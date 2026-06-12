import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICronRepos, INotifier } from '../../application/ports.js';
import type { Config } from '../../domain/types.js';

vi.mock('../../application/collect.js',  () => ({ runCollect:      vi.fn() }));
vi.mock('../../application/friction.js', () => ({ analyzeFriction: vi.fn() }));
vi.mock('../../application/discover.js', () => ({ runDiscovery:    vi.fn() }));
vi.mock('../../application/score.js',    () => ({ runScore:        vi.fn() }));
vi.mock('../../application/gap.js',      () => ({ runSnapshot: vi.fn(), runGapScore: vi.fn() }));
vi.mock('../../domain/candidates.js',    () => ({ seedCandidatesFromConfig: vi.fn().mockReturnValue([]) }));

import { runCronJob } from '../../application/cron.js';
import { runCollect }               from '../../application/collect.js';
import { analyzeFriction }          from '../../application/friction.js';
import { runDiscovery }             from '../../application/discover.js';
import { runScore }                 from '../../application/score.js';
import { runSnapshot, runGapScore } from '../../application/gap.js';

function makeCfg(): Config {
  return {
    segments:  {},
    score:     { top_n: 5, min_score: 0, dry_run: false },
    llm:       { provider: 'groq', model: 'llama3-8b', temperature: 0.2, max_tokens: 1024 },
    friction:  { min_strength: 0 },
    discover:  { max_clusters: 10, min_signals: 3 },
    notifications: { from_email: '', to_email: '', alert_score_threshold: 70 },
  } as unknown as Config;
}

function makeRepos(): ICronRepos {
  return {
    signals: {
      getUnanalyzed:      vi.fn().mockResolvedValue([]),
      get:                vi.fn().mockResolvedValue([]),
      count:              vi.fn().mockResolvedValue(0),
      upsert:             vi.fn().mockResolvedValue(undefined),
      upsertFriction:     vi.fn().mockResolvedValue(undefined),
      getSignalsBySource: vi.fn().mockResolvedValue([]),
      save:               vi.fn().mockResolvedValue(true),
      getAll:             vi.fn().mockResolvedValue([]),
      updateFriction:     vi.fn().mockResolvedValue(undefined),
      getSignalsInRange:  vi.fn().mockResolvedValue([]),
    },
    opportunities: {
      getBySegment:   vi.fn().mockResolvedValue(null),
      upsert:         vi.fn().mockResolvedValue(undefined),
      getAll:         vi.fn().mockResolvedValue([]),
      updateStatus:   vi.fn().mockResolvedValue(undefined),
      updateGapScore: vi.fn().mockResolvedValue(undefined),
      updateLanding:  vi.fn().mockResolvedValue(undefined),
      markAlerted:    vi.fn().mockResolvedValue(undefined),
    },
    discovery: {
      hasCandidates:              vi.fn().mockResolvedValue(true),
      getLatestCandidates:        vi.fn().mockResolvedValue(null),
      saveCandidates:             vi.fn().mockResolvedValue(undefined),
      getSegmentsToScore:         vi.fn().mockResolvedValue([]),
      replaceCandidatesWithRunId: vi.fn().mockResolvedValue(undefined),
    },
    collectorHealth: {
      upsertHealth:       vi.fn().mockResolvedValue(undefined),
      getCollectorHealth: vi.fn().mockResolvedValue([]),
    },
    cronLog: {
      insertCronRun:   vi.fn().mockResolvedValue(undefined),
      finishCronRun:   vi.fn().mockResolvedValue(undefined),
      getRecentCronRuns: vi.fn().mockResolvedValue([]),
      upsertCronStep:  vi.fn().mockResolvedValue(undefined),
      getCronSteps:    vi.fn().mockResolvedValue([]),
    },
    snapshots: {
      upsertSnapshot:        vi.fn().mockResolvedValue(undefined),
      getSnapshots:          vi.fn().mockResolvedValue([]),
      getSnapshotsBySegment: vi.fn().mockResolvedValue([]),
      getLatestSnapshotAllSegments: vi.fn().mockResolvedValue([]),
    },
  } as unknown as ICronRepos;
}

const notifier: INotifier = { send: vi.fn() };
const runId = 'test-run-id';

describe('runCronJob step instrumentation', () => {
  let repos: ICronRepos;

  beforeEach(() => {
    repos = makeRepos();
    vi.mocked(runCollect).mockResolvedValue({ signals: [], stats: [] });
    vi.mocked(analyzeFriction).mockResolvedValue(undefined);
    vi.mocked(runDiscovery).mockResolvedValue([]);
    vi.mocked(runScore).mockResolvedValue([]);
    vi.mocked(runSnapshot).mockResolvedValue(undefined);
    vi.mocked(runGapScore).mockResolvedValue(undefined);
  });

  it('writes running+done for collect/score/snapshot; skipped done for friction/discovery when no LLM', async () => {
    await runCronJob(repos, undefined, notifier, [], makeCfg(), 'manual', runId);

    const calls  = vi.mocked(repos.cronLog.upsertCronStep).mock.calls;
    const byStep = (name: string) => calls.filter(c => c[1] === name);

    expect(byStep('collect')[0][2]).toBe('running');
    expect(byStep('collect')[1][2]).toBe('done');

    expect(byStep('friction').length).toBe(1);
    expect(byStep('friction')[0][2]).toBe('done');
    expect(byStep('friction')[0][5]).toEqual({ skipped: true });

    expect(byStep('discovery').length).toBe(1);
    expect(byStep('discovery')[0][2]).toBe('done');
    expect(byStep('discovery')[0][5]).toEqual({ skipped: true });

    expect(byStep('score')[0][2]).toBe('running');
    expect(byStep('score')[1][2]).toBe('done');

    expect(byStep('snapshot')[0][2]).toBe('running');
    expect(byStep('snapshot')[1][2]).toBe('done');
  });

  it('writes running+done for friction when LLM is provided', async () => {
    const llm = { complete: vi.fn().mockResolvedValue('[]') };
    vi.mocked(repos.signals.getUnanalyzed as ReturnType<typeof vi.fn>).mockResolvedValue([{ raw_text: 'x' }]);

    await runCronJob(repos, llm as any, notifier, [], makeCfg(), 'manual', runId);

    const calls  = vi.mocked(repos.cronLog.upsertCronStep).mock.calls;
    const byStep = (name: string) => calls.filter(c => c[1] === name);

    expect(byStep('friction')[0][2]).toBe('running');
    expect(byStep('friction')[1][2]).toBe('done');
    expect(byStep('friction')[1][5]).toEqual({ analyzed: 1 });
  });

  it('writes error status for collect when it throws, then finishCronRun is still called', async () => {
    vi.mocked(runCollect).mockRejectedValue(new Error('network failure'));

    await runCronJob(repos, undefined, notifier, [], makeCfg(), 'manual', runId);

    const calls        = vi.mocked(repos.cronLog.upsertCronStep).mock.calls;
    const collectCalls = calls.filter(c => c[1] === 'collect');
    expect(collectCalls[0][2]).toBe('running');
    expect(collectCalls[1][2]).toBe('error');
    expect((collectCalls[1][5] as Record<string, unknown>)?.['error']).toContain('network failure');

    expect(repos.cronLog.finishCronRun).toHaveBeenCalledOnce();
  });
});
