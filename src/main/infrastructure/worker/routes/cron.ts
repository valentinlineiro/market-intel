/**
 * routes/cron.ts
 *
 * Route handlers for pipeline trigger, health, and cron run statuses.
 * This is the composition root for the cron pipeline — infrastructure is
 * wired here and injected into application services.
 */

import { D1Repo } from '../infrastructure/db/d1-repo.js';
import { EmailNotifier } from '../infrastructure/notify.js';
import { buildRegistry } from '../infrastructure/collectors/registry.js';
import { getConfig } from '../infrastructure/config.js';
import { runCronJob } from '../application/cron.js';
import type { ICronRepos } from '../application/ports.js';
import type { CronStep } from '../domain/types.js';
import { json, makeLlm, hasLlmKey, authCors, PUBLIC_CORS } from '../index.js';
import type { Env } from '../index.js';

// ---------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------

async function buildCronDeps(env: Env, cfg: Awaited<ReturnType<typeof getConfig>>) {
  const d1repo = new D1Repo(env.DB);
  const repos: ICronRepos = {
    signals:         d1repo,
    opportunities:   d1repo,
    discovery:       d1repo,
    collectorHealth: d1repo,
    cronLog:         d1repo,
    snapshots:       d1repo,
  };
  const llm       = hasLlmKey(env) ? makeLlm(cfg.llm, env) : undefined;
  const notifier  = new EmailNotifier(env.EMAIL, cfg.notifications);

  const prevDiscovery = await d1repo.getLatestCandidates();
  const discoveredSegments = (prevDiscovery?.candidates ?? []).map(c => ({
    key:      c.segment,
    keywords: c.raw_signals ?? [],
  }));
  const collectors = buildRegistry(cfg, env, discoveredSegments);

  return { repos, llm, notifier, collectors, d1repo };
}

/**
 * Entry point for both manual (HTTP) and scheduled cron runs.
 * Handles all infrastructure setup, then delegates to the application layer.
 */
export async function triggerCronJob(
  env: Env,
  trigger: 'manual' | 'scheduled',
  existingRunId?: string,
): Promise<void> {
  const cfg = await getConfig(env.DB);
  const { repos, llm, notifier, collectors } = await buildCronDeps(env, cfg);
  await runCronJob(repos, llm, notifier, collectors, cfg, trigger, existingRunId);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function handleRunCron(env: Env, ctx: ExecutionContext): Promise<Response> {
  const runId     = crypto.randomUUID();
  const d1repo    = new D1Repo(env.DB);
  const startedAt = new Date().toISOString();
  await d1repo.insertCronRun({
    id: runId,
    started_at:       startedAt,
    finished_at:      null,
    trigger:          'manual',
    fresh_signals:    null,
    analyzed_signals: null,
    opps_updated:     null,
    error:            null,
  });
  ctx.waitUntil(triggerCronJob(env, 'manual', runId));
  return json({ ok: true, run_id: runId, started_at: startedAt }, 200, authCors(env));
}

export async function handleGetHealth(env: Env): Promise<Response> {
  const healthRepo = new D1Repo(env.DB);
  let last_runs: Record<string, { last_run_at: string; signal_count: number; error: string | null }> = {};
  try {
    const rows = await healthRepo.getCollectorHealth();
    for (const row of rows) {
      last_runs[row.collector_id] = {
        last_run_at:  row.last_run_at,
        signal_count: row.signal_count,
        error:        row.error,
      };
    }
  } catch (e) {
    console.error('[health] failed to load collector health:', e instanceof Error ? e.message : e);
  }
  return json({ status: 'ok', ts: new Date().toISOString(), last_runs }, 200, authCors(env));
}

export async function handleGetPipelineStatus(db: D1Database, cors = PUBLIC_CORS): Promise<Response> {
  const repo = new D1Repo(db);
  const [runs, collectors, bySource] = await Promise.all([
    repo.getRecentCronRuns(5).catch(() => [] as import('../domain/types.js').CronRun[]),
    repo.getCollectorHealth().catch(() => [] as Array<{ collector_id: string; last_run_at: string; signal_count: number; error: string | null }>),
    repo.getSignalsBySource().catch(() => [] as Array<{ source: string; total: number; avg_strength: number; analyzed: number }>),
  ]);
  const stepsPerRun = await Promise.all(
    runs.map(r => repo.getCronSteps(r.id).catch(() => [] as CronStep[])),
  );
  const stepsByRun: Record<string, CronStep[]> = Object.fromEntries(
    runs.map((r, i) => [r.id, stepsPerRun[i]]),
  );
  return json({ runs, collectors, bySource, stepsByRun }, 200, cors);
}

export async function handleGetPipelineStatusById(db: D1Database, runId: string, cors = PUBLIC_CORS): Promise<Response> {
  const repo  = new D1Repo(db);
  const runs  = await repo.getRecentCronRuns(20).catch(() => [] as import('../domain/types.js').CronRun[]);
  const run   = runs.find(r => r.id === runId) ?? null;
  const steps = run ? await repo.getCronSteps(runId).catch(() => [] as CronStep[]) : [];
  return json({ run, steps }, 200, cors);
}

export async function handleGetStats(d1repo: D1Repo): Promise<Response> {
  const [stats, bySegRows, topRow] = await Promise.all([
    d1repo.getStats(),
    d1repo.getStatsBySegment(),
    d1repo.getTopOpportunity(),
  ]);
  const by_segment: Record<string, number> = {};
  for (const r of bySegRows) {
    by_segment[r.segment] = r.count;
  }
  return json({
    total_signals:       stats.signals,
    total_opportunities: stats.opportunities,
    analyzed_count:      stats.analyzed_count,
    by_segment,
    top_opportunity:     topRow ?? null,
    backend:             'worker+d1',
  });
}

export async function handleGetStatsVelocity(db: D1Database, params: URLSearchParams, cors = PUBLIC_CORS): Promise<Response> {
  const weeks = Math.min(parseInt(params.get('weeks') ?? '12') || 12, 52);
  const rows  = await new D1Repo(db).getSignalVelocity(weeks);
  return json({ weeks, rows }, 200, cors);
}
