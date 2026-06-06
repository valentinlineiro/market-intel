## TASK-001: Complete your first governed task
**Meta:** P1 | S | DONE | Focus:no | 2-code-generation | claude-code | docs/tasks/
**Turns:** 0
**Closed-at:** 2026-06-06T18:04:48.147Z
**Actor:** unknown
**Locked-commit:** e345b05
**Created-at:** 2026-06-06T18:04:40.528Z

**Depends:** none

### Context

Welcome to ARCH. This task walks you through the full governed lifecycle.

1. **Start:** Run `arch task start TASK-001` — sets status to IN_PROGRESS and commits.
2. **Implement:** Make any change to your project. Check it with `arch review`.
3. **Finish:** Run `arch task done TASK-001` (after review predicates pass).

### Acceptance Criteria

- [x] You have run `arch task start TASK-001` and the Meta line shows IN_PROGRESS
  - `prose: Meta line shows IN_PROGRESS`

- [x] `arch review` passes with no blocking errors
  - `cmd: arch review`

- [x] You have run `arch task done TASK-001` to complete the lifecycle
  - `prose: task archived to docs/archive/`

### Definition of Done
- [x] All ACs checked by Auditor
- [x] `arch review` passes

## Hansei
**Severity:** H0
**Category:** [no-issue]
**Decision:** Starter task — no implementation performed.
**Constraint:** None.
**Cost:** None.
**Forward Action:** None required.

## Hansei
**Severity:** H0
**Category:** [SpecDrift]
**Decision:** Bootstrap complete. ARCH governance adopted on market-intel — brownfield, minimal profile. 5 tasks captured from evolution plan. git hooks installed. First governed commit pushed.
**Constraint:** Pre-ARCH commit history has no TASK-IDs — brownfield expected state.
**Cost:** None.
**Forward Action:** Configure git hooksPath (TASK-005) to activate pre-commit enforcement.
