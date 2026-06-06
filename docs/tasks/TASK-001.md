## TASK-001: Complete your first governed task
**Meta:** P1 | S | READY | Focus:yes | 2-code-generation | claude-code | docs/tasks/

**Depends:** none

### Context

Welcome to ARCH. This task walks you through the full governed lifecycle.

1. **Start:** Run `arch task start TASK-001` — sets status to IN_PROGRESS and commits.
2. **Implement:** Make any change to your project. Check it with `arch review`.
3. **Finish:** Run `arch task done TASK-001` (after review predicates pass).

### Acceptance Criteria

- [ ] You have run `arch task start TASK-001` and the Meta line shows IN_PROGRESS
  - `prose: Meta line shows IN_PROGRESS`

- [ ] `arch review` passes with no blocking errors
  - `cmd: arch review`

- [ ] You have run `arch task done TASK-001` to complete the lifecycle
  - `prose: task archived to docs/archive/`

### Definition of Done
- [ ] All ACs checked by Auditor
- [ ] `arch review` passes

## Hansei
**Severity:** H0
**Category:** [no-issue]
**Decision:** Starter task — no implementation performed.
**Constraint:** None.
**Cost:** None.
**Forward Action:** None required.
