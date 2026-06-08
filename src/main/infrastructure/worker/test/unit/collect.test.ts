import { describe, it, expect, vi } from 'vitest';
import { runCollect } from '../../application/collect.js';
import type { ISignalRepo, Collector } from '../../application/ports.js';
import type { Signal } from '../../domain/types.js';

function makeSignal(id: string): Signal {
  return {
    id,
    source:          'gnews',
    collected_at:    new Date().toISOString(),
    segment:         'test',
    location:        null,
    raw_text:        'text',
    url:             `https://example.com/${id}`,
    pain_keywords:   [],
    sentiment_score: null,
    salary_mean:     null,
    income_tier:     null,
    signal_strength: 0.5,
    has_deadline:    false,
  };
}

function makeRepo(saveResult = true): ISignalRepo {
  return {
    save:           vi.fn().mockResolvedValue(saveResult),
    get:            vi.fn().mockResolvedValue([]),
    getAll:         vi.fn().mockResolvedValue([]),
    count:          vi.fn().mockResolvedValue(0),
    updateFriction: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCollector(id: string, signals: Signal[]): Collector {
  return { id, collect: async () => signals };
}

describe('runCollect', () => {
  it('returns all newly saved signals from all collectors', async () => {
    const s1 = makeSignal('a');
    const s2 = makeSignal('b');
    const repo = makeRepo(true);

    const { signals } = await runCollect(repo, [
      makeCollector('c1', [s1]),
      makeCollector('c2', [s2]),
    ]);

    expect(signals).toHaveLength(2);
    expect(signals).toContain(s1);
    expect(signals).toContain(s2);
  });

  it('excludes duplicate signals when repo.save returns false', async () => {
    const s1 = makeSignal('a');
    const repo = makeRepo(false);

    const { signals } = await runCollect(repo, [makeCollector('c1', [s1])]);

    expect(signals).toHaveLength(0);
  });

  it('returns empty array when no collectors produce signals', async () => {
    const repo = makeRepo(true);
    const { signals } = await runCollect(repo, [makeCollector('c1', [])]);
    expect(signals).toHaveLength(0);
  });

  it('returns one stat per collector', async () => {
    const repo = makeRepo(true);
    const { stats } = await runCollect(repo, [
      makeCollector('c1', [makeSignal('a')]),
      makeCollector('c2', [makeSignal('b'), makeSignal('c')]),
    ]);
    expect(stats).toHaveLength(2);
    expect(stats.find(s => s.id === 'c1')!.count).toBe(1);
    expect(stats.find(s => s.id === 'c2')!.count).toBe(2);
  });

  it('stat error is set and other collectors still run when a collector throws', async () => {
    const repo = makeRepo(true);
    const goodSignal = makeSignal('a');
    const thrower: Collector = {
      id: 'bad',
      collect: async () => { throw new Error('API down'); },
    };
    const good: Collector = { id: 'good', collect: async () => [goodSignal] };

    const { signals, stats } = await runCollect(repo, [thrower, good]);

    expect(signals).toHaveLength(1);
    const badStat = stats.find(s => s.id === 'bad')!;
    expect(badStat.count).toBe(0);
    expect(badStat.error).toContain('API down');
    const goodStat = stats.find(s => s.id === 'good')!;
    expect(goodStat.count).toBe(1);
    expect(goodStat.error).toBeUndefined();
  });
});
