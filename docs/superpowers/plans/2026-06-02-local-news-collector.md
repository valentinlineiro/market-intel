# Local News Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable local newspaper RSS collector that writes signals tagged with a specific geographic area to D1.

**Architecture:** New `collectors/local_news.js` file follows the exact pattern of `gnews.js` — a `LOCATIONS` config object maps location names to RSS feed arrays, `env.LOCAL_NEWS_LOCATION` selects the active location at runtime, and `runLocalNewsCron(env)` is called alongside `runGnewsCron` in the scheduled handler. No existing files are restructured.

**Tech Stack:** Cloudflare Workers (JS), D1 (SQLite), RSS/XML parsing via regex (same approach as gnews.js), wrangler CLI for deploy.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/main/infrastructure/worker/collectors/local_news.js` | New collector — fetches local newspaper RSS feeds, inserts signals |
| Modify | `src/main/infrastructure/worker/index.js` | Import and call `runLocalNewsCron` in scheduled handler |
| Modify | `src/main/infrastructure/worker/wrangler.toml` | Add `[vars]` with `LOCAL_NEWS_LOCATION = "Cádiz"` |

---

## Task 1: Create `local_news.js` collector

**Files:**
- Create: `src/main/infrastructure/worker/collectors/local_news.js`

- [ ] **Step 1: Verify the RSS feed URLs resolve**

Run these curl commands and confirm each returns XML with `<item>` entries:

```bash
curl -sI "https://www.diariodecadiz.es/rss/2.0/" | head -5
curl -sI "https://www.europasur.es/rss/2.0/" | head -5
curl -sI "https://www.lavozdigital.es/rss/2.0/" | head -5
```

Expected: HTTP 200 with `Content-Type: application/rss+xml` or `text/xml`. If a feed returns 404 or redirects, find the correct URL by visiting the newspaper's homepage and looking for an RSS link, then update the `LOCATIONS` config in the next step accordingly.

- [ ] **Step 2: Create the collector file**

Create `src/main/infrastructure/worker/collectors/local_news.js` with this content:

```js
/**
 * local_news.js — configurable local newspaper RSS collector
 * Called from the scheduled handler in index.js.
 * Active location is set via env.LOCAL_NEWS_LOCATION (wrangler.toml [vars]).
 */

const LOCATIONS = {
  "Cádiz": [
    "https://www.diariodecadiz.es/rss/2.0/",
    "https://www.europasur.es/rss/2.0/",
    "https://www.lavozdigital.es/rss/2.0/",
  ],
  // To add a new location:
  // "Sevilla": [
  //   "https://www.diariodesevilla.es/rss/2.0/",
  // ],
};

const PAIN_KEYWORDS = [
  "problema", "queja", "multa", "burocracia", "retraso", "lento", "caro",
  "imposible", "denuncia", "fallo", "error", "cierre", "crisis", "huelga",
  "protesta", "reclamación", "sanción", "deuda", "impago", "colapso",
];

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; market-intel/0.1)" };

function sentimentScore(text) {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => PAIN_KEYWORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKeywords, sentimentScore, textLength) {
  const kwScore   = Math.min(matchedKeywords / 3, 1.0);
  const sentScore = Math.min(Math.abs(sentimentScore), 1.0);
  const lenScore  = Math.min(textLength / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sentScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

async function fetchFeed(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const xml = await r.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block) || [])[1] || "";
    const link  = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || "";
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || /<description>(.*?)<\/description>/.exec(block) || [])[1] || "";
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
  }
  return items.slice(0, 20);
}

async function insertSignal(db, signal) {
  const existing = await db.prepare(
    "SELECT 1 FROM signals WHERE url=? AND segment=? LIMIT 1"
  ).bind(signal.url, signal.segment).first();
  if (existing) return false;

  await db.prepare(`
    INSERT INTO signals (id, source, collected_at, segment, location, raw_text, url,
      pain_keywords, sentiment_score, salary_mean, income_tier, signal_strength, has_deadline)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    signal.id, signal.source, signal.collected_at, signal.segment,
    signal.location, signal.raw_text.slice(0, 2000), signal.url,
    JSON.stringify(signal.pain_keywords), signal.sentiment_score,
    null, null, signal.signal_strength, 0,
  ).run();
  return true;
}

export async function runLocalNewsCron(env) {
  const location = env.LOCAL_NEWS_LOCATION;
  const feeds = LOCATIONS[location];
  if (!feeds) {
    console.warn(`local_news: no feeds configured for location "${location}" — skipping`);
    return;
  }

  let total = 0;
  for (const feedUrl of feeds) {
    try {
      const items = await fetchFeed(feedUrl);
      for (const item of items) {
        const text    = `${item.title}. ${item.desc}`;
        const sent    = sentimentScore(text);
        const matched = PAIN_KEYWORDS.filter(kw => text.toLowerCase().includes(kw));
        if (matched.length === 0 && sent > -0.03) continue;

        const inserted = await insertSignal(env.DB, {
          id:              shortId(),
          source:          "local_news",
          collected_at:    new Date().toISOString(),
          segment:         "general",
          location,
          raw_text:        text,
          url:             item.link || `local_news://${shortId()}`,
          pain_keywords:   matched,
          sentiment_score: sent,
          signal_strength: signalStrength(matched.length, sent, text.length),
        });
        if (inserted) total++;
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`local_news feed "${feedUrl}":`, e.message);
    }
  }
  console.log(`local_news cron (${location}): ${total} new signals`);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/collectors/local_news.js
git commit -m "feat: add local newspaper RSS collector"
```

---

## Task 2: Wire collector into the scheduled handler

**Files:**
- Modify: `src/main/infrastructure/worker/index.js` (line 26-28 imports, line 167-169 scheduled handler)
- Modify: `src/main/infrastructure/worker/wrangler.toml`

- [ ] **Step 1: Add `[vars]` to wrangler.toml**

Open `src/main/infrastructure/worker/wrangler.toml`. Append after the last line:

```toml
[vars]
LOCAL_NEWS_LOCATION = "Cádiz"
```

- [ ] **Step 2: Import and call `runLocalNewsCron` in `index.js`**

At the top of `src/main/infrastructure/worker/index.js`, add the import after the existing imports (around line 28):

```js
import { runLocalNewsCron } from "./collectors/local_news.js";
```

Then replace the `scheduled` handler (lines 167-169):

```js
async scheduled(event, env, ctx) {
  ctx.waitUntil(Promise.all([
    runGnewsCron(env.DB),
    runLocalNewsCron(env),
  ]));
},
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/index.js src/main/infrastructure/worker/wrangler.toml
git commit -m "feat: wire local_news cron into scheduled handler"
```

---

## Task 3: Deploy and verify

- [ ] **Step 1: Deploy the worker**

```bash
cd src/main/infrastructure/worker
npx wrangler deploy
```

Expected: `Deployed market-intel-api` with no errors.

- [ ] **Step 2: Trigger the cron manually**

```bash
npx wrangler dev --test-scheduled
```

In another terminal, trigger the scheduled event:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*%2F12+*+*+*"
```

Expected: Worker logs show `local_news cron (Cádiz): N new signals`.

- [ ] **Step 3: Query D1 to confirm signals were inserted**

```bash
npx wrangler d1 execute market-intel --command "SELECT source, location, segment, COUNT(*) as n FROM signals WHERE source='local_news' GROUP BY source, location, segment"
```

Expected: One row with `source=local_news`, `location=Cádiz`, `segment=general`, `n > 0`.

- [ ] **Step 4: Confirm deduplication works**

Re-trigger the scheduled event a second time (same curl command). Then re-run the D1 query — the count should not increase, confirming the `(url, segment)` dedup guard is working.

- [ ] **Step 5: Commit any fixes, then done**

If any feed URLs needed correction in Step 1 of Task 1, commit the updated `LOCATIONS` config:

```bash
git add src/main/infrastructure/worker/collectors/local_news.js
git commit -m "fix: correct local news RSS feed URLs for Cádiz"
```
