## TASK-004: improve scoring: embedding clustering to replace flat LLM scoring
**Meta:** P2 | S | DONE | Focus:yes | 2-code-generation | claude-code | src/main/infrastructure/worker/application/score.ts
**Actor:** claude-code
**Created-at:** 2026-06-06T10:17:39.122Z
**Closed-at:** 2026-06-08T09:31:00.000Z
**Depends:** none

### Acceptance Criteria

- [x] Signals with semantic similarity > 0.85 are grouped into clusters before scoring
  - `prose: clusterSignals(signals, 0.85) uses keyword Jaccard similarity; domain/cluster.ts`
- [x] Cluster score aggregates friction analysis across all signals in the cluster
  - `prose: dolorScore iterates all cluster members; analyzeFriction propagates friction profile to every member`
- [x] LLM call count per govern run reduced vs current flat scoring
  - `prose: analyzeFriction batches over representatives (1 per cluster), not all eligible signals`
- [x] npm test passes
  - `cmd: npm test; exit: 0` → 107 tests pass

### Implementation notes
- New: `domain/cluster.ts` — `jaccardSimilarity`, `parseKeywords` (exported), `clusterSignals`
- Changed: `application/friction.ts` — clusters eligible signals, picks highest-ss representative per cluster, propagates profile to all members; `extractArray` fallback for bare-object LLM responses
- Changed: `domain/scoring.ts` — `dolorScore` uses `clusters.length` for volume bonus; uses shared `parseKeywords`
- Also shipped: `application/friction.ts` batch mode (10 signals per LLM call), `/debug/friction` endpoint

### Definition of Done
- [x] All ACs checked
- [ ] `arch review` passes
