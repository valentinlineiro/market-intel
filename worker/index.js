/**
 * worker/index.js
 *
 * API REST sobre D1. Llamado desde Python (GitHub Actions / local).
 * El Worker tiene binding nativo a D1 — sin HTTP overhead ni auth CF.
 *
 * Rutas:
 *   GET    /signals?segment=X&limit=N
 *   POST   /signals                    body: Signal JSON
 *   GET    /signals/count?segment=X
 *   GET    /opportunities?status=X
 *   POST   /opportunities              body: Opportunity JSON (upsert)
 *   GET    /stats
 *   GET    /health
 *
 * Auth: header Authorization: Bearer {WORKER_SECRET}
 *
 * Bindings requeridos (wrangler.toml):
 *   DB             — D1 database
 *   WORKER_SECRET  — secret para autenticar llamadas desde Python
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    // ── Auth ──────────────────────────────────────────────────────────────
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ") || auth.slice(7) !== env.WORKER_SECRET)
      return json({ error: "unauthorized" }, 401);

    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, "");
    const method = request.method;

    try {
      // ── Health ────────────────────────────────────────────────────────
      if (path === "/health" && method === "GET")
        return json({ status: "ok", ts: new Date().toISOString() });

      // ── Signals ───────────────────────────────────────────────────────
      if (path === "/signals" && method === "GET")
        return await getSignals(env.DB, url.searchParams);

      if (path === "/signals" && method === "POST")
        return await insertSignal(env.DB, await request.json());

      if (path === "/signals/count" && method === "GET")
        return await countSignals(env.DB, url.searchParams);

      // ── Opportunities ─────────────────────────────────────────────────
      if (path === "/opportunities" && method === "GET")
        return await getOpportunities(env.DB, url.searchParams);

      if (path === "/opportunities" && method === "POST")
        return await upsertOpportunity(env.DB, await request.json());

      // ── Stats ─────────────────────────────────────────────────────────
      if (path === "/stats" && method === "GET")
        return await getStats(env.DB);

      return json({ error: "not found" }, 404);

    } catch (err) {
      console.error(path, err);
      return json({ error: err.message }, 500);
    }
  },
};

// ── Handlers ──────────────────────────────────────────────────────────────

async function getSignals(db, params) {
  const segment = params.get("segment");
  const limit   = Math.min(parseInt(params.get("limit") || "100"), 500);

  const { results } = segment
    ? await db.prepare(
        "SELECT * FROM signals WHERE segment = ? ORDER BY collected_at DESC LIMIT ?"
      ).bind(segment, limit).all()
    : await db.prepare(
        "SELECT * FROM signals ORDER BY collected_at DESC LIMIT ?"
      ).bind(limit).all();

  return json({ results });
}

async function insertSignal(db, signal) {
  // Dedup: si ya existe (url + segment) devolver ok sin insertar
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
    signal.id,
    signal.source,
    signal.collected_at,
    signal.segment,
    signal.location     ?? null,
    (signal.raw_text || "").slice(0, 2000),
    signal.url,
    JSON.stringify(signal.pain_keywords ?? []),
    signal.sentiment_score  ?? null,
    signal.salary_mean      ?? null,
    signal.income_tier      ?? null,
    signal.signal_strength  ?? null,
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
    ? await db.prepare(
        "SELECT * FROM opportunities WHERE status = ? ORDER BY score DESC"
      ).bind(status).all()
    : await db.prepare(
        "SELECT * FROM opportunities ORDER BY score DESC"
      ).all();
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
      score               = excluded.score,
      score_breakdown     = excluded.score_breakdown,
      signal_ids          = excluded.signal_ids,
      signal_count        = excluded.signal_count,
      last_updated        = excluded.last_updated,
      status              = excluded.status,
      emails_captured     = excluded.emails_captured,
      landing_url         = excluded.landing_url,
      validation_deadline = excluded.validation_deadline,
      telegram_alerted_at = excluded.telegram_alerted_at
  `).bind(
    o.id, o.segment, o.pain_summary ?? null, o.score,
    typeof o.score_breakdown === "string" ? o.score_breakdown : JSON.stringify(o.score_breakdown ?? {}),
    typeof o.signal_ids      === "string" ? o.signal_ids      : JSON.stringify(o.signal_ids      ?? []),
    o.signal_count        ?? 0,
    o.first_seen, o.last_updated,
    o.status              ?? "watching",
    o.landing_url         ?? null,
    o.emails_captured     ?? 0,
    o.validation_deadline ?? null,
    o.telegram_alerted_at ?? null,
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
    total_signals:       sigRow?.n  ?? 0,
    total_opportunities: oppRow?.n  ?? 0,
    by_segment,
    top_opportunity:     topRow     ?? null,
    backend:             "worker+d1",
  });
}

// ── Helper ────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
