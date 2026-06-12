/**
 * routes/cron.ts
 *
 * Route handlers for pipeline trigger, health, and cron run statuses.
 */

import { D1Repo } from '../infrastructure/db/d1-repo.js';
import { runCronJob } from '../application/cron.js';
import { json, authCors, PUBLIC_CORS } from '../index.js';
import type { Env } from '../index.js';

export async function handleRunCron(env: Env, ctx: ExecutionContext): Promise<Response> {
  const runId = crypto.randomUUID();
  const d1repo = new D1Repo(env.DB);
  const startedAt = new Date().toISOString();
  await d1repo.insertCronRun({
    id: runId,
    started_at: startedAt,
    finished_at: null,
    trigger: 'manual',
    fresh_signals: null,
    analyzed_signals: null,
    opps_updated: null,
    error: null
  });
  ctx.waitUntil(runCronJob(env, 'manual', runId));
  return json({ ok: true, run_id: runId, started_at: startedAt }, 200, authCors(env));
}

export async function handleGetHealth(env: Env): Promise<Response> {
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
  return json({ runs, collectors, bySource }, 200, cors);
}

export async function handleGetPipelineStatusById(db: D1Database, runId: string, cors = PUBLIC_CORS): Promise<Response> {
  const repo = new D1Repo(db);
  const runs = await repo.getRecentCronRuns(20).catch(() => [] as import('../domain/types.js').CronRun[]);
  const run = runs.find(r => r.id === runId) ?? null;
  return json({ run }, 200, cors);
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
    top_opportunity: topRow ?? null,
    backend: 'worker+d1',
  });
}

export async function handleGetStatsVelocity(db: D1Database, params: URLSearchParams, cors = PUBLIC_CORS): Promise<Response> {
  const weeks = Math.min(parseInt(params.get('weeks') ?? '12') || 12, 52);
  const rows = await new D1Repo(db).getSignalVelocity(weeks);
  return json({ weeks, rows }, 200, cors);
}
