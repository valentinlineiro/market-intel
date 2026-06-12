import type { DiscoveryCandidate, MarketSegment } from './types.js';

/**
 * Builds baseline DiscoveryCandidate records from hardcoded segment config.
 * Used as a fallback when no discovery run has produced candidates yet.
 */
export function seedCandidatesFromConfig(
  segments: Record<string, MarketSegment>,
  now: string,
): DiscoveryCandidate[] {
  return Object.entries(segments).map(([key, sc]) => ({
    segment:         key,
    label:           sc.label,
    pain_summary:    '',
    discovery_score: 5,
    source_urls:     [],
    raw_signals:     sc.keywords,
    discovered_at:   now,
    post_count:      0,
    income_est:      sc.income_tier,
    has_deadline:    sc.has_deadline,
  }));
}
