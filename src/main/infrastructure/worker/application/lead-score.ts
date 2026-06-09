const PRICE_POINTS: Record<string, number> = {
  '50+':   4.0,
  '30-50': 3.0,
  '10-30': 1.5,
  '0-10':  0.0,
};

function recencyPoints(capturedAt: string, now: number): number {
  const ageDays = (now - new Date(capturedAt).getTime()) / 86_400_000;
  if (ageDays < 7)  return 3.0;
  if (ageDays < 30) return 1.5;
  return 0.0;
}

function segmentPoints(opportunityScore: number | null): number {
  if (opportunityScore === null) return 0.0;
  if (opportunityScore >= 7)    return 3.0;
  if (opportunityScore >= 5)    return 1.5;
  return 0.0;
}

export function computeLeadScore(
  priceTier: string | null,
  capturedAt: string,
  opportunityScore: number | null,
  now = Date.now(),
): number {
  const price   = priceTier != null ? (PRICE_POINTS[priceTier] ?? 0.0) : 0.0;
  const recency = recencyPoints(capturedAt, now);
  const segment = segmentPoints(opportunityScore);
  return Math.round((price + recency + segment) * 10) / 10;
}
