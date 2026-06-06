## TASK-003: StackOverflow collector via Stack Exchange API
**Meta:** P2 | S | DONE | Focus:no | 2-code-generation | claude-code | src/main/infrastructure/worker/infrastructure/collectors/stackoverflow.ts
**Turns:** 3
**Closed-at:** 2026-06-06T18:18:54.443Z
**Actor:** unknown
**Locked-commit:** 61d99de48cb0428615eaf9a8d334fc7ec3ec992c
**Created-at:** 2026-06-06T10:17:38.986Z
**Depends:** none

### Acceptance Criteria

- [x] `stackoverflow.ts` collector fetches questions with 0 answers from target tags (configurable)
  - `file: src/main/infrastructure/worker/infrastructure/collectors/stackoverflow.ts`
- [x] Collector maps questions to Signal format (title → description, vote_count → frequency, 0 answers → pain signal)
  - `prose: Signal objects produced match existing Signal type`
- [x] Collector wired into cron pipeline alongside github.ts and reddit.ts
  - `prose: stackoverflow collector runs on cron alongside other collectors`
- [x] npm test passes
  - `cmd: npm test; exit: 0`

### Definition of Done
- [x] All ACs checked by Auditor
- [x] `arch review` passes

## Hansei
**Severity:** H1
**Category:** [SpecDrift]
**Decision:** StackOverflow collector implemented (stackoverflow.ts) and wired into cron pipeline alongside github, gnews, local_news. collectStackOverflow() fetches unanswered questions (0 answers = strongest pain signal) from Stack Exchange API, filtered by keywords and tags. Mapped to Signal type. soCollector added to runCollect() call in index.ts. npm typecheck passes after fixing import.
**Constraint:** Stack Exchange API has rate limits (300/day unauthenticated). The collector runs on every cron tick. May need API key (stackapps.com) if rate limits become an issue.
**Cost:** No API key needed for public questions. ~50 signals per run depending on keyword matches.
**Forward Action:** Implement IDEA-easy-source-addition — the 5-step wiring process for adding collectors is the exact friction this IDEA addresses. Promote to task when TASK-004 is done.
