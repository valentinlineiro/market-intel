import type { ISignalRepo, ISignalSnapshotRepo, IOpportunityRepo } from './ports.js';

export const SOLUTION_KEYWORDS = [
  'uso ', 'utilizo ', 'existe ', 'herramienta', 'ya hay',
  'use ', 'tool', 'there is', 'alternative', 'already exists',
];

export function currentISOWeek(): string {
  const d = new Date();
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weekBounds(isoWeek: string): { from: string; to: string } {
  const [yearStr, weekStr] = isoWeek.split('-W');
  const year = parseInt(yearStr!);
  const week = parseInt(weekStr!);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const startMs = jan4.getTime() - (jan4Day - 1) * 86400000 + (week - 1) * 7 * 86400000;
  return {
    from: new Date(startMs).toISOString(),
    to:   new Date(startMs + 7 * 86400000).toISOString(),
  };
}

function isSolution(signal: { pain_keywords: string[]; raw_text: string }): boolean {
  if (signal.pain_keywords.includes('__solution__')) return true;
  const text = signal.raw_text.toLowerCase();
  return SOLUTION_KEYWORDS.some(kw => text.includes(kw));
}

export async function runSnapshot(
  signalRepo: ISignalRepo,
  snapshotRepo: ISignalSnapshotRepo,
): Promise<void> {
  const week = currentISOWeek();
  const { from, to } = weekBounds(week);
  const signals = await signalRepo.getSignalsInRange(from, to);

  const bySegment = new Map<string, typeof signals>();
  for (const signal of signals) {
    const group = bySegment.get(signal.segment) ?? [];
    group.push(signal);
    bySegment.set(signal.segment, group);
  }

  await Promise.all([...bySegment.entries()].map(([segment, segs]) => {
    const withPain = segs.filter(s => s.signal_strength !== null);
    const avg_pain = withPain.length > 0
      ? (withPain.reduce((sum, s) => sum + s.signal_strength!, 0) / withPain.length) * 10
      : 0;
    const solutionCount  = segs.filter(isSolution).length;
    const solution_ratio = segs.length > 0 ? solutionCount / segs.length : 0;

    return snapshotRepo.upsertSnapshot({ segment, week, count: segs.length, avg_pain, solution_ratio });
  }));
}

export async function runGapScore(
  snapshotRepo: ISignalSnapshotRepo,
  opportunityRepo: IOpportunityRepo,
): Promise<void> {
  const opportunities = await opportunityRepo.getAll();

  const scored = await Promise.all(
    opportunities.map(async opp => {
      const snapshots = await snapshotRepo.getSnapshots(opp.segment, 5);
      if (snapshots.length === 0) return null;

      const latest   = snapshots[0]!;
      const prior    = snapshots.slice(1);
      const priorAvg = prior.length > 0
        ? prior.reduce((sum, s) => sum + s.count, 0) / prior.length
        : latest.count;

      const momentum  = latest.count / Math.max(priorAvg, 1);
      const rawScore  = (latest.avg_pain / 10) * momentum * (1 - latest.solution_ratio);
      const gap_score = Math.min(Math.round(rawScore / 3 * 100), 100);

      return { segment: opp.segment, gap_score };
    }),
  );

  await Promise.all(
    scored
      .filter((r): r is { segment: string; gap_score: number } => r !== null)
      .map(r => opportunityRepo.updateGapScore(r.segment, r.gap_score)),
  );
}
