## TASK-003: StackOverflow collector via Stack Exchange API
**Meta:** P2 | S | IN_PROGRESS | Focus:yes | 2-code-generation | claude-code | src/main/infrastructure/worker/infrastructure/collectors/stackoverflow.ts
**Actor:** unknown
**Locked-commit:** 61d99de48cb0428615eaf9a8d334fc7ec3ec992c
**Created-at:** 2026-06-06T10:17:38.986Z
**Depends:** none

### Acceptance Criteria

- [ ] `stackoverflow.ts` collector fetches questions with 0 answers from target tags (configurable)
  - `file: src/main/infrastructure/worker/infrastructure/collectors/stackoverflow.ts`
- [ ] Collector maps questions to Signal format (title → description, vote_count → frequency, 0 answers → pain signal)
  - `prose: Signal objects produced match existing Signal type`
- [ ] Collector wired into cron pipeline alongside github.ts and reddit.ts
  - `prose: stackoverflow collector runs on cron alongside other collectors`
- [ ] npm test passes
  - `cmd: npm test; exit: 0`

### Definition of Done
- [ ] All ACs checked by Auditor
- [ ] `arch review` passes