/**
 * application/cron.ts
 *
 * Core synchronization pipelines: daily cron job and focused segment sync.
 * All infrastructure dependencies are injected — no direct imports from infrastructure/.
 */

import type { ICronRepos, ILLMProvider, INotifier, Collector } from './ports.js';
import type { Config, CronRun } from '../domain/types.js';
import { runCollect } from './collect.js';
import { runScore } from './score.js';
import { runDiscovery } from './discover.js';
import { analyzeFriction } from './friction.js';
import { runSnapshot, runGapScore } from './gap.js';
import { seedCandidatesFromConfig } from '../domain/candidates.js';

// ---------------------------------------------------------------------------
// Cron job execution pipeline
// ---------------------------------------------------------------------------

export async function runCronJob(
  repos: ICronRepos,
  llm: ILLMProvider | undefined,
  notifier: INotifier,
  collectors: Collector[],
  cfg: Config,
  trigger: CronRun['trigger'],
  existingRunId?: string,
): Promise<void> {
  const runId = existingRunId ?? crypto.randomUUID();
  if (!existingRunId) {
    await repos.cronLog.insertCronRun({
      id: runId,
      started_at: new Date().toISOString(),
      finished_at: null,
      trigger,
      fresh_signals: null,
      analyzed_signals: null,
      opps_updated: null,
      error: null,
    });
  }

  let freshCount    = 0;
  let analyzedCount = 0;
  let oppsUpdated   = 0;
  let cronError: string | undefined;

  try {
    const { signals: fresh, stats } = await runCollect(repos.signals, collectors);
    freshCount = fresh.length;

    const runAt = new Date().toISOString();
    await Promise.all(
      stats.map(stat =>
        repos.collectorHealth.upsertHealth(stat, runAt).catch(e =>
          console.error(`[cron] upsertHealth failed for ${stat.id}:`, e instanceof Error ? e.message : e),
        ),
      ),
    );

    try {
      const toAnalyze = await repos.signals.getUnanalyzed();
      await analyzeFriction(toAnalyze, llm!, repos.signals, 0.85, cfg.friction?.min_strength ?? 0);
      analyzedCount = toAnalyze.length;
    } catch (e) {
      console.error('[cron] friction analysis failed (non-fatal):', e instanceof Error ? e.message : e);
    }

    try {
      const discoverTexts = fresh.map(s => s.raw_text).filter(Boolean).slice(0, 80) as string[];
      if (discoverTexts.length >= 5) {
        const prevDiscovery = await repos.discovery.getLatestCandidates();
        const knownSegments = [
          ...Object.keys(cfg.segments),
          ...(prevDiscovery?.candidates ?? []).map(c => c.segment),
        ];
        const newCandidates = await runDiscovery(llm!, notifier, cfg.discover, discoverTexts, knownSegments);
        if (newCandidates.length) {
          await repos.discovery.saveCandidates(newCandidates, crypto.randomUUID());
          console.log(`[cron] discovery done — ${newCandidates.length} candidates`);
        }
      }
    } catch (e) {
      console.error('[cron] discovery failed (non-fatal):', e instanceof Error ? e.message : e);
    }

    if (!(await repos.discovery.hasCandidates())) {
      await repos.discovery.saveCandidates(
        seedCandidatesFromConfig(cfg.segments, new Date().toISOString()),
        crypto.randomUUID(),
      );
    }

    const scoreResults = await runScore(
      { signals: repos.signals, opportunities: repos.opportunities, discovery: repos.discovery },
      notifier,
      cfg.score.top_n,
      cfg.score.min_score,
      cfg.score.dry_run,
      llm,
    );
    oppsUpdated = scoreResults.length;

    await runSnapshot(repos.signals, repos.snapshots);
    await runGapScore(repos.snapshots, repos.opportunities);
    console.log('[cron] gap snapshot + scoring done');
  } catch (e) {
    cronError = e instanceof Error ? e.message : String(e);
    console.error('[cron] fatal error:', cronError);
  }

  await repos.cronLog.finishCronRun(runId, {
    fresh_signals:    freshCount,
    analyzed_signals: analyzedCount,
    opps_updated:     oppsUpdated,
    error:            cronError,
  });
}

// ---------------------------------------------------------------------------
// Focused sync (single segment, triggered by /discovery/promote)
// ---------------------------------------------------------------------------

export async function runFocusedSync(
  repos: ICronRepos,
  llm: ILLMProvider | undefined,
  notifier: INotifier,
  collectors: Collector[],
  segmentKey: string,
  segmentLabel: string,
  segmentKeywords: string[],
  incomeTier: string,
  hasDeadline: boolean,
  runId: string,
): Promise<void> {
  let freshCount    = 0;
  let analyzedCount = 0;
  let oppsUpdated   = 0;
  let cronError: string | undefined;

  try {
    const { signals: fresh } = await runCollect(repos.signals, collectors);
    freshCount = fresh.length;

    if (fresh.length && llm) {
      try {
        await analyzeFriction(fresh, llm, repos.signals, 0.85, 0);
        analyzedCount = fresh.length;
      } catch (e) {
        console.error('[focused-sync] friction failed (non-fatal):', e instanceof Error ? e.message : e);
      }
    }

    const scoreResults = await runScore(
      {
        signals:       repos.signals,
        opportunities: repos.opportunities,
        discovery: {
          saveCandidates:      (candidates, id) => repos.discovery.saveCandidates(candidates, id),
          getLatestCandidates: () => repos.discovery.getLatestCandidates(),
          hasCandidates:       () => repos.discovery.hasCandidates(),
          getSegmentsToScore:  async () => [{
            key:             segmentKey,
            label:           segmentLabel,
            keywords:        segmentKeywords,
            income_tier:     incomeTier,
            has_deadline:    hasDeadline,
            discovery_score: 5,
          }],
        },
      },
      notifier,
      1,
      0,
      false,
      llm,
    );
    oppsUpdated = scoreResults.length;
  } catch (e) {
    cronError = e instanceof Error ? e.message : String(e);
    console.error('[focused-sync] error:', cronError);
  }

  await repos.cronLog.finishCronRun(runId, {
    fresh_signals:    freshCount,
    analyzed_signals: analyzedCount,
    opps_updated:     oppsUpdated,
    error:            cronError,
  });
}
