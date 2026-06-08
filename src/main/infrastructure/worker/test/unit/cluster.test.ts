import { describe, it, expect } from 'vitest';
import { jaccardSimilarity, clusterSignals } from '../../domain/cluster.js';
import type { Signal } from '../../domain/types.js';

function makeSignal(id: string, keywords: string[], ss = 0.5): Signal {
  return {
    id,
    source: 'gnews',
    collected_at: new Date().toISOString(),
    segment: 'test',
    location: null,
    raw_text: 'text',
    url: 'http://example.com',
    pain_keywords: keywords,
    sentiment_score: null,
    salary_mean: null,
    income_tier: null,
    signal_strength: ss,
    has_deadline: false,
  };
}

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('returns 1/3 for one shared element out of three unique', () => {
    // intersection={b}, union={a,b,c} → 1/3
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 5);
  });

  it('returns 1 for two empty arrays', () => {
    expect(jaccardSimilarity([], [])).toBe(1);
  });

  it('returns 0 when one side is empty', () => {
    expect(jaccardSimilarity(['a'], [])).toBe(0);
    expect(jaccardSimilarity([], ['a'])).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(jaccardSimilarity(['Verifactu'], ['verifactu'])).toBe(1);
  });
});

describe('clusterSignals', () => {
  it('puts a single signal into its own cluster', () => {
    const clusters = clusterSignals([makeSignal('a', ['kw1', 'kw2'])]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(1);
  });

  it('groups identical-keyword signals into one cluster', () => {
    const s1 = makeSignal('s1', ['verifactu', 'hacienda']);
    const s2 = makeSignal('s2', ['verifactu', 'hacienda']);
    const clusters = clusterSignals([s1, s2]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('keeps disjoint-keyword signals in separate clusters', () => {
    const s1 = makeSignal('s1', ['verifactu', 'hacienda']);
    const s2 = makeSignal('s2', ['aneca', 'sexenio']);
    const clusters = clusterSignals([s1, s2]);
    expect(clusters).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(clusterSignals([])).toHaveLength(0);
  });

  it('respects a lower threshold — groups partial overlap', () => {
    const s1 = makeSignal('s1', ['a', 'b', 'c']);
    const s2 = makeSignal('s2', ['a', 'b', 'd']); // Jaccard = 2/4 = 0.5
    const atDefault = clusterSignals([s1, s2], 0.85);
    const atLow = clusterSignals([s1, s2], 0.5);
    expect(atDefault).toHaveLength(2);
    expect(atLow).toHaveLength(1);
  });

  it('groups empty-keyword signals together (Jaccard 1.0)', () => {
    const s1 = makeSignal('s1', []);
    const s2 = makeSignal('s2', []);
    const clusters = clusterSignals([s1, s2]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });
});
