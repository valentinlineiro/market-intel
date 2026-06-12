/**
 * application/cron.ts
 *
 * Core synchronization pipelines: daily cron job and focused segment sync.
 */

import { getConfig } from '../infrastructure/config.js';
import { D1Repo } from '../infrastructure/db/d1-repo.js';
import { LLMChain } from '../infrastructure/llm/chain.js';
import { EmailNotifier } from '../infrastructure/notify.js';
import { buildRegistry } from '../infrastructure/collectors/registry.js';
import { runCollect } from './collect.js';
import { runScore } from './score.js';
import { runDiscovery } from './discover.js';
import { analyzeFriction } from './friction.js';
import { runSnapshot, runGapScore } from './gap.js';
import { collectGnews } from '../infrastructure/collectors/gnews.js';
import { runMarketTest } from './market-test.js';
import type { Config, CronRun } from '../domain/types.js';
import type { Env } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasLlmKey(env: Env): boolean {
  return !!(env.GROQ_API_KEY || env.OPENROUTER_API_KEY || env.NIM_API_KEY || env.MISTRAL_API_KEY);
}

function makeLlm(llmCfg: Config['llm'], env: Env): LLMChain {
  return new LLMChain(llmCfg, env.GROQ_API_KEY, env.OPENROUTER_API_KEY, env.NIM_API_KEY, env.MISTRAL_API_KEY);
}

// ---------------------------------------------------------------------------
// Cron job execution pipeline
// ---------------------------------------------------------------------------

export async function runCronJob(env: Env, trigger: CronRun['trigger'] = 'scheduled', existingRunId?: string): Promise<void> {
  const cfg = await getConfig(env.DB);
  const d1repo = new D1Repo(env.DB);
  const llm = makeLlm(cfg.llm, env);
  const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);

  const runId = existingRunId ?? crypto.randomUUID();
  if (!existingRunId) {
    await d1repo.insertCronRun({ id: runId, started_at: new Date().toISOString(), finished_at: null, trigger, fresh_signals: null, analyzed_signals: null, opps_updated: null, error: null });
  }

  let freshCount   = 0;
  let analyzedCount = 0;
  let oppsUpdated  = 0;
  let cronError: string | undefined;

  try {
    // Load previous discovery candidates to expand collection to discovered segments
    const prevDiscovery = await d1repo.getLatestCandidates();
    const discoveredSegments = (prevDiscovery?.candidates ?? []).map(c => ({
      key:      c.segment,
      keywords: c.raw_signals ?? [],
    }));

    // Collect (hardcoded segments + previously discovered ones)
    const collectors = buildRegistry(cfg, env, discoveredSegments);
    const { signals: fresh, stats } = await runCollect(d1repo, collectors);
    freshCount = fresh.length;
    const runAt = new Date().toISOString();
    for (const stat of stats) {
      try { await d1repo.upsertHealth(stat, runAt); } catch (e) { console.error(`[cron] upsertHealth failed for ${stat.id}:`, e instanceof Error ? e.message : e); }
    }

    try {
      const toAnalyze = await d1repo.getUnanalyzed();
      await analyzeFriction(toAnalyze, llm, d1repo, 0.85, cfg.friction?.min_strength ?? 0);
      analyzedCount = toAnalyze.length;
    } catch (e) {
      console.error('[cron] friction analysis failed (non-fatal):', e instanceof Error ? e.message : e);
    }

    // Auto-discover new segments from freshly analyzed signals
    try {
      const discoverTexts = fresh.map(s => s.raw_text).filter(Boolean).slice(0, 80) as string[];
      if (discoverTexts.length >= 5) {
        const hardcodedKeys = Object.keys(cfg.segments);
        const knownSegments = [...hardcodedKeys, ...discoveredSegments.map(s => s.key)];
        const newCandidates = await runDiscovery(llm, notifier, cfg.discover, discoverTexts, knownSegments);
        if (newCandidates.length) {
          const run_id = crypto.randomUUID();
          await d1repo.saveCandidates(newCandidates, run_id);
          console.log(`[cron] discovery done — ${newCandidates.length} candidates`);
        }
      }
    } catch (e) {
      console.error('[cron] discovery failed (non-fatal):', e instanceof Error ? e.message : e);
    }

    // If discovery produced nothing, seed candidates from hardcoded config segments
    // so runScore always has at least the baseline segments to work with
    if (!(await d1repo.hasCandidates())) {
      const now = new Date().toISOString();
      const run_id = crypto.randomUUID();
      const seeds: import('../domain/types.js').DiscoveryCandidate[] = Object.entries(cfg.segments).map(([key, sc]) => ({
        segment:         key,
        label:           sc.label,
        pain_summary:    '',
        discovery_score: 5,
        source_urls:     [],
        raw_signals:     sc.keywords,
        discovered_at:   now,
        post_count:      0,
        income_est:      sc.income_tier,
        has_deadline:    sc.has_deadline,
      }));
      await d1repo.saveCandidates(seeds, run_id);
    }

    // Score
    const scoreResults = await runScore(
      { signals: d1repo, opportunities: d1repo, discovery: d1repo },
      notifier,
      cfg.score.top_n,
      cfg.score.min_score,
      cfg.score.dry_run,
      hasLlmKey(env) ? llm : undefined,
    );
    oppsUpdated = scoreResults.length;

    // Gap snapshot + scoring (runs after runScore so gap_score is fresh)
    await runSnapshot(d1repo, d1repo);
    await runGapScore(d1repo, d1repo);
    console.log('[cron] gap snapshot + scoring done');
  } catch (e) {
    cronError = e instanceof Error ? e.message : String(e);
    console.error('[cron] fatal error:', cronError);
  }

  await d1repo.finishCronRun(runId, { fresh_signals: freshCount, analyzed_signals: analyzedCount, opps_updated: oppsUpdated, error: cronError });
}

// ---------------------------------------------------------------------------
// Focused sync (single segment, triggered by /discovery/promote)
// ---------------------------------------------------------------------------

export async function runFocusedSync(env: Env, segmentKey: string, runId: string): Promise<void> {
  const cfg = await getConfig(env.DB);
  const seg = cfg.segments[segmentKey];
  if (!seg) return; // segment removed between promote and sync start

  const d1repo = new D1Repo(env.DB);
  const llm = makeLlm(cfg.llm, env);
  const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);

  let freshCount = 0;
  let analyzedCount = 0;
  let oppsUpdated = 0;
  let cronError: string | undefined;

  try {
    const focusedCfg: Config = { ...cfg, segments: { [segmentKey]: seg } };
    const collectors = buildRegistry(focusedCfg, env, []);
    const { signals: fresh } = await runCollect(d1repo, collectors);
    freshCount = fresh.length;

    if (fresh.length) {
      try {
        await analyzeFriction(fresh, llm, d1repo, 0.85, cfg.friction?.min_strength ?? 0);
        analyzedCount = fresh.length;
      } catch (e) {
        console.error('[focused-sync] friction failed (non-fatal):', e instanceof Error ? e.message : e);
      }
    }

    const scoreResults = await runScore(
      {
        signals: d1repo,
        opportunities: d1repo,
        discovery: {
          saveCandidates: (candidates) => d1repo.saveCandidates(candidates),
          getLatestCandidates: () => d1repo.getLatestCandidates(),
          getSegmentsToScore: async () => [{
            key:             segmentKey,
            label:           seg.label,
            keywords:        seg.keywords,
            income_tier:     seg.income_tier,
            has_deadline:    seg.has_deadline,
            discovery_score: 5,
          }],
        },
      },
      notifier,
      1,
      0,
      false,
      hasLlmKey(env) ? llm : undefined,
    );
    oppsUpdated = scoreResults.length;
  } catch (e) {
    cronError = e instanceof Error ? e.message : String(e);
    console.error('[focused-sync] error:', cronError);
  }

  await d1repo.finishCronRun(runId, {
    fresh_signals: freshCount,
    analyzed_signals: analyzedCount,
    opps_updated: oppsUpdated,
    error: cronError,
  });
}
