# Market Test Feature — Design Spec

**Date:** 2026-06-05  
**Status:** Approved

## Goal

Validate the core bet: does the pipeline of LLM-generated config → collector execution → scoring produce a score number worth acting on? A single JSON result per test. No landing page generation, no UI work.

---

## Approach

New `application/market-test.ts` use case (Approach A — thin orchestrator). Reuses existing domain scoring functions and `runCollect` unchanged. No modifications to any existing use case.

---

## Execution Model

Async with `ctx.waitUntil`. `POST /market-test` inserts a `pending` row and returns `test_id` immediately. The `waitUntil` callback runs the full pipeline in the background. Client polls `GET /market-test/:id` for status and result.

`waitUntil` has a 30-second post-response limit. Current collectors stay within this. If a slow upstream is ever added, the idempotency guard (see below) means the runner can be safely re-triggered without corrupting state.

---

## Data Model

Migration `0007_add_market_tests.sql`:

```sql
CREATE TABLE market_tests (
  id               TEXT PRIMARY KEY,
  description      TEXT NOT NULL,
  generated_config TEXT,          -- JSON GnewsSegmentConfig; null until LLM call completes
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  result           TEXT,          -- JSON MarketTestResult; null until done
  error            TEXT,          -- error message; null unless failed
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

### `MarketTestResult` (stored in `result` column)

```typescript
interface MarketTestResult {
  score: number;
  breakdown: ScoreBreakdown;
  pain_summary: string;
  signal_count: number;
  signals: Signal[];  // raw collected signals for debugging; no secondary table needed
}
```

Note: `raw_text` on stored signals can be truncated to 200 chars in a future iteration if row size becomes a concern (50 signals × 2000 chars ≈ 100KB, within D1's 1MB limit).

---

## Status Lifecycle & Idempotency

```
POST /market-test
  → INSERT status=pending, return test_id
  → ctx.waitUntil(runner)

runner:
  → UPDATE status=running WHERE id=? AND status='pending'  -- claims the test
  → if 0 rows affected: exit (duplicate invocation guard)
  → LLM generates GnewsSegmentConfig → UPDATE generated_config
  → runCollect with InMemorySignalRepo
  → score with domain functions
  → UPDATE status=done, result=JSON
  → on any throw: UPDATE status=failed, error=message
```

The conditional `WHERE status='pending'` update makes the runner safe to invoke multiple times. A stale `running` row (updated_at > 2 min) is detectable by the existing cron if automatic retry is ever needed. A retry endpoint can reset `running → pending` explicitly.

---

## Signal Isolation

Signals collected during a market test are held in `InMemorySignalRepo`, which implements the existing `ISignalRepo` interface. They are never written to the main `signals` table. The full signal list is stored in `market_tests.result` for debugging. This keeps the production `opportunities` table clean from test noise.

`runCollect` is reused unchanged — the `ISignalRepo` swap is transparent.

---

## LLM Config Generation

The LLM receives the free-text description and returns a `GnewsSegmentConfig`:

```typescript
interface GnewsSegmentConfig {
  label: string;
  queries: string[];      // 3–5 Google News search queries
  keywords: string[];     // 5–10 pain/domain keywords
  salary_mean: number;    // estimated annual salary in EUR
  income_tier: string;    // 'high' | 'medium_high' | 'medium' | 'low'
  has_deadline: boolean;  // regulatory or external deadline exists
}
```

The runner passes `{ "market-test": generatedConfig }` to `collectGnews` — no changes needed to the collector.

Future: hash the description to skip the LLM call on re-submission of identical inputs.

---

## Scoring

The runner calls domain functions directly — not `runScore`, which is coupled to discovery (`getSegmentsToScore`) and notification side effects.

```typescript
const [dolor, painSummary] = dolorScore(signals);
const breakdown: ScoreBreakdown = {
  dolor,
  capacidad_pago: incomeTierScore(generatedConfig.income_tier),
  volumen:        volumeScore(5.0),          // neutral default; no discovery score available
  competencia:    DEFAULT_COMPETENCIA_SCORE, // 5.0, same as production
  urgencia:       urgencyScore(generatedConfig.has_deadline),
};
const score = computeOpportunityScore(breakdown);
```

---

## HTTP API

Both routes are authenticated (existing `WORKER_SECRET` header check).

### `POST /market-test`

Request: `{ description: string }`  
Response: `{ test_id: string }`  
Side effect: inserts `pending` row, fires `ctx.waitUntil`.

### `GET /market-test/:id`

Response:
```typescript
{
  id: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  generated_config: GnewsSegmentConfig | null;
  result: MarketTestResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `migrations/0007_add_market_tests.sql` | New — creates `market_tests` table |
| `domain/types.ts` | Add `MarketTestResult` interface |
| `application/market-test.ts` | New — `runMarketTest` use case |
| `infrastructure/db/d1-repo.ts` | Add 4 `MarketTest` repo methods |
| `application/ports.ts` | Add `IMarketTestRepo` interface |
| `index.ts` | Wire `POST /market-test` + `GET /market-test/:id` routes |

No changes to `runCollect`, `collectGnews`, domain scoring functions, or any existing route.

---

## Out of Scope (this iteration)

- Landing page auto-generation on high score
- Dashboard UI (raw JSON from `GET /market-test/:id` is sufficient)
- Description hashing / LLM call deduplication
- `raw_text` truncation in stored signals
- Automatic retry of stale `running` tests
