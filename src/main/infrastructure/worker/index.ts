/**
 * infrastructure/worker/index.ts
 *
 * Composition root, HTTP router, and cron handler for the Worker.
 */

import { D1Repo } from './infrastructure/db/d1-repo.js';
import { LLMChain } from './infrastructure/llm/chain.js';
import type { Config } from './domain/types.js';
import { triggerCronJob } from './routes/cron.js';

// Route Handlers
import {
  handleGetSignals,
  handleInsertSignal,
  handleCountSignals,
  handleCollectGithubDebug,
  handleDebugCollectAll,
  handleDebugFriction,
} from './routes/signals.js';

import {
  handleGetOpportunities,
  handleUpsertOpportunity,
  handleUpdateOpportunityStatus,
  handleScore,
  handleCreateMarketTest,
  handleGetMarketTest,
} from './routes/opportunities.js';

import {
  handleGetDiscovery,
  handleGetLeads,
  handleGetPainProfiles,
  handleGetLandingHtml,
  handlePublicSignup,
  handlePublicSignupPrice,
  handleSynthesize,
  handleDeploy,
  handleRender,
  handleListLandingPages,
  handleDeleteLandingPage,
  handleGetGapRadar,
  handleSaveDiscoveryCandidates,
  handleDiscoveryPromote,
  handleDiscover,
} from './routes/discovery.js';

import {
  handleGetConfig,
  handleSetConfig,
  handleGenerateSeed,
} from './routes/config.js';

import {
  handleRunCron,
  handleGetHealth,
  handleGetPipelineStatus,
  handleGetPipelineStatusById,
  handleGetStats,
  handleGetStatsVelocity,
} from './routes/cron.js';

// ---------------------------------------------------------------------------
// Env interface
// ---------------------------------------------------------------------------

export interface Env {
  DB: D1Database;
  WORKER_SECRET: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  NIM_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  GITHUB_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
  PRODUCTHUNT_API_KEY?: string;
  EMAIL?: any;
  /** Allowed browser origin for authenticated routes. Defaults to Pages production URL. */
  PAGES_ORIGIN?: string;
  /** Set to "true" to enable /debug/* and /generate-seed routes. Off by default in production. */
  DEBUG_ROUTES?: string;
}

// ---------------------------------------------------------------------------
// CORS headers & Helpers
// ---------------------------------------------------------------------------

export const PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function authCors(env: Env): Record<string, string> {
  const origin = env.PAGES_ORIGIN ?? 'https://market-intel.pages.dev';
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function json(body: unknown, status = 200, cors: Record<string, string> = PUBLIC_CORS): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export function hasLlmKey(env: Env): boolean {
  return !!(env.GROQ_API_KEY || env.OPENROUTER_API_KEY || env.NIM_API_KEY || env.MISTRAL_API_KEY);
}

export function makeLlm(llmCfg: Config['llm'], env: Env): LLMChain {
  return new LLMChain(llmCfg, env.GROQ_API_KEY, env.OPENROUTER_API_KEY, env.NIM_API_KEY, env.MISTRAL_API_KEY);
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------

const handleFetch: ExportedHandler<Env>['fetch'] = async (request, env, ctx) => {
  if (request.method === 'OPTIONS') {
    const p = new URL(request.url).pathname;
    const prefCors = p.startsWith('/public/') ? PUBLIC_CORS : authCors(env);
    return new Response(null, { status: 204, headers: prefCors });
  }

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
    path === '/public/pain-profiles' ||
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
      if (path === '/public/pain-profiles') return await handleGetPainProfiles(d1repo);

      if (path.startsWith('/public/landings/')) {
        return await handleGetLandingHtml(d1repo, path);
      }

      if (path === '/public/signup' && method === 'POST') {
        const body = await request.json() as { email?: string; segment?: string };
        return await handlePublicSignup(d1repo, body);
      }

      if (path === '/public/signup/price' && method === 'POST') {
        const body = await request.json() as { email?: string; segment?: string; price_tier?: string };
        return await handlePublicSignupPrice(d1repo, body);
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

  const cors = authCors(env);
  const ajson = (body: unknown, status = 200) => json(body, status, cors);

  try {
    if (path === '/run-cron' && method === 'POST') {
      return await handleRunCron(env, ctx);
    }

    if (path === '/health' && method === 'GET') {
      return await handleGetHealth(env);
    }

    if (path === '/pipeline-status' && method === 'GET') {
      return await handleGetPipelineStatus(env.DB, cors);
    }

    if (path.startsWith('/pipeline-status/') && method === 'GET') {
      const runId = decodeURIComponent(path.slice('/pipeline-status/'.length));
      return await handleGetPipelineStatusById(env.DB, runId, cors);
    }

    if (path === '/signals' && method === 'GET')
      return await handleGetSignals(env.DB, url.searchParams, cors);

    if (path === '/signals' && method === 'POST')
      return await handleInsertSignal(env.DB, await request.json() as Record<string, unknown>, cors);

    if (path === '/signals/count' && method === 'GET')
      return await handleCountSignals(env.DB, url.searchParams, cors);

    if (path === '/opportunities' && method === 'GET')
      return await handleGetOpportunities(env.DB, url.searchParams);

    if (path === '/opportunities' && method === 'POST')
      return await handleUpsertOpportunity(env.DB, await request.json() as Record<string, unknown>, cors);

    const statusMatch = path.match(/^\/opportunities\/([^/]+)\/status$/);
    if (statusMatch && method === 'PATCH') {
      const segment = decodeURIComponent(statusMatch[1]);
      const body = await request.json() as { status?: string };
      return await handleUpdateOpportunityStatus(env.DB, segment, body.status ?? '', cors);
    }

    if (path === '/stats' && method === 'GET')
      return await handleGetStats(new D1Repo(env.DB));

    if (path === '/stats/velocity' && method === 'GET') {
      return await handleGetStatsVelocity(env.DB, url.searchParams, cors);
    }

    if (path === '/config' && method === 'GET')
      return await handleGetConfig(env.DB);

    if (path === '/config' && method === 'PUT') {
      return await handleSetConfig(env.DB, await request.json(), cors);
    }

    if (path === '/synthesize' && method === 'POST') {
      const body = await request.json() as { segment?: string };
      return await handleSynthesize(env, body);
    }

    if (path === '/deploy' && method === 'POST') {
      const body = await request.json() as any;
      return await handleDeploy(env, body);
    }

    if (path === '/render' && method === 'POST') {
      const body = await request.json() as any;
      return await handleRender(body, cors);
    }

    const pagesMatch = path.match(/^\/pages\/([^/]+)$/);
    if (pagesMatch && method === 'GET') {
      const segment = decodeURIComponent(pagesMatch[1]);
      return await handleListLandingPages(env.DB, segment, cors);
    }

    const pageDeleteMatch = path.match(/^\/pages\/([^/]+)\/([^/]+)$/);
    if (pageDeleteMatch && method === 'DELETE') {
      const segment  = decodeURIComponent(pageDeleteMatch[1]);
      const pageSlug = decodeURIComponent(pageDeleteMatch[2]);
      return await handleDeleteLandingPage(env.DB, segment, pageSlug, cors);
    }

    if (method === 'GET' && path === '/gap-radar') {
      return await handleGetGapRadar(env.DB, cors);
    }

    if (path === '/discovery/candidates' && method === 'POST') {
      const body = await request.json() as any;
      return await handleSaveDiscoveryCandidates(env.DB, body, cors);
    }

    if (path === '/collect/github-debug' && method === 'GET') {
      return await handleCollectGithubDebug(env);
    }

    if (env.DEBUG_ROUTES !== 'true' && (path.startsWith('/debug/') || path === '/generate-seed'))
      return ajson({ error: 'not found' }, 404);

    if (path === '/debug/collect-all' && method === 'GET') {
      return await handleDebugCollectAll(env);
    }

    if (path === '/debug/friction' && method === 'GET') {
      return await handleDebugFriction(env);
    }

    if (path === '/discover' && method === 'POST') {
      return await handleDiscover(env);
    }

    if (path === '/score' && method === 'POST') {
      const body = await request.json().catch(() => ({})) as any;
      return await handleScore(env, body);
    }

    if (path === '/market-test' && method === 'POST') {
      const body = await request.json() as any;
      return await handleCreateMarketTest(env, ctx, body);
    }

    if (path.startsWith('/market-test/') && method === 'GET') {
      const id = path.slice('/market-test/'.length);
      return await handleGetMarketTest(env.DB, id, cors);
    }

    if (path === '/generate-seed' && method === 'POST') {
      const body = await request.json() as any;
      return await handleGenerateSeed(env, body);
    }

    if (path === '/discovery/promote' && method === 'POST') {
      const body = await request.json() as any;
      return await handleDiscoveryPromote(env, ctx, body);
    }

    return ajson({ error: 'not found' }, 404);

  } catch (err) {
    console.error(path, err);
    const msg = err instanceof Error ? err.message : String(err);
    return ajson({ error: msg }, 500);
  }
};

const scheduled: ExportedHandlerScheduledHandler<Env> = (_event, env, ctx) => {
  ctx.waitUntil(triggerCronJob(env, 'scheduled'));
};

export default { fetch: handleFetch, scheduled } satisfies ExportedHandler<Env>;
