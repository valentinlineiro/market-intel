# Python → TypeScript Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete all Python and consolidate the entire backend into the existing Cloudflare Worker (JS/ES modules), closing the scoring gap and removing the weekly GitHub Actions pipeline job.

**Architecture:** The Worker already handles collection (gnews + local_news every 12h) and all API endpoints. The only missing piece is scoring — currently in Python. After migration: collection + scoring both run in the 12h cron; discovery stays as a monthly GH Actions curl to `POST /discover`; the Python pipeline (`main.py`, `dashboard.yml`) is deleted entirely.

**Tech Stack:** Cloudflare Workers (ES modules), D1 (SQLite), Vitest (unit tests), wrangler

---

## File Map

**Create:**
- `src/main/infrastructure/worker/score.js` — pure scoring functions + `runScore()` orchestrator (port of `score.py` + `rules.py`)
- `src/main/infrastructure/worker/notify.js` — `sendTelegram(env, msg)` helper (port of `notifications.py`)
- `src/main/infrastructure/worker/test/score.test.js` — Vitest tests for scoring functions

**Modify:**
- `package.json` — add `vitest`, add `"type": "module"`, add `"test"` script
- `src/main/infrastructure/worker/index.js` — add `POST /score`, add Telegram alert to `/discover`, add `runScore` to scheduled handler
- `.github/workflows/discover.yml` — replace Python with curl to Worker
- `.github/workflows/ci.yml` — replace `pytest` step with `vitest run`

**Delete (Task 7):**
- `src/main/` (entire Python tree — domain, application, infrastructure Python files, main.py, run_discover.py)
- `src/test/`
- `requirements.txt`
- `pyproject.toml`
- `.github/workflows/dashboard.yml` (replaced by Worker 12h cron)

---

## Task 1: Add Vitest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json**

Replace the entire file with:

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "wrangler": "^4.95.0"
  }
}
```

- [ ] **Step 2: Install**

Run from repo root:
```bash
npm install
```

Expected: `node_modules/vitest` appears, no errors.

- [ ] **Step 3: Verify vitest works**

```bash
npx vitest run --reporter=verbose 2>&1 | head -5
```

Expected: `No test files found` or similar (no crash).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for worker unit tests"
```

---

## Task 2: Create notify.js

**Files:**
- Create: `src/main/infrastructure/worker/notify.js`

- [ ] **Step 1: Create the file**

```js
// notify.js
export async function sendTelegram(env, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/worker/notify.js
git commit -m "feat: add telegram notifier helper for worker"
```

---

## Task 3: Write failing tests for score.js

**Files:**
- Create: `src/main/infrastructure/worker/test/score.test.js`

- [ ] **Step 1: Create the test file**

```js
import { describe, it, expect } from "vitest";
import {
  computeOpportunityScore,
  incomeTierScore,
  urgencyScore,
  volumeScore,
  dolorScore,
  applyRules,
  shouldAlert,
  ALERT_SCORE_THRESHOLD,
  KILL_SCORE_THRESHOLD,
  SCALE_SCORE_THRESHOLD,
} from "../score.js";

describe("computeOpportunityScore", () => {
  it("returns 0 for empty breakdown", () => {
    expect(computeOpportunityScore({})).toBe(0);
  });

  it("applies weights correctly", () => {
    const breakdown = { dolor: 10, capacidad_pago: 10, volumen: 10, competencia: 10, urgencia: 10 };
    expect(computeOpportunityScore(breakdown)).toBe(10);
  });

  it("uses partial breakdown without crashing", () => {
    expect(computeOpportunityScore({ dolor: 10 })).toBe(3);
  });
});

describe("incomeTierScore", () => {
  it("returns 10 for high", () => expect(incomeTierScore("high")).toBe(10));
  it("returns 7 for medium_high", () => expect(incomeTierScore("medium_high")).toBe(7));
  it("returns 5 for medium", () => expect(incomeTierScore("medium")).toBe(5));
  it("returns 2 for low", () => expect(incomeTierScore("low")).toBe(2));
  it("returns 2 for unknown tier", () => expect(incomeTierScore("unknown")).toBe(2));
});

describe("urgencyScore", () => {
  it("returns 10 when has deadline", () => expect(urgencyScore(true)).toBe(10));
  it("returns 0 when no deadline", () => expect(urgencyScore(false)).toBe(0));
});

describe("volumeScore", () => {
  it("caps at 10", () => expect(volumeScore(999)).toBe(10));
  it("normalises: discovery_score 20 → 10", () => expect(volumeScore(20)).toBe(10));
  it("normalises: discovery_score 10 → 5", () => expect(volumeScore(10)).toBe(5));
  it("returns 0 for 0", () => expect(volumeScore(0)).toBe(0));
});

describe("dolorScore", () => {
  it("returns [0, ''] for empty signals", () => {
    const [score, summary] = dolorScore([]);
    expect(score).toBe(0);
    expect(summary).toBe("");
  });

  it("returns [0, ''] for signals older than 30 days", () => {
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    const [score] = dolorScore([{ collected_at: old, signal_strength: 1.0, pain_keywords: "[]" }]);
    expect(score).toBe(0);
  });

  it("scores recent signals > 0", () => {
    const now = new Date().toISOString();
    const signals = Array.from({ length: 10 }, (_, i) => ({
      collected_at: now,
      signal_strength: 0.8,
      pain_keywords: JSON.stringify(["burocracia", "multa"]),
    }));
    const [score, summary] = dolorScore(signals);
    expect(score).toBeGreaterThan(0);
    expect(summary).toMatch(/burocracia|multa|señales/);
  });

  it("never exceeds 10", () => {
    const now = new Date().toISOString();
    const signals = Array.from({ length: 100 }, () => ({
      collected_at: now,
      signal_strength: 1.0,
      pain_keywords: JSON.stringify(["pain"]),
    }));
    const [score] = dolorScore(signals);
    expect(score).toBeLessThanOrEqual(10);
  });
});

describe("applyRules", () => {
  const baseOpp = {
    id: "abc",
    segment: "test",
    score: 6.0,
    signal_count: 5,
    status: "watching",
    emails_captured: 0,
    first_seen: new Date().toISOString(),
    kill_threshold_days: 7,
    scale_threshold_emails: 30,
  };

  it("does not change already-killed opp", () => {
    const opp = { ...baseOpp, status: "killed" };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("kills opp with no signals after threshold days", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp = { ...baseOpp, signal_count: 0, score: 4.0, first_seen: old };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("does not kill if score is above kill threshold", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp = { ...baseOpp, signal_count: 0, score: KILL_SCORE_THRESHOLD + 1, first_seen: old };
    expect(applyRules(opp).status).toBe("watching");
  });

  it("scales opp with high score and enough emails", () => {
    const opp = { ...baseOpp, score: SCALE_SCORE_THRESHOLD + 0.1, emails_captured: 30 };
    expect(applyRules(opp).status).toBe("scaling");
  });
});

describe("shouldAlert", () => {
  it("returns true when never alerted", () => {
    expect(shouldAlert({ telegram_alerted_at: null })).toBe(true);
  });

  it("returns false when alerted less than 24h ago", () => {
    const recent = new Date(Date.now() - 12 * 3600000).toISOString();
    expect(shouldAlert({ telegram_alerted_at: recent })).toBe(false);
  });

  it("returns true when alerted more than 24h ago", () => {
    const old = new Date(Date.now() - 25 * 3600000).toISOString();
    expect(shouldAlert({ telegram_alerted_at: old })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests (expect fail — score.js doesn't exist yet)**

```bash
cd src/main/infrastructure/worker && npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: `Cannot find module '../score.js'` or similar import error.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/main/infrastructure/worker/test/score.test.js
git commit -m "test: add failing tests for score.js"
```

---

## Task 4: Implement score.js

**Files:**
- Create: `src/main/infrastructure/worker/score.js`

- [ ] **Step 1: Create score.js**

```js
// score.js — port of score.py + rules.py
import { sendTelegram } from "./notify.js";

export const SCORE_WEIGHTS = {
  dolor: 0.30,
  capacidad_pago: 0.25,
  volumen: 0.20,
  competencia: 0.15,
  urgencia: 0.10,
};

export const KILL_SCORE_THRESHOLD = 5.0;
export const SCALE_SCORE_THRESHOLD = 8.0;
export const ALERT_SCORE_THRESHOLD = 7.0;

const SALARY_TIERS = { high: 10, medium_high: 7, medium: 5, low: 2 };

export function computeOpportunityScore(breakdown) {
  const raw = Object.entries(SCORE_WEIGHTS).reduce(
    (sum, [k, w]) => sum + (breakdown[k] ?? 0) * w, 0
  );
  return Math.round(raw * 100) / 100;
}

export function incomeTierScore(tier) {
  return SALARY_TIERS[tier] ?? 2;
}

export function urgencyScore(hasDeadline) {
  return hasDeadline ? 10 : 0;
}

export function volumeScore(discoveryScore) {
  return Math.round(Math.min(discoveryScore / 20.0, 1.0) * 10 * 100) / 100;
}

export function dolorScore(signals) {
  const now = Date.now();
  const cutoff = now - 30 * 86400000;
  const weekAgo = now - 7 * 86400000;
  const recent = signals.filter(s => new Date(s.collected_at).getTime() > cutoff);
  if (!recent.length) return [0, ""];

  const freqScore = Math.min(recent.length / 20, 1.0) * 10;
  let weighted = 0, totalW = 0;
  const allKw = [];

  for (const s of recent) {
    const w = new Date(s.collected_at).getTime() > weekAgo ? 2.0 : 1.0;
    weighted += (s.signal_strength ?? 0) * w;
    totalW += w;
    const kws = JSON.parse(s.pain_keywords || "[]");
    allKw.push(...kws);
  }

  const intensity = totalW ? (weighted / totalW) * 10 : 0;
  const dolor = Math.min(Math.round((freqScore * 0.5 + intensity * 0.5) * 100) / 100, 10.0);

  const kwCount = {};
  for (const kw of allKw) kwCount[kw] = (kwCount[kw] ?? 0) + 1;
  const topKw = Object.entries(kwCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const summary = topKw.length ? `Dolor en: ${topKw.join(", ")}` : `${recent.length} señales recientes`;

  return [dolor, summary];
}

export function applyRules(opp) {
  if (opp.status === "killed" || opp.status === "scaling") return opp;
  const ageDays = (Date.now() - new Date(opp.first_seen).getTime()) / 86400000;
  if (opp.signal_count === 0 && ageDays >= (opp.kill_threshold_days ?? 7) && opp.score < KILL_SCORE_THRESHOLD) {
    return { ...opp, status: "killed" };
  }
  if (opp.score >= SCALE_SCORE_THRESHOLD && (opp.emails_captured ?? 0) >= (opp.scale_threshold_emails ?? 30)) {
    return { ...opp, status: "scaling" };
  }
  return opp;
}

export function shouldAlert(opp) {
  if (!opp.telegram_alerted_at) return true;
  return (Date.now() - new Date(opp.telegram_alerted_at).getTime()) > 86400000;
}

export function formatAlert(opp, seg) {
  const bd = opp.score_breakdown ?? {};
  const lines = [
    `🎯 *Oportunidad detectada*`,
    `*Segmento:* ${seg.label}`,
    `*Score:* ${opp.score}/10`,
    `*Dolor:* ${(bd.dolor ?? 0).toFixed(1)} | *Pago:* ${(bd.capacidad_pago ?? 0).toFixed(0)} | *Urgencia:* ${(bd.urgencia ?? 0).toFixed(0)}`,
    `*Señales:* ${opp.signal_count}`,
    `*Resumen:* ${opp.pain_summary}`,
  ];
  if (seg.has_deadline) lines.push("⚠️ Deadline activo");
  return lines.join("\n");
}

export async function runScore(env, topN = 10, minScore = 1.0, dryRun = false) {
  const activeSegments = await _buildActiveSegments(env, topN, minScore);
  const results = [];

  for (const seg of activeSegments.values()) {
    const { results: signals } = await env.DB.prepare(
      "SELECT * FROM signals WHERE segment = ? ORDER BY collected_at DESC LIMIT 500"
    ).bind(seg.key).all();
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM signals WHERE segment = ?"
    ).bind(seg.key).first();

    const [dolor, painSummary] = dolorScore(signals ?? []);
    const breakdown = {
      dolor,
      capacidad_pago: incomeTierScore(seg.income_tier),
      volumen: volumeScore(seg.discovery_score),
      competencia: 5.0,
      urgencia: urgencyScore(seg.has_deadline),
    };
    const score = computeOpportunityScore(breakdown);

    const existing = await env.DB.prepare(
      "SELECT * FROM opportunities WHERE segment = ? LIMIT 1"
    ).bind(seg.key).first();

    const now = new Date().toISOString();
    const opp = {
      id: existing?.id ?? crypto.randomUUID().slice(0, 8),
      segment: seg.key,
      pain_summary: painSummary || existing?.pain_summary || "",
      score,
      score_breakdown: breakdown,
      signal_ids: (signals ?? []).slice(-50).map(s => s.id),
      signal_count: countRow?.n ?? 0,
      first_seen: existing?.first_seen ?? now,
      last_updated: now,
      status: existing?.status ?? "watching",
      landing_url: existing?.landing_url ?? null,
      emails_captured: existing?.emails_captured ?? 0,
      kill_threshold_days: 7,
      scale_threshold_emails: 30,
      telegram_alerted_at: existing?.telegram_alerted_at ?? null,
    };

    const finalOpp = applyRules(opp);

    if (!dryRun) {
      await env.DB.prepare(`
        INSERT INTO opportunities
          (id, segment, pain_summary, score, score_breakdown, signal_ids,
           signal_count, first_seen, last_updated, status, landing_url,
           emails_captured, validation_deadline, telegram_alerted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          score=excluded.score, score_breakdown=excluded.score_breakdown,
          signal_ids=excluded.signal_ids, signal_count=excluded.signal_count,
          last_updated=excluded.last_updated, status=excluded.status,
          emails_captured=excluded.emails_captured, landing_url=excluded.landing_url,
          validation_deadline=excluded.validation_deadline,
          telegram_alerted_at=excluded.telegram_alerted_at
      `).bind(
        finalOpp.id, finalOpp.segment, finalOpp.pain_summary ?? null, finalOpp.score,
        JSON.stringify(finalOpp.score_breakdown), JSON.stringify(finalOpp.signal_ids),
        finalOpp.signal_count, finalOpp.first_seen, finalOpp.last_updated,
        finalOpp.status, finalOpp.landing_url ?? null, finalOpp.emails_captured ?? 0,
        null, finalOpp.telegram_alerted_at ?? null,
      ).run();

      if (finalOpp.score >= ALERT_SCORE_THRESHOLD && finalOpp.status === "watching" && shouldAlert(finalOpp)) {
        const msg = formatAlert(finalOpp, seg);
        const sent = await sendTelegram(env, msg);
        if (sent) {
          await env.DB.prepare(
            "UPDATE opportunities SET telegram_alerted_at = ? WHERE id = ?"
          ).bind(now, finalOpp.id).run();
        }
      }
    }

    results.push({
      segment: seg.key, score: finalOpp.score, status: finalOpp.status,
      signal_count: finalOpp.signal_count, breakdown, pain_summary: finalOpp.pain_summary,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

async function _buildActiveSegments(env, topN, minScore) {
  const segments = new Map();

  const latestRun = await env.DB.prepare(
    "SELECT run_id FROM discovery_candidates ORDER BY id DESC LIMIT 1"
  ).first();

  if (latestRun) {
    const { results: candidates } = await env.DB.prepare(
      `SELECT * FROM discovery_candidates
       WHERE run_id = ? AND discovery_score >= ?
       ORDER BY discovery_score DESC LIMIT ?`
    ).bind(latestRun.run_id, minScore, topN).all();

    for (const c of candidates ?? []) {
      const key = c.profile.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
      segments.set(key, {
        key, label: c.profile,
        keywords: JSON.parse(c.keywords || "[]"),
        income_tier: c.income_est || "medium",
        has_deadline: c.has_deadline === 1,
        discovery_score: c.discovery_score ?? 0,
      });
    }
  }

  const { results: leadSegs } = await env.DB.prepare(
    "SELECT DISTINCT segment FROM leads"
  ).all();
  for (const r of leadSegs ?? []) {
    if (!segments.has(r.segment)) {
      segments.set(r.segment, {
        key: r.segment, label: r.segment, keywords: [],
        income_tier: "medium", has_deadline: false, discovery_score: 0,
      });
    }
  }

  return segments;
}
```

- [ ] **Step 2: Run tests**

```bash
cd src/main/infrastructure/worker && npx vitest run --reporter=verbose 2>&1
```

Expected: all tests in `test/score.test.js` pass (green).

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/score.js
git commit -m "feat: add scoring logic ported from Python to Worker"
```

---

## Task 5: Wire score.js into index.js

**Files:**
- Modify: `src/main/infrastructure/worker/index.js`

Three changes to index.js: (1) import score + notify, (2) add `POST /score` endpoint, (3) add `runScore` to the scheduled handler.

- [ ] **Step 1: Add imports at top of index.js**

Find the existing import block at the top of `index.js` (lines 1–29 currently) and add two lines after the existing imports:

```js
import { runScore } from "./score.js";
import { sendTelegram } from "./notify.js";
```

The top of the file should now look like:

```js
import { runGnewsCron } from "./collectors/gnews.js";
import { runLocalNewsCron } from "./collectors/local_news.js";
import { synthesizeCopy, buildHtml } from "./synthesize.js";
import { runDiscovery } from "./discover.js";
import { runScore } from "./score.js";
import { sendTelegram } from "./notify.js";
```

- [ ] **Step 2: Add POST /score endpoint**

Inside the authenticated route block in the `try { ... }` section, add this block after the existing `/discover` route (after line ~158):

```js
      if (path === "/score" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const results = await runScore(
          env,
          body.top_n ?? 10,
          body.min_score ?? 1.0,
          body.dry_run ?? false,
        );
        return json({ results });
      }
```

- [ ] **Step 3: Add Telegram alert to /discover handler and scoring to scheduled handler**

Find the `scheduled` handler at the bottom of index.js (currently lines ~168–173):

```js
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      runGnewsCron(env.DB),
      runLocalNewsCron(env),
    ]));
  },
```

Replace it with:

```js
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.all([
        runGnewsCron(env.DB),
        runLocalNewsCron(env),
      ]).then(() => runScore(env, 10, 1.0, false))
    );
  },
```

- [ ] **Step 4: Add Telegram notification after saving candidates in /discover handler**

Find the `/discover` POST block (around lines 136–158). After the `await env.DB.batch(...)` call and before `return json({ run_id, candidates })`, add:

```js
        const top5 = candidates.slice(0, 5);
        if (top5.length && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
          const lines = ["🔍 *Segmentos ocultos detectados*\n"];
          for (const [i, c] of top5.entries()) {
            lines.push(`*${i + 1}. ${c.profile}*\n  Dolor: ${c.pain}\n  Score: ${c.discovery_score}\n`);
          }
          await sendTelegram(env, lines.join("\n"));
        }
```

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/index.js
git commit -m "feat: add /score endpoint and wire scoring into 12h cron"
```

---

## Task 6: Update GitHub Actions

**Files:**
- Modify: `.github/workflows/discover.yml`
- Modify: `.github/workflows/ci.yml`
- Delete: `.github/workflows/dashboard.yml`

- [ ] **Step 1: Replace discover.yml**

Replace the entire file with:

```yaml
name: Discover

on:
  schedule:
    - cron: "0 7 1-7 * 1"  # first Monday of each month
  workflow_dispatch:

jobs:
  discover:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger discovery on Worker
        env:
          WORKER_URL: ${{ secrets.WORKER_URL }}
          WORKER_SECRET: ${{ secrets.WORKER_SECRET }}
        run: |
          curl -f -s -X POST "${WORKER_URL}/discover" \
            -H "Authorization: Bearer ${WORKER_SECRET}" \
            -H "Content-Type: application/json" \
            -d '{}' | jq .
```

- [ ] **Step 2: Update ci.yml — replace the test job**

Find the `test` job in `ci.yml`. It currently runs `pytest`. Replace the entire `test` job steps with:

```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm

      - name: Install deps
        run: npm ci

      - name: Run tests
        run: npm test
```

Also remove the `PYTHONPATH: src/main` line from the env (if it appears in the test job; it may only be in `discover.yml`).

The `changes`, `migrate`, `deploy-worker`, and `deploy-pages` jobs in ci.yml stay unchanged.

- [ ] **Step 3: Delete dashboard.yml**

```bash
rm .github/workflows/dashboard.yml
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/discover.yml .github/workflows/ci.yml
git rm .github/workflows/dashboard.yml
git commit -m "ci: replace python pipeline with worker endpoints, add vitest to ci"
```

---

## Task 7: Delete all Python

**Files:**
- Delete: `src/main/application/` (all files)
- Delete: `src/main/domain/` (all files)
- Delete: `src/main/infrastructure/collectors/` (all files)
- Delete: `src/main/infrastructure/db/` (all files)
- Delete: `src/main/infrastructure/llm/` (all files)
- Delete: `src/main/infrastructure/notifications.py`
- Delete: `src/main/infrastructure/compose.py`
- Delete: `src/main/infrastructure/__init__.py`
- Delete: `src/main/__init__.py`
- Delete: `src/main/main.py`
- Delete: `src/main/run_discover.py`
- Delete: `src/test/` (all files)
- Delete: `requirements.txt`
- Delete: `pyproject.toml`
- Delete: `.pytest_cache/`

- [ ] **Step 1: Delete Python source tree**

```bash
rm -rf src/main/application
rm -rf src/main/domain
rm -rf src/main/infrastructure/collectors
rm -rf src/main/infrastructure/db
rm -rf src/main/infrastructure/llm
rm src/main/infrastructure/notifications.py
rm src/main/infrastructure/compose.py
rm src/main/infrastructure/__init__.py
rm src/main/__init__.py
rm src/main/main.py
rm src/main/run_discover.py
```

- [ ] **Step 2: Delete test tree and Python config**

```bash
rm -rf src/test
rm -f requirements.txt pyproject.toml
rm -rf .pytest_cache
```

- [ ] **Step 3: Verify only Worker files remain in src/main**

```bash
find src/ -type f | sort
```

Expected output (only Worker and Pages files):
```
src/main/infrastructure/pages/...
src/main/infrastructure/worker/collectors/gnews.js
src/main/infrastructure/worker/collectors/local_news.js
src/main/infrastructure/worker/discover.js
src/main/infrastructure/worker/index.js
src/main/infrastructure/worker/llm.js
src/main/infrastructure/worker/migrations/...
src/main/infrastructure/worker/notify.js
src/main/infrastructure/worker/score.js
src/main/infrastructure/worker/synthesize.js
src/main/infrastructure/worker/test/score.test.js
src/main/infrastructure/worker/wrangler.toml
```

- [ ] **Step 4: Verify tests still pass**

```bash
npm test
```

Expected: all score tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete all Python code — backend fully migrated to TypeScript Worker"
```

---

## Self-Review

**Spec coverage:**
- ✅ Scoring logic ported (score.js with all functions from score.py + rules.py)
- ✅ Telegram notifier extracted to notify.js, reused in score.js and /discover handler
- ✅ /score endpoint added to Worker
- ✅ Scoring wired into 12h cron (closes the 7-day lag gap)
- ✅ discover.yml simplified to curl
- ✅ dashboard.yml deleted (full Python pipeline replaced by Worker cron)
- ✅ ci.yml tests Python removed, Vitest added
- ✅ All Python deleted

**Gaps:**
- None. The Worker already had /synthesize and /deploy, so validate.py has no equivalent missing.
- The `g2.py`, `hn.py`, `trends.py`, `reddit.py` collectors are explicitly not being used per user confirmation — deleted without replacement.
- SQLite local repo deleted — development now uses `wrangler dev` with local D1 simulation.
