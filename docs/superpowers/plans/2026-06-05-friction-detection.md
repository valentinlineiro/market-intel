# Friction Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-based friction analysis that enriches `signal.signal_strength` before scoring, so `dolorScore` differentiates real pain from noise without any change to the domain layer.

**Architecture:** `runCollect` returns fresh signals → `analyzeFriction` runs LLM per eligible signal and writes `signal_strength` + `friction_analysis` back to D1 → `runScore` reads enriched values unchanged. Domain layer (`dolorScore`, scoring tests) is untouched.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, Vitest, existing `ILLMProvider` interface.

---

### Task 1: Add friction types to domain

**Files:**
- Modify: `src/main/infrastructure/worker/domain/types.ts`

- [ ] **Step 1: Add 'github' to SignalSource and add types and Signal field**

Open `domain/types.ts`. First, check line 1: `export type SignalSource = 'gnews' | 'local_news';`. If `'github'` is not already present, update it:

```typescript
export type SignalSource = 'gnews' | 'local_news' | 'github';
```

Then add after the existing type exports (after the `MarketTest` interface at the end of the file):

```typescript
export type ProblemType =
  | 'regulation' | 'process' | 'software'
  | 'cost' | 'time' | 'complexity' | 'unknown';

export type PainFrequency =
  | 'daily' | 'weekly' | 'monthly'
  | 'yearly' | 'one-time' | 'unknown';

export interface FrictionProfile {
  problem_type: ProblemType;
  intensity: number;           // 0–10
  frequency: PainFrequency;
  workaround: boolean | null;
  has_solution: boolean | null;
  regulatory_body: string | null;
  affected_role: string | null;
  pain_summary: string;
  confidence: number;          // 0–1
}
```

Then add `friction_analysis` to the `Signal` interface (currently ends with `has_deadline: boolean`):

```typescript
export interface Signal {
  id: string;
  source: SignalSource;
  collected_at: string;
  segment: string;
  location: string | null;
  raw_text: string;
  url: string;
  pain_keywords: string[];
  sentiment_score: number | null;
  salary_mean: number | null;
  income_tier: string | null;
  signal_strength: number | null;
  has_deadline: boolean;
  friction_analysis?: string | null;   // JSON FrictionProfile; null = not yet analyzed
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd src/main/infrastructure/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/domain/types.ts
git commit -m "feat: add FrictionProfile types and friction_analysis field to Signal"
```

---

### Task 2: Add updateFriction to ISignalRepo and InMemorySignalRepo

**Files:**
- Modify: `src/main/infrastructure/worker/application/ports.ts`
- Modify: `src/main/infrastructure/worker/application/market-test.ts`

`ISignalRepo` is the interface that all signal repositories implement. Adding `updateFriction` here means both the D1 production repo and the in-memory test repo must implement it.

- [ ] **Step 1: Add method to ISignalRepo in ports.ts**

In `application/ports.ts`, the `ISignalRepo` interface currently ends with `count`. Add:

```typescript
import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig, GnewsSegmentConfig, MarketTest, MarketTestResult, FrictionProfile } from '../domain/types.js';

export interface ISignalRepo {
  save(signal: Signal): Promise<boolean>;
  get(segment: string, limit: number): Promise<Signal[]>;
  getAll(limit: number): Promise<Signal[]>;
  count(segment?: string): Promise<number>;
  updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void>;
}
```

- [ ] **Step 2: Implement in InMemorySignalRepo (market-test.ts)**

`InMemorySignalRepo` lives in `application/market-test.ts` at line 28. Add `updateFriction` after `count`:

```typescript
async updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void> {
  const s = this.signals.find(sig => sig.id === id);
  if (s) {
    s.signal_strength = strength;
    s.friction_analysis = JSON.stringify(profile);
  }
}
```

Also add `FrictionProfile` to the import at line 2 of `market-test.ts`:

```typescript
import type { Signal, GnewsSegmentConfig, MarketTestResult, FrictionProfile } from '../domain/types.js';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd src/main/infrastructure/worker && npx tsc --noEmit
```

Expected: no errors (D1Repo will error until Task 3 — that's expected, fix it in Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/application/ports.ts \
        src/main/infrastructure/worker/application/market-test.ts
git commit -m "feat: add updateFriction to ISignalRepo interface and InMemorySignalRepo"
```

---

### Task 3: Database migration

**Files:**
- Create: `src/main/infrastructure/worker/migrations/0008_add_friction_analysis.sql`

- [ ] **Step 1: Create migration file**

```sql
ALTER TABLE signals ADD COLUMN friction_analysis TEXT;
ALTER TABLE signals ADD COLUMN updated_at TEXT;
```

- [ ] **Step 2: Apply locally**

```bash
npx wrangler d1 execute market-intel-db --local \
  --file=src/main/infrastructure/worker/migrations/0008_add_friction_analysis.sql
```

Expected: `✅ Successfully executed SQL`

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/migrations/0008_add_friction_analysis.sql
git commit -m "feat: add friction_analysis and updated_at columns to signals"
```

---

### Task 4: Implement updateFriction in D1Repo

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`

- [ ] **Step 1: Add FrictionProfile to imports**

At the top of `d1-repo.ts`, `FrictionProfile` needs to be imported. Update the first import line:

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
} from '../../domain/types.js';
```

- [ ] **Step 2: Update rowToSignal to include friction_analysis**

`rowToSignal` is around line 32. Add `friction_analysis` as the last field:

```typescript
function rowToSignal(r: Record<string, unknown>): Signal {
  return {
    id:               r['id'] as string,
    source:           r['source'] as Signal['source'],
    collected_at:     r['collected_at'] as string,
    segment:          r['segment'] as string,
    location:         (r['location'] as string | null) ?? null,
    raw_text:         r['raw_text'] as string,
    url:              r['url'] as string,
    pain_keywords:    parseJson<string[]>(r['pain_keywords'], []),
    sentiment_score:  (r['sentiment_score'] as number | null) ?? null,
    salary_mean:      (r['salary_mean'] as number | null) ?? null,
    income_tier:      (r['income_tier'] as string | null) ?? null,
    signal_strength:  (r['signal_strength'] as number | null) ?? null,
    has_deadline:     r['has_deadline'] === 1 || r['has_deadline'] === true,
    friction_analysis: (r['friction_analysis'] as string | null) ?? null,
  };
}
```

- [ ] **Step 3: Add updateFriction method to D1Repo**

Add after the `count` method (around line 166) inside the `D1Repo` class, still in the `// ── ISignalRepo ──` section:

```typescript
async updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void> {
  await this.db
    .prepare(
      `UPDATE signals SET signal_strength = ?, friction_analysis = ?, updated_at = ? WHERE id = ?`
    )
    .bind(strength, JSON.stringify(profile), new Date().toISOString(), id)
    .run();
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd src/main/infrastructure/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run tests**

```bash
cd src/main/infrastructure/worker && npx vitest run
```

Expected: all tests pass (no changes to test logic yet).

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/db/d1-repo.ts
git commit -m "feat: implement updateFriction in D1Repo"
```

---

### Task 5: Change runCollect to return Signal[]

**Files:**
- Modify: `src/main/infrastructure/worker/application/collect.ts`
- Create: `src/main/infrastructure/worker/test/unit/collect.test.ts`

`runCollect` currently returns `Promise<void>`. It must return `Promise<Signal[]>` containing only the signals actually saved (repo.save returns true) this cycle. Duplicates (save returns false) are excluded.

- [ ] **Step 1: Write the failing test**

Create `test/unit/collect.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runCollect } from '../../application/collect.js';
import type { ISignalRepo } from '../../application/ports.js';
import type { Signal, FrictionProfile } from '../../domain/types.js';

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

describe('runCollect', () => {
  it('returns all newly saved signals from all collectors', async () => {
    const s1 = makeSignal('a');
    const s2 = makeSignal('b');
    const repo = makeRepo(true);

    const result = await runCollect(repo, [
      async () => [s1],
      async () => [s2],
    ]);

    expect(result).toHaveLength(2);
    expect(result).toContain(s1);
    expect(result).toContain(s2);
  });

  it('excludes duplicate signals when repo.save returns false', async () => {
    const s1 = makeSignal('a');
    const repo = makeRepo(false);

    const result = await runCollect(repo, [async () => [s1]]);

    expect(result).toHaveLength(0);
  });

  it('returns empty array when no collectors produce signals', async () => {
    const repo = makeRepo(true);
    const result = await runCollect(repo, [async () => []]);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/main/infrastructure/worker && npx vitest run test/unit/collect.test.ts
```

Expected: FAIL — `runCollect` returns `void`, not `Signal[]`.

- [ ] **Step 3: Update runCollect to return Signal[]**

Replace the entire content of `application/collect.ts`:

```typescript
import type { ISignalRepo } from './ports.js';
import type { Signal } from '../domain/types.js';

export async function runCollect(
  repo: ISignalRepo,
  collectors: Array<() => Promise<Signal[]>>,
): Promise<Signal[]> {
  const saved: Signal[] = [];
  for (const collector of collectors) {
    const signals = await collector();
    for (const signal of signals) {
      const isNew = await repo.save(signal);
      if (isNew) saved.push(signal);
    }
  }
  return saved;
}
```

- [ ] **Step 4: Run tests**

```bash
cd src/main/infrastructure/worker && npx vitest run
```

Expected: all tests pass (the `void` return in `index.ts` is backwards-compatible — TypeScript ignores unused return values).

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/application/collect.ts \
        src/main/infrastructure/worker/test/unit/collect.test.ts
git commit -m "feat: runCollect returns newly saved Signal[] instead of void"
```

---

### Task 6: Implement analyzeFriction (TDD)

**Files:**
- Create: `src/main/infrastructure/worker/application/friction.ts`
- Create: `src/main/infrastructure/worker/test/unit/friction.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/friction.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { analyzeFriction } from '../../application/friction.js';
import type { ILLMProvider, ISignalRepo } from '../../application/ports.js';
import type { Signal, FrictionProfile } from '../../domain/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id:              'sig-1',
    source:          'github',
    collected_at:    new Date().toISOString(),
    segment:         'test',
    location:        null,
    raw_text:        'Implementing SII is causing serious issues with 701 comments discussing workarounds',
    url:             'https://github.com/OCA/l10n-spain/issues/123',
    pain_keywords:   ['sii'],
    sentiment_score: -0.5,
    salary_mean:     null,
    income_tier:     null,
    signal_strength: 0.6,
    has_deadline:    false,
    ...overrides,
  };
}

const VALID_PROFILE: FrictionProfile = {
  problem_type:    'regulation',
  intensity:       8,
  frequency:       'monthly',
  workaround:      true,
  has_solution:    false,
  regulatory_body: 'AEAT',
  affected_role:   'gestor',
  pain_summary:    'SII reporting requires complex integration',
  confidence:      0.9,
};

function makeLlm(response: string): ILLMProvider {
  return { complete: vi.fn().mockResolvedValue(response) };
}

interface TrackingRepo extends ISignalRepo {
  calls: Array<{ id: string; strength: number; profile: FrictionProfile }>;
}

function makeRepo(): TrackingRepo {
  const calls: Array<{ id: string; strength: number; profile: FrictionProfile }> = [];
  return {
    save:    vi.fn().mockResolvedValue(true),
    get:     vi.fn().mockResolvedValue([]),
    getAll:  vi.fn().mockResolvedValue([]),
    count:   vi.fn().mockResolvedValue(0),
    updateFriction: vi.fn().mockImplementation(
      async (id: string, strength: number, profile: FrictionProfile) => {
        calls.push({ id, strength, profile });
      }
    ),
    calls,
  };
}

describe('analyzeFriction', () => {
  it('enriches github signal and calls updateFriction with computed quality', async () => {
    const repo = makeRepo();
    await analyzeFriction([makeSignal()], makeLlm(JSON.stringify(VALID_PROFILE)), repo);

    expect(repo.calls).toHaveLength(1);
    // quality = (8/10) * (0.6 + 0.4 * 0.9) = 0.8 * 0.96 = 0.768
    expect(repo.calls[0]!.strength).toBeCloseTo(0.768, 2);
    expect(repo.calls[0]!.id).toBe('sig-1');
    expect(repo.calls[0]!.profile.problem_type).toBe('regulation');
  });

  it('skips gnews signal with ss below 0.35', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ source: 'gnews', signal_strength: 0.28 });
    await analyzeFriction([signal], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('analyzes gnews signal at ss >= 0.35', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ source: 'gnews', signal_strength: 0.40 });
    await analyzeFriction([signal], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(1);
  });

  it('skips local_news signal with ss below 0.35', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ source: 'local_news', signal_strength: 0.30 });
    await analyzeFriction([signal], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('skips already-analyzed signal', async () => {
    const repo = makeRepo();
    const signal = makeSignal({ friction_analysis: JSON.stringify(VALID_PROFILE) });
    await analyzeFriction([signal], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('silently skips signal when LLM returns no JSON object', async () => {
    const repo = makeRepo();
    await analyzeFriction([makeSignal()], makeLlm('not valid json at all'), repo);
    expect(repo.calls).toHaveLength(0);
  });

  it('handles LLM preamble before JSON', async () => {
    const repo = makeRepo();
    const llm = makeLlm(`Aquí el análisis: ${JSON.stringify(VALID_PROFILE)}`);
    await analyzeFriction([makeSignal()], llm, repo);
    expect(repo.calls).toHaveLength(1);
  });

  it('processes multiple signals independently', async () => {
    const repo = makeRepo();
    const s1 = makeSignal({ id: 'sig-1' });
    const s2 = makeSignal({ id: 'sig-2', signal_strength: 0.5 });
    await analyzeFriction([s1, s2], makeLlm(JSON.stringify(VALID_PROFILE)), repo);
    expect(repo.calls).toHaveLength(2);
    expect(repo.calls.map(c => c.id)).toContain('sig-1');
    expect(repo.calls.map(c => c.id)).toContain('sig-2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd src/main/infrastructure/worker && npx vitest run test/unit/friction.test.ts
```

Expected: FAIL — module `../../application/friction.js` not found.

- [ ] **Step 3: Implement analyzeFriction**

Create `application/friction.ts`:

```typescript
import type { Signal, FrictionProfile } from '../domain/types.js';
import type { ILLMProvider, ISignalRepo } from './ports.js';

const FRICTION_PROMPT = `Eres un analista de pain points de profesionales. Analiza este texto y extrae el perfil de fricción.

Fuente: {source}
Texto: {raw_text}

Devuelve SOLO un JSON válido:
{
  "problem_type": "regulation|process|software|cost|time|complexity|unknown",
  "intensity": <0-10>,
  "frequency": "daily|weekly|monthly|yearly|one-time|unknown",
  "workaround": <true|false|null>,
  "has_solution": <true|false|null>,
  "regulatory_body": "<nombre o null>",
  "affected_role": "<rol profesional o null>",
  "pain_summary": "<frase corta describiendo el problema>",
  "confidence": <0.0-1.0>
}`;

function shouldAnalyze(signal: Signal): boolean {
  if (signal.friction_analysis != null) return false;
  if (signal.source === 'github') return true;
  return (signal.signal_strength ?? 0) >= 0.35;
}

export async function analyzeFriction(
  signals: Signal[],
  llm: ILLMProvider,
  repo: ISignalRepo,
): Promise<void> {
  const eligible = signals.filter(shouldAnalyze);
  for (const signal of eligible) {
    try {
      const prompt = FRICTION_PROMPT
        .replace('{source}', signal.source)
        .replace('{raw_text}', signal.raw_text.slice(0, 1000));
      let raw = await llm.complete(prompt, 300);
      raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1) continue;
      const profile = JSON.parse(raw.slice(start, end + 1)) as FrictionProfile;
      const quality = (profile.intensity / 10) * (0.6 + 0.4 * profile.confidence);
      await repo.updateFriction(signal.id, quality, profile);
    } catch {
      // original signal_strength preserved on any failure
    }
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
cd src/main/infrastructure/worker && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/application/friction.ts \
        src/main/infrastructure/worker/test/unit/friction.test.ts
git commit -m "feat: add analyzeFriction — LLM enriches signal_strength before scoring"
```

---

### Task 7: Wire analyzeFriction into the cron

**Files:**
- Modify: `src/main/infrastructure/worker/index.ts`

- [ ] **Step 1: Add import**

At the top of `index.ts`, alongside the other application imports (around line 43):

```typescript
import { analyzeFriction } from './application/friction.js';
```

- [ ] **Step 2: Update the cron handler**

In the `scheduled` handler (around line 348), the current collect line is:

```typescript
await runCollect(d1repo, [gnewsCollector, localNewsCollector, githubCollector]);
```

Replace it with:

```typescript
const fresh = await runCollect(d1repo, [gnewsCollector, localNewsCollector, githubCollector]);
await analyzeFriction(fresh, llm, d1repo);
```

The `llm` variable is already in scope from line 334:
```typescript
const llm = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd src/main/infrastructure/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd src/main/infrastructure/worker && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/index.ts
git commit -m "feat: wire analyzeFriction between collect and score in cron"
```

---

### Task 8: Apply migration to remote D1

- [ ] **Step 1: Apply to production**

```bash
npx wrangler d1 execute market-intel-db \
  --file=src/main/infrastructure/worker/migrations/0008_add_friction_analysis.sql
```

Expected: `✅ Successfully executed SQL`

- [ ] **Step 2: Deploy**

```bash
npx wrangler deploy src/main/infrastructure/worker/index.ts
```

- [ ] **Step 3: Verify with a market test**

```bash
curl -X POST https://<worker-url>/market-test \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"description": "Gestores que sufren con el SII de hacienda"}'
```

Then poll `GET /market-test/:id` until status is `done`. Confirm signals in the result have `signal_strength` values in the 0.5–0.8 range for GitHub-sourced signals.
