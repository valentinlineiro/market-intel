## TASK-002: hot sectors: discovery_candidates table, Worker endpoints, dashboard section
**Meta:** P1 | M | READY | Focus:yes | 2-code-generation | claude-code | schema.sql, src/main/infrastructure/worker/index.ts, src/main/infrastructure/pages/index.html
**Actor:** unknown
**Created-at:** 2026-06-06T10:17:34.894Z
**Depends:** none

### Acceptance Criteria

- [ ] `discovery_candidates` table added to schema.sql with columns: id, sector, signals, score, source, created_at
  - `file: schema.sql`
- [ ] Worker exposes `GET /public/discovery` returning latest discovery candidates from D1
  - `prose: curl /public/discovery returns JSON array`
- [ ] Worker exposes `POST /discover` triggering a lightweight Reddit+LLM sweep
  - `prose: POST /discover returns 200 with discovery results`
- [ ] Worker exposes `POST /discovery/candidates` receiving results from Python pipeline
  - `prose: POST /discovery/candidates accepts JSON body and persists to D1`
- [ ] Dashboard index.html has a Hot Sectors section reading from /public/discovery
  - `file: src/main/infrastructure/pages/index.html`
- [ ] npm test passes
  - `cmd: npm test; exit: 0`

### Definition of Done
- [ ] All ACs checked by Auditor
- [ ] `arch review` passes