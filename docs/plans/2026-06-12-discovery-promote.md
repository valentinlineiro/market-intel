# Implementation Plan — Discovery Candidate Promote
_2026-06-12_

This plan outlines the changes required to implement the promotion of discovery candidates to active segments, with immediate focused background syncs.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts` | Export `profileToSlug` helper function. |
| Modify | `src/main/infrastructure/worker/index.ts` | Implement `POST /discovery/promote` endpoint and the `runFocusedSync` helper. |
| Modify | `src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte` | Add the "Promover" button, slug derivation matching the backend, local state machine, and custom event dispatching. |
| Modify | `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte` | Bind `activeSegments` prop to `SectorsGrid` and handle the `on:promoted` event to trigger polling. |

---

## Tasks

### Task 1: Export `profileToSlug` from `d1-repo.ts`
- **File:** [d1-repo.ts](file:///home/valentin/code/market-intel/src/main/infrastructure/worker/infrastructure/db/d1-repo.ts)
- [ ] Export the existing `profileToSlug` helper so it can be imported and reused in `index.ts`.
  ```typescript
  export function profileToSlug(profile: string): string { ... }
  ```

### Task 2: Implement Worker Promote Endpoint & Focused Sync Helper
- **File:** [index.ts](file:///home/valentin/code/market-intel/src/main/infrastructure/worker/index.ts)
- [ ] Import `profileToSlug` from `./infrastructure/db/d1-repo.js`.
- [ ] Implement `POST /discovery/promote` handler in `fetch` method:
  - Verify auth token using `Authorization: Bearer <WORKER_SECRET>`.
  - Parse request JSON containing `profile`, `keywords`, `income_est`, `has_deadline`.
  - Derivate segment slug using `profileToSlug(profile)`.
  - Validate if the segment already exists in `config.segments` (using `getConfig(env.DB)`). If it does, return `409 Conflict` with `{ ok: false, error: 'already_active' }`.
  - Perform LLM call using `makeLlm(cfg.llm, env)` to generate GNews query strings. On failure, fall back to `[`${profile} problema`, `${profile} España`]`.
  - Add the new segment to config using `setConfig` and call `invalidateCache()`.
  - Run background task: `ctx.waitUntil(runFocusedSync(env, slug))`.
  - Return `{ ok: true, segment: slug, run_id: runId }`.
- [ ] Implement the `runFocusedSync(env: Env, segmentKey: string): Promise<void>` helper function:
  - Generate a new `runId` UUID.
  - Insert a `cron_log` row: `insertCronRun({ id: runId, started_at: new Date().toISOString(), trigger: 'manual', ... })`.
  - Retrieve the segment config: `const seg = cfg.segments[segmentKey]`.
  - Build a temporary focused configuration containing only this segment.
  - Instantiate collectors via `buildRegistry(focusedConfig, env, [])`.
  - Call `runCollect(d1repo, collectors)` to fetch new signals.
  - If new signals are gathered, call `analyzeFriction(freshSignals, llm, d1repo, 0.85, cfg.friction?.min_strength ?? 0)` to enrich them.
  - Call `runScore(...)` with a custom `discovery` repository override whose `getSegmentsToScore` returns only this single segment config, to immediately compute and persist its `Opportunity` row.
  - Complete the run by calling `finishCronRun(runId, { fresh_signals, analyzed_signals, opps_updated: 1 })`. Wrap in try/catch to capture errors in `finishCronRun` error field.

### Task 3: Update `SectorsGrid.svelte` UI
- **File:** [SectorsGrid.svelte](file:///home/valentin/code/market-intel/src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte)
- [ ] Accept `activeSegments` object prop (defaulting to `{}`).
- [ ] Add the `toSlug` helper matching the backend implementation:
  ```typescript
  function toSlug(profile: string): string {
    return profile
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }
  ```
- [ ] Declare card states: `let states: Record<string, 'idle' | 'loading' | 'promoted' | 'error'> = {};`.
- [ ] Implement `promote(c)` function that makes a POST request to `/api/discovery/promote`, updates the local card state, and dispatches the `promoted` custom event with `{ run_id }`.
- [ ] Render card actions based on states:
  - If `activeSegments[toSlug(c.profile)]` exists, display green badge `"Activo"`.
  - If state is `'loading'`, show loader and `"Promoviendo..."`.
  - If state is `'promoted'`, show badge `"Activo · sync iniciado"`.
  - If state is `'error'`, show button and a red error line/text under the card.
  - Otherwise, show the `"Promover →"` button.

### Task 4: Connect Promotion to Sync Toast in `+page.svelte`
- **File:** [+page.svelte](file:///home/valentin/code/market-intel/src/main/infrastructure/pages/src/routes/dashboard/%2Bpage.svelte)
- [ ] Pass `activeSegments={data.config?.segments ?? {}}` to `<SectorsGrid>`.
- [ ] Handle `on:promoted` custom event from `<SectorsGrid>`:
  - Set `syncRunId = event.detail.run_id`.
  - Set `syncRunning = true`.
  - Call `pollSync()` to poll the worker's status until completion. This will automatically update the UI toast and invalidate page data on completion, rendering the card as permanently active.

---

## Verification

### Unit and Integration Tests
- Run `npm test` to verify no existing tests are broken.
- Add unit/integration tests for the new promote flow if applicable.

### Manual Verification
1. Start local Pages dev server (`npm run dev` in Pages) and Worker (`wrangler dev` in Worker).
2. Clean database or make sure segments are empty.
3. Generate initial seed.
4. From the "Info" tab, click "Promover →" on any detected Sector candidate card.
5. Verify:
   - Card transitions to "Promoviendo..." and then "Activo · sync iniciado".
   - The sync indicator in the header turns to "en curso".
   - Once completed, a toast notifies about new collected signals, and the card displays a permanent "Activo" badge.
   - The "Oportunidades" tab contains the newly promoted segment with its updated score and pain summary.
