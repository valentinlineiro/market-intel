import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../../infrastructure/collectors/registry.js';
import type { Config } from '../../domain/types.js';
import type { Env } from '../../index.js';

const MINIMAL_CFG: Config = {
  segments: {},
  score: { top_n: 10, min_score: 5, dry_run: true },
  llm: { provider: 'groq', model: 'llama-3.1-8b-instant', temperature: 0.3, max_tokens: 1024 },
  discover: { max_clusters: 10, min_signals: 3 },
  notifications: { from_email: '', to_email: '', alert_score_threshold: 7 },
  collectors: {
    gnews: { enabled: true, max_results: 5, segments: {} },
    local_news: { enabled: true, feeds: [], pain_keywords: [] },
    reddit: { enabled: true, subreddits: ['es'] },
    youtube: { enabled: true, max_videos: 2, max_comments_per_video: 5 },
    bluesky: { enabled: true, max_results: 10 },
    mastodon: { enabled: true, instances: ['mastodon.social'], max_results: 5 },
  },
  synthesis_segments: {},
};

const MINIMAL_ENV = { DB: {} } as unknown as Env;

describe('buildRegistry', () => {
  it('returns a Collector for each source', () => {
    const collectors = buildRegistry(MINIMAL_CFG, MINIMAL_ENV);
    const ids = collectors.map(c => c.id);
    expect(ids).toContain('gnews');
    expect(ids).toContain('local_news');
    expect(ids).toContain('github');
    expect(ids).toContain('stackoverflow');
    expect(ids).toContain('reddit');
    expect(ids).toContain('youtube');
    expect(ids).toContain('bluesky');
    expect(ids).toContain('mastodon');
  });

  it('every collector has a collect function', () => {
    const collectors = buildRegistry(MINIMAL_CFG, MINIMAL_ENV);
    for (const c of collectors) {
      expect(typeof c.collect).toBe('function');
    }
  });
});
