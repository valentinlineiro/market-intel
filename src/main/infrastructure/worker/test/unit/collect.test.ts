import { describe, it, expect, vi } from 'vitest';
import { runCollect } from '../../application/collect.js';
import type { ISignalRepo, Collector } from '../../application/ports.js';
import type { Signal, FrictionProfile } from '../../domain/types.js';

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

    const result = await runCollect(repo, [
      makeCollector('c1', [s1]),
      makeCollector('c2', [s2]),
    ]);

    expect(result).toHaveLength(2);
    expect(result).toContain(s1);
    expect(result).toContain(s2);
  });

  it('excludes duplicate signals when repo.save returns false', async () => {
    const s1 = makeSignal('a');
    const repo = makeRepo(false);

    const result = await runCollect(repo, [makeCollector('c1', [s1])]);

    expect(result).toHaveLength(0);
  });

  it('returns empty array when no collectors produce signals', async () => {
    const repo = makeRepo(true);
    const result = await runCollect(repo, [makeCollector('c1', [])]);
    expect(result).toHaveLength(0);
  });
});
