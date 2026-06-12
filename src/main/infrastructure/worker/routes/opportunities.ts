/**
 * routes/opportunities.ts
 *
 * Route handlers for opportunities (GET /opportunities, POST /opportunities, PATCH status, scoring, market testing).
 */

import { D1Repo } from '../infrastructure/db/d1-repo.js';
import { getConfig } from '../infrastructure/config.js';
import { EmailNotifier } from '../infrastructure/notify.js';
import { runScore } from '../application/score.js';
import { runMarketTest } from '../application/market-test.js';
import { collectGnews } from '../infrastructure/collectors/gnews.js';
import { LLMChain } from '../infrastructure/llm/chain.js';
import { json, makeLlm, hasLlmKey, authCors, PUBLIC_CORS } from '../index.js';
import type { Env } from '../index.js';

export async function handleGetOpportunities(db: D1Database, params: URLSearchParams): Promise<Response> {
  const status = params.get('status');
  const { results } = status
    ? await db.prepare('SELECT * FROM opportunities WHERE status = ? ORDER BY score DESC LIMIT 200').bind(status).all()
    : await db.prepare('SELECT * FROM opportunities ORDER BY score DESC LIMIT 200').all();
  return json({ results });
}

export async function handleUpsertOpportunity(db: D1Database, o: Record<string, unknown>, cors = PUBLIC_CORS): Promise<Response> {
  await db.prepare(`
    INSERT INTO opportunities
    (id, segment, pain_summary, score, score_breakdown, signal_ids,
     signal_count, first_seen, last_updated, status, landing_url,
     emails_captured, validation_deadline, alerted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      score=excluded.score, score_breakdown=excluded.score_breakdown,
      signal_ids=excluded.signal_ids, signal_count=excluded.signal_count,
      last_updated=excluded.last_updated, status=excluded.status,
      emails_captured=excluded.emails_captured, landing_url=excluded.landing_url,
      validation_deadline=excluded.validation_deadline,
      alerted_at=excluded.alerted_at
  `).bind(
    o['id'], o['segment'], o['pain_summary'] ?? null, o['score'],
    typeof o['score_breakdown'] === 'string' ? o['score_breakdown'] : JSON.stringify(o['score_breakdown'] ?? {}),
    typeof o['signal_ids'] === 'string' ? o['signal_ids'] : JSON.stringify(Array.isArray(o['signal_ids']) ? o['signal_ids'] : []),
    o['signal_count'] ?? 0, o['first_seen'], o['last_updated'],
    o['status'] ?? 'watching', o['landing_url'] ?? null, o['emails_captured'] ?? 0,
    o['validation_deadline'] ?? null, o['alerted_at'] ?? null,
  ).run();
  return json({ upserted: true }, 200, cors);
}

export async function handleUpdateOpportunityStatus(db: D1Database, segment: string, status: string, cors = PUBLIC_CORS): Promise<Response> {
  const valid = ['watching', 'testing', 'scaling', 'killed'];
  if (!status || !valid.includes(status)) {
    return json({ error: 'invalid status' }, 400, cors);
  }
  await new D1Repo(db).updateOpportunityStatus(segment, status, new Date().toISOString());
  return json({ ok: true }, 200, cors);
}

export async function handleScore(env: Env, body: { top_n?: number; min_score?: number; dry_run?: boolean }): Promise<Response> {
  const cfg = await getConfig(env.DB);
  const d1repo = new D1Repo(env.DB);
  const llm = makeLlm(cfg.llm, env);
  const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);
  if (!(await d1repo.hasCandidates())) {
    const now = new Date().toISOString();
    const seeds: import('../domain/types.js').DiscoveryCandidate[] = Object.entries(cfg.segments).map(([key, sc]) => ({
      segment: key, label: sc.label, pain_summary: '', discovery_score: 5,
      source_urls: [], raw_signals: sc.keywords, discovered_at: now,
      post_count: 0, income_est: sc.income_tier, has_deadline: sc.has_deadline,
    }));
    await d1repo.saveCandidates(seeds, crypto.randomUUID());
  }
  const results = await runScore(
    { signals: d1repo, opportunities: d1repo, discovery: d1repo },
    notifier,
    body.top_n ?? cfg.score.top_n,
    body.min_score ?? cfg.score.min_score,
    body.dry_run ?? cfg.score.dry_run,
    hasLlmKey(env) ? llm : undefined,
  );
  return json({ results }, 200, authCors(env));
}

export async function handleCreateMarketTest(env: Env, ctx: ExecutionContext, body: { description?: string }): Promise<Response> {
  const { description } = body;
  if (!description || typeof description !== 'string' || !description.trim()) {
    return json({ error: 'description required' }, 400, authCors(env));
  }
  if (!hasLlmKey(env)) {
    return json({ error: 'No LLM key configured (set GROQ_API_KEY, OPENROUTER_API_KEY, NIM_API_KEY, or MISTRAL_API_KEY)' }, 503, authCors(env));
  }
  const id   = crypto.randomUUID().slice(0, 12);
  const now  = new Date().toISOString();
  const d1repo = new D1Repo(env.DB);
  await d1repo.createMarketTest(id, description.trim(), now);
  const cfg = await getConfig(env.DB);
  const llm = makeLlm(cfg.llm, env);
  ctx.waitUntil(runMarketTest(id, description.trim(), llm, d1repo,
    (config) => collectGnews({ 'market-test': config }, ''),
  ));
  return json({ test_id: id }, 200, authCors(env));
}

export async function handleGetMarketTest(db: D1Database, id: string, cors = PUBLIC_CORS): Promise<Response> {
  const d1repo = new D1Repo(db);
  const test = await d1repo.getMarketTest(id);
  if (!test) return json({ error: 'not found' }, 404, cors);
  return json(test, 200, cors);
}
