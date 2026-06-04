import type { ISignalRepo, IOpportunityRepo, IDiscoveryRepo, INotifier } from './ports.js';
import type { Opportunity, ScoreBreakdown } from '../domain/types.js';
import {
  computeOpportunityScore,
  dolorScore,
  incomeTierScore,
  urgencyScore,
  volumeScore,
  applyRules,
  shouldAlert,
  formatAlert,
} from '../domain/scoring.js';
import { DEFAULT_COMPETENCIA_SCORE } from '../domain/rules.js';

export interface ScoreResult {
  segment: string;
  score: number;
  status: string;
  signal_count: number;
  breakdown: ScoreBreakdown;
  pain_summary: string;
}

export async function runScore(
  repos: {
    signals: ISignalRepo;
    opportunities: IOpportunityRepo;
    discovery: IDiscoveryRepo;
  },
  notifier: INotifier,
  topN: number,
  minScore: number,
  dryRun: boolean,
): Promise<ScoreResult[]> {
  const segments = await repos.discovery.getSegmentsToScore(topN, minScore);
  const results: ScoreResult[] = [];

  for (const seg of segments) {
    const signals = await repos.signals.get(seg.key, 500);
    const signalCount = await repos.signals.count(seg.key);

    const [dolor, painSummary] = dolorScore(signals);
    const breakdown: ScoreBreakdown = {
      dolor,
      capacidad_pago: incomeTierScore(seg.income_tier),
      volumen: volumeScore(seg.discovery_score),
      competencia: DEFAULT_COMPETENCIA_SCORE,
      urgencia: urgencyScore(seg.has_deadline),
    };
    const score = computeOpportunityScore(breakdown);

    const existing = await repos.opportunities.getBySegment(seg.key);

    const now = new Date().toISOString();
    const opp: Opportunity = {
      id: existing?.id ?? crypto.randomUUID().slice(0, 8),
      segment: seg.key,
      pain_summary: painSummary || existing?.pain_summary || '',
      score,
      score_breakdown: breakdown,
      signal_ids: signals.slice(-50).map(s => s.id),
      signal_count: signalCount,
      first_seen: existing?.first_seen ?? now,
      last_updated: now,
      status: existing?.status ?? 'watching',
      landing_url: existing?.landing_url ?? null,
      emails_captured: existing?.emails_captured ?? 0,
      validation_deadline: existing?.validation_deadline ?? null,
      telegram_alerted_at: existing?.telegram_alerted_at ?? null,
    };

    const finalOpp = applyRules(opp);

    if (!dryRun) {
      await repos.opportunities.upsert(finalOpp);

      if (shouldAlert(finalOpp) && finalOpp.status === 'watching') {
        const { subject, html, text } = formatAlert(finalOpp, seg);
        const sent = await notifier.send(subject, html, text);
        if (sent) {
          await repos.opportunities.markAlerted(finalOpp.id, now);
        }
      }
    }

    results.push({
      segment: seg.key,
      score: finalOpp.score,
      status: finalOpp.status,
      signal_count: finalOpp.signal_count,
      breakdown,
      pain_summary: finalOpp.pain_summary,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
