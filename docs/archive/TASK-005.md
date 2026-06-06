## TASK-005: brownfield git hooks: configure git hooksPath to activate enforcement
**Meta:** P1 | XS | DONE | Focus:no | 7-operations | local | .githooks/
**Turns:** 0
**Closed-at:** 2026-06-06T18:06:07.950Z
**Locked-commit:** 61d99de
**Actor:** unknown
**Created-at:** 2026-06-06T10:17:39.252Z
**Depends:** none

### Acceptance Criteria

- [x] git config core.hooksPath .githooks configured in repo
  - `cmd: git config core.hooksPath; exit: 0`
- [x] Committing without a TASK-ID is rejected by pre-commit hook
  - `prose: git commit -m "test" fails with TASK-ID required message`

### Definition of Done
- [x] All ACs checked by Auditor
- [x] `arch review` passes

## Hansei
**Severity:** H0
**Category:** [SpecDrift]
**Decision:** git config core.hooksPath .githooks configured. Hook fires on ungoverned commits — rejects without [TASK-ID]. pre-commit hook calls arch --scope which is an unrecognised option and produces a warning but does not block (benign). Enforcement is active.
**Constraint:** Each developer must run git config core.hooksPath .githooks locally — it is not committed to git config. Add to onboarding docs or README.
**Cost:** None.
**Forward Action:** Fix pre-commit hook to remove arch --scope call — unknown option produces noise.
