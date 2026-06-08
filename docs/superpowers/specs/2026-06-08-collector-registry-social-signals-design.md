# Collector Registry + Social Network Signals

**Date:** 2026-06-08
**Status:** Approved
**Scope:** Two phases — collector plugin interface, then three new social sources.

---

## Problem

Adding a new signal source currently requires changes to 5 places across 4 files, including the crowded `index.ts` cron handler. The StackOverflow collector took longer to wire than to write. See `docs/refinement/IDEA-easy-source-addition.md`.

---

## Phase 1 — Collector Interface & Registry

### Interface

Added to `application/ports.ts`:

```ts
export interface Collector {
  id: string;
  collect(): Promise<Signal[]>;
}
```

Each collector module remains a pure function (e.g. `collectYouTube(keywords, apiKey)`). The interface is only instantiated in the registry.

### Registry

New file: `infrastructure/collectors/registry.ts`

```ts
export function buildRegistry(cfg: Config, env: Env): Collector[]
```

This is the single place where `Env` secrets and `Config` values are bound to collector factories. All five existing collectors (`gnews`, `github`, `local_news`, `reddit`, `stackoverflow`) are wired here with zero changes to their own logic.

### runCollect

`application/collect.ts` signature changes from:

```ts
runCollect(repo, factories: Array<() => Promise<Signal[]>>)
```

to:

```ts
runCollect(repo, collectors: Collector[])
```

Internally, `collector.collect()` replaces the anonymous factory call. Behavior identical.

### Cron handler (index.ts)

Reduces from ~20 lines of per-collector wiring to:

```ts
const collectors = buildRegistry(cfg, env);
const fresh = await runCollect(d1repo, collectors);
```

### Adding a future collector

1. Write `infrastructure/collectors/<name>.ts` — pure function, no knowledge of Env.
2. Add one entry to `buildRegistry` in `registry.ts`.
3. Add API key to `Env` if needed.

No changes to `index.ts`, `collect.ts`, or any other file.

---

## Phase 2 — Three New Collectors

### YouTube (`collectYouTube`)

- **API:** YouTube Data API v3 — free, 10 000 units/day. Requires `YOUTUBE_API_KEY` added to `Env` and `wrangler.toml` secrets.
- **Strategy:** Search videos by keyword (e.g. `"verifactu tutorial"`), then fetch top-level comments for each video. Filter comments containing pain keywords. Comments = unsolicited frustration, high signal value.
- **Signal mapping:**
  - `source`: `'youtube'`
  - `signal_strength`: function of negative-sentiment word count, comment length, like count on comment
  - `sentiment_score`: keyword-based negative scoring (reuse existing pattern from reddit.ts)
  - `raw_text`: comment text (truncated to 1000 chars)
  - `url`: link to the video (not the individual comment)
- **Rate limit:** 19 keywords × (1 search @ 100u + 5 videos × 1u comments) ≈ 1 995 units/day — well within the 10 000 free quota. Default: `maxVideos = 5`, `maxCommentsPerVideo = 20`.
- **Auth:** API key only — no OAuth needed.

### Bluesky (`collectBluesky`)

- **API:** `api.bsky.app` public search endpoint — no auth, no key.
- **Endpoint:** `GET /xrpc/app.bsky.feed.searchPosts?q=<keyword>&limit=25`
- **Strategy:** One request per keyword from the segment's keyword list. Deduplicate by post URI.
- **Signal mapping:**
  - `source`: `'bluesky'`
  - `signal_strength`: function of reply count, like count, repost count, sentiment
  - `raw_text`: post text
  - `url`: `https://bsky.app/profile/<did>/post/<rkey>`
- **Auth:** None.

### Mastodon (`collectMastodon`)

- **API:** Public instance search — no auth needed for public posts.
- **Instances:** `mastodon.social` (general), `mastodon.es` (Spanish-speaking) — configurable list in `Config`.
- **Endpoint:** `GET https://<instance>/api/v2/search?q=<keyword>&type=statuses&limit=20`
- **Strategy:** Query each instance × each keyword. Deduplicate by URL.
- **Signal mapping:**
  - `source`: `'mastodon'`
  - `signal_strength`: function of replies count, reblogs count, favourites count, sentiment
  - `raw_text`: status content (HTML stripped)
  - `url`: status URL
- **Auth:** None.

---

## Config changes

`Config` type gains:

```ts
collectors: {
  ...existing...
  youtube: { enabled: boolean; max_videos: number; max_comments_per_video: number };
  bluesky: { enabled: boolean; max_results: number };
  mastodon: { enabled: boolean; instances: string[]; max_results: number };
}
```

`Env` gains:
```ts
YOUTUBE_API_KEY?: string;
```

---

## Error handling

- Each collector wraps its fetch in try/catch per-item (same pattern as existing collectors).
- A collector that throws entirely is caught by `runCollect` — other collectors proceed.
- Missing API key (`YOUTUBE_API_KEY` undefined): `collectYouTube` returns `[]` immediately with a console warning.

---

## Testing

- Unit tests for each new collector using `vi.fn()` to mock `fetch` — same pattern as existing collector tests.
- Signal shape validated: `id`, `source`, `url`, `raw_text`, `pain_keywords` all present.
- `buildRegistry` smoke test: given a mock cfg + env, returns an array of Collector objects with correct `id`s.

---

## Out of scope

- LinkedIn, Instagram/Threads, Facebook — all require OAuth or partner API access.
- Collector enable/disable without deploy: intentionally not in scope; static registry is the chosen approach.
