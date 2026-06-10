/**
 * infrastructure/worker/index.ts
 *
 * Composition root, HTTP router, and cron handler for the Worker.
 *
 * Authenticated routes:
 *   GET    /signals?segment=X&limit=N
 *   POST   /signals
 *   GET    /signals/count?segment=X
 *   GET    /opportunities?status=X
 *   POST   /opportunities
 *   GET    /stats
 *   GET    /health
 *   GET    /config
 *   PUT    /config
 *   POST   /synthesize
 *   POST   /deploy
 *   POST   /discovery/candidates
 *   POST   /discover
 *   POST   /score
 *   POST   /market-test
 *   GET    /market-test/:id
 *
 * Public routes (no auth required):
 *   GET    /public/stats
 *   GET    /public/opportunities
 *   GET    /public/leads
 *   GET    /public/discovery
 *   GET    /public/config
 *   GET    /public/landings/:segment
 *   POST   /public/signup
 */

import { getConfig, setConfig, invalidateCache, DEFAULT_CONFIG } from './infrastructure/config.js';
import { D1Repo } from './infrastructure/db/d1-repo.js';
import { LLMChain } from './infrastructure/llm/chain.js';
import { EmailNotifier } from './infrastructure/notify.js';
import type { SendEmail } from './infrastructure/notify.js';
import { collectGitHub } from './infrastructure/collectors/github.js';
import { buildRegistry } from './infrastructure/collectors/registry.js';
import type { Config, FrictionProfile } from './domain/types.js';
import type { ISignalRepo } from './application/ports.js';
import { runCollect } from './application/collect.js';
import { runScore } from './application/score.js';
import { runDiscovery } from './application/discover.js';
import { analyzeFriction } from './application/friction.js';
import { synthesizeCopy, buildHtml } from './application/synthesize.js';
import { runMarketTest } from './application/market-test.js';
import { computeLeadScore } from './application/lead-score.js';
import { runSnapshot, runGapScore } from './application/gap.js';

// ---------------------------------------------------------------------------
// Env interface
// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
  WORKER_SECRET: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GITHUB_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
  PRODUCTHUNT_API_KEY?: string;
  EMAIL?: SendEmail;
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------

const handleFetch: ExportedHandler<Env>['fetch'] = async (request, env, ctx) => {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });

  const url    = new URL(request.url);
  const path   = url.pathname.replace(/\/$/, '');
  const method = request.method;

  // ── Public routes (no auth required) ──────────────────────────────────────
  const isPublicGet = method === 'GET' && (
    path === '/public/stats' ||
    path === '/public/opportunities' ||
    path === '/public/leads' ||
    path === '/public/discovery' ||
    path === '/public/config' ||
    path.startsWith('/public/landings/')
  );
  const isPublicPost = method === 'POST' && (
    path === '/public/signup' ||
    path === '/public/signup/price'
  );

  if (isPublicGet || isPublicPost) {
    try {
      const d1repo = new D1Repo(env.DB);

      if (path === '/public/stats')         return await handleGetStats(d1repo);
      if (path === '/public/leads')         return await handleGetLeads(d1repo, url.searchParams);
      if (path === '/public/discovery')     return await handleGetDiscovery(d1repo);
      if (path === '/public/config')        return await handleGetConfig(env.DB);
      if (path === '/public/opportunities') return await handleGetOpportunities(env.DB, url.searchParams);

      if (path.startsWith('/public/landings/')) {
        const rest = path.slice('/public/landings/'.length);
        const slashIdx = rest.indexOf('/');
        const segment  = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
        const pageSlug = slashIdx === -1 ? 'index' : rest.slice(slashIdx + 1);
        if (!segment) return new Response('Not Found', { status: 404 });
        const html = await d1repo.getLandingHtml(segment, pageSlug);
        if (!html) return new Response('Not Found', { status: 404 });
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }

      if (path === '/public/signup' && method === 'POST') {
        const body = await request.json() as { email?: string; segment?: string };
        if (!body.email || !body.segment)
          return json({ error: 'email and segment required' }, 400);
        await d1repo.saveLead(body.email, body.segment);
        return json({ ok: true });
      }

      if (path === '/public/signup/price' && method === 'POST') {
        const body = await request.json() as { email?: string; segment?: string; price_tier?: string };
        const validTiers = ['0-10', '10-30', '30-50', '50+'];
        if (!body.email || !body.segment || !body.price_tier)
          return json({ error: 'email, segment and price_tier required' }, 400);
        if (!validTiers.includes(body.price_tier))
          return json({ error: 'invalid price_tier' }, 400);
        await d1repo.savePriceTier(body.email, body.segment, body.price_tier);
        return json({ ok: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: msg }, 500);
    }
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.slice(7) !== env.WORKER_SECRET)
    return json({ error: 'unauthorized' }, 401);

  try {
    if (path === '/run-cron' && method === 'POST') {
      const fakeCtx = { waitUntil: (p: Promise<unknown>) => p, passThroughOnException: () => {} };
      await scheduled({} as ScheduledEvent, env, fakeCtx as unknown as ExecutionContext);
      return json({ ok: true, started_at: new Date().toISOString() });
    }

    if (path === '/health' && method === 'GET') {
      const healthRepo = new D1Repo(env.DB);
      let last_runs: Record<string, { last_run_at: string; signal_count: number; error: string | null }> = {};
      try {
        const rows = await healthRepo.getCollectorHealth();
        for (const row of rows) {
          last_runs[row.collector_id] = {
            last_run_at:   row.last_run_at,
            signal_count:  row.signal_count,
            error:         row.error,
          };
        }
      } catch { /* return empty last_runs on D1 error */ }
      return json({ status: 'ok', ts: new Date().toISOString(), last_runs });
    }

    if (path === '/signals' && method === 'GET')
      return await handleGetSignals(env.DB, url.searchParams);

    if (path === '/signals' && method === 'POST')
      return await handleInsertSignal(env.DB, await request.json() as Record<string, unknown>);

    if (path === '/signals/count' && method === 'GET')
      return await handleCountSignals(env.DB, url.searchParams);

    if (path === '/opportunities' && method === 'GET')
      return await handleGetOpportunities(env.DB, url.searchParams);

    if (path === '/opportunities' && method === 'POST')
      return await handleUpsertOpportunity(env.DB, await request.json() as Record<string, unknown>);

    const statusMatch = path.match(/^\/opportunities\/([^/]+)\/status$/);
    if (statusMatch && method === 'PATCH') {
      const segment = decodeURIComponent(statusMatch[1]);
      const body = await request.json() as { status?: string };
      const valid = ['watching', 'testing', 'scaling', 'killed'];
      if (!body.status || !valid.includes(body.status))
        return json({ error: 'invalid status' }, 400);
      await new D1Repo(env.DB).updateOpportunityStatus(segment, body.status, new Date().toISOString());
      return json({ ok: true });
    }

    if (path === '/stats' && method === 'GET')
      return await handleGetStats(new D1Repo(env.DB));

    if (path === '/config' && method === 'GET')
      return await handleGetConfig(env.DB);

    if (path === '/config' && method === 'PUT') {
      const body = await request.json() as unknown;
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return json({ error: 'invalid config' }, 400);
      await setConfig(env.DB, body as Record<string, unknown>);
      invalidateCache();
      return json({ status: 'ok' });
    }

    if (path === '/synthesize' && method === 'POST') {
      const { segment } = await request.json() as { segment?: string };
      if (!segment) return json({ error: 'segment required' }, 400);
      if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY)
        return json({ error: 'No LLM key configured (GROQ_API_KEY or OPENROUTER_API_KEY required)' }, 503);
      const cfg = await getConfig(env.DB);
      let segmentConfig = cfg.synthesis_segments[segment];
      if (!segmentConfig) {
        const d1repo = new D1Repo(env.DB);
        const discovery = await d1repo.getLatestCandidates();
        const candidate = discovery?.candidates.find(c => c.segment === segment);
        if (!candidate) return json({ error: `segment '${segment}' not found` }, 404);
        segmentConfig = {
          key:             segment,
          label:           candidate.label ?? segment.replace(/_/g, ' '),
          keywords:        candidate.raw_signals ?? [],
          income_tier:     candidate.income_est ?? 'medium',
          has_deadline:    candidate.has_deadline ?? false,
          discovery_score: candidate.discovery_score,
        };
      }
      const llm = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
      const copy = await synthesizeCopy(segment, segmentConfig, llm);
      const html = buildHtml(segment, copy);
      return json({ segment, copy, html });
    }

    if (path === '/deploy' && method === 'POST') {
      const body = await request.json() as {
        segment?: string;
        page_slug?: string;
        html?: string;
        copy?: { headline?: string; subheadline?: string; pain_points?: string[]; cta?: string };
      };
      const { segment, page_slug = 'index' } = body;
      if (!segment) return json({ error: 'segment required' }, 400);
      const copy = body.copy ?? null;
      const html = body.html ?? (copy ? buildHtml(segment, copy as Parameters<typeof buildHtml>[1]) : null);
      if (!html) return json({ error: 'html or copy required' }, 400);
      const now   = new Date().toISOString();
      const title = copy?.headline ?? segment;
      const d1repo = new D1Repo(env.DB);
      await d1repo.saveLanding(segment, page_slug, html, copy as Parameters<typeof d1repo.saveLanding>[3], title);
      const landingUrl = page_slug === 'index'
        ? `https://market-intel.pages.dev/landings/${segment}`
        : `https://market-intel.pages.dev/landings/${segment}/${page_slug}`;
      await d1repo.updateOpportunityLanding(segment, landingUrl, 'testing', now);
      return json({ url: landingUrl });
    }

    if (path === '/render' && method === 'POST') {
      const { segment, copy } = await request.json() as {
        segment?: string;
        copy?: Parameters<typeof buildHtml>[1];
      };
      if (!segment || !copy) return json({ error: 'segment and copy required' }, 400);
      return json({ html: buildHtml(segment, copy) });
    }

    const pagesMatch = path.match(/^\/pages\/([^/]+)$/);
    if (pagesMatch && method === 'GET') {
      const segment = decodeURIComponent(pagesMatch[1]);
      const d1repo = new D1Repo(env.DB);
      const pages = await d1repo.listLandingPages(segment);
      return json({ pages });
    }

    const pageDeleteMatch = path.match(/^\/pages\/([^/]+)\/([^/]+)$/);
    if (pageDeleteMatch && method === 'DELETE') {
      const segment  = decodeURIComponent(pageDeleteMatch[1]);
      const pageSlug = decodeURIComponent(pageDeleteMatch[2]);
      const d1repo = new D1Repo(env.DB);
      await d1repo.deleteLandingPage(segment, pageSlug);
      return json({ ok: true });
    }

    if (method === 'GET' && path === '/gap-radar') {
      const d1repo = new D1Repo(env.DB);
      const rows = await d1repo.getGapRadar(50);
      return json(rows.map(r => ({
        segment:        r.segment,
        label:          r.segment.replace(/_/g, ' '),
        avg_pain:       Math.round(r.avg_pain * 10) / 10,
        solution_ratio: Math.round(r.solution_ratio * 100),        // as %
        whitespace:     Math.round((1 - r.solution_ratio) * 100),  // as %
        gap_score:      Math.round(r.gap_score ?? 0),
        has_landing:    r.has_landing,
        opportunity_id: r.opportunity_id,
      })));
    }

    if (path === '/discovery/candidates' && method === 'POST') {
      const { run_id, candidates } = await request.json() as {
        run_id?: string;
        candidates?: Array<{
          profile?: string;
          pain?: string;
          keywords?: string[];
          post_count?: number;
          discovery_score?: number;
          income_est?: string | null;
          has_deadline?: boolean;
          source?: string;
        }>;
      };
      if (!run_id || !Array.isArray(candidates) || !candidates.length)
        return json({ error: 'run_id and non-empty candidates required' }, 400);
      const invalid = candidates.filter(c => !c.profile || !c.pain);
      if (invalid.length)
        return json({ error: `${invalid.length} candidate(s) missing required profile/pain fields` }, 400);
      const d1repo = new D1Repo(env.DB);
      await d1repo.replaceCandidatesWithRunId(run_id, candidates);
      return json({ saved: candidates.length });
    }

    if (path === '/collect/github-debug' && method === 'GET') {
      const keywords = [
        'verifactu', 'hacienda', 'facturación', 'rrsif', 'multa', 'gestión clínica',
        'aneca', 'acreditación', 'sexenio', 'docentia', 'plaza',
        'lexnet', 'irpf', 'turno oficio', 'honorarios',
        'visado colegial', 'licencia obras', 'burocracia', 'certificado energético',
      ];
      const signals = await collectGitHub(keywords, 'debug', env.GITHUB_TOKEN);
      const ss: number[] = signals.map(s => s.signal_strength ?? 0);
      const buckets: Record<string, number> = { '0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 };
      for (const v of ss) {
        if (v < 0.2) buckets['0-0.2']++;
        else if (v < 0.4) buckets['0.2-0.4']++;
        else if (v < 0.6) buckets['0.4-0.6']++;
        else if (v < 0.8) buckets['0.6-0.8']++;
        else buckets['0.8-1.0']++;
      }
      const avg = ss.length ? (ss.reduce((a, b) => a + b, 0) / ss.length) : 0;
      const top = signals.sort((a, b) => (b.signal_strength ?? 0) - (a.signal_strength ?? 0)).slice(0, 5).map(s => ({
        ss: s.signal_strength ?? 0, kw: s.pain_keywords, sent: s.sentiment_score,
        url: s.url, excerpt: s.raw_text.slice(0, 100),
      }));
      return json({ signal_count: signals.length, ss_mean: avg, ss_distribution: buckets, top });
    }

    if (path === '/debug/collect-all' && method === 'GET') {
      const testCfg: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      if (!testCfg.collectors.gnews.segments || !Object.keys(testCfg.collectors.gnews.segments).length) {
        testCfg.collectors.gnews.segments = {
          dentista: {
            label: 'Dentista',
            queries: ['verifactu dentista'],
            keywords: ['verifactu', 'hacienda', 'facturación', 'rrsif', 'multa'],
            salary_mean: 66500,
            income_tier: 'high',
            has_deadline: true,
          },
        };
      }
      const collectors = buildRegistry(testCfg, env);
      const results: Array<{ id: string; signals: number; error?: string }> = [];
      for (const c of collectors) {
        try {
          const signals = await c.collect();
          results.push({ id: c.id, signals: signals.length });
        } catch (e) {
          results.push({ id: c.id, signals: 0, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
        }
      }
      return json(results);
    }

    if (path === '/debug/friction' && method === 'GET') {
      const keywords = [
        'verifactu', 'hacienda', 'facturación', 'rrsif', 'multa', 'gestión clínica',
        'aneca', 'acreditación', 'sexenio', 'docentia', 'plaza',
        'lexnet', 'irpf', 'turno oficio', 'honorarios',
        'visado colegial', 'licencia obras', 'burocracia', 'certificado energético',
      ];
      const signals = await collectGitHub(keywords, 'debug', env.GITHUB_TOKEN);
      const before = signals.map(s => ({ url: s.url, ss: s.signal_strength ?? 0 }));

      const llm = new LLMChain(
        { provider: 'groq', model: 'llama-3.1-8b-instant', temperature: 0.1, max_tokens: 5000 },
        env.GROQ_API_KEY,
        env.OPENROUTER_API_KEY,
      );

      const captured: Array<{ id: string; strength: number; profile: FrictionProfile }> = [];
      const memRepo: ISignalRepo = {
        save: async () => true,
        get: async () => [],
        getAll: async () => [],
        count: async () => 0,
        updateFriction: async (id, strength, profile) => { captured.push({ id, strength, profile }); },
        getSignalsInRange: async () => [],
      };

      await analyzeFriction(signals, llm, memRepo);

      const signalMap = new Map(signals.map(s => [s.id, s]));
      const enriched = captured.map(c => {
        const s = signalMap.get(c.id);
        return {
          url: s?.url ?? c.id,
          before: s?.signal_strength ?? 0,
          after: c.strength,
          profile: c.profile,
        };
      });

      const afterAll = enriched.map(e => e.after);
      const afterBuckets: Record<string, number> = { '0-0.2': 0, '0.2-0.4': 0, '0.4-0.6': 0, '0.6-0.8': 0, '0.8-1.0': 0 };
      for (const v of afterAll) {
        if (v < 0.2) afterBuckets['0-0.2']++;
        else if (v < 0.4) afterBuckets['0.2-0.4']++;
        else if (v < 0.6) afterBuckets['0.4-0.6']++;
        else if (v < 0.8) afterBuckets['0.6-0.8']++;
        else afterBuckets['0.8-1.0']++;
      }
      const afterMean = afterAll.length ? (afterAll.reduce((a, b) => a + b, 0) / afterAll.length) : 0;
      return json({
        total_signals: signals.length,
        enriched_count: enriched.length,
        batch_count: Math.ceil(signals.length / 10),
        before_mean: before.length ? (before.reduce((a, b) => a + b.ss, 0) / before.length) : 0,
        after_mean: afterMean,
        after_distribution: afterBuckets,
        detail: enriched.sort((a, b) => b.after - a.after).slice(0, 10),
      });
    }

    if (path === '/discover' && method === 'POST') {
      if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY)
        return json({ error: 'LLM key not configured' }, 503);

      try {
        const cfg = await getConfig(env.DB);
        const discoverCfg = { ...(cfg.discover ?? { max_clusters: 10, min_signals: 3 }) };
        const llm = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
        const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);

        const texts = await collectDiscoveryTexts();
        const d1repo = new D1Repo(env.DB);
        const latestCandidates = await d1repo.getLatestCandidates();
        const knownSegments = latestCandidates?.candidates.map(c => c.segment) ?? [];

        const candidates = await runDiscovery(llm, notifier, discoverCfg, texts, knownSegments);

        if (!candidates.length) return json({ run_id: null, candidates: [], message: 'No new segments found' });

        const run_id = crypto.randomUUID();
        await d1repo.saveCandidates(candidates, run_id);
        return json({ run_id, candidates });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('discover failed:', msg);
        return json({ error: msg }, 500);
      }
    }

    if (path === '/score' && method === 'POST') {
      const body = await request.json().catch(() => ({})) as {
        top_n?: number;
        min_score?: number;
        dry_run?: boolean;
      };
      const cfg = await getConfig(env.DB);
      const d1repo = new D1Repo(env.DB);
      const llm = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
      const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);
      const results = await runScore(
        { signals: d1repo, opportunities: d1repo, discovery: d1repo },
        notifier,
        body.top_n ?? cfg.score.top_n,
        body.min_score ?? cfg.score.min_score,
        body.dry_run ?? cfg.score.dry_run,
      );
      return json({ results });
    }

    if (path === '/market-test' && method === 'POST') {
      const { description } = await request.json() as { description?: string };
      if (!description || typeof description !== 'string' || !description.trim())
        return json({ error: 'description required' }, 400);
      if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY)
        return json({ error: 'No LLM key configured (GROQ_API_KEY or OPENROUTER_API_KEY required)' }, 503);
      const id   = crypto.randomUUID().slice(0, 12);
      const now  = new Date().toISOString();
      const d1repo = new D1Repo(env.DB);
      await d1repo.createMarketTest(id, description.trim(), now);
      const cfg = await getConfig(env.DB);
      const llm = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
      ctx.waitUntil(runMarketTest(id, description.trim(), llm, d1repo));
      return json({ test_id: id });
    }

    if (path.startsWith('/market-test/') && method === 'GET') {
      const id = path.slice('/market-test/'.length);
      const d1repo = new D1Repo(env.DB);
      const test = await d1repo.getMarketTest(id);
      if (!test) return json({ error: 'not found' }, 404);
      return json(test);
    }

    return json({ error: 'not found' }, 404);

  } catch (err) {
    console.error(path, err);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
};

// ---------------------------------------------------------------------------
// Cron handler
// ---------------------------------------------------------------------------

const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, ctx) => {
  ctx.waitUntil((async () => {
    const cfg = await getConfig(env.DB);
    const d1repo = new D1Repo(env.DB);
    const llm = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
    const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);

    // Collect
    const collectors = buildRegistry(cfg, env);
    const { signals: fresh, stats } = await runCollect(d1repo, collectors);
    const runAt = new Date().toISOString();
    for (const stat of stats) {
      try { await d1repo.upsertHealth(stat, runAt); } catch { /* non-fatal */ }
    }
    await analyzeFriction(fresh, llm, d1repo);

    // Score
    await runScore(
      { signals: d1repo, opportunities: d1repo, discovery: d1repo },
      notifier,
      cfg.score.top_n,
      cfg.score.min_score,
      cfg.score.dry_run,
    );

    // Gap snapshot + scoring (runs after runScore so gap_score is fresh)
    await runSnapshot(d1repo, d1repo);
    await runGapScore(d1repo, d1repo);
    console.log('[cron] gap snapshot + scoring done');
  })());
};

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default { fetch: handleFetch, scheduled } satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// Route handler helpers
// ---------------------------------------------------------------------------

async function handleGetSignals(db: D1Database, params: URLSearchParams): Promise<Response> {
  const segment = params.get('segment');
  const limit   = Math.min(parseInt(params.get('limit') ?? '100') || 100, 500);
  const { results } = segment
    ? await db.prepare('SELECT * FROM signals WHERE segment = ? ORDER BY collected_at DESC LIMIT ?').bind(segment, limit).all()
    : await db.prepare('SELECT * FROM signals ORDER BY collected_at DESC LIMIT ?').bind(limit).all();
  return json({ results });
}

async function handleInsertSignal(db: D1Database, signal: Record<string, unknown>): Promise<Response> {
  const existing = await db.prepare(
    'SELECT 1 FROM signals WHERE url = ? AND segment = ? LIMIT 1'
  ).bind(signal['url'], signal['segment']).first();
  if (existing) return json({ inserted: false, reason: 'duplicate' });

  await db.prepare(`
    INSERT INTO signals
    (id, source, collected_at, segment, location, raw_text, url,
     pain_keywords, sentiment_score, salary_mean, income_tier,
     signal_strength, has_deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    signal['id'], signal['source'], signal['collected_at'], signal['segment'],
    signal['location'] ?? null,
    (typeof signal['raw_text'] === 'string' ? signal['raw_text'] : '').slice(0, 2000),
    signal['url'],
    JSON.stringify(Array.isArray(signal['pain_keywords']) ? signal['pain_keywords'] : []),
    signal['sentiment_score'] ?? null, signal['salary_mean'] ?? null,
    signal['income_tier'] ?? null, signal['signal_strength'] ?? null,
    signal['has_deadline'] ? 1 : 0,
  ).run();
  return json({ inserted: true });
}

async function handleCountSignals(db: D1Database, params: URLSearchParams): Promise<Response> {
  const segment = params.get('segment');
  const row = segment
    ? await db.prepare('SELECT COUNT(*) as n FROM signals WHERE segment = ?').bind(segment).first<Record<string, unknown>>()
    : await db.prepare('SELECT COUNT(*) as n FROM signals').first<Record<string, unknown>>();
  return json({ count: row?.['n'] ?? 0 });
}

async function handleGetOpportunities(db: D1Database, params: URLSearchParams): Promise<Response> {
  const status = params.get('status');
  const { results } = status
    ? await db.prepare('SELECT * FROM opportunities WHERE status = ? ORDER BY score DESC').bind(status).all()
    : await db.prepare('SELECT * FROM opportunities ORDER BY score DESC').all();
  return json({ results });
}

async function handleUpsertOpportunity(db: D1Database, o: Record<string, unknown>): Promise<Response> {
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
  return json({ upserted: true });
}

async function handleGetStats(d1repo: D1Repo): Promise<Response> {
  const [stats, bySegRows, topRow] = await Promise.all([
    d1repo.getStats(),
    d1repo.getStatsBySegment(),
    d1repo.getTopOpportunity(),
  ]);
  const by_segment: Record<string, number> = {};
  for (const r of bySegRows) by_segment[r.segment] = r.count;
  return json({
    total_signals:       stats.signals,
    total_opportunities: stats.opportunities,
    by_segment,
    top_opportunity: topRow ?? null,
    backend: 'worker+d1',
  });
}

async function handleGetDiscovery(d1repo: D1Repo): Promise<Response> {
  const latest = await d1repo.getLatestCandidates();
  if (!latest) return json({ run_id: null, candidates: [], discovered_at: null });
  const candidates = latest.candidates.map(c => ({
    profile:         c.segment,
    pain:            c.pain_summary,
    keywords:        c.raw_signals,
    post_count:      c.post_count ?? 0,
    discovery_score: c.discovery_score,
    income_est:      c.income_est ?? null,
    has_deadline:    c.has_deadline ?? false,
  }));
  return json({ run_id: null, candidates, discovered_at: latest.discovered_at });
}

async function handleGetLeads(d1repo: D1Repo, params: URLSearchParams): Promise<Response> {
  const segment = params.get('segment') ?? undefined;
  const [leads, opportunities] = await Promise.all([
    d1repo.getLeads(segment),
    d1repo.getAll(),
  ]);
  const oppScores = new Map<string, number>(
    opportunities.map(o => [o.segment, o.score]),
  );
  const bySegment: Record<string, Array<{
    email: string;
    captured_at: string;
    price_tier: string | null;
    lead_score: number;
  }>> = {};
  for (const r of leads) {
    if (!bySegment[r.segment]) bySegment[r.segment] = [];
    bySegment[r.segment].push({
      email:       r.email,
      captured_at: r.created_at,
      price_tier:  r.price_tier,
      lead_score:  computeLeadScore(r.price_tier, r.created_at, oppScores.get(r.segment) ?? null),
    });
  }
  for (const seg of Object.keys(bySegment)) {
    bySegment[seg].sort((a, b) => b.lead_score - a.lead_score);
  }
  return json({ total: leads.length, by_segment: bySegment });
}

async function handleGetConfig(db: D1Database): Promise<Response> {
  const cfg = await getConfig(db);
  return json({ config: cfg });
}

// ---------------------------------------------------------------------------
// Discovery text fetching (HN Algolia + Google News RSS)
// ---------------------------------------------------------------------------

async function collectDiscoveryTexts(limit = 60): Promise<string[]> {
  const texts: string[] = [];

  const hnQueries = [
    'freelancer pain problem',
    'professional software problem',
    'pequeña empresa problema gestión',
    'autónomo problema hacienda',
  ];

  const newsQueries = [
    'autónomos problema España',
    'profesionales freelance queja',
    'pyme gestión problema',
  ];

  for (const query of hnQueries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story,ask_hn&hitsPerPage=12`;
      const res = await fetch(url, { headers: { 'User-Agent': 'market-intel/0.1' } });
      if (!res.ok) continue;
      const data = await res.json() as { hits?: Array<{ title?: string; story_text?: string }> };
      for (const hit of data.hits ?? []) {
        const title = (hit.title ?? '').trim();
        const body  = (hit.story_text ?? '').slice(0, 200).trim();
        if (title) texts.push(body ? `${title} — ${body}` : title);
      }
    } catch (e) {
      console.error(`HN broad '${query}':`, e instanceof Error ? e.message : String(e));
    }
  }

  for (const query of newsQueries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`;
      const res = await fetch(url, { headers: { 'User-Agent': 'market-intel/0.1' } });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = [...text.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)];
      for (const m of matches.slice(1, 11)) {
        const title = ((m[1] ?? m[2] ?? '') as string).trim();
        if (title) texts.push(title);
      }
    } catch (e) {
      console.error(`News RSS '${query}':`, e instanceof Error ? e.message : String(e));
    }
  }

  return texts.slice(0, limit);
}
