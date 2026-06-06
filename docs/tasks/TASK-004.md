## TASK-004: improve scoring: embedding clustering to replace flat LLM scoring
**Meta:** P2 | S | READY | Focus:yes | 2-code-generation | claude-code | src/main/infrastructure/worker/application/score.ts
**Actor:** unknown
**Created-at:** 2026-06-06T10:17:39.122Z
**Depends:** none

### Acceptance Criteria

- [ ] Signals with semantic similarity > 0.85 are grouped into clusters before scoring
  - `prose: 3 signals about "slow database queries" cluster together`
- [ ] Cluster score aggregates friction analysis across all signals in the cluster
  - `prose: cluster score reflects combined signal intensity`
- [ ] LLM call count per govern run reduced vs current flat scoring
  - `prose: fewer LLM calls per cron run with same or more signals`
- [ ] npm test passes
  - `cmd: npm test; exit: 0`

### Definition of Done
- [ ] All ACs checked by Auditor
- [ ] `arch review` passes