import type { ISignalRepo, IOpportunityRepo, IDiscoveryRepo, INotifier, ILLMProvider } from './ports.js';
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

const NARRATIVE_PROMPT = `Eres un analista de mercado. Explica en 2-3 frases cortas y directas por qué este segmento obtuvo la puntuación indicada. Menciona los factores más determinantes (positivos y negativos). No uses listas, solo texto corrido en español.

Segmento: {segment}
Puntuación: {score}/10
Dolor: {dolor}/10 ({signal_count} señales, resumen: {pain_summary})
Capacidad de pago: {capacidad_pago}/10
Volumen de mercado: {volumen}/10
Urgencia: {urgencia}/10
Competencia (estimada): {competencia}/10

Responde SOLO con el texto explicativo, sin encabezados ni etiquetas.`;

async function generateNarrative(
  segment: string,
  score: number,
  breakdown: ScoreBreakdown,
  signal_count: number,
  pain_summary: string,
  llm: ILLMProvider,
): Promise<string> {
  const prompt = NARRATIVE_PROMPT
    .replace('{segment}', segment)
    .replace('{score}', score.toFixed(1))
    .replace('{dolor}', breakdown.dolor.toFixed(1))
    .replace('{signal_count}', String(signal_count))
    .replace('{pain_summary}', pain_summary.slice(0, 120))
    .replace('{capacidad_pago}', breakdown.capacidad_pago.toFixed(1))
    .replace('{volumen}', breakdown.volumen.toFixed(1))
    .replace('{urgencia}', breakdown.urgencia.toFixed(1))
    .replace('{competencia}', breakdown.competencia.toFixed(1));
  const raw = await llm.complete(prompt, 200);
  return raw.trim();
}

export interface ScoreResult {
  segment: string;
  score: number;
  status: string;
  signal_count: number;
  breakdown: ScoreBreakdown;
  pain_summary: string;
  score_narrative: string | null;
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
  llm?: ILLMProvider,
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

    let narrative: string | null = existing?.score_narrative ?? null;
    // Regenerate when score changed by ≥0.5 or no narrative exists yet
    const scoreChanged = !existing || Math.abs(existing.score - score) >= 0.5;
    if (llm && !dryRun && (scoreChanged || !narrative)) {
      try {
        narrative = await generateNarrative(seg.key, score, breakdown, signalCount, painSummary, llm);
      } catch (e) {
        console.error('[score] narrative generation failed for', seg.key, ':', e instanceof Error ? e.message : e);
      }
    }

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
      score_narrative: narrative,
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
      score_narrative: narrative,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
