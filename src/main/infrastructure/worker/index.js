/**
 * infrastructure/worker/index.js
 *
 * API REST sobre D1 + gnews cron trigger.
 *
 * Rutas autenticadas:
 *   GET    /signals?segment=X&limit=N
 *   POST   /signals
 *   GET    /signals/count?segment=X
 *   GET    /opportunities?status=X
 *   POST   /opportunities
 *   GET    /stats
 *   GET    /health
 *
 * Rutas públicas (sin auth — para dashboard):
 *   GET    /public/stats
 *   GET    /public/opportunities
 *   GET    /public/leads
 *   GET    /public/discovery
 *
 * Rutas autenticadas (nuevas):
 *   POST   /synthesize   — genera copy vía LLM (sin deployar)
 *   POST   /deploy       — guarda HTML en D1 y actualiza opportunity
 */

import { runGnewsCron } from "./collectors/gnews.js";
import { runLocalNewsCron } from "./collectors/local_news.js";
import { synthesizeCopy, buildHtml } from "./synthesize.js";
import { runDiscovery } from "./discover.js";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, "");
    const method = request.method;

    // ── Public read-only routes (no auth required for dashboard) ──────────
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

    // ── Auth ──────────────────────────────────────────────────────────────
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ") || auth.slice(7) !== env.WORKER_SECRET)
      return json({ error: "unauthorized" }, 401);

    try {
      if (path === "/health" && method === "GET")
        return json({ status: "ok", ts: new Date().toISOString() });

      if (path === "/signals" && method === "GET")
        return await getSignals(env.DB, url.searchParams);

      if (path === "/signals" && method === "POST")
        return await insertSignal(env.DB, await request.json());

      if (path === "/signals/count" && method === "GET")
        return await countSignals(env.DB, url.searchParams);

      if (path === "/opportunities" && method === "GET")
        return await getOpportunities(env.DB, url.searchParams);

      if (path === "/opportunities" && method === "POST")
        return await upsertOpportunity(env.DB, await request.json());

      if (path === "/stats" && method === "GET")
        return await getStats(env.DB);

      if (path === "/synthesize" && method === "POST") {
        const { segment } = await request.json();
        if (!segment) return json({ error: "segment required" }, 400);
        const copy = await synthesizeCopy(segment, env);
        return json({ segment, copy });
      }

      if (path === "/deploy" && method === "POST") {
        const { segment, copy } = await request.json();
        if (!segment || !copy) return json({ error: "segment and copy required" }, 400);
        const html = buildHtml(segment, copy);
        const now  = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO landing_pages (segment, html, title, deployed_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(segment) DO UPDATE SET
             html=excluded.html, title=excluded.title, deployed_at=excluded.deployed_at`
        ).bind(segment, html, copy.title, now).run();
        const landingUrl = `https://market-intel.pages.dev/landings/${segment}`;
        await env.DB.prepare(
          `UPDATE opportunities SET landing_url = ?, status = 'testing', last_updated = ?
           WHERE segment = ?`
        ).bind(landingUrl, now, segment).run();
        return json({ url: landingUrl });
      }

      if (path === "/discovery/candidates" && method === "POST") {
        const { run_id, candidates } = await request.json();
        if (!run_id || !Array.isArray(candidates) || !candidates.length)
          return json({ error: "run_id and non-empty candidates required" }, 400);
        const invalid = candidates.filter(c => !c.profile || !c.pain);
        if (invalid.length)
          return json({ error: `${invalid.length} candidate(s) missing required profile/pain fields` }, 400);
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
        if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY)
          return json({ error: "No LLM key configured (GROQ_API_KEY or OPENROUTER_API_KEY required)" }, 503);
        const candidates = await runDiscovery(env);
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

      return json({ error: "not found" }, 404);

    } catch (err) {
      console.error(path, err);
      return json({ error: err.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      runGnewsCron(env.DB),
      runLocalNewsCron(env),
    ]));
  },
};

// ── Handlers ──────────────────────────────────────────────────────────────

async function getSignals(db, params) {
  const segment = params.get("segment");
  const limit   = Math.min(parseInt(params.get("limit") || "100"), 500);
  const { results } = segment
    ? await db.prepare("SELECT * FROM signals WHERE segment = ? ORDER BY collected_at DESC LIMIT ?").bind(segment, limit).all()
    : await db.prepare("SELECT * FROM signals ORDER BY collected_at DESC LIMIT ?").bind(limit).all();
  return json({ results });
}

async function insertSignal(db, signal) {
  const existing = await db.prepare(
    "SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1"
  ).bind(signal.url, signal.segment).first();
  if (existing) return json({ inserted: false, reason: "duplicate" });

  await db.prepare(`
    INSERT INTO signals
    (id, source, collected_at, segment, location, raw_text, url,
     pain_keywords, sentiment_score, salary_mean, income_tier,
     signal_strength, has_deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    signal.id, signal.source, signal.collected_at, signal.segment,
    signal.location ?? null, (signal.raw_text || "").slice(0, 2000), signal.url,
    JSON.stringify(signal.pain_keywords ?? []),
    signal.sentiment_score ?? null, signal.salary_mean ?? null,
    signal.income_tier ?? null, signal.signal_strength ?? null,
    signal.has_deadline ? 1 : 0,
  ).run();
  return json({ inserted: true });
}

async function countSignals(db, params) {
  const segment = params.get("segment");
  const row = segment
    ? await db.prepare("SELECT COUNT(*) as n FROM signals WHERE segment = ?").bind(segment).first()
    : await db.prepare("SELECT COUNT(*) as n FROM signals").first();
  return json({ count: row?.n ?? 0 });
}

async function getOpportunities(db, params) {
  const status = params.get("status");
  const { results } = status
    ? await db.prepare("SELECT * FROM opportunities WHERE status = ? ORDER BY score DESC").bind(status).all()
    : await db.prepare("SELECT * FROM opportunities ORDER BY score DESC").all();
  return json({ results });
}

async function upsertOpportunity(db, o) {
  await db.prepare(`
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
    o.id, o.segment, o.pain_summary ?? null, o.score,
    typeof o.score_breakdown === "string" ? o.score_breakdown : JSON.stringify(o.score_breakdown ?? {}),
    typeof o.signal_ids === "string" ? o.signal_ids : JSON.stringify(o.signal_ids ?? []),
    o.signal_count ?? 0, o.first_seen, o.last_updated,
    o.status ?? "watching", o.landing_url ?? null, o.emails_captured ?? 0,
    o.validation_deadline ?? null, o.telegram_alerted_at ?? null,
  ).run();
  return json({ upserted: true });
}

async function getStats(db) {
  const [sigRow, oppRow, bySegRows, topRow] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n FROM signals").first(),
    db.prepare("SELECT COUNT(*) as n FROM opportunities").first(),
    db.prepare("SELECT segment, COUNT(*) as n FROM signals GROUP BY segment").all(),
    db.prepare("SELECT score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1").first(),
  ]);
  const by_segment = {};
  for (const r of bySegRows.results ?? []) by_segment[r.segment] = r.n;
  return json({
    total_signals: sigRow?.n ?? 0,
    total_opportunities: oppRow?.n ?? 0,
    by_segment,
    top_opportunity: topRow ?? null,
    backend: "worker+d1",
  });
}

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

async function getLeads(db, params) {
  const segment = params.get("segment");
  const { results } = segment
    ? await db.prepare("SELECT email, segment, captured_at FROM leads WHERE segment = ? ORDER BY captured_at DESC").bind(segment).all()
    : await db.prepare("SELECT email, segment, captured_at FROM leads ORDER BY captured_at DESC LIMIT 200").all();
  const bySegment = {};
  for (const r of results ?? []) {
    if (!bySegment[r.segment]) bySegment[r.segment] = [];
    bySegment[r.segment].push({ email: r.email, captured_at: r.captured_at });
  }
  return json({ total: (results ?? []).length, by_segment: bySegment });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
