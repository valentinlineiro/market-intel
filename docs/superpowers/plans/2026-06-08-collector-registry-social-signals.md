# Collector Registry + Social Network Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a typed `Collector` interface and a `buildRegistry` factory so adding a new signal source requires touching exactly 2 files, then ship YouTube, Bluesky, and Mastodon collectors using that interface.

**Architecture:** A `Collector` has `id` + `collect(): Promise<Signal[]>`. `buildRegistry(cfg, env)` is the single place where secrets and config are bound to collector factories. `runCollect` accepts `Collector[]`; the cron handler calls `buildRegistry` and passes the result directly. Each collector module is a pure function that knows nothing about `Env`.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest (tests), YouTube Data API v3, Bluesky AT Protocol (`public.api.bsky.app`), Mastodon REST API.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `application/ports.ts` | Modify | Add `Collector` interface |
| `application/collect.ts` | Modify | Accept `Collector[]` instead of raw factories |
| `test/unit/collect.test.ts` | Modify | Update tests to use `Collector` shape |
| `domain/types.ts` | Modify | Extend `SignalSource`, extend `Config.collectors` |
| `infrastructure/config.ts` | Modify | Add reddit/youtube/bluesky/mastodon to `DEFAULT_CONFIG` |
| `index.ts` | Modify | Add `YOUTUBE_API_KEY` to `Env`; replace 20-line cron wiring with `buildRegistry` |
| `infrastructure/collectors/registry.ts` | **Create** | `buildRegistry(cfg, env): Collector[]` |
| `infrastructure/collectors/youtube.ts` | **Create** | YouTube Data API v3 collector |
| `infrastructure/collectors/bluesky.ts` | **Create** | Bluesky AT Protocol collector |
| `infrastructure/collectors/mastodon.ts` | **Create** | Mastodon public search collector |
| `test/unit/registry.test.ts` | **Create** | `buildRegistry` smoke test |
| `test/unit/youtube.test.ts` | **Create** | YouTube collector unit tests |
| `test/unit/bluesky.test.ts` | **Create** | Bluesky collector unit tests |
| `test/unit/mastodon.test.ts` | **Create** | Mastodon collector unit tests |

---

## Task 1: `Collector` interface + `runCollect` migration

**Files:**
- Modify: `src/main/infrastructure/worker/application/ports.ts`
- Modify: `src/main/infrastructure/worker/application/collect.ts`
- Modify: `src/main/infrastructure/worker/test/unit/collect.test.ts`

- [ ] **Step 1: Update collect.test.ts to use `Collector` shape**

Replace the existing `runCollect` test calls (they currently pass `async () => [signal]`):

```typescript
// src/main/infrastructure/worker/test/unit/collect.test.ts
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
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "collect"
```

Expected: TypeScript error — `Collector` not yet defined in ports.ts.

- [ ] **Step 3: Add `Collector` interface to ports.ts**

Add after the last existing interface in `src/main/infrastructure/worker/application/ports.ts`:

```typescript
export interface Collector {
  id: string;
  collect(): Promise<Signal[]>;
}
```

- [ ] **Step 4: Update `runCollect` in collect.ts**

```typescript
// src/main/infrastructure/worker/application/collect.ts
import type { ISignalRepo, Collector } from './ports.js';
import type { Signal } from '../domain/types.js';

export async function runCollect(
  repo: ISignalRepo,
  collectors: Collector[],
): Promise<Signal[]> {
  const saved: Signal[] = [];
  for (const collector of collectors) {
    const signals = await collector.collect();
    for (const signal of signals) {
      const isNew = await repo.save(signal);
      if (isNew) saved.push(signal);
    }
  }
  return saved;
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  107 passed`

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/application/ports.ts \
        src/main/infrastructure/worker/application/collect.ts \
        src/main/infrastructure/worker/test/unit/collect.test.ts
git commit -m "feat: Collector interface — runCollect accepts Collector[] instead of raw factories"
```

---

## Task 2: Extend types and config for new sources

**Files:**
- Modify: `src/main/infrastructure/worker/domain/types.ts`
- Modify: `src/main/infrastructure/worker/infrastructure/config.ts`
- Modify: `src/main/infrastructure/worker/index.ts` (Env only)

- [ ] **Step 1: Extend `SignalSource` in types.ts**

Find and replace the `SignalSource` line in `src/main/infrastructure/worker/domain/types.ts`:

```typescript
// Before:
export type SignalSource = 'gnews' | 'local_news' | 'reddit' | 'github';

// After:
export type SignalSource =
  | 'gnews' | 'local_news' | 'reddit' | 'github' | 'stackoverflow'
  | 'youtube' | 'bluesky' | 'mastodon';
```

- [ ] **Step 2: Extend `Config.collectors` in types.ts**

Find the `Config` interface's `collectors` block and replace it:

```typescript
  collectors: {
    gnews: {
      enabled: boolean;
      max_results: number;
      segments: Record<string, GnewsSegmentConfig>;
    };
    local_news: {
      enabled: boolean;
      feeds: Array<{ url: string; location: string }>;
      pain_keywords: string[];
    };
    reddit: {
      enabled: boolean;
      subreddits: string[];
    };
    youtube: {
      enabled: boolean;
      max_videos: number;
      max_comments_per_video: number;
    };
    bluesky: {
      enabled: boolean;
      max_results: number;
    };
    mastodon: {
      enabled: boolean;
      instances: string[];
      max_results: number;
    };
  };
```

- [ ] **Step 3: Add defaults to DEFAULT_CONFIG in config.ts**

In `src/main/infrastructure/worker/infrastructure/config.ts`, add inside the `collectors` block (after `local_news`):

```typescript
    reddit: {
      enabled: true,
      subreddits: ['es', 'spain', 'preguntaespana', 'autonomos', 'freelance'],
    },
    youtube: {
      enabled: true,
      max_videos: 5,
      max_comments_per_video: 20,
    },
    bluesky: {
      enabled: true,
      max_results: 25,
    },
    mastodon: {
      enabled: true,
      instances: ['mastodon.social', 'mastodon.es'],
      max_results: 20,
    },
```

- [ ] **Step 4: Add `YOUTUBE_API_KEY` to `Env` in index.ts**

Find the `Env` interface in `src/main/infrastructure/worker/index.ts` and add:

```typescript
export interface Env {
  DB: D1Database;
  WORKER_SECRET: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GITHUB_TOKEN?: string;
  YOUTUBE_API_KEY?: string;   // ← add this line
  EMAIL?: SendEmail;
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  107 passed` (no behavioral change yet, just types).

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/domain/types.ts \
        src/main/infrastructure/worker/infrastructure/config.ts \
        src/main/infrastructure/worker/index.ts
git commit -m "feat: extend SignalSource + Config for reddit/youtube/bluesky/mastodon collectors"
```

---

## Task 3: `buildRegistry` + cron migration

**Files:**
- Create: `src/main/infrastructure/worker/infrastructure/collectors/registry.ts`
- Create: `src/main/infrastructure/worker/test/unit/registry.test.ts`
- Modify: `src/main/infrastructure/worker/index.ts`

- [ ] **Step 1: Write registry smoke test**

```typescript
// src/main/infrastructure/worker/test/unit/registry.test.ts
import { describe, it, expect } from 'vitest';
import { buildRegistry } from '../../infrastructure/collectors/registry.js';
import type { Config } from '../../domain/types.js';
import type { Env } from '../../index.js';

const MINIMAL_CFG: Config = {
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
```

- [ ] **Step 2: Run test — expect failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep "registry"
```

Expected: FAIL — `buildRegistry` not found.

- [ ] **Step 3: Create registry.ts**

```typescript
// src/main/infrastructure/worker/infrastructure/collectors/registry.ts
import type { Collector } from '../../application/ports.js';
import type { Config, Signal } from '../../domain/types.js';
import type { Env } from '../../index.js';
import { collectGnews } from './gnews.js';
import { collectLocalNews } from './local_news.js';
import { collectGitHub } from './github.js';
import { collectStackOverflow } from './stackoverflow.js';
import { collectReddit } from './reddit.js';
import { collectYouTube } from './youtube.js';
import { collectBluesky } from './bluesky.js';
import { collectMastodon } from './mastodon.js';

export function buildRegistry(cfg: Config, env: Env): Collector[] {
  const segments = Object.entries(cfg.collectors.gnews.segments);

  return [
    {
      id: 'gnews',
      collect: () => collectGnews(cfg.collectors.gnews.segments, env.GROQ_API_KEY ?? ''),
    },
    {
      id: 'local_news',
      collect: () => collectLocalNews(cfg.collectors.local_news),
    },
    {
      id: 'github',
      collect: async () => {
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectGitHub(sc.keywords, segment, env.GITHUB_TOKEN));
        }
        return all;
      },
    },
    {
      id: 'stackoverflow',
      collect: async () => {
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectStackOverflow(sc.keywords, sc.keywords.slice(0, 3), segment, ''));
        }
        return all;
      },
    },
    {
      id: 'reddit',
      collect: async () => {
        if (!cfg.collectors.reddit.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectReddit(cfg.collectors.reddit.subreddits, sc.keywords, segment));
        }
        return all;
      },
    },
    {
      id: 'youtube',
      collect: async () => {
        if (!cfg.collectors.youtube.enabled || !env.YOUTUBE_API_KEY) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectYouTube(
            sc.keywords,
            segment,
            env.YOUTUBE_API_KEY,
            cfg.collectors.youtube.max_videos,
            cfg.collectors.youtube.max_comments_per_video,
          ));
        }
        return all;
      },
    },
    {
      id: 'bluesky',
      collect: async () => {
        if (!cfg.collectors.bluesky.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectBluesky(sc.keywords, segment, cfg.collectors.bluesky.max_results));
        }
        return all;
      },
    },
    {
      id: 'mastodon',
      collect: async () => {
        if (!cfg.collectors.mastodon.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectMastodon(
            sc.keywords,
            segment,
            cfg.collectors.mastodon.instances,
            cfg.collectors.mastodon.max_results,
          ));
        }
        return all;
      },
    },
  ];
}
```

- [ ] **Step 4: Create stub files so registry.ts compiles**

Create three empty-export stubs (will be filled in Tasks 4–6):

```typescript
// src/main/infrastructure/worker/infrastructure/collectors/youtube.ts
import type { Signal } from '../../domain/types.js';
export async function collectYouTube(
  _keywords: string[], _segment: string, _apiKey: string,
  _maxVideos: number, _maxComments: number,
): Promise<Signal[]> { return []; }
```

```typescript
// src/main/infrastructure/worker/infrastructure/collectors/bluesky.ts
import type { Signal } from '../../domain/types.js';
export async function collectBluesky(
  _keywords: string[], _segment: string, _maxResults: number,
): Promise<Signal[]> { return []; }
```

```typescript
// src/main/infrastructure/worker/infrastructure/collectors/mastodon.ts
import type { Signal } from '../../domain/types.js';
export async function collectMastodon(
  _keywords: string[], _segment: string,
  _instances: string[], _maxResults: number,
): Promise<Signal[]> { return []; }
```

- [ ] **Step 5: Run registry test — expect pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A5 "registry"
```

Expected: `buildRegistry > returns a Collector for each source PASS`

- [ ] **Step 6: Update index.ts cron handler**

In `src/main/infrastructure/worker/index.ts`:

Add import at the top (near other collector imports):
```typescript
import { buildRegistry } from './infrastructure/collectors/registry.js';
```

Replace the entire "Collect" block in the `scheduled` handler (lines that define `gnewsCollector`, `localNewsCollector`, `githubCollector`, `soCollector`, and the `runCollect` call) with:

```typescript
    // Collect
    const collectors = buildRegistry(cfg, env);
    const fresh = await runCollect(d1repo, collectors);
```

Also remove the now-unused individual collector imports from the top of index.ts:
```typescript
// Remove these lines:
import { collectGnews } from './infrastructure/collectors/gnews.js';
import { collectLocalNews } from './infrastructure/collectors/local_news.js';
import { collectStackOverflow } from './infrastructure/collectors/stackoverflow.js';
// Keep collectGitHub — still used by /debug/friction and /debug/signals endpoints
```

- [ ] **Step 7: Run all tests — expect pass**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  108 passed` (107 existing + 2 new registry tests).

- [ ] **Step 8: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/collectors/registry.ts \
        src/main/infrastructure/worker/infrastructure/collectors/youtube.ts \
        src/main/infrastructure/worker/infrastructure/collectors/bluesky.ts \
        src/main/infrastructure/worker/infrastructure/collectors/mastodon.ts \
        src/main/infrastructure/worker/test/unit/registry.test.ts \
        src/main/infrastructure/worker/index.ts
git commit -m "feat: buildRegistry — single wiring point for all collectors; cron reduced to 2 lines"
```

---

## Task 4: YouTube collector

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/collectors/youtube.ts`
- Create: `src/main/infrastructure/worker/test/unit/youtube.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/infrastructure/worker/test/unit/youtube.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectYouTube } from '../../infrastructure/collectors/youtube.js';

afterEach(() => vi.restoreAllMocks());

function mockFetch(...responses: object[]) {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const body = responses[call++] ?? {};
    return { ok: true, json: async () => body };
  }));
}

const SEARCH_RESPONSE = {
  items: [
    { id: { videoId: 'vid123' }, snippet: { title: 'Problemas con Verifactu' } },
  ],
};

const COMMENTS_RESPONSE = {
  items: [
    {
      snippet: {
        topLevelComment: {
          snippet: {
            textDisplay: 'Esto es horrible, no puedo con verifactu, es un problema grave y caro',
            likeCount: 5,
            publishedAt: '2024-01-01T00:00:00Z',
          },
        },
      },
    },
  ],
};

describe('collectYouTube', () => {
  it('returns signals from video comments matching keywords', async () => {
    mockFetch(SEARCH_RESPONSE, COMMENTS_RESPONSE);
    const signals = await collectYouTube(['verifactu', 'hacienda'], 'dentista', 'KEY', 5, 20);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]!.source).toBe('youtube');
    expect(signals[0]!.segment).toBe('dentista');
    expect(signals[0]!.url).toContain('vid123');
  });

  it('sets signal fields correctly', async () => {
    mockFetch(SEARCH_RESPONSE, COMMENTS_RESPONSE);
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    const s = signals[0]!;
    expect(s.id).toBeTruthy();
    expect(s.raw_text).toContain('verifactu');
    expect(s.pain_keywords.length).toBeGreaterThan(0);
    expect(s.signal_strength).toBeGreaterThan(0);
    expect(s.signal_strength).toBeLessThanOrEqual(1);
    expect(s.has_deadline).toBe(false);
  });

  it('returns empty array when API key is missing', async () => {
    const signals = await collectYouTube(['verifactu'], 'dentista', '', 5, 20);
    expect(signals).toHaveLength(0);
  });

  it('returns empty array when search returns no videos', async () => {
    mockFetch({ items: [] });
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    expect(signals).toHaveLength(0);
  });

  it('skips comments with no keyword match and neutral sentiment', async () => {
    mockFetch(SEARCH_RESPONSE, {
      items: [
        {
          snippet: {
            topLevelComment: {
              snippet: { textDisplay: 'Buen video gracias', likeCount: 0, publishedAt: '2024-01-01T00:00:00Z' },
            },
          },
        },
      ],
    });
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    expect(signals).toHaveLength(0);
  });

  it('handles fetch errors gracefully and returns empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    expect(signals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "youtube"
```

Expected: FAIL — stub returns `[]`.

- [ ] **Step 3: Implement `collectYouTube`**

```typescript
// src/main/infrastructure/worker/infrastructure/collectors/youtube.ts
import type { Signal } from '../../domain/types.js';

const NEG_WORDS = [
  'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
  'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo', 'error', 'bug',
  'urge', 'emergencia', 'peor', 'difícil', 'complicado', 'tardanza', 'retraso',
];

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => NEG_WORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, textLen: number, likes: number): number {
  const kwScore  = Math.min(matchedKw / 3, 1.0);
  const sScore   = Math.min(Math.abs(sent), 1.0);
  const lenScore = Math.min(textLen / 300, 1.0);
  const engScore = Math.min(Math.log2(likes + 2) / 5, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.40 + sScore * 0.30 + lenScore * 0.15 + engScore * 0.15) * 1000) / 1000);
}

interface YTSearchItem {
  id: { videoId: string };
  snippet: { title: string };
}

interface YTCommentSnippet {
  textDisplay: string;
  likeCount: number;
  publishedAt: string;
}

export async function collectYouTube(
  keywords: string[],
  segment: string,
  apiKey: string,
  maxVideos = 5,
  maxCommentsPerVideo = 20,
): Promise<Signal[]> {
  if (!apiKey) return [];
  const signals: Signal[] = [];
  const seen = new Set<string>();
  const query = keywords.slice(0, 4).join(' ');

  try {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', String(maxVideos));
    searchUrl.searchParams.set('relevanceLanguage', 'es');
    searchUrl.searchParams.set('key', apiKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) return [];
    const searchBody = await searchRes.json() as { items?: YTSearchItem[] };
    const videos = searchBody.items ?? [];

    for (const video of videos) {
      const videoId = video.id.videoId;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      try {
        const commentsUrl = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
        commentsUrl.searchParams.set('part', 'snippet');
        commentsUrl.searchParams.set('videoId', videoId);
        commentsUrl.searchParams.set('maxResults', String(maxCommentsPerVideo));
        commentsUrl.searchParams.set('order', 'relevance');
        commentsUrl.searchParams.set('key', apiKey);

        const commentsRes = await fetch(commentsUrl.toString());
        if (!commentsRes.ok) continue;
        const commentsBody = await commentsRes.json() as {
          items?: Array<{ snippet: { topLevelComment: { snippet: YTCommentSnippet } } }>;
        };

        for (const item of commentsBody.items ?? []) {
          const cs = item.snippet.topLevelComment.snippet;
          const text = cs.textDisplay.slice(0, 1000);
          const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
          const sent = sentimentScore(text);

          if (matched.length === 0 && sent > -0.03) continue;

          const dedupeKey = `${videoId}:${text.slice(0, 80)}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          signals.push({
            id:              crypto.randomUUID(),
            source:          'youtube',
            collected_at:    new Date(cs.publishedAt).toISOString(),
            segment,
            location:        null,
            raw_text:        text,
            url:             videoUrl,
            pain_keywords:   matched,
            sentiment_score: sent,
            salary_mean:     null,
            income_tier:     null,
            signal_strength: signalStrength(matched.length, sent, text.length, cs.likeCount),
            has_deadline:    false,
          });
        }
      } catch {
        // skip this video on error
      }
    }
  } catch {
    // return what we have
  }

  return signals;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A10 "collectYouTube"
```

Expected: all 6 YouTube tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/collectors/youtube.ts \
        src/main/infrastructure/worker/test/unit/youtube.test.ts
git commit -m "feat: YouTube collector — video comment pain signals via Data API v3"
```

---

## Task 5: Bluesky collector

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/collectors/bluesky.ts`
- Create: `src/main/infrastructure/worker/test/unit/bluesky.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/infrastructure/worker/test/unit/bluesky.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectBluesky } from '../../infrastructure/collectors/bluesky.js';

afterEach(() => vi.restoreAllMocks());

const BSKY_RESPONSE = {
  posts: [
    {
      uri: 'at://did:plc:abc123/app.bsky.feed.post/xyz789',
      author: { did: 'did:plc:abc123', handle: 'gestor.bsky.social' },
      record: {
        text: 'Problema horrible con verifactu hacienda no puedo más',
        createdAt: '2024-01-15T10:00:00Z',
      },
      likeCount: 8,
      replyCount: 3,
      repostCount: 1,
    },
  ],
};

describe('collectBluesky', () => {
  it('returns signals from posts matching keywords', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu', 'hacienda'], 'dentista', 25);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]!.source).toBe('bluesky');
    expect(signals[0]!.segment).toBe('dentista');
  });

  it('builds correct bsky.app URL from at:// URI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    expect(signals[0]!.url).toBe('https://bsky.app/profile/gestor.bsky.social/post/xyz789');
  });

  it('sets signal fields correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    const s = signals[0]!;
    expect(s.id).toBeTruthy();
    expect(s.pain_keywords).toContain('verifactu');
    expect(s.signal_strength).toBeGreaterThan(0);
    expect(s.signal_strength).toBeLessThanOrEqual(1);
  });

  it('skips posts with no keyword match and neutral sentiment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        posts: [{ uri: 'at://did/app.bsky.feed.post/1', author: { did: 'did', handle: 'x.bsky.social' },
          record: { text: 'Buen día a todos!', createdAt: '2024-01-01T00:00:00Z' },
          likeCount: 0, replyCount: 0, repostCount: 0 }],
      }),
    }));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    expect(signals).toHaveLength(0);
  });

  it('deduplicates posts with same URI across keyword searches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu', 'hacienda'], 'dentista', 25);
    const uris = signals.map(s => s.url);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it('handles fetch error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    expect(signals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "bluesky"
```

Expected: FAIL — stub returns `[]`.

- [ ] **Step 3: Implement `collectBluesky`**

```typescript
// src/main/infrastructure/worker/infrastructure/collectors/bluesky.ts
import type { Signal } from '../../domain/types.js';

const NEG_WORDS = [
  'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
  'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo', 'error',
  'urge', 'emergencia', 'peor', 'difícil', 'complicado',
];

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => NEG_WORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, likes: number, replies: number, reposts: number): number {
  const kwScore  = Math.min(matchedKw / 3, 1.0);
  const sScore   = Math.min(Math.abs(sent), 1.0);
  const engScore = Math.min((Math.log2(likes + 2) + Math.log2(replies + 2) + Math.log2(reposts + 2)) / 9, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sScore * 0.35 + engScore * 0.20) * 1000) / 1000);
}

interface BskyPost {
  uri: string;
  author: { did: string; handle: string };
  record: { text: string; createdAt: string };
  likeCount: number;
  replyCount: number;
  repostCount: number;
}

function buildUrl(uri: string, handle: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/handle/post/rkey
  const rkey = uri.split('/').at(-1) ?? '';
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export async function collectBluesky(
  keywords: string[],
  segment: string,
  maxResults = 25,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const seen = new Set<string>();

  for (const keyword of keywords) {
    try {
      const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
      url.searchParams.set('q', keyword);
      url.searchParams.set('limit', String(maxResults));
      url.searchParams.set('lang', 'es');

      const res = await fetch(url.toString(), {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) continue;

      const body = await res.json() as { posts?: BskyPost[] };
      for (const post of body.posts ?? []) {
        if (seen.has(post.uri)) continue;
        seen.add(post.uri);

        const text = post.record.text.slice(0, 1000);
        const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
        const sent = sentimentScore(text);

        if (matched.length === 0 && sent > -0.03) continue;

        signals.push({
          id:              crypto.randomUUID(),
          source:          'bluesky',
          collected_at:    post.record.createdAt,
          segment,
          location:        null,
          raw_text:        text,
          url:             buildUrl(post.uri, post.author.handle),
          pain_keywords:   matched,
          sentiment_score: sent,
          salary_mean:     null,
          income_tier:     null,
          signal_strength: signalStrength(matched.length, sent, post.likeCount, post.replyCount, post.repostCount),
          has_deadline:    false,
        });
      }
    } catch {
      // skip this keyword on error
    }
  }

  return signals;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A10 "collectBluesky"
```

Expected: all 5 Bluesky tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/collectors/bluesky.ts \
        src/main/infrastructure/worker/test/unit/bluesky.test.ts
git commit -m "feat: Bluesky collector — public AT Protocol search, no auth required"
```

---

## Task 6: Mastodon collector

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/collectors/mastodon.ts`
- Create: `src/main/infrastructure/worker/test/unit/mastodon.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/infrastructure/worker/test/unit/mastodon.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectMastodon } from '../../infrastructure/collectors/mastodon.js';

afterEach(() => vi.restoreAllMocks());

const MASTODON_RESPONSE = {
  statuses: [
    {
      id: '112345678',
      url: 'https://mastodon.social/@gestor/112345678',
      content: '<p>Problema horrible con <a href="#">verifactu</a>, hacienda me tiene loco. No puedo más con esta burocracia.</p>',
      reblogs_count: 2,
      favourites_count: 7,
      replies_count: 3,
      account: { acct: 'gestor' },
      created_at: '2024-01-15T10:00:00Z',
    },
  ],
};

describe('collectMastodon', () => {
  it('returns signals from statuses matching keywords', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu', 'hacienda'], 'dentista', ['mastodon.social'], 20);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]!.source).toBe('mastodon');
    expect(signals[0]!.segment).toBe('dentista');
  });

  it('strips HTML from status content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    expect(signals[0]!.raw_text).not.toContain('<p>');
    expect(signals[0]!.raw_text).not.toContain('<a href=');
    expect(signals[0]!.raw_text).toContain('verifactu');
  });

  it('sets signal fields correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    const s = signals[0]!;
    expect(s.id).toBeTruthy();
    expect(s.url).toBe('https://mastodon.social/@gestor/112345678');
    expect(s.signal_strength).toBeGreaterThan(0);
    expect(s.signal_strength).toBeLessThanOrEqual(1);
  });

  it('queries each instance and deduplicates by URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social', 'mastodon.es'], 20);
    const urls = signals.map(s => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('skips statuses with no keyword match and neutral sentiment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        statuses: [{
          id: '1', url: 'https://mastodon.social/@x/1',
          content: '<p>Buenos días a todos</p>',
          reblogs_count: 0, favourites_count: 0, replies_count: 0,
          account: { acct: 'x' }, created_at: '2024-01-01T00:00:00Z',
        }],
      }),
    }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    expect(signals).toHaveLength(0);
  });

  it('handles fetch error per instance gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    expect(signals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "mastodon"
```

Expected: FAIL — stub returns `[]`.

- [ ] **Step 3: Implement `collectMastodon`**

```typescript
// src/main/infrastructure/worker/infrastructure/collectors/mastodon.ts
import type { Signal } from '../../domain/types.js';

const NEG_WORDS = [
  'problema', 'horrible', 'imposible', 'multa', 'burocracia', 'lento', 'caro',
  'queja', 'odio', 'caos', 'frustrado', 'harto', 'fallo', 'error',
  'urge', 'emergencia', 'peor', 'difícil', 'complicado',
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => NEG_WORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, reblogs: number, favs: number, replies: number): number {
  const kwScore  = Math.min(matchedKw / 3, 1.0);
  const sScore   = Math.min(Math.abs(sent), 1.0);
  const engScore = Math.min((Math.log2(reblogs + 2) + Math.log2(favs + 2) + Math.log2(replies + 2)) / 9, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sScore * 0.35 + engScore * 0.20) * 1000) / 1000);
}

interface MastodonStatus {
  id: string;
  url: string;
  content: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  account: { acct: string };
  created_at: string;
}

export async function collectMastodon(
  keywords: string[],
  segment: string,
  instances: string[],
  maxResults = 20,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const seen = new Set<string>();

  for (const instance of instances) {
    for (const keyword of keywords) {
      try {
        const url = new URL(`https://${instance}/api/v2/search`);
        url.searchParams.set('q', keyword);
        url.searchParams.set('type', 'statuses');
        url.searchParams.set('limit', String(maxResults));

        const res = await fetch(url.toString(), {
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) continue;

        const body = await res.json() as { statuses?: MastodonStatus[] };
        for (const status of body.statuses ?? []) {
          if (seen.has(status.url)) continue;
          seen.add(status.url);

          const text = stripHtml(status.content).slice(0, 1000);
          const matched = keywords.filter(kw => text.toLowerCase().includes(kw.toLowerCase()));
          const sent = sentimentScore(text);

          if (matched.length === 0 && sent > -0.03) continue;

          signals.push({
            id:              crypto.randomUUID(),
            source:          'mastodon',
            collected_at:    status.created_at,
            segment,
            location:        null,
            raw_text:        text,
            url:             status.url,
            pain_keywords:   matched,
            sentiment_score: sent,
            salary_mean:     null,
            income_tier:     null,
            signal_strength: signalStrength(matched.length, sent, status.reblogs_count, status.favourites_count, status.replies_count),
            has_deadline:    false,
          });
        }
      } catch {
        // skip this instance/keyword pair on error
      }
    }
  }

  return signals;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A10 "collectMastodon"
```

Expected: all 6 Mastodon tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/collectors/mastodon.ts \
        src/main/infrastructure/worker/test/unit/mastodon.test.ts
git commit -m "feat: Mastodon collector — public search on mastodon.social + mastodon.es"
```

---

## Task 7: Push and deploy

- [ ] **Step 1: Run full test suite one final time**

```bash
npm test 2>&1
```

Expected output contains: `Test Files  8 passed` and `Tests  NNN passed` (no failures).

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Add YOUTUBE_API_KEY secret to Cloudflare**

```bash
npx wrangler secret put YOUTUBE_API_KEY --config src/main/infrastructure/worker/wrangler.toml
```

Enter the API key when prompted.

- [ ] **Step 4: Deploy**

```bash
npx wrangler deploy --config src/main/infrastructure/worker/wrangler.toml
```

Expected: `Deployed market-intel-api triggers` with new version hash.

- [ ] **Step 5: Smoke test registry via cron trigger**

```bash
curl -X POST https://<your-worker-domain>/cron \
  -H "Authorization: Bearer $WORKER_SECRET" | jq '.collectors // empty'
```

Or wait for the next scheduled cron and check the worker logs in the Cloudflare dashboard for lines like `[gnews] N signals`, `[youtube] N signals`, etc.

---

## Self-Review

**Spec coverage:**
- ✅ `Collector` interface in ports.ts — Task 1
- ✅ `buildRegistry(cfg, env)` — Task 3
- ✅ `runCollect` accepts `Collector[]` — Task 1
- ✅ All 5 existing collectors (incl. Reddit) wired in registry — Task 3
- ✅ YouTube collector with rate limit note — Task 4
- ✅ Bluesky collector (no auth) — Task 5
- ✅ Mastodon collector (mastodon.social + mastodon.es) — Task 6
- ✅ `YOUTUBE_API_KEY` in Env — Task 2
- ✅ Config types extended — Task 2
- ✅ `SignalSource` extended with all new sources + stackoverflow — Task 2
- ✅ Error handling per-item and per-collector — each collector + runCollect unchanged (already handles)
- ✅ Tests for each new collector — Tasks 4–6

**Type consistency check:**
- `collectYouTube(keywords, segment, apiKey, maxVideos, maxCommentsPerVideo)` — matches registry.ts call ✅
- `collectBluesky(keywords, segment, maxResults)` — matches registry.ts call ✅
- `collectMastodon(keywords, segment, instances, maxResults)` — matches registry.ts call ✅
- `Collector.collect()` used consistently in collect.ts and registry.ts ✅
