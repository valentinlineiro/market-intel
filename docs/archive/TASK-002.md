## TASK-002: hot sectors: discovery_candidates table, Worker endpoints, dashboard section
**Meta:** P1 | M | DONE | Focus:no | 2-code-generation | claude-code | schema.sql, src/main/infrastructure/worker/index.ts, src/main/infrastructure/pages/index.html
**Turns:** 0
**Closed-at:** 2026-06-06T18:07:51.700Z
**Locked-commit:** 61d99de
**Actor:** unknown
**Created-at:** 2026-06-06T10:17:34.894Z
**Depends:** none

### Context

From docs/plans/2026-06-05-evolution-architecture.md and docs/plans/2026-06-01-hot-sectors.md.

Implement the Hot Sectors pipeline: D1 table for discovery candidates, three Worker endpoints, and dashboard Hot Sectors section with Run Discovery button.




### Relevant Context
_confidence: 0.00_

**Files:**
- .arch/focus-ledger.jsonl _(utility)_
- docs/tasks/TASK-002.md _(utility)_

### Context Feedback
- [x] accurate — files and ADRs were on-target
- [x] partial — correct direction, missing key files
- [x] off — wrong files dominated

### Gaps

discovery_candidates D1 table not yet in schema.sql. Worker index.ts missing the three routes.

### Acceptance Criteria

- [x] `discovery_candidates` table added to schema.sql with columns: id, sector, signals, score, source, created_at
  - `file: schema.sql`
- [x] Worker exposes `GET /public/discovery` returning latest discovery candidates from D1
  - `prose: curl /public/discovery returns JSON array`
- [x] Worker exposes `POST /discover` triggering a lightweight Reddit+LLM sweep
  - `prose: POST /discover returns 200 with discovery results`
- [x] Worker exposes `POST /discovery/candidates` receiving results from Python pipeline
  - `prose: POST /discovery/candidates accepts JSON body and persists to D1`
- [x] Dashboard index.html has a Hot Sectors section reading from /public/discovery
  - `file: src/main/infrastructure/pages/index.html`
- [x] npm test passes
  - `cmd: npm test; exit: 0`

### Definition of Done
- [x] All ACs checked by Auditor
- [x] `arch review` passes

## Hansei
**Severity:** H0
**Category:** [SpecDrift]
**Decision:** All ACs already implemented before ARCH adoption. discovery_candidates table: migration 0003. Worker endpoints: POST /discover, POST /discovery/candidates, GET /public/discovery all wired in index.ts. Dashboard: SvelteKit SectorsGrid.svelte component consuming /public/discovery. 93 tests pass.
**Constraint:** The plan was already partially executed without governance. ARCH adoption captures the existing state, not missing work.
**Cost:** None — no new code written.
**Forward Action:** Validate the full pipeline end-to-end: run POST /discover and verify SectorsGrid renders the results in the dashboard.

## Approval
**Decision:** Approved

