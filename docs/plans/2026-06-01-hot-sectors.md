# Hot Sectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface emergent market sectors from live Reddit scraping in a Hot Sectors dashboard section, with on-demand triggering from the UI and persistence in D1.

**Architecture:** A new `discovery_candidates` D1 table stores results from both the monthly Python cron and on-demand Worker-side discovery. The Worker gains three endpoints: `POST /discover` (runs a lightweight Reddit+LLM sweep directly in the Worker), `POST /discovery/candidates` (receives results from the Python pipeline), and `GET /public/discovery` (serves the latest run to the dashboard). The Python `run_discover.py` is updated to POST its full results to the Worker after each cron run. The dashboard gets a Hot Sectors section reading from `/public/discovery` plus a "Run Discovery" button calling `/discover`.

**Tech Stack:** Cloudflare Workers (JS), D1 (SQLite), OpenRouter API, Reddit public JSON API, vanilla JS dashboard, Python (existing discover pipeline).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `schema.sql` | Add `discovery_candidates` table |
| Create | `src/main/infrastructure/worker/discover.js` | Reddit scrape + LLM clustering in JS (lightweight, Worker-safe) |
| Modify | `src/main/infrastructure/worker/index.js` | Add `/discover`, `/discovery/candidates`, `/public/discovery` routes |
| Modify | `src/main/run_discover.py` | POST results to Worker after Python cron run |
| Modify | `.github/workflows/discover.yml` | Add WORKER_URL + WORKER_SECRET env vars |
| Modify | `src/main/infrastructure/pages/index.html` | Hot Sectors section + Run Discovery button |

---

## Task 1: Schema — add discovery_candidates table

**Files:**
- Modify: `schema.sql`

- [ ] **Step 1: Append table definition to schema.sql**

Add after the `landing_pages` block:

```sql
CREATE TABLE IF NOT EXISTS discovery_candidates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile         TEXT NOT NULL,
    pain            TEXT NOT NULL,
    keywords        TEXT NOT NULL,
    post_count      INTEGER DEFAULT 0,
    discovery_score REAL DEFAULT 0,
    income_est      TEXT,
    has_deadline    INTEGER DEFAULT 0,
    source          TEXT DEFAULT 'reddit',
    run_id          TEXT NOT NULL,
    discovered_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_run   ON discovery_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_discovery_score ON discovery_candidates(discovery_score DESC);
```

- [ ] **Step 2: Apply to remote D1**

```bash
wrangler d1 execute market-intel --file=schema.sql --remote --yes
```

Expected: `Successfully executed` — `IF NOT EXISTS` makes it a no-op if the table already exists.

- [ ] **Step 3: Commit**

```bash
git add schema.sql
git commit -m "feat: add discovery_candidates table to D1 schema"
```

---

## Task 2: Worker — discover.js module

**Files:**
- Create: `src/main/infrastructure/worker/discover.js`

This is a lightweight JS port of `src/main/application/discover.py`. It scrapes 4 subreddits (instead of 7) and runs 2 LLM batches max to stay within Worker's ~30s wall-clock limit.

- [ ] **Step 1: Create discover.js**

```javascript
// src/main/infrastructure/worker/discover.js

const SUBREDDITS = ["autonomos", "pymes", "emprendimiento", "spain"];
const KNOWN_SEGMENTS = [
  "Odontólogo / Clínica dental",
  "Docente universitario",
  "Abogado autónomo",
  "Arquitecto",
];

const CLUSTER_PROMPT = `Analiza estos posts de Reddit de comunidades profesionales españolas.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en: {known}.

POSTS:
{posts}

Para cada perfil nuevo devuelve JSON:
{"profile":"...","pain":"...","keywords":["..."],"post_count":N,"income_estimate":"high|medium_high|medium|low","has_deadline":true|false}

Devuelve SOLO un array JSON válido. Si no hay perfiles nuevos devuelve [].`;

export async function runDiscovery(apiKey, limit = 60) {
  const texts = await collectBroad(limit);
  if (!texts.length) return [];

  const allClusters = [];
  for (let i = 0; i < texts.length && i < 30; i += 15) {
    const batch = texts.slice(i, i + 15);
    const clusters = await clusterBatch(batch, apiKey);
    allClusters.push(...clusters);
  }

  return aggregate(allClusters);
}

async function collectBroad(limit) {
  const headers = { "User-Agent": "market-intel-discover/0.1", "Accept": "application/json" };
  const seen = new Set();
  const texts = [];

  for (const sub of SUBREDDITS) {
    if (texts.length >= limit) break;
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/new.json?limit=15`,
        { headers }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const child of data.data?.children ?? []) {
        const p = child.data;
        if (!p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        const body = (p.selftext || "").slice(0, 200);
        texts.push(body ? `${p.title} — ${body}` : p.title);
      }
    } catch (e) {
      console.error(`r/${sub}:`, e.message);
    }
  }
  return texts.slice(0, limit);
}

async function clusterBatch(texts, apiKey) {
  const prompt = CLUSTER_PROMPT
    .replace("{known}", KNOWN_SEGMENTS.join(", "))
    .replace("{posts}", texts.map((t, i) => `${i + 1}. ${t}`).join("\n"));

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      }),
    });
    if (!res.ok) return [];

    const data = await res.json();
    let raw = data.choices[0].message.content.trim();
    if (raw.startsWith("```")) {
      raw = raw.split("```")[1];
      if (raw.startsWith("json")) raw = raw.slice(4).trim();
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error("cluster batch failed:", e.message);
    return [];
  }
}

function aggregate(clusters) {
  const merged = [];
  for (const c of clusters) {
    if (!c.profile) continue;
    const keywords = c.keywords || [];
    const existing = merged.find(
      m => keywords.filter(k => (m.keywords || []).includes(k)).length >= 2
    );
    if (existing) {
      existing.post_count = (existing.post_count || 0) + (c.post_count || 1);
      existing.batch_count = (existing.batch_count || 1) + 1;
    } else {
      merged.push({ ...c, keywords, batch_count: 1 });
    }
  }
  return merged
    .map(m => ({
      profile:         m.profile,
      pain:            m.pain,
      keywords:        m.keywords || [],
      post_count:      m.post_count || 1,
      discovery_score: Math.round((m.post_count || 1) * (1 + (m.batch_count || 1) * 0.5) * 10) / 10,
      income_est:      m.income_estimate || null,
      has_deadline:    m.has_deadline || false,
    }))
    .sort((a, b) => b.discovery_score - a.discovery_score);
}
```

- [ ] **Step 2: Verify the module exports are valid JS**

```bash
node --input-type=module <<'EOF'
import { runDiscovery } from './src/main/infrastructure/worker/discover.js';
console.log(typeof runDiscovery);
EOF
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/discover.js
git commit -m "feat: worker discover.js — Reddit scrape + LLM clustering module"
```

---

## Task 3: Worker — /discover, /discovery/candidates, /public/discovery endpoints

**Files:**
- Modify: `src/main/infrastructure/worker/index.js`

- [ ] **Step 1: Add import at top of index.js**

After the existing imports, add:

```javascript
import { runDiscovery } from "./discover.js";
```

- [ ] **Step 2: Add /public/discovery to the public routes block**

In the public routes condition, add `/public/discovery`:

```javascript
    if (method === "GET" && (path === "/public/stats" || path === "/public/opportunities" || path === "/public/leads" || path === "/public/discovery")) {
      try {
        if (path === "/public/stats")         return await getStats(env.DB);
        if (path === "/public/leads")         return await getLeads(env.DB, url.searchParams);
        if (path === "/public/discovery")     return await getDiscovery(env.DB);
        return await getOpportunities(env.DB, url.searchParams);
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }
```

- [ ] **Step 3: Add /discover and /discovery/candidates inside the authenticated try block**

Before `return json({ error: "not found" }, 404)`, add:

```javascript
      if (path === "/discovery/candidates" && method === "POST") {
        const { run_id, candidates } = await request.json();
        if (!run_id || !Array.isArray(candidates) || !candidates.length)
          return json({ error: "run_id and non-empty candidates required" }, 400);
        const now = new Date().toISOString();
        const stmt = env.DB.prepare(
          `INSERT INTO discovery_candidates
           (profile, pain, keywords, post_count, discovery_score, income_est, has_deadline, source, run_id, discovered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        await env.DB.batch(
          candidates.map(c => stmt.bind(
            c.profile, c.pain,
            JSON.stringify(c.keywords || []),
            c.post_count || 0, c.discovery_score || 0,
            c.income_est || null, c.has_deadline ? 1 : 0,
            c.source || "reddit", run_id, now
          ))
        );
        return json({ saved: candidates.length });
      }

      if (path === "/discover" && method === "POST") {
        if (!env.OPENROUTER_API_KEY)
          return json({ error: "OPENROUTER_API_KEY not configured" }, 503);
        const candidates = await runDiscovery(env.OPENROUTER_API_KEY);
        if (!candidates.length) return json({ run_id: null, candidates: [] });
        const run_id = new Date().toISOString();
        const now    = run_id;
        const stmt = env.DB.prepare(
          `INSERT INTO discovery_candidates
           (profile, pain, keywords, post_count, discovery_score, income_est, has_deadline, source, run_id, discovered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        await env.DB.batch(
          candidates.map(c => stmt.bind(
            c.profile, c.pain,
            JSON.stringify(c.keywords || []),
            c.post_count || 0, c.discovery_score || 0,
            c.income_est || null, c.has_deadline ? 1 : 0,
            "reddit", run_id, now
          ))
        );
        return json({ run_id, candidates });
      }
```

- [ ] **Step 4: Add getDiscovery handler before the json() helper**

```javascript
async function getDiscovery(db) {
  const latest = await db.prepare(
    "SELECT run_id, discovered_at FROM discovery_candidates ORDER BY id DESC LIMIT 1"
  ).first();
  if (!latest) return json({ run_id: null, candidates: [], discovered_at: null });

  const { results } = await db.prepare(
    "SELECT * FROM discovery_candidates WHERE run_id = ? ORDER BY discovery_score DESC LIMIT 20"
  ).bind(latest.run_id).all();

  const candidates = (results ?? []).map(r => ({
    profile:         r.profile,
    pain:            r.pain,
    keywords:        JSON.parse(r.keywords || "[]"),
    post_count:      r.post_count,
    discovery_score: r.discovery_score,
    income_est:      r.income_est,
    has_deadline:    r.has_deadline === 1,
  }));

  return json({ run_id: latest.run_id, candidates, discovered_at: latest.discovered_at });
}
```

- [ ] **Step 5: Smoke-test /public/discovery (should return empty, not error)**

Deploy worker first:
```bash
cd src/main/infrastructure/worker && wrangler deploy
```

Then:
```bash
curl https://market-intel-api.valentinlineiro.workers.dev/public/discovery
```

Expected: `{"run_id":null,"candidates":[],"discovered_at":null}`

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/index.js
git commit -m "feat: worker /discover, /discovery/candidates, /public/discovery endpoints"
```

---

## Task 4: Python pipeline — save discovery results to Worker

**Files:**
- Modify: `src/main/run_discover.py`
- Modify: `.github/workflows/discover.yml`

- [ ] **Step 1: Update run_discover.py to POST results to Worker**

Replace the entire file content:

```python
import os
import json
import logging
from datetime import datetime, timezone

import requests

from infrastructure.llm.chain import LLMChain
from infrastructure.notifications import TelegramNotifier
from application.discover import DiscoverUseCase

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

uc = DiscoverUseCase(LLMChain(), TelegramNotifier())
candidates = uc.run(
    limit=int(os.environ.get("DISCOVER_LIMIT", "100")),
    min_score=float(os.environ.get("DISCOVER_MIN_SCORE", "3.0")),
)

worker_url    = os.environ.get("WORKER_URL", "").rstrip("/")
worker_secret = os.environ.get("WORKER_SECRET", "")

if candidates and worker_url and worker_secret:
    run_id = datetime.now(timezone.utc).isoformat()
    payload = {
        "run_id": run_id,
        "candidates": [
            {
                "profile":         c["profile"],
                "pain":            c["pain"],
                "keywords":        c.get("keywords", []),
                "post_count":      c.get("post_count", 0),
                "discovery_score": c.get("discovery_score", 0.0),
                "income_est":      c.get("income_estimate", None),
                "has_deadline":    c.get("has_deadline", False),
                "source":          "reddit",
            }
            for c in candidates
        ],
    }
    try:
        r = requests.post(
            f"{worker_url}/discovery/candidates",
            headers={
                "Authorization": f"Bearer {worker_secret}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        r.raise_for_status()
        log.info(f"Saved {r.json().get('saved', 0)} candidates to Worker (run_id={run_id})")
    except Exception as e:
        log.error(f"Failed to save candidates to Worker: {e}")
else:
    log.info("Skipping Worker save (no candidates or WORKER_URL/WORKER_SECRET not set)")
```

- [ ] **Step 2: Add WORKER_URL and WORKER_SECRET to discover.yml**

In the `env:` block of the "Run discovery" step, add:

```yaml
          WORKER_URL:         ${{ secrets.WORKER_URL }}
          WORKER_SECRET:      ${{ secrets.WORKER_SECRET }}
```

The full env block becomes:

```yaml
        env:
          GROQ_API_KEY:       ${{ secrets.GROQ_API_KEY }}
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          ANTHROPIC_API_KEY:  ${{ secrets.ANTHROPIC_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
          WORKER_URL:         ${{ secrets.WORKER_URL }}
          WORKER_SECRET:      ${{ secrets.WORKER_SECRET }}
          PYTHONPATH:         src/main
          PYTHONUNBUFFERED:   "1"
          DISCOVER_LIMIT:     "${{ github.event.inputs.limit || '100' }}"
          DISCOVER_MIN_SCORE: "${{ github.event.inputs.min_score || '3.0' }}"
```

- [ ] **Step 3: Run the Python tests to make sure nothing broke**

```bash
cd /home/valentin/code/market-intel
PYTHONPATH=src/main pytest src/test/ -v
```

Expected: all tests pass (run_discover.py has no unit tests — it's an integration entry point).

- [ ] **Step 4: Commit**

```bash
git add src/main/run_discover.py .github/workflows/discover.yml
git commit -m "feat: run_discover.py saves candidates to Worker after cron run"
```

---

## Task 5: Dashboard — Hot Sectors section

**Files:**
- Modify: `src/main/infrastructure/pages/index.html`

- [ ] **Step 1: Add Hot Sectors HTML section**

In `index.html`, find the `<h2>Oportunidades</h2>` block and add the Hot Sectors section **before** it:

```html
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0;margin-bottom:16px;">
    <h2 style="margin:0;">Sectores Emergentes</h2>
    <div style="display:flex;align-items:center;gap:12px;">
      <span id="discovery-ts" style="font-size:0.7rem;color:#334155;"></span>
      <button id="run-discovery-btn"
        onclick="runDiscovery()"
        style="padding:6px 14px;background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:6px;font-size:0.75rem;cursor:pointer;">
        Descubrir ahora
      </button>
    </div>
  </div>
  <div id="sectors-grid" class="grid" style="margin-bottom:32px;">
    <div class="card"><p class="loading">Cargando...</p></div>
  </div>

```

- [ ] **Step 2: Add /public/discovery to the Promise.all in load()**

Replace the existing `Promise.all` in `load()`:

```javascript
      const [statsRes, oppsRes, leadsRes, discoveryRes] = await Promise.all([
        fetch(`${WORKER}/public/stats`),
        fetch(`${WORKER}/public/opportunities`),
        fetch(`${WORKER}/public/leads`),
        fetch(`${WORKER}/public/discovery`),
      ]);
      const stats     = await statsRes.json();
      const opps      = await oppsRes.json();
      const leads     = await leadsRes.json();
      const discovery = await discoveryRes.json();
```

- [ ] **Step 3: Add sectors rendering in load() after stats rendering**

After the `document.getElementById("stats-grid").innerHTML = ...` block, add:

```javascript
      if (discovery.discovered_at) {
        const ago = Math.round((Date.now() - new Date(discovery.discovered_at)) / 60000);
        document.getElementById("discovery-ts").textContent =
          `Última exploración: hace ${ago < 60 ? ago + " min" : Math.round(ago / 60) + " h"}`;
      }

      const sectorCards = (discovery.candidates || []).slice(0, 6).map(c => {
        const scorePct  = Math.min(c.discovery_score / 20, 1);
        const scoreColor = scorePct > 0.6 ? "#34d399" : scorePct > 0.3 ? "#fbbf24" : "#94a3b8";
        const kwChips = (c.keywords || []).slice(0, 4).map(
          k => `<span style="padding:2px 6px;background:#1e293b;border-radius:4px;font-size:0.7rem;color:#64748b;">${k}</span>`
        ).join(" ");
        return `<div class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <strong style="color:#f1f5f9;font-size:0.9rem;line-height:1.3;">${c.profile}</strong>
            <span style="color:${scoreColor};font-weight:700;font-size:0.85rem;white-space:nowrap;margin-left:8px;">${c.discovery_score.toFixed(1)}</span>
          </div>
          <p style="color:#64748b;font-size:0.8rem;margin-bottom:10px;line-height:1.4;">${c.pain}</p>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">${kwChips}</div>
          <div style="margin-top:8px;font-size:0.7rem;color:#334155;">${c.post_count} posts · ${c.income_est || "—"}</div>
        </div>`;
      }).join("");

      document.getElementById("sectors-grid").innerHTML =
        sectorCards || '<div class="card"><p style="color:#475569;font-size:0.875rem;">Sin sectores detectados todavía. Haz clic en "Descubrir ahora".</p></div>';
```

- [ ] **Step 4: Add runDiscovery() function in the script block**

After the `closeModal()` function, add:

```javascript
  async function runDiscovery() {
    const secret = document.getElementById("secret-input").value.trim();
    if (!secret) {
      alert("Introduce el Worker secret primero.");
      document.getElementById("secret-input").focus();
      return;
    }
    const btn = document.getElementById("run-discovery-btn");
    btn.textContent = "Explorando...";
    btn.disabled = true;
    try {
      const res = await fetch(`${WORKER}/discover`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const data = await res.json();
      btn.textContent = `✓ ${data.candidates?.length ?? 0} sectores encontrados`;
      setTimeout(() => { btn.textContent = "Descubrir ahora"; btn.disabled = false; load(); }, 2000);
    } catch (e) {
      btn.textContent = `Error: ${e.message}`;
      setTimeout(() => { btn.textContent = "Descubrir ahora"; btn.disabled = false; }, 3000);
    }
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/pages/index.html
git commit -m "feat: dashboard Hot Sectors section with on-demand discovery trigger"
```

- [ ] **Step 6: Push and trigger full deploy**

```bash
git push
gh workflow run ci.yml --ref main
```

- [ ] **Step 7: Smoke-test the full flow**

After CI completes (~3 min):

1. Open `https://market-intel-36d.pages.dev/`
2. Confirm Hot Sectors section shows "Sin sectores detectados todavía"
3. Enter Worker secret, click "Descubrir ahora"
4. Wait ~15–20s for Reddit + LLM
5. Confirm button shows "✓ N sectores encontrados"
6. Confirm grid populates with sector cards showing profile, pain, score, keywords

---

## Self-Review

**Spec coverage:**
- ✅ Hot Sectors view with pain, signal count, trend score — Task 5
- ✅ Stores discovery results in D1 — Tasks 1, 3
- ✅ On-demand trigger from UI — Task 5 (`runDiscovery()` → `/discover`)
- ✅ Worker `/discover` endpoint runs Reddit + LLM — Tasks 2, 3
- ✅ Monthly cron results persist to D1 — Task 4
- ✅ Telegram notification still works — `DiscoverUseCase.run()` unchanged, we only add the POST after
- ✅ Sources: Reddit (Worker + Python), Google News already runs via gnews cron

**Gaps / known omissions:**
- Google News signals are already in D1 `signals` table via gnews cron but are not used by the discovery clustering. They serve the scoring pipeline instead. Not adding to discovery avoids scope creep — the signals → score pipeline already handles GNews.
- No pagination on `/public/discovery` — returns latest 20 results, sufficient for dashboard cards.
- Worker `/discover` timeout risk: 4 subreddits × ~2s each + 2 LLM calls × ~3s = ~14s total, within the 30s Worker limit. If it times out, the endpoint returns a 500 and the dashboard shows the error on the button.

**Placeholder scan:** None found — all steps contain complete code.

**Type consistency:**
- `discovery_score` used consistently across discover.js, index.js handler, and dashboard rendering
- `income_est` field name consistent across D1 schema, discover.js output, index.js insert, and run_discover.py mapping
- `run_id` is an ISO timestamp string in all three code paths (Worker `/discover`, Worker `/discovery/candidates`, Python run_discover.py)
