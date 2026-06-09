import { describe, it, expect } from 'vitest';
import { computeLeadScore } from '../../application/lead-score.js';

const NOW = new Date('2026-06-09T12:00:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('computeLeadScore', () => {
  it('max score: €50+, <7 days, opp≥7 = 10', () => {
    expect(computeLeadScore('50+', daysAgo(1), 8.5, NOW)).toBe(10);
  });

  it('price tier points', () => {
    expect(computeLeadScore('50+',   daysAgo(60), null, NOW)).toBe(4);
    expect(computeLeadScore('30-50', daysAgo(60), null, NOW)).toBe(3);
    expect(computeLeadScore('10-30', daysAgo(60), null, NOW)).toBe(1.5);
    expect(computeLeadScore('0-10',  daysAgo(60), null, NOW)).toBe(0);
  });

  it('null price_tier contributes 0', () => {
    expect(computeLeadScore(null, daysAgo(60), null, NOW)).toBe(0);
  });

  it('recency points: <7 days = 3, 7-30 = 1.5, >30 = 0', () => {
    expect(computeLeadScore(null, daysAgo(3),  null, NOW)).toBe(3);
    expect(computeLeadScore(null, daysAgo(15), null, NOW)).toBe(1.5);
    expect(computeLeadScore(null, daysAgo(45), null, NOW)).toBe(0);
  });

  it('segment points: ≥7 = 3, 5-7 = 1.5, <5 = 0', () => {
    expect(computeLeadScore(null, daysAgo(60), 8.0, NOW)).toBe(3);
    expect(computeLeadScore(null, daysAgo(60), 6.0, NOW)).toBe(1.5);
    expect(computeLeadScore(null, daysAgo(60), 3.0, NOW)).toBe(0);
  });

  it('null opportunity score contributes 0', () => {
    expect(computeLeadScore(null, daysAgo(60), null, NOW)).toBe(0);
  });

  it('unknown price_tier string treated as 0', () => {
    expect(computeLeadScore('banana', daysAgo(60), null, NOW)).toBe(0);
  });

  it('result is rounded to 1 decimal', () => {
    // 1.5 + 1.5 + 1.5 = 4.5
    expect(computeLeadScore('10-30', daysAgo(15), 6.0, NOW)).toBe(4.5);
  });
});
