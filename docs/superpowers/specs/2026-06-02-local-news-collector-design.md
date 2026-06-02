# Local News Collector — Design Spec

**Date:** 2026-06-02

## Goal

Add a configurable local newspaper RSS collector that tags signals with a specific geographic area, complementing the existing national Google News collector.

## Background

The current pipeline collects signals from Google News RSS (national, `location: "España"`) and Hacker News (global English). There are no local sources. Adding local newspaper feeds will surface pain signals that are geographically specific and often appear in local press before national outlets pick them up.

## Design

### New file: `collectors/local_news.js`

A `LOCATIONS` config object maps location names to arrays of RSS feed URLs:

```js
const LOCATIONS = {
  "Cádiz": [
    "https://www.diariodecadiz.es/rss/",
    "https://www.europasur.es/rss/",
    "https://www.lavozdigital.es/rss/",
  ],
  // add more locations here
};
```

The active location is determined at runtime by `env.LOCAL_NEWS_LOCATION` (a Cloudflare Worker env var). If the env var is unset or does not match a key in `LOCATIONS`, the collector logs a warning and exits without writing anything.

Signals are written to D1 with:
- `source: "local_news"`
- `location: env.LOCAL_NEWS_LOCATION` (e.g. `"Cádiz"`)

This makes them filterable in the dashboard separately from national signals.

### Signal processing

Re-uses the same scoring pattern as `gnews.js`:
- `sentimentScore(text)` — negative-keyword count heuristic
- `signalStrength(matchedKeywords, sentimentScore, textLength)` — weighted composite
- `insertSignal(db, signal)` — deduplicates by `(url, segment)` before inserting

Since local news is not segment-specific at collection time, `segment` is set to `"general"` for local signals. Downstream scoring/synthesis can re-classify them.

### Integration

`index.js` scheduled handler calls `runLocalNewsCron(env)` alongside the existing `runGnewsCron(db)` call. No changes to `gnews.js` or any other existing file.

### Configuration

`LOCAL_NEWS_LOCATION` is set in `wrangler.toml` under `[vars]`:

```toml
[vars]
LOCAL_NEWS_LOCATION = "Cádiz"
```

To target a different location, change the var and add the corresponding entry to `LOCATIONS` in `local_news.js`.

## Out of Scope

- BOJA / BOE integration (identified as a future step)
- Per-location segment keyword tuning
- Dashboard filtering UI by location (separate concern)

## Success Criteria

- New signals appear in D1 with `source = "local_news"` and `location = "Cádiz"` after a cron run
- No duplicate signals across runs (dedup by url + segment)
- Removing or changing `LOCAL_NEWS_LOCATION` does not break the existing gnews cron
