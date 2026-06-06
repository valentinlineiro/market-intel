# TASK-FORMAT
<!-- Authoritative task meta line format -->

## Meta Line Format
```
**Meta:** <Priority> | <Size> | <Status> | Focus:<yes|no> | <task-class> | <provider> | <paths>
```

### Priority
- `P0` — Critical / blocking
- `P1` — High
- `P2` — Normal
- `P3` — Low / nice-to-have

### Size
- `XS` — < 1 hour
- `S` — 1–4 hours
- `M` — 1–2 days
- `L` — 3–5 days (decompose if XL)

### Status
- `READY` — Available for selection
- `IN_PROGRESS` — Being implemented (must have lock)
- `REVIEW` — Awaiting Auditor
- `DONE` — Verified (Auditor only)
- `BLOCKED` — Waiting on dependency

### Task Classes
- `1-code-reasoning` — Architecture, ADRs, complex debugging
- `2-code-generation` — Boilerplate, CRUD, standard endpoints
- `3-code-context` — Cross-repo refactors, large context analysis
- `6-writing` — Docs, ADRs, proposals
- `7-operations` — ETL, pipelines, config
- `8-strategy` — Trade-offs, retrospectives

## Full Task Template
```markdown
## TASK-XXX: <title>
**Meta:** P1 | M | READY | Focus:no | 1-code-reasoning | claude-code | src/

**Depends:** (none)

### Acceptance Criteria
- [ ] AC 1
  - `cmd: npm test`
- [ ] AC 2
  - `file: src/feature.ts`

### Definition of Done
- [ ] All ACs checked by Auditor
- [ ] `arch review` passes

## Hansei
**Severity:** H0
**Category:** [no-issue]
**Decision:** Straightforward implementation, no deviations.
**Constraint:** None.
**Cost:** None.
**Forward Action:** None required.
```

## Hansei Severity Levels
- `H0` — No issue, happy path
- `H1` — Minor deviation, no action needed
- `H2` — Pattern worth tracking (link IDEA in Forward Action)
- `H3a` — Task must be rejected and reworked before closing
- `H3b` — Systemic risk, requires expiry resource and owner
