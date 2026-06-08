# Collector Health Dashboard

**Date:** 2026-06-08
**Status:** Approved
**Scope:** D1 health table written by cron, `/health` endpoint extended with per-collector last-run data.

---

## Problem

The pipeline now runs 8 collectors on every cron tick but there is no way to tell which ones are producing signals in production. `/debug/collect-all` gives an inline snapshot but uses a hardcoded test config and writes nothing — a rerun gives a fresh snapshot with no history. After a real cron run the only observable output is the total signal count; per-source breakdown is invisible.

---

## Design

### New D1 table

Migration `0009_add_collector_health.sql`:

```sql
CREATE TABLE collector_health (
  collector_id  TEXT PRIMARY KEY,
  last_run_at   TEXT NOT NULL,
  signal_count  INTEGER NOT NULL,
  error         TEXT
);
```

One row per collector ID, updated on every cron run via `INSERT OR REPLACE`.

---

### `CollectorStat` type

Added to `domain/types.ts`:

```ts
export interface CollectorStat {
  id:    string;
  count: number;
  error?: string;
}
```

---

### Port

Added to `application/ports.ts`:

```ts
export interface ICollectorHealthRepo {
  upsertHealth(stat: CollectorStat, runAt: string): Promise<void>;
}
```

`runAt` is passed by the caller (cron handler) as `new Date().toISOString()` captured at collect-completion time, not at D1 write time.

`D1Repo` implements `ICollectorHealthRepo` via `INSERT OR REPLACE INTO collector_health`.

---

### `runCollect` return type

Changed from `Promise<Signal[]>` to:

```ts
Promise<{ signals: Signal[]; stats: CollectorStat[] }>
```

`runCollect` catches per-collector errors internally — a throwing collector produces `{ id, count: 0, error: message }` in stats and does not abort the rest. `collect.test.ts` updated to destructure `{ signals }`.

---

### Cron handler

```ts
const { signals: fresh, stats } = await runCollect(d1repo, collectors);
const runAt = new Date().toISOString();
for (const stat of stats) await d1repo.upsertHealth(stat, runAt);
await analyzeFriction(fresh, llm, d1repo);
```

`runAt` is captured once after `runCollect` completes so all collectors in a single cron run share the same timestamp.

---

### `/health` endpoint

Existing response extended with `last_runs`:

```json
{
  "status": "ok",
  "last_runs": {
    "gnews":        { "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 77, "error": null },
    "local_news":   { "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 3,  "error": null },
    "github":       { "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 27, "error": null },
    "stackoverflow":{ "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 0,  "error": null },
    "reddit":       { "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 0,  "error": null },
    "bluesky":      { "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 0,  "error": null },
    "mastodon":     { "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 0,  "error": null },
    "youtube":      { "last_run_at": "2026-06-08T10:00:00Z", "signal_count": 0,  "error": null }
  }
}
```

If the table is empty (before first cron run), `last_runs` is `{}`.

`/debug/collect-all` is **unchanged** — stateless, no writes.

---

## File map

| File | Action |
|------|--------|
| `migrations/0009_add_collector_health.sql` | **Create** |
| `domain/types.ts` | Modify — add `CollectorStat` |
| `application/ports.ts` | Modify — add `ICollectorHealthRepo` |
| `application/collect.ts` | Modify — return `{ signals, stats }` |
| `infrastructure/db/d1-repo.ts` | Modify — implement `upsertHealth` |
| `index.ts` | Modify — destructure return, write health, extend `/health` |
| `test/unit/collect.test.ts` | Modify — destructure `{ signals }` |

---

## Error handling

- A collector that throws: `runCollect` catches, stores `error: message.slice(0, 200)` in the stat, continues with remaining collectors.
- `upsertHealth` failure: non-fatal — log to console, do not abort the cron run.
- `/health` D1 read failure: return `{ status: "ok", last_runs: {} }` rather than a 500.

---

## Testing

- `collect.test.ts`: update return-value assertions to destructure `{ signals }`. Add one test: a collector that throws produces a stat with `count: 0` and a non-empty `error`, and does not prevent other collectors from running.
- `d1-repo` unit: not tested (D1 integration tested in prod). No new unit test needed for `upsertHealth`.
- `/health` response shape: existing health test (if any) updated to expect `last_runs` key.

---

## Out of scope

- Historical run log (more than the latest row per collector) — one row per source is sufficient for diagnosis.
- Per-segment breakdown — source-level granularity is the right first cut.
- `/debug/collect-all` writing to D1 — stateless by design.
