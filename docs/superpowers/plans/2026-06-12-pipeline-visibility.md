# Pipeline Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-stage progress tracking to the ingestion pipeline, shown as a live banner during manual sync and as an expandable step breakdown in the Pipeline drawer for all runs.

**Architecture:** A new `cron_steps` D1 table records start/end of each of the 5 pipeline stages. `runCronJob` and `runFocusedSync` write step rows before/after each stage via `ICronLogRepo`. The existing `/api/pipeline-status/:runId` poll endpoint returns steps alongside run data. A new `SyncBanner.svelte` replaces the manual `pollSync` function in the dashboard. `PipelineDrawer.svelte` gains expandable per-step rows for every historical run.

**Tech Stack:** Cloudflare Worker + D1, SvelteKit Pages, TypeScript, Vitest

---

## File Map

**Create:**
- `src/main/infrastructure/worker/migrations/0015_add_cron_steps.sql`
- `src/main/infrastructure/worker/test/unit/cron.test.ts`
- `src/main/infrastructure/pages/src/lib/components/SyncBanner.svelte`

**Modify:**
- `src/main/infrastructure/worker/domain/types.ts` — add `CronStepName`, `CronStepStatus`, `CronStep`
- `src/main/infrastructure/worker/application/ports.ts` — extend `ICronLogRepo` with two new methods
- `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts` — implement `upsertCronStep`, `getCronSteps`
- `src/main/infrastructure/worker/test/integration/d1-repo.test.ts` — add `cron_steps` suite
- `src/main/infrastructure/worker/application/cron.ts` — instrument `runCronJob` and `runFocusedSync`
- `src/main/infrastructure/worker/routes/cron.ts` — return `steps`/`stepsByRun` from pipeline endpoints
- `src/main/infrastructure/pages/src/lib/types.ts` — add `CronStep`
- `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts` — include `stepsByRun` in pipeline data
- `src/main/infrastructure/pages/src/lib/components/PipelineDrawer.svelte` — expandable step rows
- `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte` — wire `SyncBanner`, remove `pollSync`

---

## Task 1: Migration and domain types

**Files:**
- Create: `src/main/infrastructure/worker/migrations/0015_add_cron_steps.sql`
- Modify: `src/main/infrastructure/worker/domain/types.ts`

- [ ] **Step 1: Create the migration file**

```sql
-- src/main/infrastructure/worker/migrations/0015_add_cron_steps.sql
CREATE TABLE IF NOT EXISTS cron_steps (
  run_id      TEXT NOT NULL,
  step        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK(status IN ('running','done','error')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  detail_json TEXT,
  PRIMARY KEY (run_id, step),
  FOREIGN KEY (run_id) REFERENCES cron_log(id)
);
```

- [ ] **Step 2: Apply migration locally**

```bash
cd src/main/infrastructure/worker
wrangler d1 migrations apply market-intel --local
```

Expected: `✅ Applied 1 migration`

- [ ] **Step 3: Add domain types**

In `src/main/infrastructure/worker/domain/types.ts`, add after the `CronRun` interface (after line 21):

```typescript
export type CronStepName   = 'collect' | 'friction' | 'discovery' | 'score' | 'snapshot';
export type CronStepStatus = 'running' | 'done' | 'error';

export interface CronStep {
  run_id:      string;
  step:        CronStepName;
  status:      CronStepStatus;
  started_at:  string;
  finished_at: string | null;
  detail:      Record<string, unknown> | null;
}
```

- [ ] **Step 4: Type-check**

```bash
cd /home/valentin/code/market-intel && npm run typecheck
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/migrations/0015_add_cron_steps.sql \
        src/main/infrastructure/worker/domain/types.ts
git commit -m "feat: cron_steps migration and domain types"
```

---

## Task 2: Port interface

**Files:**
- Modify: `src/main/infrastructure/worker/application/ports.ts`

- [ ] **Step 1: Add new types to the import**

The first line of `application/ports.ts` is:

```typescript
import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig,
  GnewsSegmentConfig, MarketTest, MarketTestResult, FrictionProfile,
  CollectorStat, SignalSnapshot, CronRun } from '../domain/types.js';
```

Replace it with:

```typescript
import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig,
  GnewsSegmentConfig, MarketTest, MarketTestResult, FrictionProfile,
  CollectorStat, SignalSnapshot, CronRun, CronStep, CronStepName, CronStepStatus } from '../domain/types.js';
```

- [ ] **Step 2: Extend ICronLogRepo**

Replace the current `ICronLogRepo` interface (currently at line 74):

```typescript
export interface ICronLogRepo {
  insertCronRun(run: CronRun): Promise<void>;
  finishCronRun(id: string, fields: { fresh_signals: number; analyzed_signals: number; opps_updated: number; error?: string }): Promise<void>;
  getRecentCronRuns(limit?: number): Promise<CronRun[]>;
  upsertCronStep(
    runId: string,
    step: CronStepName,
    status: CronStepStatus,
    startedAt: string,
    finishedAt?: string | null,
    detail?: Record<string, unknown>,
  ): Promise<void>;
  getCronSteps(runId: string): Promise<CronStep[]>;
}
```

- [ ] **Step 3: Run typecheck — expect errors about D1Repo**

```bash
npm run typecheck 2>&1 | grep "upsertCronStep\|getCronSteps"
```

Expected: TypeScript errors saying `D1Repo` doesn't implement the new methods. That's fine — fixed in Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/application/ports.ts
git commit -m "feat: extend ICronLogRepo with upsertCronStep and getCronSteps"
```

---

## Task 3: D1Repo implementation + integration tests

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`
- Modify: `src/main/infrastructure/worker/test/integration/d1-repo.test.ts`

- [ ] **Step 1: Write failing integration tests**

In `d1-repo.test.ts`, add this `describe` block at the end of the file (before any final closing braces if the file has an outer `describe`):

```typescript
describe('cron_steps', () => {
  const runId = 'cron-steps-test-run';
  const now   = new Date().toISOString();

  beforeEach(async () => {
    await db.exec(`DELETE FROM cron_steps WHERE run_id = '${runId}'`);
    await db.exec(`DELETE FROM cron_log   WHERE id     = '${runId}'`);
  });

  async function insertParentRun() {
    await repo.insertCronRun({
      id: runId, started_at: now, finished_at: null, trigger: 'manual',
      fresh_signals: null, analyzed_signals: null, opps_updated: null, error: null,
    });
  }

  it('writes running status then updates to done via upsert', async () => {
    await insertParentRun();

    await repo.upsertCronStep(runId, 'collect', 'running', now);
    const running = await repo.getCronSteps(runId);
    expect(running).toHaveLength(1);
    expect(running[0].step).toBe('collect');
    expect(running[0].status).toBe('running');
    expect(running[0].finished_at).toBeNull();
    expect(running[0].detail).toBeNull();

    const fin = new Date().toISOString();
    await repo.upsertCronStep(runId, 'collect', 'done', now, fin, { signals: 42 });
    const done = await repo.getCronSteps(runId);
    expect(done).toHaveLength(1);
    expect(done[0].status).toBe('done');
    expect(done[0].finished_at).toBe(fin);
    expect(done[0].detail).toEqual({ signals: 42 });
  });

  it('returns steps ordered by started_at ascending', async () => {
    await insertParentRun();
    const t1 = new Date(Date.now() - 5000).toISOString();
    const t2 = new Date(Date.now() - 3000).toISOString();
    await repo.upsertCronStep(runId, 'friction', 'done', t2, new Date().toISOString(), { analyzed: 10 });
    await repo.upsertCronStep(runId, 'collect',  'done', t1, t2, { signals: 20 });
    const steps = await repo.getCronSteps(runId);
    expect(steps[0].step).toBe('collect');
    expect(steps[1].step).toBe('friction');
  });

  it('parses detail_json as an object, not a string', async () => {
    await insertParentRun();
    await repo.upsertCronStep(runId, 'discovery', 'done', now, now, { skipped: true });
    const steps = await repo.getCronSteps(runId);
    expect(steps[0].detail).toEqual({ skipped: true });
    expect(typeof steps[0].detail).toBe('object');
  });
});
```

- [ ] **Step 2: Run integration tests to confirm failure**

```bash
npm run test:integration -- --reporter verbose 2>&1 | grep -E "cron_steps|upsertCronStep|FAIL|PASS" | head -20
```

Expected: FAIL — `repo.upsertCronStep is not a function`

- [ ] **Step 3: Add new types to d1-repo.ts import**

The first import block in `d1-repo.ts` (lines 1–16) lists types from `domain/types.js`. Add `CronStep`, `CronStepName`, `CronStepStatus` to it:

```typescript
import type {
  Signal,
  Opportunity,
  Lead,
  DiscoveryCandidate,
  SegmentConfig,
  ScoreBreakdown,
  OpportunityStatus,
  GnewsSegmentConfig,
  MarketTest,
  MarketTestResult,
  FrictionProfile,
  CollectorStat,
  SignalSnapshot,
  CronRun,
  CronStep,
  CronStepName,
  CronStepStatus,
} from '../../domain/types.js';
```

- [ ] **Step 4: Implement upsertCronStep and getCronSteps in D1Repo**

Add these two methods at the end of the `D1Repo` class, just after `getRecentCronRuns`:

```typescript
async upsertCronStep(
  runId: string,
  step: CronStepName,
  status: CronStepStatus,
  startedAt: string,
  finishedAt?: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await this.db
    .prepare(`
      INSERT INTO cron_steps (run_id, step, status, started_at, finished_at, detail_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (run_id, step) DO UPDATE SET
        status      = excluded.status,
        finished_at = excluded.finished_at,
        detail_json = excluded.detail_json
    `)
    .bind(
      runId, step, status, startedAt,
      finishedAt ?? null,
      detail !== undefined ? JSON.stringify(detail) : null,
    )
    .run();
}

async getCronSteps(runId: string): Promise<CronStep[]> {
  const { results } = await this.db
    .prepare('SELECT * FROM cron_steps WHERE run_id = ? ORDER BY started_at ASC')
    .bind(runId)
    .all<Record<string, unknown>>();
  return (results ?? []).map(r => ({
    run_id:      r['run_id']     as string,
    step:        r['step']       as CronStepName,
    status:      r['status']     as CronStepStatus,
    started_at:  r['started_at'] as string,
    finished_at: (r['finished_at'] as string | null) ?? null,
    detail:      r['detail_json']
      ? JSON.parse(r['detail_json'] as string) as Record<string, unknown>
      : null,
  }));
}
```

- [ ] **Step 5: Run integration tests**

```bash
npm run test:integration -- --reporter verbose 2>&1 | grep -E "cron_steps|FAIL|PASS" | head -10
```

Expected: all 3 `cron_steps` tests PASS

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors

- [ ] **Step 7: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/db/d1-repo.ts \
        src/main/infrastructure/worker/test/integration/d1-repo.test.ts
git commit -m "feat: implement upsertCronStep and getCronSteps in D1Repo"
```

---

## Task 4: Instrument runCronJob with unit tests

`runCronJob` runs 5 stages: collect, friction, discovery, score, snapshot. Each gets a `running` write before and a `done`/`error` write after. Friction and discovery are non-fatal (they catch their own errors). Skipped stages (no LLM, or too few texts) write `done` + `{ skipped: true }`.

**Files:**
- Create: `src/main/infrastructure/worker/test/unit/cron.test.ts`
- Modify: `src/main/infrastructure/worker/application/cron.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/main/infrastructure/worker/test/unit/cron.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICronRepos, INotifier } from '../../application/ports.js';
import type { Config } from '../../domain/types.js';

// vi.mock calls are hoisted before imports — mock all application services
// so runCronJob only hits the repo layer (what we're testing).
vi.mock('../../application/collect.js',  () => ({ runCollect:      vi.fn() }));
vi.mock('../../application/friction.js', () => ({ analyzeFriction: vi.fn() }));
vi.mock('../../application/discover.js', () => ({ runDiscovery:    vi.fn() }));
vi.mock('../../application/score.js',    () => ({ runScore:        vi.fn() }));
vi.mock('../../application/gap.js',      () => ({ runSnapshot: vi.fn(), runGapScore: vi.fn() }));
vi.mock('../../domain/candidates.js',    () => ({ seedCandidatesFromConfig: vi.fn().mockReturnValue([]) }));

import { runCronJob } from '../../application/cron.js';
import { runCollect }             from '../../application/collect.js';
import { analyzeFriction }        from '../../application/friction.js';
import { runDiscovery }           from '../../application/discover.js';
import { runScore }               from '../../application/score.js';
import { runSnapshot, runGapScore } from '../../application/gap.js';

function makeCfg(): Config {
  return {
    segments:  {},
    score:     { top_n: 5, min_score: 0, dry_run: false },
    llm:       { provider: 'groq', model: 'llama3-8b' },
    friction:  { min_strength: 0 },
    discover:  { max_clusters: 10, min_signals: 3 },
    notifications: { email: null, score_threshold: 70 },
  } as unknown as Config;
}

function makeRepos(): ICronRepos {
  return {
    signals: {
      getUnanalyzed: vi.fn().mockResolvedValue([]),
      get:           vi.fn().mockResolvedValue([]),
      count:         vi.fn().mockResolvedValue(0),
      upsert:        vi.fn().mockResolvedValue(undefined),
      upsertFriction: vi.fn().mockResolvedValue(undefined),
      getSignalsBySource: vi.fn().mockResolvedValue([]),
    },
    opportunities: {
      getBySegment: vi.fn().mockResolvedValue(null),
      upsert:       vi.fn().mockResolvedValue(undefined),
      getAll:       vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateGapScore: vi.fn().mockResolvedValue(undefined),
      updateLanding:  vi.fn().mockResolvedValue(undefined),
    },
    discovery: {
      hasCandidates:       vi.fn().mockResolvedValue(true),
      getLatestCandidates: vi.fn().mockResolvedValue(null),
      saveCandidates:      vi.fn().mockResolvedValue(undefined),
      getSegmentsToScore:  vi.fn().mockResolvedValue([]),
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
      upsertSnapshot:         vi.fn().mockResolvedValue(undefined),
      getSnapshotsBySegment:  vi.fn().mockResolvedValue([]),
    },
  } as unknown as ICronRepos;
}

const notifier: INotifier = { sendAlert: vi.fn() };
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
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run src/main/infrastructure/worker/test/unit/cron.test.ts 2>&1 | tail -15
```

Expected: FAIL — `repos.cronLog.upsertCronStep is not a function` (method doesn't exist yet on the application layer's cron.ts)

- [ ] **Step 3: Replace runCronJob with the instrumented version**

Replace the entire `runCronJob` function in `application/cron.ts`. Also update the import on line 9 to include `Signal` and `CollectorStat`:

```typescript
import type { Config, CronRun, Signal, CollectorStat } from '../domain/types.js';
```

Full replacement for `runCronJob`:

```typescript
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
      started_at:       new Date().toISOString(),
      finished_at:      null,
      trigger,
      fresh_signals:    null,
      analyzed_signals: null,
      opps_updated:     null,
      error:            null,
    });
  }

  let freshCount    = 0;
  let analyzedCount = 0;
  let oppsUpdated   = 0;
  let cronError: string | undefined;

  try {
    // ── Collect ──────────────────────────────────────────────────────────────
    const collectStart = new Date().toISOString();
    await repos.cronLog.upsertCronStep(runId, 'collect', 'running', collectStart).catch(() => {});
    let fresh: Signal[];
    let collectStats: CollectorStat[];
    try {
      const result = await runCollect(repos.signals, collectors);
      fresh        = result.signals;
      collectStats = result.stats;
      freshCount   = fresh.length;
      await repos.cronLog.upsertCronStep(runId, 'collect', 'done', collectStart, new Date().toISOString(), { signals: freshCount }).catch(() => {});
    } catch (e) {
      await repos.cronLog.upsertCronStep(runId, 'collect', 'error', collectStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      throw e;
    }

    const runAt = new Date().toISOString();
    await Promise.all(
      collectStats.map(stat =>
        repos.collectorHealth.upsertHealth(stat, runAt).catch(e =>
          console.error(`[cron] upsertHealth failed for ${stat.id}:`, e instanceof Error ? e.message : e),
        ),
      ),
    );

    // ── Friction ─────────────────────────────────────────────────────────────
    const frictionStart = new Date().toISOString();
    if (llm) {
      await repos.cronLog.upsertCronStep(runId, 'friction', 'running', frictionStart).catch(() => {});
      try {
        const toAnalyze = await repos.signals.getUnanalyzed();
        await analyzeFriction(toAnalyze, llm, repos.signals, 0.85, cfg.friction?.min_strength ?? 0);
        analyzedCount = toAnalyze.length;
        await repos.cronLog.upsertCronStep(runId, 'friction', 'done', frictionStart, new Date().toISOString(), { analyzed: analyzedCount }).catch(() => {});
      } catch (e) {
        console.error('[cron] friction analysis failed (non-fatal):', e instanceof Error ? e.message : e);
        await repos.cronLog.upsertCronStep(runId, 'friction', 'error', frictionStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      }
    } else {
      await repos.cronLog.upsertCronStep(runId, 'friction', 'done', frictionStart, new Date().toISOString(), { skipped: true }).catch(() => {});
    }

    // ── Discovery ─────────────────────────────────────────────────────────────
    const discoveryStart = new Date().toISOString();
    if (llm) {
      await repos.cronLog.upsertCronStep(runId, 'discovery', 'running', discoveryStart).catch(() => {});
      try {
        const discoverTexts = fresh.map(s => s.raw_text).filter(Boolean).slice(0, 80) as string[];
        if (discoverTexts.length >= 5) {
          const prevDiscovery  = await repos.discovery.getLatestCandidates();
          const knownSegments  = [
            ...Object.keys(cfg.segments),
            ...(prevDiscovery?.candidates ?? []).map(c => c.segment),
          ];
          const newCandidates = await runDiscovery(llm, notifier, cfg.discover, discoverTexts, knownSegments);
          if (newCandidates.length) {
            await repos.discovery.saveCandidates(newCandidates, crypto.randomUUID());
            console.log(`[cron] discovery done — ${newCandidates.length} candidates`);
          }
          await repos.cronLog.upsertCronStep(runId, 'discovery', 'done', discoveryStart, new Date().toISOString(), { candidates: newCandidates.length }).catch(() => {});
        } else {
          await repos.cronLog.upsertCronStep(runId, 'discovery', 'done', discoveryStart, new Date().toISOString(), { skipped: true }).catch(() => {});
        }
      } catch (e) {
        console.error('[cron] discovery failed (non-fatal):', e instanceof Error ? e.message : e);
        await repos.cronLog.upsertCronStep(runId, 'discovery', 'error', discoveryStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      }
    } else {
      await repos.cronLog.upsertCronStep(runId, 'discovery', 'done', discoveryStart, new Date().toISOString(), { skipped: true }).catch(() => {});
    }

    if (!(await repos.discovery.hasCandidates())) {
      await repos.discovery.saveCandidates(
        seedCandidatesFromConfig(cfg.segments, new Date().toISOString()),
        crypto.randomUUID(),
      );
    }

    // ── Score ────────────────────────────────────────────────────────────────
    const scoreStart = new Date().toISOString();
    await repos.cronLog.upsertCronStep(runId, 'score', 'running', scoreStart).catch(() => {});
    try {
      const scoreResults = await runScore(
        { signals: repos.signals, opportunities: repos.opportunities, discovery: repos.discovery },
        notifier,
        cfg.score.top_n,
        cfg.score.min_score,
        cfg.score.dry_run,
        llm,
      );
      oppsUpdated = scoreResults.length;
      await repos.cronLog.upsertCronStep(runId, 'score', 'done', scoreStart, new Date().toISOString(), { opps: oppsUpdated }).catch(() => {});
    } catch (e) {
      await repos.cronLog.upsertCronStep(runId, 'score', 'error', scoreStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      throw e;
    }

    // ── Snapshot ─────────────────────────────────────────────────────────────
    const snapshotStart = new Date().toISOString();
    await repos.cronLog.upsertCronStep(runId, 'snapshot', 'running', snapshotStart).catch(() => {});
    try {
      await runSnapshot(repos.signals, repos.snapshots);
      await runGapScore(repos.snapshots, repos.opportunities);
      console.log('[cron] gap snapshot + scoring done');
      await repos.cronLog.upsertCronStep(runId, 'snapshot', 'done', snapshotStart, new Date().toISOString(), {}).catch(() => {});
    } catch (e) {
      await repos.cronLog.upsertCronStep(runId, 'snapshot', 'error', snapshotStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      throw e;
    }

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
```

- [ ] **Step 4: Run the unit tests**

```bash
npx vitest run src/main/infrastructure/worker/test/unit/cron.test.ts 2>&1 | tail -15
```

Expected: all 3 tests PASS

- [ ] **Step 5: Run all unit tests for regressions**

```bash
npm test 2>&1 | tail -5
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/application/cron.ts \
        src/main/infrastructure/worker/test/unit/cron.test.ts
git commit -m "feat: instrument runCronJob with per-step progress writes"
```

---

## Task 5: Instrument runFocusedSync

`runFocusedSync` runs only 3 steps: collect, friction (if fresh signals + llm), score. No discovery, no snapshot.

**Files:**
- Modify: `src/main/infrastructure/worker/application/cron.ts`

- [ ] **Step 1: Replace runFocusedSync with the instrumented version**

```typescript
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
    // ── Collect ──────────────────────────────────────────────────────────────
    const collectStart = new Date().toISOString();
    await repos.cronLog.upsertCronStep(runId, 'collect', 'running', collectStart).catch(() => {});
    let fresh: Signal[];
    try {
      const result = await runCollect(repos.signals, collectors);
      fresh      = result.signals;
      freshCount = fresh.length;
      await repos.cronLog.upsertCronStep(runId, 'collect', 'done', collectStart, new Date().toISOString(), { signals: freshCount }).catch(() => {});
    } catch (e) {
      await repos.cronLog.upsertCronStep(runId, 'collect', 'error', collectStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      throw e;
    }

    // ── Friction ─────────────────────────────────────────────────────────────
    const frictionStart = new Date().toISOString();
    if (fresh.length && llm) {
      await repos.cronLog.upsertCronStep(runId, 'friction', 'running', frictionStart).catch(() => {});
      try {
        await analyzeFriction(fresh, llm, repos.signals, 0.85, 0);
        analyzedCount = fresh.length;
        await repos.cronLog.upsertCronStep(runId, 'friction', 'done', frictionStart, new Date().toISOString(), { analyzed: analyzedCount }).catch(() => {});
      } catch (e) {
        console.error('[focused-sync] friction failed (non-fatal):', e instanceof Error ? e.message : e);
        await repos.cronLog.upsertCronStep(runId, 'friction', 'error', frictionStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      }
    } else {
      await repos.cronLog.upsertCronStep(runId, 'friction', 'done', frictionStart, new Date().toISOString(), { skipped: true }).catch(() => {});
    }

    // ── Score ────────────────────────────────────────────────────────────────
    const scoreStart = new Date().toISOString();
    await repos.cronLog.upsertCronStep(runId, 'score', 'running', scoreStart).catch(() => {});
    try {
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
      await repos.cronLog.upsertCronStep(runId, 'score', 'done', scoreStart, new Date().toISOString(), { opps: oppsUpdated }).catch(() => {});
    } catch (e) {
      await repos.cronLog.upsertCronStep(runId, 'score', 'error', scoreStart, new Date().toISOString(), { error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      throw e;
    }

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
```

- [ ] **Step 2: Run all unit tests**

```bash
npm test 2>&1 | tail -5
```

Expected: all tests pass

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/application/cron.ts
git commit -m "feat: instrument runFocusedSync with per-step progress writes"
```

---

## Task 6: API layer

**Files:**
- Modify: `src/main/infrastructure/worker/routes/cron.ts`

- [ ] **Step 1: Add CronStep import**

At the top of `routes/cron.ts`, add a top-level import for `CronStep`:

```typescript
import type { CronStep } from '../domain/types.js';
```

- [ ] **Step 2: Replace handleGetPipelineStatus**

```typescript
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
```

- [ ] **Step 3: Replace handleGetPipelineStatusById**

```typescript
export async function handleGetPipelineStatusById(db: D1Database, runId: string, cors = PUBLIC_CORS): Promise<Response> {
  const repo  = new D1Repo(db);
  const runs  = await repo.getRecentCronRuns(20).catch(() => [] as import('../domain/types.js').CronRun[]);
  const run   = runs.find(r => r.id === runId) ?? null;
  const steps = run ? await repo.getCronSteps(runId).catch(() => [] as CronStep[]) : [];
  return json({ run, steps }, 200, cors);
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/routes/cron.ts
git commit -m "feat: include cron steps in pipeline-status API responses"
```

---

## Task 7: Frontend types and page server

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/types.ts`
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts`

- [ ] **Step 1: Add CronStep to types.ts**

In `src/main/infrastructure/pages/src/lib/types.ts`, add after the `CronRun` interface:

```typescript
export interface CronStep {
  run_id:      string;
  step:        string;
  status:      'running' | 'done' | 'error';
  started_at:  string;
  finished_at: string | null;
  detail:      Record<string, unknown> | null;
}
```

- [ ] **Step 2: Add CronStep to page.server.ts import**

In `+page.server.ts`, find the types import line:

```typescript
import type { Stats, DiscoveryResult, Opportunity, Config, GapEntry, SignalRow, PainProfile, CronRun, CollectorHealth, VelocityRow, SourceStat } from '$lib/types.js';
```

Replace with:

```typescript
import type { Stats, DiscoveryResult, Opportunity, Config, GapEntry, SignalRow, PainProfile, CronRun, CronStep, CollectorHealth, VelocityRow, SourceStat } from '$lib/types.js';
```

- [ ] **Step 3: Update the pipelineData safeJson type**

In the second `Promise.all` inside the `load` function, find the line that currently reads:

```typescript
safeJson<{ runs: CronRun[]; collectors: CollectorHealth[]; bySource: SourceStat[] }>(pipelineRes, { runs: [], collectors: [], bySource: [] }),
```

Replace with:

```typescript
safeJson<{ runs: CronRun[]; collectors: CollectorHealth[]; bySource: SourceStat[]; stepsByRun: Record<string, CronStep[]> }>(pipelineRes, { runs: [], collectors: [], bySource: [], stepsByRun: {} }),
```

- [ ] **Step 4: Typecheck Pages**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/types.ts \
        src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts
git commit -m "feat: add CronStep type and stepsByRun to pipeline page data"
```

---

## Task 8: SyncBanner component

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/SyncBanner.svelte`

- [ ] **Step 1: Create the component**

```svelte
<!-- src/main/infrastructure/pages/src/lib/components/SyncBanner.svelte -->
<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { CronStep } from '$lib/types.js';

  /** The cron run ID to poll. */
  export let runId: string;
  /** true = full pipeline (5 steps); false = focused sync (3 steps). */
  export let fullPipeline = true;

  const dispatch = createEventDispatcher<{ complete: { error: string | null } }>();

  type StepState = 'pending' | 'running' | 'done' | 'error';

  const FULL_STEPS  = ['collect', 'friction', 'discovery', 'score', 'snapshot'] as const;
  const SHORT_STEPS = ['collect', 'friction', 'score'] as const;
  const STEP_LABELS: Record<string, string> = {
    collect:   'Collect',
    friction:  'Friction',
    discovery: 'Discovery',
    score:     'Score',
    snapshot:  'Snapshot',
  };

  $: expectedKeys = (fullPipeline ? FULL_STEPS : SHORT_STEPS) as readonly string[];

  let steps:  CronStep[] = [];
  let elapsed = 0;
  const started = Date.now();

  const tickTimer = setInterval(() => { elapsed = Math.round((Date.now() - started) / 1000); }, 1000);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function poll() {
    try {
      const res  = await fetch(`/api/pipeline-status/${encodeURIComponent(runId)}`);
      if (!res.ok) return;
      const body = await res.json() as {
        run:   { finished_at: string | null; error: string | null } | null;
        steps: CronStep[];
      };
      steps = body.steps ?? [];
      if (body.run?.finished_at) {
        stop();
        await invalidateAll();
        dispatch('complete', { error: body.run.error });
      }
    } catch { /* non-fatal */ }
  }

  function stop() {
    clearInterval(tickTimer);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  pollTimer = setInterval(poll, 2000);
  poll(); // immediate first fetch

  onDestroy(stop);

  function stepDetail(step: CronStep): string {
    const d = step.detail;
    if (!d)                      return '';
    if (d['skipped'])            return '—';
    if (d['error'])              return String(d['error']).slice(0, 40);
    if (d['signals']   != null)  return `${d['signals']} señales`;
    if (d['analyzed']  != null)  return `${d['analyzed']} analizadas`;
    if (d['candidates'] != null) return `${d['candidates']} candidatos`;
    if (d['opps']      != null)  return `${d['opps']} opps`;
    return '';
  }

  $: nodes = expectedKeys.map(key => {
    const s = steps.find(st => st.step === key);
    return {
      key,
      label:  STEP_LABELS[key] ?? key,
      state:  (s?.status ?? 'pending') as StepState,
      detail: s ? stepDetail(s) : '',
    };
  });

  function connClass(i: number): string {
    const cur  = nodes[i]?.state;
    const next = nodes[i + 1]?.state;
    if (cur === 'done' && next !== 'pending') return 'done';
    if (cur === 'done') return 'half';
    return 'pending';
  }
</script>

<div class="sync-banner">
  <div class="banner-top">
    <span class="dot"></span>
    Pipeline · en curso
    <span class="timer">{elapsed}s</span>
  </div>
  <div class="stages">
    {#each nodes as node, i}
      <div class="stage">
        <div class="circle {node.state}">
          {#if node.state === 'done'}✓{:else if node.state === 'running'}···{:else if node.state === 'error'}✗{:else}○{/if}
        </div>
        <div class="name {node.state}">{node.label}</div>
        {#if node.detail}<div class="count">{node.detail}</div>{/if}
      </div>
      {#if i < nodes.length - 1}
        <div class="conn {connClass(i)}"></div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .sync-banner {
    background: #13131f;
    border-bottom: 1px solid color-mix(in srgb, var(--violet) 25%, transparent);
    padding: 7px 16px;
  }
  .banner-top {
    display: flex; align-items: center; gap: 7px;
    font-size: 0.72rem; color: var(--violet); font-weight: 700; margin-bottom: 8px;
  }
  .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--violet); flex-shrink: 0;
    animation: pulse .9s ease-in-out infinite;
  }
  .timer { margin-left: auto; color: var(--text-dim); font-weight: 400; }

  .stages { display: flex; align-items: flex-end; }

  .stage {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; align-items: center; padding: 0 2px;
  }

  .circle {
    width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.65rem; font-weight: 700; margin-bottom: 4px; flex-shrink: 0;
  }
  .circle.done    { background: var(--violet); color: #fff; }
  .circle.running { background: var(--violet); color: #fff; animation: pulse .9s ease-in-out infinite; }
  .circle.error   { background: #ef4444; color: #fff; }
  .circle.pending { background: var(--bg-input); color: var(--border); border: 1px solid var(--border); }

  .name         { font-size: 0.65rem; color: var(--text-muted); white-space: nowrap; }
  .name.done    { color: var(--violet); }
  .name.running { color: var(--violet); font-weight: 700; }
  .name.error   { color: #ef4444; }

  .count { font-size: 0.6rem; color: var(--violet); margin-top: 2px; white-space: nowrap; }

  .conn { flex: 0 0 8px; height: 2px; margin-bottom: 22px; }
  .conn.done    { background: var(--violet); }
  .conn.half    { background: linear-gradient(90deg, var(--violet) 50%, var(--border) 50%); }
  .conn.pending { background: var(--border); }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
</style>
```

- [ ] **Step 2: Typecheck Pages**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/SyncBanner.svelte
git commit -m "feat: SyncBanner component with live per-stage progress polling"
```

---

## Task 9: PipelineDrawer update

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/components/PipelineDrawer.svelte`

- [ ] **Step 1: Add stepsByRun prop and helper functions to the script block**

In `PipelineDrawer.svelte`, add the following to the `<script>` block, after the existing `export let bySource` line:

```typescript
import type { CronStep } from '$lib/types.js';

export let stepsByRun: Record<string, CronStep[]> = {};

$: latestFinishedId = runs.find(r => r.finished_at)?.id ?? null;
let expandedRunId: string | null = null;
$: if (latestFinishedId && expandedRunId === null) expandedRunId = latestFinishedId;

function toggleExpand(runId: string) {
  expandedRunId = expandedRunId === runId ? null : runId;
}

function stepDetail(step: CronStep): string {
  const d = step.detail;
  if (!d)                      return '';
  if (d['skipped'])            return '—';
  if (d['error'])              return String(d['error']).slice(0, 50);
  if (d['signals']   != null)  return `${d['signals']} señales`;
  if (d['analyzed']  != null)  return `${d['analyzed']} analizadas`;
  if (d['candidates'] != null) return `${d['candidates']} candidatos`;
  if (d['opps']      != null)  return `${d['opps']} opps`;
  return '';
}

function stepDuration(step: CronStep): string {
  if (!step.finished_at) return '';
  const ms = new Date(step.finished_at).getTime() - new Date(step.started_at).getTime();
  return ms < 1000 ? '<1s' : `${Math.round(ms / 1000)}s`;
}
```

- [ ] **Step 2: Replace the run history section markup**

Find the section that starts with `{#each runs as run}` inside the `<!-- Cron run history -->` section. Replace the entire `{#each}` block with:

```svelte
{#each runs as run}
  {@const st = runStatus(run)}
  {@const runSteps = stepsByRun[run.id] ?? []}
  {@const isExpanded = expandedRunId === run.id}
  <div class="run-row" class:run-ok={st === 'ok'} class:run-err={st === 'error'} class:run-running={st === 'running'}>
    <div class="run-top">
      <span class="run-status-dot" class:ok={st === 'ok'} class:err={st === 'error'} class:spin={st === 'running'}></span>
      <span class="run-trigger">{run.trigger === 'manual' ? 'Manual' : 'Cron'}</span>
      <span class="run-age">{fmtAge(run.started_at)}</span>
      <span class="run-dur">{fmtDuration(run)}</span>
      {#if runSteps.length > 0}
        <button class="expand-btn" on:click={() => toggleExpand(run.id)}>
          {isExpanded ? '▴' : '▾'}
        </button>
      {/if}
    </div>
    {#if st !== 'running'}
      <div class="run-stats">
        <span>{run.fresh_signals ?? 0} nuevas</span>
        <span>{run.analyzed_signals ?? 0} analizadas</span>
        <span>{run.opps_updated ?? 0} oportunidades</span>
      </div>
    {/if}
    {#if run.error}
      <div class="run-error">{run.error}</div>
    {/if}
    {#if isExpanded && runSteps.length > 0}
      <div class="step-list">
        {#each runSteps as step}
          <div class="step-item" class:step-err={step.status === 'error'}>
            <span class="step-dot" class:done={step.status === 'done'} class:err={step.status === 'error'}></span>
            <span class="step-name">{step.step}</span>
            <span class="step-detail">{stepDetail(step)}</span>
            <span class="step-dur">{stepDuration(step)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/each}
```

- [ ] **Step 3: Add new CSS to the style block**

Add these rules to the `<style>` block in PipelineDrawer.svelte:

```css
.expand-btn { background: none; border: none; cursor: pointer; font-size: 0.7rem; color: var(--text-dim); padding: 0 2px; }
.step-list  { margin-top: 5px; padding: 4px 0 2px 14px; border-left: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
.step-item  { display: flex; align-items: center; gap: 5px; font-size: 0.68rem; }
.step-item.step-err { color: #ef4444; }
.step-dot   { width: 6px; height: 6px; border-radius: 50%; background: var(--border); flex-shrink: 0; }
.step-dot.done { background: var(--violet); }
.step-dot.err  { background: #ef4444; }
.step-name   { color: var(--text-sub); min-width: 62px; }
.step-detail { color: var(--violet); }
.step-dur    { margin-left: auto; color: var(--text-dim); }
```

- [ ] **Step 4: Typecheck Pages**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/PipelineDrawer.svelte
git commit -m "feat: PipelineDrawer with expandable per-step run breakdown"
```

---

## Task 10: Dashboard integration

**Files:**
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte`

- [ ] **Step 1: Import SyncBanner**

Add to the component imports in the `<script>` block (alongside the other component imports):

```typescript
import SyncBanner from '$lib/components/SyncBanner.svelte';
```

- [ ] **Step 2: Remove syncPollTimer variable and the pollSync function**

Delete the `syncPollTimer` variable declaration:
```typescript
let syncPollTimer: ReturnType<typeof setInterval> | null = null;
```

Delete the entire `async function pollSync() { ... }` function (lines 90–111 approximately).

- [ ] **Step 3: Add syncIsFullPipeline variable**

After `let syncRunId: string | null = null;`, add:

```typescript
let syncIsFullPipeline = true;
```

- [ ] **Step 4: Replace forceSync**

Replace the entire `forceSync` function with the version that no longer calls `setInterval(pollSync, ...)`:

```typescript
async function forceSync() {
  if (syncRunning) return;
  syncRunning = true;
  syncIsFullPipeline = true;
  syncMsg = null;
  try {
    const res  = await fetch('/api/run-cron', { method: 'POST' });
    const body = await res.json() as { run_id?: string; error?: string };
    if (!res.ok) {
      syncRunning = false;
      showSyncMsg(false, `No se pudo iniciar el sync: ${body.error ?? res.status}`);
      return;
    }
    syncRunId = body.run_id ?? null;
  } catch (e) {
    syncRunning = false;
    showSyncMsg(false, `Error de red: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

- [ ] **Step 5: Add onSyncComplete handler**

Add this function after `forceSync`:

```typescript
function onSyncComplete(event: CustomEvent<{ error: string | null }>) {
  syncRunning = false;
  syncRunId   = null;
  if (event.detail.error) {
    showSyncMsg(false, `Error en sync: ${event.detail.error.slice(0, 80)}`);
  } else {
    showSyncMsg(true, 'Sync completado');
  }
  showPipeline = true;
}
```

- [ ] **Step 6: Update the focused sync trigger**

Find the block in the `on:sync` handler that currently reads:

```typescript
syncRunId = detail.run_id;
syncRunning = true;
pollSync();
```

Replace with:

```typescript
syncRunId = detail.run_id;
syncIsFullPipeline = false;
syncRunning = true;
```

- [ ] **Step 7: Add SyncBanner to the template**

In the template, find the `<PipelineBar ...>` component. Insert the `SyncBanner` immediately before it (after the header, before the pipeline tabs):

```svelte
{#if syncRunning && syncRunId}
  <SyncBanner
    runId={syncRunId}
    fullPipeline={syncIsFullPipeline}
    on:complete={onSyncComplete}
  />
{/if}
```

- [ ] **Step 8: Pass stepsByRun to PipelineDrawer**

Find `<PipelineDrawer` in the template. Add the `stepsByRun` prop:

```svelte
<PipelineDrawer
  runs={data.pipeline.runs}
  collectors={data.pipeline.collectors}
  bySource={data.pipeline.bySource ?? []}
  stepsByRun={data.pipeline.stepsByRun ?? {}}
  on:close={() => showPipeline = false}
/>
```

- [ ] **Step 9: Typecheck Pages**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```

Expected: zero errors

- [ ] **Step 10: Run all worker unit tests**

```bash
cd /home/valentin/code/market-intel && npm test
```

Expected: all tests pass (146+)

- [ ] **Step 11: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/dashboard/+page.svelte
git commit -m "feat: wire SyncBanner into dashboard, replace pollSync with component polling"
```

---

## Manual verification

After all tasks complete:

1. Start the local worker: `cd src/main/infrastructure/worker && wrangler dev`
2. Start the pages dev server: `cd src/main/infrastructure/pages && npm run dev`
3. Open the dashboard, click **↻ Sync ahora**
4. Verify the SyncBanner appears between the header and the pipeline tabs, nodes advance as the run progresses
5. After completion, verify the drawer auto-opens with the last run expanded showing 5 step rows with counts and durations
6. Click an older run to verify it expands its step rows too
7. Trigger a sector promotion from the SectorsGrid, verify the banner shows 3 nodes (collect/friction/score)
