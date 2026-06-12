# Pipeline Visibility — Design Spec
**Date:** 2026-06-12  
**Status:** Approved

## Problem

The ingestion pipeline (Collect → Friction → Discovery → Score → Snapshot) runs every 12 hours as a scheduled cron job and can also be triggered manually from the dashboard. Currently the user gets no feedback on which stage is executing or how many items were processed per stage. After a run completes, only three aggregate counters are visible (`fresh_signals`, `analyzed_signals`, `opps_updated`).

## Goal

Show per-stage progress in real time during a manual sync, and expose the same per-stage breakdown for every historical run (including scheduled cron runs) in the existing Pipeline drawer.

## Design

### Data layer — `cron_steps` table

New migration `0015_add_cron_steps.sql` adds a `cron_steps` table:

```sql
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

`step` values: `collect`, `friction`, `discovery`, `score`, `snapshot`.  
`detail_json` carries per-step counts:
- collect: `{ signals: number }`
- friction: `{ analyzed: number }`
- discovery: `{ candidates: number, skipped?: true }`
- score: `{ opps: number }`
- snapshot: `{ skipped?: true }`

**Skipped steps:** If a stage is intentionally skipped (e.g. `discovery` when `discoverTexts.length < 5` or `llm` is undefined; `snapshot` is never skipped in full cron but is omitted in focused sync), write `status = 'done'` with `{ skipped: true }` in the detail. This keeps the step row present for the UI to render rather than requiring special-case logic to handle missing rows.

### Application layer — `ICronLogRepo` and `runCronJob`

Two new methods added to `ICronLogRepo` in `application/ports.ts`:

```typescript
upsertCronStep(
  runId: string,
  step: CronStepName,
  status: 'running' | 'done' | 'error',
  startedAt: string,
  finishedAt?: string | null,
  detail?: Record<string, unknown>,
): Promise<void>;

getCronSteps(runId: string): Promise<CronStep[]>;
```

`CronStepName` and `CronStep` are added to `domain/types.ts`.

`runCronJob` in `application/cron.ts` wraps each stage with upsert calls:

```typescript
const stepStart = new Date().toISOString();
await repos.cronLog.upsertCronStep(runId, 'collect', 'running', stepStart);
try {
  const { signals, stats } = await runCollect(...);
  await repos.cronLog.upsertCronStep(runId, 'collect', 'done', stepStart,
    new Date().toISOString(), { signals: fresh.length });
} catch (e) {
  await repos.cronLog.upsertCronStep(runId, 'collect', 'error', stepStart,
    new Date().toISOString(), { error: String(e) });
  throw e;
}
```

Step errors are recorded individually; a failed step still writes `error` status so the UI shows exactly which stage broke. The outer try/catch in `runCronJob` still catches fatal errors for the run-level record.

### Infrastructure layer — `D1Repo`

`upsertCronStep` uses `INSERT ... ON CONFLICT DO UPDATE` to handle both the initial `running` write and the final `done`/`error` update in one statement.

`getCronSteps` returns rows ordered by `started_at ASC`. The repo layer parses `detail_json` before returning, so callers receive `detail: Record<string, unknown> | null` rather than a raw string. `CronStep.detail` replaces `CronStep.detail_json` in the TypeScript type.

### API layer — `routes/cron.ts`

`handleGetPipelineStatus` (bulk endpoint) includes steps for the 5 most recent runs, fetched in parallel:

```typescript
const [runs, collectors, bySource] = await Promise.all([...]);
const stepsPerRun = await Promise.all(
  runs.map(r => repo.getCronSteps(r.id))
);
return json({ runs, collectors, bySource, stepsByRun: Object.fromEntries(
  runs.map((r, i) => [r.id, stepsPerRun[i]])
)}, 200, cors);
```

`handleGetPipelineStatusById` returns `{ run, steps }` — already polled by the dashboard during active sync.

### Frontend — new `SyncBanner.svelte` component

Shown between the dashboard header and the pipeline tabs while a sync is running. Receives `runId` as a prop, polls `/api/pipeline-status/:runId` every 2 seconds, and derives step state from the response.

Layout: a horizontal row of stage nodes connected by lines, matching the visual design. Each node shows:
- Circle: `✓` (done, violet), `···` (running, pulsing), `○` (pending, dim)
- Stage name below
- Count below the name once the step is done (skipped steps show `—`)

**Adaptive node count:** the banner derives visible steps from the steps returned by the poll response. A full cron run yields all 5 nodes; a focused sync yields 3 (`collect`, `friction`, `score`). The banner never shows `discovery` or `snapshot` nodes as permanently pending for a focused sync — it only renders the nodes present in the step data. During the initial poll before any steps are written, the banner defaults to 5 nodes if the run trigger is `'scheduled'` or `'manual'` cron, and 3 nodes if it was triggered via `/discovery/promote`.

The banner disappears when `run.finished_at` is set, then triggers `invalidateAll()` to refresh the dashboard. Emits a `complete` event so the dashboard can auto-open the drawer.

The existing `syncRunning` / `syncRunId` state in `+page.svelte` drives banner visibility. The current `pollSync` function is replaced by the banner's internal polling.

### Frontend — updated `PipelineDrawer.svelte`

Receives an additional `stepsByRun: Record<string, CronStep[]>` prop alongside the existing `runs`.

Each run row gains a collapse/expand toggle (▾ / ▴). The most recently finished run is auto-expanded on open. When expanded, a step list renders below the existing run stats row:

```
● Collect     42 señales          4s
● Friction    38 analizadas       18s
● Discovery   3 candidatos        5s
● Score       5 oportunidades     1s
● Snapshot    ok                  <1s
```

Error steps show in red with the error message truncated to 60 chars.

### Types — `domain/types.ts` additions

```typescript
export type CronStepName = 'collect' | 'friction' | 'discovery' | 'score' | 'snapshot';
export type CronStepStatus = 'running' | 'done' | 'error';

export interface CronStep {
  run_id:      string;
  step:        CronStepName;
  status:      CronStepStatus;
  started_at:  string;
  finished_at: string | null;
  detail:      Record<string, unknown> | null;  // parsed by repo layer, never a raw string
}
```

## Scope

**In scope:**
- `cron_steps` migration
- `ICronLogRepo` extension + D1Repo implementation
- `runCronJob` step instrumentation (5 steps)
- `runFocusedSync` step instrumentation (collect, friction, score — no discovery/snapshot)
- API response changes for both pipeline-status endpoints
- New `SyncBanner.svelte` component
- Updated `PipelineDrawer.svelte` with expandable step rows

**Out of scope:**
- WebSocket / SSE streaming (polling at 2s is sufficient)
- Per-collector step breakdown within the Collect stage
- Retention policy for `cron_steps` rows (no cleanup needed at current volume)

## Testing

- Unit: `runCronJob` with a mock `ICronLogRepo` — verify `upsertCronStep` is called with correct args for each stage, including error paths
- Integration: existing `d1-repo.test.ts` — add `cron_steps` upsert and fetch cases
- Manual: trigger a sync from the dashboard, watch banner advance through stages, open drawer and verify step breakdown
