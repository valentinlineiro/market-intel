import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSnapshot, runGapScore, currentISOWeek } from '../../application/gap.js';
import type { ISignalRepo, ISignalSnapshotRepo, IOpportunityRepo } from '../../application/ports.js';
import type { Signal, SignalSnapshot, Opportunity } from '../../domain/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig1', source: 'reddit', collected_at: new Date().toISOString(),
    segment: 'test_seg', location: null, raw_text: 'I have a big problem here',
    url: 'https://example.com', pain_keywords: [], sentiment_score: -0.5,
    salary_mean: null, income_tier: null, signal_strength: 0.8,
    has_deadline: false, friction_analysis: null,
    ...overrides,
  };
}

function makeOpp(segment: string): Opportunity {
  return {
    id: `opp-${segment}`, segment, pain_summary: 'test pain',
    score: 7.0, score_breakdown: { dolor:7, capacidad_pago:7, volumen:7, competencia:7, urgencia:7 },
    signal_ids: [], signal_count: 5, first_seen: '2026-01-01T00:00:00Z',
    last_updated: '2026-01-01T00:00:00Z', status: 'watching', landing_url: null,
    emails_captured: 0, validation_deadline: null, telegram_alerted_at: null,
  };
}

describe('currentISOWeek', () => {
  it('returns a string matching YYYY-Www format', () => {
    const week = currentISOWeek();
    expect(week).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe('runSnapshot', () => {
  let signalRepo: ISignalRepo;
  let snapshotRepo: ISignalSnapshotRepo;
  let upserted: SignalSnapshot[];

  beforeEach(() => {
    upserted = [];
    snapshotRepo = {
      upsertSnapshot: vi.fn(async (s) => { upserted.push(s); }),
      getSnapshots: vi.fn(async () => []),
      getLatestSnapshotAllSegments: vi.fn(async () => []),
    };
  });

  it('computes avg_pain as 0–10 from signal_strength (0–1)', async () => {
    signalRepo = {
      save: vi.fn(), get: vi.fn(), getAll: vi.fn(), count: vi.fn(),
      updateFriction: vi.fn(),
      getSignalsInRange: vi.fn(async () => [
        makeSignal({ segment: 'seg1', signal_strength: 0.6 }),
        makeSignal({ segment: 'seg1', signal_strength: 0.8, id: 'sig2', url: 'https://b.com' }),
      ]),
    };
    await runSnapshot(signalRepo, snapshotRepo);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]!.avg_pain).toBeCloseTo(7.0); // (0.6+0.8)/2 * 10
  });

  it('filters null signal_strength from avg_pain', async () => {
    signalRepo = {
      save: vi.fn(), get: vi.fn(), getAll: vi.fn(), count: vi.fn(),
      updateFriction: vi.fn(),
      getSignalsInRange: vi.fn(async () => [
        makeSignal({ segment: 'seg2', signal_strength: null }),
        makeSignal({ segment: 'seg2', signal_strength: 0.5, id: 'sig2', url: 'https://b.com' }),
      ]),
    };
    await runSnapshot(signalRepo, snapshotRepo);
    expect(upserted[0]!.avg_pain).toBeCloseTo(5.0); // only 0.5 * 10
  });

  it('detects __solution__ sentinel in pain_keywords', async () => {
    signalRepo = {
      save: vi.fn(), get: vi.fn(), getAll: vi.fn(), count: vi.fn(),
      updateFriction: vi.fn(),
      getSignalsInRange: vi.fn(async () => [
        makeSignal({ segment: 'seg3', pain_keywords: ['__solution__'] }),
        makeSignal({ segment: 'seg3', id: 'sig2', url: 'https://b.com' }),
      ]),
    };
    await runSnapshot(signalRepo, snapshotRepo);
    expect(upserted[0]!.solution_ratio).toBe(0.5);
  });

  it('detects English solution keywords in raw_text', async () => {
    signalRepo = {
      save: vi.fn(), get: vi.fn(), getAll: vi.fn(), count: vi.fn(),
      updateFriction: vi.fn(),
      getSignalsInRange: vi.fn(async () => [
        makeSignal({ segment: 'seg4', raw_text: 'I use this tool every day' }),
        makeSignal({ segment: 'seg4', id: 'sig2', url: 'https://b.com', raw_text: 'big problem' }),
      ]),
    };
    await runSnapshot(signalRepo, snapshotRepo);
    expect(upserted[0]!.solution_ratio).toBe(0.5);
  });
});

describe('runGapScore', () => {
  it('computes gap_score from pain × momentum × whitespace, normalized 0–100', async () => {
    const updated: Array<{ segment: string; score: number }> = [];
    const oppRepo: IOpportunityRepo = {
      upsert: vi.fn(), getBySegment: vi.fn(), markAlerted: vi.fn(),
      getAll: vi.fn(async () => [makeOpp('seg1')]),
      updateGapScore: vi.fn(async (seg, score) => { updated.push({ segment: seg, score }); }),
    };
    const snapshotRepo: ISignalSnapshotRepo = {
      upsertSnapshot: vi.fn(),
      getLatestSnapshotAllSegments: vi.fn(),
      getSnapshots: vi.fn(async (seg, weeksBack) => [
        // Current week: count=20, prior 4 weeks avg=10 → momentum=2.0
        { segment: seg, week: '2026-W23', count: 20, avg_pain: 8.0, solution_ratio: 0.2 },
        { segment: seg, week: '2026-W22', count: 10, avg_pain: 7.0, solution_ratio: 0.1 },
        { segment: seg, week: '2026-W21', count: 10, avg_pain: 7.0, solution_ratio: 0.1 },
        { segment: seg, week: '2026-W20', count: 10, avg_pain: 7.0, solution_ratio: 0.1 },
        { segment: seg, week: '2026-W19', count: 10, avg_pain: 7.0, solution_ratio: 0.1 },
      ]),
    };
    await runGapScore(snapshotRepo, oppRepo);
    // raw = (8.0/10) × (20/10) × (1-0.2) = 0.8 × 2.0 × 0.8 = 1.28
    // gap_score = min(round(1.28/3 * 100), 100) = min(43, 100) = 43
    expect(updated[0]!.score).toBe(43);
  });

  it('uses momentum=1.0 when fewer than 4 prior weeks', async () => {
    const updated: Array<{ segment: string; score: number }> = [];
    const oppRepo: IOpportunityRepo = {
      upsert: vi.fn(), getBySegment: vi.fn(), markAlerted: vi.fn(),
      getAll: vi.fn(async () => [makeOpp('seg2')]),
      updateGapScore: vi.fn(async (seg, score) => { updated.push({ segment: seg, score }); }),
    };
    const snapshotRepo: ISignalSnapshotRepo = {
      upsertSnapshot: vi.fn(),
      getLatestSnapshotAllSegments: vi.fn(),
      getSnapshots: vi.fn(async () => [
        { segment: 'seg2', week: '2026-W23', count: 10, avg_pain: 6.0, solution_ratio: 0.0 },
      ]),
    };
    await runGapScore(snapshotRepo, oppRepo);
    // raw = (6.0/10) × 1.0 × 1.0 = 0.6 → score = round(0.6/3 * 100) = 20
    expect(updated[0]!.score).toBe(20);
  });

  it('guards against division by zero when prior weeks all have count=0', async () => {
    const updated: Array<{ segment: string; score: number }> = [];
    const oppRepo: IOpportunityRepo = {
      upsert: vi.fn(), getBySegment: vi.fn(), markAlerted: vi.fn(),
      getAll: vi.fn(async () => [makeOpp('seg3')]),
      updateGapScore: vi.fn(async (seg, score) => { updated.push({ segment: seg, score }); }),
    };
    const snapshotRepo: ISignalSnapshotRepo = {
      upsertSnapshot: vi.fn(),
      getLatestSnapshotAllSegments: vi.fn(),
      getSnapshots: vi.fn(async () => [
        { segment: 'seg3', week: '2026-W23', count: 5, avg_pain: 5.0, solution_ratio: 0.0 },
        { segment: 'seg3', week: '2026-W22', count: 0, avg_pain: 0.0, solution_ratio: 0.0 },
        { segment: 'seg3', week: '2026-W21', count: 0, avg_pain: 0.0, solution_ratio: 0.0 },
        { segment: 'seg3', week: '2026-W20', count: 0, avg_pain: 0.0, solution_ratio: 0.0 },
        { segment: 'seg3', week: '2026-W19', count: 0, avg_pain: 0.0, solution_ratio: 0.0 },
      ]),
    };
    // momentum = 5 / max(0, 1) = 5.0 — but capped by normalization
    await runGapScore(snapshotRepo, oppRepo);
    expect(updated[0]!.score).toBeGreaterThanOrEqual(0);
    expect(updated[0]!.score).toBeLessThanOrEqual(100);
    expect(Number.isFinite(updated[0]!.score)).toBe(true);
  });

  it('skips segments with no snapshots', async () => {
    const updated: Array<unknown> = [];
    const oppRepo: IOpportunityRepo = {
      upsert: vi.fn(), getBySegment: vi.fn(), markAlerted: vi.fn(),
      getAll: vi.fn(async () => [makeOpp('empty_seg')]),
      updateGapScore: vi.fn(async (_, score) => { updated.push(score); }),
    };
    const snapshotRepo: ISignalSnapshotRepo = {
      upsertSnapshot: vi.fn(),
      getLatestSnapshotAllSegments: vi.fn(),
      getSnapshots: vi.fn(async () => []),
    };
    await runGapScore(snapshotRepo, oppRepo);
    expect(updated).toHaveLength(0);
  });
});

// ── helpers (not exported, just used by tests) ────────────────────────────

function weekStart(isoWeek: string): string {
  const [y, w] = isoWeek.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y!, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const ms = jan4.getTime() - (day - 1) * 86400000 + (w! - 1) * 7 * 86400000;
  return new Date(ms).toISOString();
}
function weekEnd(isoWeek: string): string {
  const start = new Date(weekStart(isoWeek));
  return new Date(start.getTime() + 7 * 86400000).toISOString();
}
