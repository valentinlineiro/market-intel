# Collector Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each cron run, persist per-collector signal counts and errors to D1 and surface them on the `/health` endpoint.

**Architecture:** `runCollect` is extended to return `{ signals, stats }` where `stats` is one `CollectorStat` per collector (count + optional error). The cron handler writes these stats to a new `collector_health` D1 table via `D1Repo.upsertHealth`. The `/health` endpoint reads the table and returns a `last_runs` map — one entry per collector ID.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), Vitest.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/0009_add_collector_health.sql` | **Create** | New D1 table |
| `domain/types.ts` | Modify | Add `CollectorStat` interface |
| `application/ports.ts` | Modify | Add `ICollectorHealthRepo` interface |
| `application/collect.ts` | Modify | Return `{ signals, stats }` instead of `Signal[]` |
| `test/unit/collect.test.ts` | Modify | Destructure new return value; add throwing-collector test |
| `infrastructure/db/d1-repo.ts` | Modify | Implement `upsertHealth` + `getCollectorHealth`; add to `implements` clause |
| `index.ts` | Modify | Destructure `runCollect` return; write health after collect; extend `/health` response |

Base path for all files: `src/main/infrastructure/worker/`

---

## Task 1: Migration + types + port

**Files:**
- Create: `src/main/infrastructure/worker/migrations/0009_add_collector_health.sql`
- Modify: `src/main/infrastructure/worker/domain/types.ts`
- Modify: `src/main/infrastructure/worker/application/ports.ts`

- [ ] **Step 1: Create the migration**

```sql
-- src/main/infrastructure/worker/migrations/0009_add_collector_health.sql
CREATE TABLE collector_health (
  collector_id  TEXT PRIMARY KEY,
  last_run_at   TEXT NOT NULL,
  signal_count  INTEGER NOT NULL,
  error         TEXT
);
```

- [ ] **Step 2: Add `CollectorStat` to types.ts**

Open `src/main/infrastructure/worker/domain/types.ts`. Add after the `SignalSource` type (near the top of the file):

```typescript
export interface CollectorStat {
  id:     string;
  count:  number;
  error?: string;
}
```

- [ ] **Step 3: Add `ICollectorHealthRepo` to ports.ts**

Open `src/main/infrastructure/worker/application/ports.ts`. Add this import at the top (alongside the existing `Signal` import):

```typescript
import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig, GnewsSegmentConfig, MarketTest, MarketTestResult, FrictionProfile, CollectorStat } from '../domain/types.js';
```

Then add the new interface at the end of the file (after the `Collector` interface):

```typescript
export interface ICollectorHealthRepo {
  upsertHealth(stat: CollectorStat, runAt: string): Promise<void>;
  getCollectorHealth(): Promise<Array<{
    collector_id:  string;
    last_run_at:   string;
    signal_count:  number;
    error:         string | null;
  }>>;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd /home/valentin/code/market-intel && npm test 2>&1 | tail -5
```

Expected: `Tests  127 passed` — type-only changes, no behavior changed.

- [ ] **Step 5: Commit**

```bash
cd /home/valentin/code/market-intel && git add \
  src/main/infrastructure/worker/migrations/0009_add_collector_health.sql \
  src/main/infrastructure/worker/domain/types.ts \
  src/main/infrastructure/worker/application/ports.ts && \
git commit -m "$(cat <<'EOF'
feat: CollectorStat type + ICollectorHealthRepo port + collector_health migration

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `runCollect` returns `{ signals, stats }`

**Files:**
- Modify: `src/main/infrastructure/worker/test/unit/collect.test.ts`
- Modify: `src/main/infrastructure/worker/application/collect.ts`

- [ ] **Step 1: Update collect.test.ts**

Replace the entire file with:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runCollect } from '../../application/collect.js';
import type { ISignalRepo, Collector } from '../../application/ports.js';
import type { Signal } from '../../domain/types.js';

function makeSignal(id: string): Signal {
  return {
    id,
    source:          'gnews',
    collected_at:    new Date().toISOString(),
    segment:         'test',
    location:        null,
    raw_text:        'text',
    url:             `https://example.com/${id}`,
    pain_keywords:   [],
    sentiment_score: null,
    salary_mean:     null,
    income_tier:     null,
    signal_strength: 0.5,
    has_deadline:    false,
  };
}

function makeRepo(saveResult = true): ISignalRepo {
  return {
    save:           vi.fn().mockResolvedValue(saveResult),
    get:            vi.fn().mockResolvedValue([]),
    getAll:         vi.fn().mockResolvedValue([]),
    count:          vi.fn().mockResolvedValue(0),
    updateFriction: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCollector(id: string, signals: Signal[]): Collector {
  return { id, collect: async () => signals };
}

describe('runCollect', () => {
  it('returns all newly saved signals from all collectors', async () => {
    const s1 = makeSignal('a');
    const s2 = makeSignal('b');
    const repo = makeRepo(true);

    const { signals } = await runCollect(repo, [
      makeCollector('c1', [s1]),
      makeCollector('c2', [s2]),
    ]);

    expect(signals).toHaveLength(2);
    expect(signals).toContain(s1);
    expect(signals).toContain(s2);
  });

  it('excludes duplicate signals when repo.save returns false', async () => {
    const s1 = makeSignal('a');
    const repo = makeRepo(false);

    const { signals } = await runCollect(repo, [makeCollector('c1', [s1])]);

    expect(signals).toHaveLength(0);
  });

  it('returns empty array when no collectors produce signals', async () => {
    const repo = makeRepo(true);
    const { signals } = await runCollect(repo, [makeCollector('c1', [])]);
    expect(signals).toHaveLength(0);
  });

  it('returns one stat per collector', async () => {
    const repo = makeRepo(true);
    const { stats } = await runCollect(repo, [
      makeCollector('c1', [makeSignal('a')]),
      makeCollector('c2', [makeSignal('b'), makeSignal('c')]),
    ]);
    expect(stats).toHaveLength(2);
    expect(stats.find(s => s.id === 'c1')!.count).toBe(1);
    expect(stats.find(s => s.id === 'c2')!.count).toBe(2);
  });

  it('stat error is set and other collectors still run when a collector throws', async () => {
    const repo = makeRepo(true);
    const goodSignal = makeSignal('a');
    const thrower: Collector = {
      id: 'bad',
      collect: async () => { throw new Error('API down'); },
    };
    const good: Collector = { id: 'good', collect: async () => [goodSignal] };

    const { signals, stats } = await runCollect(repo, [thrower, good]);

    expect(signals).toHaveLength(1);
    const badStat = stats.find(s => s.id === 'bad')!;
    expect(badStat.count).toBe(0);
    expect(badStat.error).toContain('API down');
    const goodStat = stats.find(s => s.id === 'good')!;
    expect(goodStat.count).toBe(1);
    expect(goodStat.error).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /home/valentin/code/market-intel && npm test -- --reporter=verbose 2>&1 | grep -E "(collect|FAIL)" | head -20
```

Expected: the 3 existing tests fail because `runCollect` still returns `Signal[]` (not `{ signals, stats }`).

- [ ] **Step 3: Update collect.ts**

Replace the entire file with:

```typescript
import type { ISignalRepo, Collector } from './ports.js';
import type { Signal, CollectorStat } from '../domain/types.js';

export async function runCollect(
  repo: ISignalRepo,
  collectors: Collector[],
): Promise<{ signals: Signal[]; stats: CollectorStat[] }> {
  const saved: Signal[] = [];
  const stats: CollectorStat[] = [];

  for (const collector of collectors) {
    try {
      const collected = await collector.collect();
      for (const signal of collected) {
        const isNew = await repo.save(signal);
        if (isNew) saved.push(signal);
      }
      stats.push({ id: collector.id, count: collected.length });
    } catch (e) {
      stats.push({
        id:    collector.id,
        count: 0,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  return { signals: saved, stats };
}
```

Note: `count` is the number of signals returned by the collector (pre-dedup), not the number saved. This is the right diagnostic — it tells you if a source is live regardless of how many signals were already in D1.

- [ ] **Step 4: Fix market-test.ts if it calls runCollect**

Check if anything outside `index.ts` calls `runCollect`:

```bash
cd /home/valentin/code/market-intel && grep -rn "runCollect" src/ --include="*.ts"
```

For each call site outside `index.ts` and `collect.ts`, destructure `{ signals }` from the result. If `index.ts` is the only other caller, it will be fixed in Task 3.

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /home/valentin/code/market-intel && npm test 2>&1 | tail -5
```

Expected: `Tests  129 passed` (127 existing + 2 new collect tests). If `index.ts` has a TypeScript error from the old `runCollect` return type, it will show as a compile error — fix by destructuring in `index.ts` now or confirm it's covered in Task 3.

- [ ] **Step 6: Commit**

```bash
cd /home/valentin/code/market-intel && git add \
  src/main/infrastructure/worker/application/collect.ts \
  src/main/infrastructure/worker/test/unit/collect.test.ts && \
git commit -m "$(cat <<'EOF'
feat: runCollect returns { signals, stats } — per-collector counts and errors

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: D1Repo health methods + cron wiring + `/health` extension

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`
- Modify: `src/main/infrastructure/worker/index.ts`

- [ ] **Step 1: Read d1-repo.ts to understand the class structure**

Read `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts` (546 lines). Note:
- Line 93: `export class D1Repo implements ISignalRepo, IOpportunityRepo, ILeadRepo, IDiscoveryRepo, IMarketTestRepo`
- Line 94: `constructor(private readonly db: D1Database) {}`
- The last method ends around line 546.

- [ ] **Step 2: Add `ICollectorHealthRepo` to D1Repo's implements clause and imports**

In `d1-repo.ts`, update the import from `ports.ts` to include `ICollectorHealthRepo`:

```typescript
import type {
  ISignalRepo,
  IOpportunityRepo,
  ILeadRepo,
  IDiscoveryRepo,
  IMarketTestRepo,
  ICollectorHealthRepo,
} from '../../application/ports.js';
```

Add `CollectorStat` to the import from `types.ts`:

```typescript
import type {
  Signal,
  Opportunity,
  Lead,
  DiscoveryCandidate,
  SegmentConfig,
  ScoreBreakdown,
  OpportunityStatus,
  GnewsSegmentConfig,
  MarketTest,
  MarketTestResult,
  FrictionProfile,
  CollectorStat,
} from '../../domain/types.js';
```

Change the class declaration line to:

```typescript
export class D1Repo implements ISignalRepo, IOpportunityRepo, ILeadRepo, IDiscoveryRepo, IMarketTestRepo, ICollectorHealthRepo {
```

- [ ] **Step 3: Add `upsertHealth` and `getCollectorHealth` to D1Repo**

Append these two methods at the end of the `D1Repo` class (just before the closing `}`):

```typescript
  // ── ICollectorHealthRepo ─────────────────────────────────────────────────

  async upsertHealth(stat: CollectorStat, runAt: string): Promise<void> {
    await this.db
      .prepare(
        'INSERT OR REPLACE INTO collector_health (collector_id, last_run_at, signal_count, error) VALUES (?, ?, ?, ?)'
      )
      .bind(stat.id, runAt, stat.count, stat.error ?? null)
      .run();
  }

  async getCollectorHealth(): Promise<Array<{
    collector_id:  string;
    last_run_at:   string;
    signal_count:  number;
    error:         string | null;
  }>> {
    const result = await this.db
      .prepare('SELECT collector_id, last_run_at, signal_count, error FROM collector_health ORDER BY collector_id')
      .all<{ collector_id: string; last_run_at: string; signal_count: number; error: string | null }>();
    return result.results;
  }
```

- [ ] **Step 4: Update the cron handler in index.ts**

Read `index.ts` around line 418–440 (the `scheduled` handler). Change:

```typescript
    // Collect
    const collectors = buildRegistry(cfg, env);
    const fresh = await runCollect(d1repo, collectors);
    await analyzeFriction(fresh, llm, d1repo);
```

To:

```typescript
    // Collect
    const collectors = buildRegistry(cfg, env);
    const { signals: fresh, stats } = await runCollect(d1repo, collectors);
    const runAt = new Date().toISOString();
    for (const stat of stats) {
      try { await d1repo.upsertHealth(stat, runAt); } catch { /* non-fatal */ }
    }
    await analyzeFriction(fresh, llm, d1repo);
```

- [ ] **Step 5: Extend the `/health` endpoint in index.ts**

Find (around line 144):

```typescript
    if (path === '/health' && method === 'GET')
      return json({ status: 'ok', ts: new Date().toISOString() });
```

Replace with:

```typescript
    if (path === '/health' && method === 'GET') {
      const healthRepo = new D1Repo(env.DB);
      let last_runs: Record<string, { last_run_at: string; signal_count: number; error: string | null }> = {};
      try {
        const rows = await healthRepo.getCollectorHealth();
        for (const row of rows) {
          last_runs[row.collector_id] = {
            last_run_at:   row.last_run_at,
            signal_count:  row.signal_count,
            error:         row.error,
          };
        }
      } catch { /* return empty last_runs on D1 error */ }
      return json({ status: 'ok', ts: new Date().toISOString(), last_runs });
    }
```

- [ ] **Step 6: Apply the migration locally**

```bash
cd /home/valentin/code/market-intel && npx wrangler d1 execute market-intel-db \
  --local \
  --file src/main/infrastructure/worker/migrations/0009_add_collector_health.sql \
  --config src/main/infrastructure/worker/wrangler.toml
```

Expected: `✅ Applied 0009_add_collector_health.sql`

- [ ] **Step 7: Run full test suite**

```bash
cd /home/valentin/code/market-intel && npm test 2>&1 | tail -5
```

Expected: `Tests  129 passed` (no regressions).

- [ ] **Step 8: Commit**

```bash
cd /home/valentin/code/market-intel && git add \
  src/main/infrastructure/worker/infrastructure/db/d1-repo.ts \
  src/main/infrastructure/worker/index.ts && \
git commit -m "$(cat <<'EOF'
feat: collector health dashboard — upsert health per cron run, /health returns last_runs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Deploy

- [ ] **Step 1: Run final test suite**

```bash
cd /home/valentin/code/market-intel && npm test 2>&1 | tail -5
```

Expected: `Tests  129 passed`

- [ ] **Step 2: Apply migration to production D1**

```bash
cd /home/valentin/code/market-intel && npx wrangler d1 execute market-intel-db \
  --remote \
  --file src/main/infrastructure/worker/migrations/0009_add_collector_health.sql \
  --config src/main/infrastructure/worker/wrangler.toml
```

Expected: `✅ Applied 0009_add_collector_health.sql`

- [ ] **Step 3: Push and deploy**

```bash
cd /home/valentin/code/market-intel && git push && \
  npx wrangler deploy --config src/main/infrastructure/worker/wrangler.toml
```

Expected: new version hash in the deploy output.

- [ ] **Step 4: Verify `/health` before the first cron run**

```bash
curl https://<your-worker-domain>/health | jq .
```

Expected:
```json
{ "status": "ok", "ts": "...", "last_runs": {} }
```

`last_runs` is empty until the first cron run writes to the table.

- [ ] **Step 5: Verify after the first cron run**

After the next scheduled cron fires, check again:

```bash
curl https://<your-worker-domain>/health | jq .last_runs
```

Expected: one entry per collector with `last_run_at`, `signal_count`, and `error: null` (or an error message if a collector failed).

---

## Self-Review

**Spec coverage:**
- ✅ `collector_health` table — Task 1
- ✅ `CollectorStat` type — Task 1
- ✅ `ICollectorHealthRepo` port — Task 1
- ✅ `runCollect` returns `{ signals, stats }` — Task 2
- ✅ Throwing collector: stat with error, others continue — Task 2 (test + impl)
- ✅ `upsertHealth` via `INSERT OR REPLACE` — Task 3
- ✅ `runAt` set at cron handler, not inside repo — Task 3 (all collectors share same timestamp)
- ✅ `upsertHealth` errors are non-fatal — Task 3 (try/catch around each call)
- ✅ `/health` returns `last_runs`, empty `{}` on D1 error — Task 3
- ✅ `/debug/collect-all` unchanged — not touched in any task
- ✅ Migration applied to prod — Task 4

**Type consistency:**
- `CollectorStat.id` used in `runCollect`, `upsertHealth`, `stats` array — consistent ✅
- `ICollectorHealthRepo.upsertHealth(stat, runAt)` matches `d1repo.upsertHealth(stat, runAt)` in cron — consistent ✅
- `getCollectorHealth()` return shape matches what the `/health` handler reads — consistent ✅
