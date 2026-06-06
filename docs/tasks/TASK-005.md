## TASK-005: capture brownfield git hooks: configure git hooksPath to act
**Meta:** P3 | S | IN_PROGRESS | Focus:no | 2-code-generation | local | docs/tasks/
**Actor:** unknown
**Created-at:** 2026-06-06T10:17:39.252Z
**Depends:** none

### Acceptance Criteria
- [ ] Implementation file exists at declared context path
  - `file: (path)`
- [ ] Tests pass
  - `cmd: npm test; exit: 0`
- [ ] `arch review` passes
  - `cmd: node cli/dist/index.js review`

### Context
#### Intent
capture brownfield git hooks: configure git hooksPath to activate pre-commit enforcement

### Definition of Done
- [ ] All ACs checked by Auditor
- [ ] `arch review` passes