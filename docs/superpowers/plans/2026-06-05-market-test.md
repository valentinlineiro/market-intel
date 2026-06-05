# Market Test Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /market-test` + `GET /market-test/:id` to the Cloudflare Worker so a free-text description triggers an async LLM-config-gen → collect → score pipeline, returning a score JSON blob stored in D1.

**Architecture:** New `application/market-test.ts` use case orchestrates three steps: LLM generates a `GnewsSegmentConfig` from the description, an `InMemorySignalRepo` (implements existing `ISignalRepo`) captures signals from the gnews collector without touching the production signals table, and domain scoring functions score those signals directly. The route handler returns `test_id` immediately and fires the pipeline via `ctx.waitUntil`. A conditional `WHERE status = 'pending'` claim guard makes the runner idempotent.

**Tech Stack:** Cloudflare Workers (TypeScript), D1 (SQLite), Vitest (unit + integration via `@cloudflare/vitest-pool-workers`), existing `ILLMProvider` / `ISignalRepo` interfaces.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/main/infrastructure/worker/migrations/0007_add_market_tests.sql` | Create | D1 schema for `market_tests` table |
| `src/main/infrastructure/worker/domain/types.ts` | Modify | Add `MarketTest`, `MarketTestResult` interfaces |
| `src/main/infrastructure/worker/application/ports.ts` | Modify | Add `IMarketTestRepo` interface |
| `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts` | Modify | Implement `IMarketTestRepo` on `D1Repo` |
| `src/main/infrastructure/worker/application/market-test.ts` | Create | `InMemorySignalRepo` + `runMarketTest` use case |
| `src/main/infrastructure/worker/index.ts` | Modify | Add `ctx` param + wire two new routes |
| `src/main/infrastructure/worker/test/unit/market-test.test.ts` | Create | Unit tests for `InMemorySignalRepo` + `runMarketTest` |
| `src/main/infrastructure/worker/test/integration/d1-repo.test.ts` | Modify | Add market test repo integration tests |

---

### Task 1: Migration, domain types, and port interface

**Files:**
- Create: `src/main/infrastructure/worker/migrations/0007_add_market_tests.sql`
- Modify: `src/main/infrastructure/worker/domain/types.ts`
- Modify: `src/main/infrastructure/worker/application/ports.ts`

- [ ] **Step 1: Create the migration file**

```sql
-- src/main/infrastructure/worker/migrations/0007_add_market_tests.sql
CREATE TABLE IF NOT EXISTS market_tests (
  id               TEXT PRIMARY KEY,
  description      TEXT NOT NULL,
  generated_config TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  result           TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

- [ ] **Step 2: Add `MarketTest` and `MarketTestResult` to `domain/types.ts`**

Append to the end of `src/main/infrastructure/worker/domain/types.ts`:

```typescript
export interface MarketTestResult {
  score: number;
  breakdown: ScoreBreakdown;
  pain_summary: string;
  signal_count: number;
  signals: Signal[];
}

export interface MarketTest {
  id: string;
  description: string;
  generated_config: GnewsSegmentConfig | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  result: MarketTestResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Add `IMarketTestRepo` to `application/ports.ts`**

Append to the end of `src/main/infrastructure/worker/application/ports.ts`. Add the import for `GnewsSegmentConfig`, `MarketTest`, `MarketTestResult` to the existing import from `'../domain/types.js'`:

```typescript
// Existing import becomes:
import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig, GnewsSegmentConfig, MarketTest, MarketTestResult } from '../domain/types.js';
```

Then append:

```typescript
export interface IMarketTestRepo {
  createMarketTest(id: string, description: string, now: string): Promise<void>;
  claimMarketTest(id: string, now: string): Promise<boolean>;
  updateMarketTestConfig(id: string, config: GnewsSegmentConfig, now: string): Promise<void>;
  completeMarketTest(id: string, result: MarketTestResult, now: string): Promise<void>;
  failMarketTest(id: string, error: string, now: string): Promise<void>;
  getMarketTest(id: string): Promise<MarketTest | null>;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd src/main/infrastructure/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/migrations/0007_add_market_tests.sql \
        src/main/infrastructure/worker/domain/types.ts \
        src/main/infrastructure/worker/application/ports.ts
git commit -m "feat: add market_tests schema, MarketTest types, and IMarketTestRepo port"
```

---

### Task 2: D1Repo — implement IMarketTestRepo

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`
- Modify: `src/main/infrastructure/worker/test/integration/d1-repo.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Add to the `applyMigrations` function in `src/main/infrastructure/worker/test/integration/d1-repo.test.ts` — append this DDL string to the `ddl` array:

```typescript
`CREATE TABLE IF NOT EXISTS market_tests (id TEXT PRIMARY KEY, description TEXT NOT NULL, generated_config TEXT, status TEXT NOT NULL DEFAULT 'pending', result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
```

Then add this test suite at the end of `d1-repo.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// Market test repo
// ---------------------------------------------------------------------------

describe('D1Repo — market tests', () => {
  it('createMarketTest inserts a pending row', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-1', 'dentists in pain', now);
    const test = await repo.getMarketTest('mt-1');
    expect(test).not.toBeNull();
    expect(test!.id).toBe('mt-1');
    expect(test!.description).toBe('dentists in pain');
    expect(test!.status).toBe('pending');
    expect(test!.generated_config).toBeNull();
    expect(test!.result).toBeNull();
  });

  it('claimMarketTest transitions pending → running and returns true', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-2', 'lawyers', now);
    const claimed = await repo.claimMarketTest('mt-2', now);
    expect(claimed).toBe(true);
    const test = await repo.getMarketTest('mt-2');
    expect(test!.status).toBe('running');
  });

  it('claimMarketTest returns false when status is not pending', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-3', 'architects', now);
    await repo.claimMarketTest('mt-3', now);       // first claim: pending → running
    const second = await repo.claimMarketTest('mt-3', now); // already running
    expect(second).toBe(false);
  });

  it('updateMarketTestConfig stores the generated config JSON', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-4', 'professors', now);
    await repo.claimMarketTest('mt-4', now);
    const config = {
      label: 'Docente universitario',
      queries: ['ANECA acreditación problema'],
      keywords: ['aneca', 'sexenios'],
      salary_mean: 42000,
      income_tier: 'medium_high' as const,
      has_deadline: false,
    };
    await repo.updateMarketTestConfig('mt-4', config, now);
    const test = await repo.getMarketTest('mt-4');
    expect(test!.generated_config).toEqual(config);
  });

  it('completeMarketTest stores result and sets status=done', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-5', 'dentists', now);
    await repo.claimMarketTest('mt-5', now);
    const result = {
      score: 7.5,
      breakdown: { dolor: 8, capacidad_pago: 7, volumen: 5, competencia: 5, urgencia: 10 },
      pain_summary: 'verifactu software pain',
      signal_count: 3,
      signals: [],
    };
    await repo.completeMarketTest('mt-5', result, now);
    const test = await repo.getMarketTest('mt-5');
    expect(test!.status).toBe('done');
    expect(test!.result).toEqual(result);
  });

  it('failMarketTest stores error and sets status=failed', async () => {
    const now = new Date().toISOString();
    await repo.createMarketTest('mt-6', 'architects', now);
    await repo.claimMarketTest('mt-6', now);
    await repo.failMarketTest('mt-6', 'LLM unavailable', now);
    const test = await repo.getMarketTest('mt-6');
    expect(test!.status).toBe('failed');
    expect(test!.error).toBe('LLM unavailable');
  });

  it('getMarketTest returns null for unknown id', async () => {
    const test = await repo.getMarketTest('does-not-exist');
    expect(test).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:integration -- --reporter=verbose 2>&1 | grep -A3 "market tests"
```

Expected: FAIL — `repo.createMarketTest is not a function`.

- [ ] **Step 3: Add `IMarketTestRepo` to D1Repo's import and implements clause**

In `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`, update the import from `'../../application/ports.js'`:

```typescript
import type {
  ISignalRepo,
  IOpportunityRepo,
  ILeadRepo,
  IDiscoveryRepo,
  IMarketTestRepo,
} from '../../application/ports.js';
```

Add `GnewsSegmentConfig`, `MarketTest`, `MarketTestResult` to the import from `'../../domain/types.js'`:

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
} from '../../domain/types.js';
```

Change the class declaration line:

```typescript
export class D1Repo implements ISignalRepo, IOpportunityRepo, ILeadRepo, IDiscoveryRepo, IMarketTestRepo {
```

- [ ] **Step 4: Implement the six IMarketTestRepo methods in D1Repo**

Append these methods inside the `D1Repo` class (before the closing `}`):

```typescript
  async createMarketTest(id: string, description: string, now: string): Promise<void> {
    await this.db
      .prepare(`INSERT INTO market_tests (id, description, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`)
      .bind(id, description, now, now)
      .run();
  }

  async claimMarketTest(id: string, now: string): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE market_tests SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'`)
      .bind(now, id)
      .run();
    return result.meta.changes > 0;
  }

  async updateMarketTestConfig(id: string, config: GnewsSegmentConfig, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE market_tests SET generated_config = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(config), now, id)
      .run();
  }

  async completeMarketTest(id: string, result: MarketTestResult, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE market_tests SET status = 'done', result = ?, updated_at = ? WHERE id = ?`)
      .bind(JSON.stringify(result), now, id)
      .run();
  }

  async failMarketTest(id: string, error: string, now: string): Promise<void> {
    await this.db
      .prepare(`UPDATE market_tests SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
      .bind(error, now, id)
      .run();
  }

  async getMarketTest(id: string): Promise<MarketTest | null> {
    const row = await this.db
      .prepare(`SELECT * FROM market_tests WHERE id = ?`)
      .bind(id)
      .first<{
        id: string; description: string; generated_config: string | null;
        status: string; result: string | null; error: string | null;
        created_at: string; updated_at: string;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      description: row.description,
      generated_config: row.generated_config ? (JSON.parse(row.generated_config) as GnewsSegmentConfig) : null,
      status: row.status as MarketTest['status'],
      result: row.result ? (JSON.parse(row.result) as MarketTestResult) : null,
      error: row.error,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
```

- [ ] **Step 5: Run integration tests to verify they pass**

```bash
npm run test:integration -- --reporter=verbose 2>&1 | grep -A3 "market tests"
```

Expected: all 6 market test cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/db/d1-repo.ts \
        src/main/infrastructure/worker/test/integration/d1-repo.test.ts
git commit -m "feat: implement IMarketTestRepo on D1Repo with integration tests"
```

---

### Task 3: InMemorySignalRepo + runMarketTest use case

**Files:**
- Create: `src/main/infrastructure/worker/application/market-test.ts`
- Create: `src/main/infrastructure/worker/test/unit/market-test.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `src/main/infrastructure/worker/test/unit/market-test.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMarketTest, InMemorySignalRepo } from '../../application/market-test.js';
import type { ILLMProvider, IMarketTestRepo } from '../../application/ports.js';
import type { GnewsSegmentConfig, MarketTest, MarketTestResult, Signal } from '../../domain/types.js';

vi.mock('../../infrastructure/collectors/gnews.js', () => ({
  collectGnews: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:              `sig-${Math.random().toString(36).slice(2, 8)}`,
    source:          'gnews',
    collected_at:    new Date().toISOString(),
    segment:         'market-test',
    location:        null,
    raw_text:        'Software fiscal pain is real and ongoing for professionals',
    url:             `https://example.com/${Math.random()}`,
    pain_keywords:   ['software', 'fiscal'],
    sentiment_score: -0.4,
    salary_mean:     40000,
    income_tier:     'medium',
    signal_strength: 0.6,
    has_deadline:    false,
    ...overrides,
  };
}

const VALID_CONFIG: GnewsSegmentConfig = {
  label: 'Test segment',
  queries: ['test query Spain'],
  keywords: ['test', 'pain', 'software'],
  salary_mean: 40000,
  income_tier: 'medium',
  has_deadline: false,
};

function makeMockLlm(config: GnewsSegmentConfig = VALID_CONFIG): ILLMProvider {
  return { complete: vi.fn().mockResolvedValue(JSON.stringify(config)) };
}

class InMemoryMarketTestRepo implements IMarketTestRepo {
  readonly store = new Map<string, Partial<MarketTest>>();

  async createMarketTest(id: string, description: string, now: string): Promise<void> {
    this.store.set(id, { id, description, status: 'pending', created_at: now, updated_at: now, generated_config: null, result: null, error: null });
  }

  async claimMarketTest(id: string, now: string): Promise<boolean> {
    const t = this.store.get(id);
    if (!t || t.status !== 'pending') return false;
    t.status = 'running';
    t.updated_at = now;
    return true;
  }

  async updateMarketTestConfig(id: string, config: GnewsSegmentConfig, now: string): Promise<void> {
    const t = this.store.get(id)!;
    t.generated_config = config;
    t.updated_at = now;
  }

  async completeMarketTest(id: string, result: MarketTestResult, now: string): Promise<void> {
    const t = this.store.get(id)!;
    t.status = 'done';
    t.result = result;
    t.updated_at = now;
  }

  async failMarketTest(id: string, error: string, now: string): Promise<void> {
    const t = this.store.get(id)!;
    t.status = 'failed';
    t.error = error;
    t.updated_at = now;
  }

  async getMarketTest(id: string): Promise<MarketTest | null> {
    return (this.store.get(id) as MarketTest) ?? null;
  }
}

// ---------------------------------------------------------------------------
// InMemorySignalRepo
// ---------------------------------------------------------------------------

describe('InMemorySignalRepo', () => {
  it('save stores a signal and count increments', async () => {
    const repo = new InMemorySignalRepo();
    expect(await repo.count()).toBe(0);
    const sig = makeSignal();
    await repo.save(sig);
    expect(await repo.count()).toBe(1);
  });

  it('get returns the last N signals', async () => {
    const repo = new InMemorySignalRepo();
    for (let i = 0; i < 5; i++) await repo.save(makeSignal());
    const result = await repo.get('any', 3);
    expect(result).toHaveLength(3);
  });

  it('getAll returns all signals up to limit', async () => {
    const repo = new InMemorySignalRepo();
    for (let i = 0; i < 4; i++) await repo.save(makeSignal());
    expect(await repo.getAll(10)).toHaveLength(4);
    expect(await repo.getAll(2)).toHaveLength(2);
  });

  it('getSignals returns a copy of all stored signals', async () => {
    const repo = new InMemorySignalRepo();
    const sig = makeSignal();
    await repo.save(sig);
    const signals = repo.getSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0].id).toBe(sig.id);
  });
});

// ---------------------------------------------------------------------------
// runMarketTest
// ---------------------------------------------------------------------------

describe('runMarketTest', () => {
  let repo: InMemoryMarketTestRepo;

  beforeEach(() => {
    repo = new InMemoryMarketTestRepo();
    const now = new Date().toISOString();
    repo.store.set('t1', { id: 't1', description: 'dentists in pain', status: 'pending', created_at: now, updated_at: now, generated_config: null, result: null, error: null });
  });

  it('transitions status to done and populates result', async () => {
    await runMarketTest('t1', 'dentists in pain', makeMockLlm(), repo);
    const test = repo.store.get('t1');
    expect(test?.status).toBe('done');
    expect(test?.result).toBeDefined();
    expect(typeof test?.result?.score).toBe('number');
    expect(test?.result?.score).toBeGreaterThanOrEqual(0);
    expect(test?.result?.score).toBeLessThanOrEqual(10);
    expect(test?.generated_config).toEqual(VALID_CONFIG);
  });

  it('exits without mutation if test is already claimed (not pending)', async () => {
    const now = new Date().toISOString();
    repo.store.set('t2', { id: 't2', description: 'lawyers', status: 'running', created_at: now, updated_at: now, generated_config: null, result: null, error: null });
    await runMarketTest('t2', 'lawyers', makeMockLlm(), repo);
    expect(repo.store.get('t2')?.status).toBe('running');
  });

  it('sets status=failed and stores error message when LLM throws', async () => {
    const failLlm: ILLMProvider = { complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')) };
    await runMarketTest('t1', 'dentists in pain', failLlm, repo);
    const test = repo.store.get('t1');
    expect(test?.status).toBe('failed');
    expect(test?.error).toBe('LLM unavailable');
  });

  it('sets status=failed when LLM returns malformed JSON', async () => {
    const badLlm: ILLMProvider = { complete: vi.fn().mockResolvedValue('not json at all') };
    await runMarketTest('t1', 'dentists in pain', badLlm, repo);
    const test = repo.store.get('t1');
    expect(test?.status).toBe('failed');
    expect(test?.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose test/unit/market-test
```

Expected: FAIL — `Cannot find module '../../application/market-test.js'`.

- [ ] **Step 3: Create `application/market-test.ts`**

Create `src/main/infrastructure/worker/application/market-test.ts`:

```typescript
import type { ISignalRepo, ILLMProvider, IMarketTestRepo } from './ports.js';
import type { Signal, GnewsSegmentConfig, MarketTestResult } from '../domain/types.js';
import { collectGnews } from '../infrastructure/collectors/gnews.js';
import { runCollect } from './collect.js';
import {
  dolorScore,
  incomeTierScore,
  volumeScore,
  urgencyScore,
  computeOpportunityScore,
} from '../domain/scoring.js';
import { DEFAULT_COMPETENCIA_SCORE } from '../domain/rules.js';

const CONFIG_PROMPT = `Eres un analista de mercado. A partir de esta descripción, genera una configuración de búsqueda para encontrar señales de dolor en Google News.

Descripción: {description}

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "label": "nombre del segmento profesional",
  "queries": ["3 a 5 queries de búsqueda en español para Google News"],
  "keywords": ["5 a 10 palabras clave de dolor o dominio"],
  "salary_mean": <salario anual medio en EUR, número entero>,
  "income_tier": "high|medium_high|medium|low",
  "has_deadline": <true si existe un deadline regulatorio externo, false si no>
}`;

export class InMemorySignalRepo implements ISignalRepo {
  private readonly signals: Signal[] = [];

  async save(signal: Signal): Promise<boolean> {
    this.signals.push(signal);
    return true;
  }

  async get(_segment: string, limit: number): Promise<Signal[]> {
    return this.signals.slice(-limit);
  }

  async getAll(limit: number): Promise<Signal[]> {
    return this.signals.slice(-limit);
  }

  async count(_segment?: string): Promise<number> {
    return this.signals.length;
  }

  getSignals(): Signal[] {
    return [...this.signals];
  }
}

async function generateSegmentConfig(
  description: string,
  llm: ILLMProvider,
): Promise<GnewsSegmentConfig> {
  const prompt = CONFIG_PROMPT.replace('{description}', description);
  let raw = await llm.complete(prompt, 400);
  raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(raw) as GnewsSegmentConfig;
}

export async function runMarketTest(
  id: string,
  description: string,
  llm: ILLMProvider,
  repo: IMarketTestRepo,
): Promise<void> {
  const now = () => new Date().toISOString();

  const claimed = await repo.claimMarketTest(id, now());
  if (!claimed) return;

  try {
    const config = await generateSegmentConfig(description, llm);
    await repo.updateMarketTestConfig(id, config, now());

    const signalRepo = new InMemorySignalRepo();
    await runCollect(signalRepo, [() => collectGnews({ 'market-test': config }, '')]);

    const signals = signalRepo.getSignals();
    const [dolor, painSummary] = dolorScore(signals);
    const breakdown = {
      dolor,
      capacidad_pago: incomeTierScore(config.income_tier),
      volumen:        volumeScore(5.0),
      competencia:    DEFAULT_COMPETENCIA_SCORE,
      urgencia:       urgencyScore(config.has_deadline),
    };
    const score = computeOpportunityScore(breakdown);

    const result: MarketTestResult = {
      score,
      breakdown,
      pain_summary: painSummary,
      signal_count: signals.length,
      signals,
    };

    await repo.completeMarketTest(id, result, now());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await repo.failMarketTest(id, message, now());
  }
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

```bash
npm test -- --reporter=verbose test/unit/market-test
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/application/market-test.ts \
        src/main/infrastructure/worker/test/unit/market-test.test.ts
git commit -m "feat: add InMemorySignalRepo and runMarketTest use case with unit tests"
```

---

### Task 4: Wire HTTP routes in index.ts

**Files:**
- Modify: `src/main/infrastructure/worker/index.ts`

- [ ] **Step 1: Add the import for `runMarketTest`**

In `src/main/infrastructure/worker/index.ts`, add this import alongside the other application imports (around line 39–42):

```typescript
import { runMarketTest } from './application/market-test.js';
```

- [ ] **Step 2: Add `ctx` to the fetch handler signature and update the doc comment**

Change line 81:
```typescript
// Before:
const handleFetch: ExportedHandler<Env>['fetch'] = async (request, env) => {

// After:
const handleFetch: ExportedHandler<Env>['fetch'] = async (request, env, ctx) => {
```

Update the doc comment at the top of the file to include the two new routes:
```
 *   POST   /market-test
 *   GET    /market-test/:id
```

- [ ] **Step 3: Add the two new routes**

Find the block for `if (path === '/score' && method === 'POST')` in `index.ts`. Add the following two route handlers immediately after that block (before the final `return json({ error: 'not found' }, 404)`):

```typescript
    if (path === '/market-test' && method === 'POST') {
      const { description } = await request.json() as { description?: string };
      if (!description || typeof description !== 'string' || !description.trim())
        return json({ error: 'description required' }, 400);
      if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY)
        return json({ error: 'No LLM key configured (GROQ_API_KEY or OPENROUTER_API_KEY required)' }, 503);
      const id   = crypto.randomUUID().slice(0, 12);
      const now  = new Date().toISOString();
      const d1repo = new D1Repo(env.DB);
      await d1repo.createMarketTest(id, description.trim(), now);
      const cfg = await getConfig(env.DB);
      const llm = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
      ctx.waitUntil(runMarketTest(id, description.trim(), llm, d1repo));
      return json({ test_id: id });
    }

    if (path.startsWith('/market-test/') && method === 'GET') {
      const id = path.slice('/market-test/'.length);
      if (!id) return json({ error: 'test id required' }, 400);
      const d1repo = new D1Repo(env.DB);
      const test = await d1repo.getMarketTest(id);
      if (!test) return json({ error: 'not found' }, 404);
      return json(test);
    }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd src/main/infrastructure/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
# From repo root
npm test
npm run test:integration
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/index.ts
git commit -m "feat: wire POST /market-test and GET /market-test/:id routes"
```

---

## Verification

After all tasks are complete, manually smoke-test the full flow:

```bash
# Apply the migration to local D1
cd src/main/infrastructure/worker
npx wrangler d1 execute market-intel --local --file=migrations/0007_add_market_tests.sql

# Start the dev worker
npx wrangler dev

# In another terminal — submit a market test
curl -s -X POST http://localhost:8787/market-test \
  -H "Authorization: Bearer <your-WORKER_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"description": "Dentistas autónomos en España con problemas de software fiscal"}' | jq .
# Expected: {"test_id":"<id>"}

# Poll for result (wait a few seconds for waitUntil to complete)
curl -s http://localhost:8787/market-test/<id> \
  -H "Authorization: Bearer <your-WORKER_SECRET>" | jq .
# Expected: status transitions pending → running → done, result contains score
```
