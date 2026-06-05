import type { Signal, Opportunity, ScoreBreakdown, SegmentConfig } from './types.js';
import {
  SCORE_WEIGHTS,
  KILL_SCORE_THRESHOLD,
  SCALE_SCORE_THRESHOLD,
  ALERT_SCORE_THRESHOLD,
  KILL_THRESHOLD_DAYS,
  SCALE_THRESHOLD_EMAILS,
} from './rules.js';

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

export function computeOpportunityScore(
  breakdown: ScoreBreakdown,
  weights: Record<keyof ScoreBreakdown, number> = SCORE_WEIGHTS,
): number {
  const raw = (Object.entries(weights) as [keyof ScoreBreakdown, number][]).reduce(
    (sum, [k, w]) => sum + (breakdown[k] ?? 0) * w,
    0,
  );
  return Math.round(raw * 100) / 100;
}

// ---------------------------------------------------------------------------
// Individual sub-scores
// ---------------------------------------------------------------------------

const SALARY_TIERS: Record<string, number> = {
  high: 10,
  medium_high: 7,
  medium: 5,
  low: 2,
};

export function incomeTierScore(tier: string | null): number {
  if (tier === null) return 2;
  return SALARY_TIERS[tier] ?? 2;
}

export function urgencyScore(hasDeadline: boolean): number {
  return hasDeadline ? 10 : 0;
}

export function volumeScore(discoveryScore: number): number {
  return Math.round(Math.min(discoveryScore / 20.0, 1.0) * 10 * 100) / 100;
}

/**
 * Returns [dolorScore, painSummary].
 * Considers signals from the last 30 days; weights recent (< 7 days) higher.
 */
export function dolorScore(signals: Signal[], now: number = Date.now()): [number, string] {
  const cutoff = now - 30 * 86400000;
  const weekAgo = now - 7 * 86400000;
  const recent = signals.filter(s => new Date(s.collected_at).getTime() > cutoff);
  if (!recent.length) return [0, ''];

  let weighted = 0;
  let totalW = 0;
  const allKw: string[] = [];

  for (const s of recent) {
    let kws: string[] = [];
    try {
      const raw = s.pain_keywords;
      kws = Array.isArray(raw) ? raw : (JSON.parse(raw as unknown as string) as string[]);
    } catch {
      kws = [];
    }
    // Specificity heuristic (stopgap until friction detection):
    // 0 keywords → noise, discount heavily (0.3x)
    // 1 keyword  → plausible but weak (0.7x)
    // 2+ keywords → meaningful signal (1.0x)
    const specificity = kws.length === 0 ? 0.3 : kws.length === 1 ? 0.7 : 1.0;

    const w = new Date(s.collected_at).getTime() > weekAgo ? 2.0 : 1.0;
    weighted += (s.signal_strength ?? 0) * w * specificity;
    totalW += w;
    allKw.push(...kws);
  }

  // Base score: average signal quality (0-10)
  const intensity = totalW ? (weighted / totalW) * 10 : 0;

  // Volume bonus: diminishing returns, max +2.0 for high volume.
  // x/(x+5) caps at 1.0 asymptotically → * 2 = max 2 extra points.
  const volBonus = Math.min(recent.length / (recent.length + 5), 1.0) * 2;

  const dolor = Math.min(
    Math.round((intensity + volBonus) * 100) / 100,
    10.0,
  );

  const kwCount: Record<string, number> = {};
  for (const kw of allKw) kwCount[kw] = (kwCount[kw] ?? 0) + 1;
  const topKw = Object.entries(kwCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  const summary = topKw.length
    ? `Dolor en: ${topKw.join(', ')}`
    : `${recent.length} señales recientes`;

  return [dolor, summary];
}

// ---------------------------------------------------------------------------
// Business rules
// ---------------------------------------------------------------------------

export function applyRules(
  opp: Opportunity,
  killThreshold = KILL_SCORE_THRESHOLD,
  scaleThreshold = SCALE_SCORE_THRESHOLD,
  killDays = KILL_THRESHOLD_DAYS,
  scaleEmails = SCALE_THRESHOLD_EMAILS,
): Opportunity {
  if (opp.status === 'killed' || opp.status === 'scaling') return opp;
  const ageDays = (Date.now() - new Date(opp.first_seen).getTime()) / 86400000;
  if (opp.signal_count === 0 && ageDays >= killDays && opp.score < killThreshold) {
    return { ...opp, status: 'killed' };
  }
  if (opp.score >= scaleThreshold && opp.emails_captured >= scaleEmails) {
    return { ...opp, status: 'scaling' };
  }
  return opp;
}

export function shouldAlert(opp: Opportunity): boolean {
  return opp.score >= ALERT_SCORE_THRESHOLD && opp.telegram_alerted_at === null;
}

export function formatAlert(
  opp: Opportunity,
  segment: SegmentConfig,
): { subject: string; html: string; text: string } {
  const bd = opp.score_breakdown;
  const lines: string[] = [
    `Oportunidad detectada — ${segment.label}`,
    `Score: ${opp.score}/10`,
    `Dolor: ${bd.dolor.toFixed(1)} | Pago: ${bd.capacidad_pago.toFixed(0)} | Urgencia: ${bd.urgencia.toFixed(0)}`,
    `Señales: ${opp.signal_count}`,
    `Resumen: ${opp.pain_summary}`,
  ];
  if (segment.has_deadline) lines.push('Deadline activo');
  const text = lines.join('\n');

  const htmlLines: string[] = [
    `<h2>Oportunidad detectada — ${segment.label}</h2>`,
    `<p><strong>Score:</strong> ${opp.score}/10</p>`,
    `<p><strong>Dolor:</strong> ${bd.dolor.toFixed(1)} | <strong>Pago:</strong> ${bd.capacidad_pago.toFixed(0)} | <strong>Urgencia:</strong> ${bd.urgencia.toFixed(0)}</p>`,
    `<p><strong>Señales:</strong> ${opp.signal_count}</p>`,
    `<p><strong>Resumen:</strong> ${opp.pain_summary}</p>`,
  ];
  if (segment.has_deadline) htmlLines.push('<p><strong>Deadline activo</strong></p>');

  const subject = `Oportunidad detectada: ${segment.label} (${opp.score}/10)`;

  return { subject, html: htmlLines.join('\n'), text };
}
