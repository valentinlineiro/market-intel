# Worker TypeScript + Clean Architecture Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Cloudflare Worker from flat JavaScript to strict TypeScript with Clean Architecture layers (domain → application → infrastructure).

**Architecture:** New files are created in `domain/`, `application/`, and `infrastructure/` directories. `index.js` is updated to import from the new TS modules, then renamed to `index.ts` as the final step. Old flat `.js` files are deleted only after their replacements are fully wired in.

**Tech Stack:** TypeScript (strict), `@cloudflare/workers-types`, Vitest, `@cloudflare/vitest-pool-workers` (integration tests), Cloudflare Workers, D1

---

## File Map

**Create:**
- `src/main/infrastructure/worker/tsconfig.json`
- `vitest.integration.config.ts` (root)
- `worker/domain/types.ts`
- `worker/domain/rules.ts`
- `worker/domain/scoring.ts`
- `worker/application/ports.ts`
- `worker/application/score.ts`
- `worker/application/discover.ts`
- `worker/application/synthesize.ts`
- `worker/application/collect.ts`
- `worker/infrastructure/config.ts`
- `worker/infrastructure/llm/chain.ts`
- `worker/infrastructure/notify.ts`
- `worker/infrastructure/db/d1-repo.ts`
- `worker/infrastructure/collectors/gnews.ts`
- `worker/infrastructure/collectors/local_news.ts`
- `worker/test/unit/scoring.test.ts`
- `worker/test/integration/d1-repo.test.ts`

**Modify:**
- `package.json` (root) — add `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`
- `worker/wrangler.toml` — change `main = "index.js"` → `main = "index.ts"`

**Rename (last task):**
- `worker/index.js` → `worker/index.ts`

**Delete (last task):**
- `worker/score.js`, `worker/notify.js`, `worker/llm.js`, `worker/discover.js`, `worker/synthesize.js`, `worker/config.js`, `worker/collectors/gnews.js`, `worker/collectors/local_news.js`

All paths below are relative to `src/main/infrastructure/`.

---

## Task 1: TypeScript tooling

**Files:**
- Create: `worker/tsconfig.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Add workers-types to root package.json**

Replace the `devDependencies` block in `/home/valentin/code/market-intel/package.json`:

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "typecheck": "tsc --noEmit -p src/main/infrastructure/worker/tsconfig.json"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.0.0",
    "vitest": "^2.0.0",
    "wrangler": "^4.95.0"
  }
}
```

- [ ] **Step 2: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", ".wrangler"]
}
```

- [ ] **Step 3: Install dependencies**

Run from repo root:
```bash
npm install
```

Expected: `node_modules/@cloudflare/workers-types` and `node_modules/@cloudflare/vitest-pool-workers` appear.

- [ ] **Step 4: Create integration vitest config**

Create `vitest.integration.config.ts` at repo root:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['src/main/infrastructure/worker/test/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './src/main/infrastructure/worker/wrangler.toml' },
      },
    },
  },
});
```

- [ ] **Step 5: Verify typecheck runs (no files yet, that's OK)**

```bash
npm run typecheck 2>&1 | head -5
```

Expected: `error TS18003: No inputs were found` (no .ts files yet — this is expected).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/infrastructure/worker/tsconfig.json vitest.integration.config.ts
git commit -m "chore: add TypeScript tooling and vitest integration config"
```

---

## Task 2: Domain types

**Files:**
- Create: `worker/domain/types.ts`

- [ ] **Step 1: Create `worker/domain/types.ts`**

```typescript
export type SignalSource = 'gnews' | 'local_news';
export type OpportunityStatus = 'watching' | 'testing' | 'scaling' | 'killed';

export interface ScoreBreakdown {
  dolor: number;
  capacidad_pago: number;
  volumen: number;
  competencia: number;
  urgencia: number;
}

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
}

export interface Opportunity {
  id: string;
  segment: string;
  pain_summary: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  signal_ids: string[];
  signal_count: number;
  first_seen: string;
  last_updated: string;
  status: OpportunityStatus;
  landing_url: string | null;
  emails_captured: number;
  validation_deadline: string | null;
  telegram_alerted_at: string | null;
}

export interface Lead {
  email: string;
  segment: string;
  captured_at: string;
}

export interface DiscoveryCandidate {
  profile: string;
  pain: string;
  keywords: string[];
  post_count: number;
  discovery_score: number;
  income_est: string | null;
  has_deadline: boolean;
  source: string;
  run_id: string;
  discovered_at: string;
}

export interface SegmentConfig {
  key: string;
  label: string;
  keywords: string[];
  income_tier: string;
  has_deadline: boolean;
  discovery_score: number;
}

export interface LandingCopy {
  title: string;
  subtitle: string;
  benefits: [string, string, string][];
  cta: string;
}

export interface Config {
  score: {
    weights: Record<string, number>;
    kill_score_threshold: number;
    scale_score_threshold: number;
    alert_score_threshold: number;
    kill_days: number;
    scale_emails: number;
    default_competencia_score: number;
  };
  llm: {
    primary_provider: string;
    primary_model: string;
    fallback_provider: string;
    fallback_model: string;
  };
  discover: {
    text_limit: number;
    batch_size: number;
    hn_queries: string[];
    news_queries: string[];
    known_segments: string[];
  };
  notifications: {
    from: string;
    recipient: string;
    cooldown_hours: number;
  };
  collectors: {
    gnews_segments: Record<string, GnewsSegmentConfig>;
    local_news: {
      location: string;
      feeds: string[];
    };
  };
  synthesis_segments: Record<string, {
    label: string;
    keywords: string[];
    salary_mean: number;
  }>;
}

export interface GnewsSegmentConfig {
  label: string;
  queries: string[];
  keywords: string[];
  salary_mean: number;
  income_tier: string;
  has_deadline: boolean;
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run typecheck 2>&1 | grep -v "error TS18003" | head -10
```

Expected: no errors (or only "No inputs" if tsconfig's include doesn't pick up the file — adjust `include` if needed).

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/domain/types.ts
git commit -m "feat: add domain types for Worker CA migration"
```

---

## Task 3: Domain rules + scoring (TDD)

**Files:**
- Create: `worker/test/unit/scoring.test.ts`
- Create: `worker/domain/rules.ts`
- Create: `worker/domain/scoring.ts`

- [ ] **Step 1: Write failing tests**

Create `worker/test/unit/scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  computeOpportunityScore,
  incomeTierScore,
  urgencyScore,
  volumeScore,
  dolorScore,
  applyRules,
  shouldAlert,
} from '../../domain/scoring.js';
import {
  ALERT_SCORE_THRESHOLD,
  KILL_SCORE_THRESHOLD,
  SCALE_SCORE_THRESHOLD,
} from '../../domain/rules.js';
import type { Opportunity, Signal } from '../../domain/types.js';

describe('computeOpportunityScore', () => {
  it('returns 0 for empty breakdown', () => {
    expect(computeOpportunityScore({})).toBe(0);
  });

  it('applies weights correctly', () => {
    const breakdown = { dolor: 10, capacidad_pago: 10, volumen: 10, competencia: 10, urgencia: 10 };
    expect(computeOpportunityScore(breakdown)).toBe(10);
  });

  it('uses partial breakdown without crashing', () => {
    expect(computeOpportunityScore({ dolor: 10 })).toBe(3);
  });
});

describe('incomeTierScore', () => {
  it('returns 10 for high', () => expect(incomeTierScore('high')).toBe(10));
  it('returns 7 for medium_high', () => expect(incomeTierScore('medium_high')).toBe(7));
  it('returns 5 for medium', () => expect(incomeTierScore('medium')).toBe(5));
  it('returns 2 for low', () => expect(incomeTierScore('low')).toBe(2));
  it('returns 2 for unknown tier', () => expect(incomeTierScore('unknown')).toBe(2));
});

describe('urgencyScore', () => {
  it('returns 10 when has deadline', () => expect(urgencyScore(true)).toBe(10));
  it('returns 0 when no deadline', () => expect(urgencyScore(false)).toBe(0));
});

describe('volumeScore', () => {
  it('caps at 10', () => expect(volumeScore(999)).toBe(10));
  it('normalises: discovery_score 20 → 10', () => expect(volumeScore(20)).toBe(10));
  it('normalises: discovery_score 10 → 5', () => expect(volumeScore(10)).toBe(5));
  it('returns 0 for 0', () => expect(volumeScore(0)).toBe(0));
});

const makeSignal = (overrides: Partial<Signal> = {}): Signal => ({
  id: 'x', source: 'gnews', collected_at: new Date().toISOString(),
  segment: 'test', location: null, raw_text: 'x', url: 'https://x.com',
  pain_keywords: [], sentiment_score: null, salary_mean: null,
  income_tier: null, signal_strength: 0.5, has_deadline: false,
  ...overrides,
});

describe('dolorScore', () => {
  it('returns score=0 summary="" for empty signals', () => {
    const result = dolorScore([]);
    expect(result.score).toBe(0);
    expect(result.summary).toBe('');
  });

  it('returns score=0 for signals older than 30 days', () => {
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    const result = dolorScore([makeSignal({ collected_at: old, signal_strength: 1.0, pain_keywords: [] })]);
    expect(result.score).toBe(0);
  });

  it('scores recent signals > 0', () => {
    const signals = Array.from({ length: 10 }, () =>
      makeSignal({ signal_strength: 0.8, pain_keywords: ['burocracia', 'multa'] })
    );
    const result = dolorScore(signals);
    expect(result.score).toBeGreaterThan(0);
    expect(result.summary).toMatch(/burocracia|multa|señales/);
  });

  it('never exceeds 10', () => {
    const signals = Array.from({ length: 100 }, () =>
      makeSignal({ signal_strength: 1.0, pain_keywords: ['pain'] })
    );
    expect(dolorScore(signals).score).toBeLessThanOrEqual(10);
  });
});

const makeOpp = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: 'abc', segment: 'test', score: 6.0, signal_count: 5,
  status: 'watching', emails_captured: 0,
  first_seen: new Date().toISOString(),
  last_updated: new Date().toISOString(),
  pain_summary: '', score_breakdown: { dolor: 6, capacidad_pago: 6, volumen: 6, competencia: 6, urgencia: 6 },
  signal_ids: [], landing_url: null, validation_deadline: null, telegram_alerted_at: null,
  ...overrides,
});

describe('applyRules', () => {
  it('does not change already-killed opp', () => {
    expect(applyRules(makeOpp({ status: 'killed' })).status).toBe('killed');
  });

  it('kills opp with no signals after 7 days when score below threshold', () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    expect(applyRules(makeOpp({ signal_count: 0, score: 4.0, first_seen: old })).status).toBe('killed');
  });

  it('does not kill if score is above kill threshold', () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    expect(applyRules(makeOpp({ signal_count: 0, score: KILL_SCORE_THRESHOLD + 1, first_seen: old })).status).toBe('watching');
  });

  it('scales opp with high score and enough emails', () => {
    expect(applyRules(makeOpp({ score: SCALE_SCORE_THRESHOLD + 0.1, emails_captured: 30 })).status).toBe('scaling');
  });
});

describe('shouldAlert', () => {
  it('returns true when never alerted', () => {
    expect(shouldAlert({ telegram_alerted_at: null })).toBe(true);
  });

  it('returns false when alerted less than 24h ago', () => {
    const recent = new Date(Date.now() - 12 * 3600000).toISOString();
    expect(shouldAlert({ telegram_alerted_at: recent })).toBe(false);
  });

  it('returns true when alerted more than 24h ago', () => {
    const old = new Date(Date.now() - 25 * 3600000).toISOString();
    expect(shouldAlert({ telegram_alerted_at: old })).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test 2>&1 | tail -5
```

Expected: `Cannot find module '../../domain/scoring.js'`

- [ ] **Step 3: Create `worker/domain/rules.ts`**

```typescript
export const SCORE_WEIGHTS: Record<string, number> = {
  dolor: 0.30,
  capacidad_pago: 0.25,
  volumen: 0.20,
  competencia: 0.15,
  urgencia: 0.10,
};

export const KILL_SCORE_THRESHOLD = 5.0;
export const SCALE_SCORE_THRESHOLD = 8.0;
export const ALERT_SCORE_THRESHOLD = 7.0;

export const SALARY_TIERS: Record<string, number> = {
  high: 10,
  medium_high: 7,
  medium: 5,
  low: 2,
};
```

- [ ] **Step 4: Create `worker/domain/scoring.ts`**

```typescript
import type { Signal, Opportunity, ScoreBreakdown } from './types.js';
import { SCORE_WEIGHTS, SALARY_TIERS, KILL_SCORE_THRESHOLD, SCALE_SCORE_THRESHOLD } from './rules.js';

export function computeOpportunityScore(breakdown: Partial<ScoreBreakdown>): number {
  const raw = Object.entries(SCORE_WEIGHTS).reduce(
    (sum, [k, w]) => sum + ((breakdown as Record<string, number>)[k] ?? 0) * w,
    0,
  );
  return Math.round(raw * 100) / 100;
}

export function incomeTierScore(tier: string): number {
  return SALARY_TIERS[tier] ?? 2;
}

export function urgencyScore(hasDeadline: boolean): number {
  return hasDeadline ? 10 : 0;
}

export function volumeScore(discoveryScore: number): number {
  return Math.round(Math.min(discoveryScore / 20.0, 1.0) * 10 * 100) / 100;
}

export interface DolorResult {
  score: number;
  summary: string;
}

export function dolorScore(signals: Signal[]): DolorResult {
  const now = Date.now();
  const cutoff = now - 30 * 86400000;
  const weekAgo = now - 7 * 86400000;
  const recent = signals.filter(s => new Date(s.collected_at).getTime() > cutoff);
  if (!recent.length) return { score: 0, summary: '' };

  const freqScore = Math.min(recent.length / 20, 1.0) * 10;
  let weighted = 0;
  let totalW = 0;
  const allKw: string[] = [];

  for (const s of recent) {
    const w = new Date(s.collected_at).getTime() > weekAgo ? 2.0 : 1.0;
    weighted += (s.signal_strength ?? 0) * w;
    totalW += w;
    allKw.push(...s.pain_keywords);
  }

  const intensity = totalW ? (weighted / totalW) * 10 : 0;
  const score = Math.min(Math.round((freqScore * 0.5 + intensity * 0.5) * 100) / 100, 10.0);

  const kwCount: Record<string, number> = {};
  for (const kw of allKw) kwCount[kw] = (kwCount[kw] ?? 0) + 1;
  const topKw = Object.entries(kwCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  const summary = topKw.length
    ? `Dolor en: ${topKw.join(', ')}`
    : `${recent.length} señales recientes`;

  return { score, summary };
}

export function applyRules(opp: Opportunity): Opportunity {
  if (opp.status === 'killed' || opp.status === 'scaling') return opp;
  const ageDays = (Date.now() - new Date(opp.first_seen).getTime()) / 86400000;
  if (opp.signal_count === 0 && ageDays >= 7 && opp.score < KILL_SCORE_THRESHOLD) {
    return { ...opp, status: 'killed' };
  }
  if (opp.score >= SCALE_SCORE_THRESHOLD && opp.emails_captured >= 30) {
    return { ...opp, status: 'scaling' };
  }
  return opp;
}

export function shouldAlert(opp: Pick<Opportunity, 'telegram_alerted_at'>): boolean {
  if (!opp.telegram_alerted_at) return true;
  return Date.now() - new Date(opp.telegram_alerted_at).getTime() > 86400000;
}

export function formatAlert(
  opp: Opportunity,
  seg: { label: string; has_deadline: boolean },
): string {
  const bd = opp.score_breakdown;
  const lines = [
    `🎯 *Oportunidad detectada*`,
    `*Segmento:* ${seg.label}`,
    `*Score:* ${opp.score}/10`,
    `*Dolor:* ${bd.dolor.toFixed(1)} | *Pago:* ${bd.capacidad_pago.toFixed(0)} | *Urgencia:* ${bd.urgencia.toFixed(0)}`,
    `*Señales:* ${opp.signal_count}`,
    `*Resumen:* ${opp.pain_summary}`,
  ];
  if (seg.has_deadline) lines.push('⚠️ Deadline activo');
  return lines.join('\n');
}
```

- [ ] **Step 5: Run tests — expect all pass**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests in `scoring.test.ts` pass (green).

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/domain/ src/main/infrastructure/worker/test/unit/scoring.test.ts
git commit -m "feat: add domain rules + scoring with unit tests"
```

---

## Task 4: Application ports

**Files:**
- Create: `worker/application/ports.ts`

- [ ] **Step 1: Create `worker/application/ports.ts`**

```typescript
import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig } from '../domain/types.js';

export interface ISignalRepo {
  save(signal: Signal): Promise<boolean>;
  get(segment: string, limit: number): Promise<Signal[]>;
  getAll(limit: number): Promise<Signal[]>;
  count(segment?: string): Promise<number>;
}

export interface IOpportunityRepo {
  upsert(opp: Opportunity): Promise<void>;
  getAll(): Promise<Opportunity[]>;
  getBySegment(segment: string): Promise<Opportunity | null>;
  markAlerted(id: string, at: string): Promise<void>;
}

export interface ILeadRepo {
  saveLead(email: string, segment: string): Promise<void>;
  getLeads(segment?: string): Promise<Lead[]>;
}

export interface IDiscoveryRepo {
  saveCandidates(candidates: DiscoveryCandidate[]): Promise<void>;
  getLatestCandidates(): Promise<{
    run_id: string;
    candidates: DiscoveryCandidate[];
    discovered_at: string;
  } | null>;
  getSegmentsToScore(topN: number, minScore: number): Promise<SegmentConfig[]>;
}

export interface ILLMProvider {
  complete(prompt: string, maxTokens: number): Promise<string>;
}

export interface INotifier {
  send(subject: string, html: string, text: string): Promise<boolean>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/worker/application/ports.ts
git commit -m "feat: add application port interfaces"
```

---

## Task 5: Infrastructure — config.ts

**Files:**
- Create: `worker/infrastructure/config.ts`

- [ ] **Step 1: Create `worker/infrastructure/config.ts`**

```typescript
import type { D1Database } from '@cloudflare/workers-types';
import type { Config } from '../domain/types.js';

export const DEFAULT_CONFIG: Config = {
  score: {
    weights: { dolor: 0.30, capacidad_pago: 0.25, volumen: 0.20, competencia: 0.15, urgencia: 0.10 },
    kill_score_threshold: 5.0,
    scale_score_threshold: 8.0,
    alert_score_threshold: 7.0,
    kill_days: 7,
    scale_emails: 30,
    default_competencia_score: 5.0,
  },
  llm: {
    primary_provider: 'groq',
    primary_model: 'llama-3.1-8b-instant',
    fallback_provider: 'openrouter',
    fallback_model: 'anthropic/claude-haiku-4-5',
  },
  discover: {
    text_limit: 30,
    batch_size: 15,
    hn_queries: [
      'solo practitioner software pain billing',
      'freelancer professional bureaucracy',
      'small practice management software problem',
      'professional license permit Spain problem',
    ],
    news_queries: [
      'autónomo España software problema hacienda',
      'profesional liberal burocracia queja',
      'pyme software gestión problema España',
    ],
    known_segments: [
      'Odontólogo / Clínica dental',
      'Docente universitario',
      'Abogado autónomo',
      'Arquitecto',
    ],
  },
  notifications: { from: '', recipient: '', cooldown_hours: 24 },
  collectors: {
    gnews_segments: {
      dentista: {
        label: 'Odontólogo / Clínica dental',
        queries: ['verifactu dentista', 'software dental hacienda', 'facturación electrónica clínica dental', 'RRSIF odontología'],
        keywords: ['verifactu', 'hacienda', 'facturación', 'rrsif', 'multa', 'gestión clínica'],
        salary_mean: 66500, income_tier: 'high', has_deadline: true,
      },
      docente_universitario: {
        label: 'Docente universitario',
        queries: ['ANECA acreditación universidad', 'sexenio investigación problema', 'Docentia evaluación docente'],
        keywords: ['aneca', 'acreditación', 'sexenio', 'docentia', 'plaza'],
        salary_mean: 42000, income_tier: 'medium_high', has_deadline: false,
      },
      abogado_autonomo: {
        label: 'Abogado autónomo',
        queries: ['LexNet abogados problema', 'facturación electrónica abogados autónomos'],
        keywords: ['lexnet', 'facturación', 'irpf', 'turno oficio', 'honorarios'],
        salary_mean: 35000, income_tier: 'medium_high', has_deadline: false,
      },
      arquitecto: {
        label: 'Arquitecto',
        queries: ['visado colegial arquitectos', 'licencia obras ayuntamiento lentitud'],
        keywords: ['visado colegial', 'licencia obras', 'burocracia', 'certificado energético'],
        salary_mean: 28500, income_tier: 'medium', has_deadline: false,
      },
    },
    local_news: {
      location: 'Cádiz',
      feeds: ['https://www.diariodecadiz.es/rss/', 'https://www.europasur.es/rss/', 'https://www.lavozdigital.es/rss/2.0/'],
    },
  },
  synthesis_segments: {
    dentista:              { label: 'Odontólogo / Clínica dental', keywords: ['Verifactu', 'gestión clínica', 'seguros'],  salary_mean: 65000 },
    docente_universitario: { label: 'Docente universitario',       keywords: ['ANECA', 'sexenios', 'burocracia'],          salary_mean: 42000 },
    abogado_autonomo:      { label: 'Abogado autónomo',            keywords: ['LexNet', 'IVA', 'expedientes'],             salary_mean: 48000 },
    arquitecto:            { label: 'Arquitecto',                  keywords: ['visado', 'presupuestos', 'certificados'],   salary_mean: 44000 },
  },
};

let cachedConfig: Config | null = null;
let cachedVersion: string | null = null;

export async function getConfig(db: D1Database): Promise<Config> {
  const row = await db.prepare("SELECT updated_at FROM config WHERE key = 'app'").first<{ updated_at: string }>();
  if (row && cachedConfig && cachedVersion === row.updated_at) return cachedConfig;
  if (row) {
    const full = await db.prepare("SELECT value FROM config WHERE key = 'app'").first<{ value: string }>();
    if (full) {
      cachedConfig = JSON.parse(full.value) as Config;
      cachedVersion = row.updated_at;
      return cachedConfig;
    }
  }
  return DEFAULT_CONFIG;
}

export async function setConfig(db: D1Database, value: Config): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES ('app', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(JSON.stringify(value), now).run();
  cachedConfig = value;
  cachedVersion = now;
}

export function invalidateCache(): void {
  cachedConfig = null;
  cachedVersion = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/config.ts
git commit -m "feat: add infrastructure/config.ts with typed Config"
```

---

## Task 6: Infrastructure — LLM chain

**Files:**
- Create: `worker/infrastructure/llm/chain.ts`

- [ ] **Step 1: Create `worker/infrastructure/llm/chain.ts`**

```typescript
import type { ILLMProvider } from '../../application/ports.js';
import type { Config } from '../../domain/types.js';

const PROVIDER_URLS: Record<string, string> = {
  groq:       'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

export class LLMChain implements ILLMProvider {
  constructor(
    private cfg: Config['llm'],
    private groqKey: string | undefined,
    private openrouterKey: string | undefined,
  ) {}

  async complete(prompt: string, maxTokens: number): Promise<string> {
    const keyFor = (provider: string) =>
      provider === 'groq' ? this.groqKey : this.openrouterKey;

    const primaryUrl = PROVIDER_URLS[this.cfg.primary_provider];
    const primaryKey = keyFor(this.cfg.primary_provider);

    if (primaryUrl && primaryKey) {
      try {
        return await _call(primaryUrl, primaryKey, this.cfg.primary_model, prompt, maxTokens);
      } catch (e) {
        console.error(`${this.cfg.primary_provider} failed, falling back:`, (e as Error).message);
      }
    }

    const fallbackUrl = PROVIDER_URLS[this.cfg.fallback_provider];
    const fallbackKey = keyFor(this.cfg.fallback_provider);
    if (fallbackUrl && fallbackKey) {
      return await _call(fallbackUrl, fallbackKey, this.cfg.fallback_model, prompt, maxTokens);
    }

    throw new Error('No LLM key available (GROQ_API_KEY or OPENROUTER_API_KEY required)');
  }
}

async function _call(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  const data = await res.json<{ choices: { message: { content: string } }[] }>();
  if (!data.choices?.length) throw new Error(`Empty choices from ${url}`);
  return data.choices[0].message.content.trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/llm/chain.ts
git commit -m "feat: add LLMChain infrastructure adapter"
```

---

## Task 7: Infrastructure — notify.ts

**Files:**
- Create: `worker/infrastructure/notify.ts`

- [ ] **Step 1: Create `worker/infrastructure/notify.ts`**

The `SendEmail` binding type from `[[send_email]]` in wrangler.toml has a `.send()` method. Define it inline since the exact type may vary by `@cloudflare/workers-types` version:

```typescript
import type { INotifier } from '../application/ports.js';
import type { Config } from '../domain/types.js';

interface EmailBinding {
  send(msg: {
    to: string;
    from: { email: string; name: string };
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

export class EmailNotifier implements INotifier {
  constructor(
    private email: EmailBinding | undefined,
    private cfg: Config['notifications'],
  ) {}

  async send(subject: string, html: string, text: string): Promise<boolean> {
    const { from, recipient } = this.cfg;
    if (!this.email || !recipient || !from) return false;
    try {
      await this.email.send({
        to: recipient,
        from: { email: from, name: 'Market Intel' },
        subject,
        html,
        text,
      });
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/notify.ts
git commit -m "feat: add EmailNotifier infrastructure adapter"
```

---

## Task 8: Infrastructure — D1 repository (with integration tests)

**Files:**
- Create: `worker/infrastructure/db/d1-repo.ts`
- Create: `worker/test/integration/d1-repo.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `worker/test/integration/d1-repo.test.ts`:

```typescript
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { D1Repo } from '../../infrastructure/db/d1-repo.js';
import type { Signal, Opportunity } from '../../domain/types.js';

const baseSignal: Omit<Signal, 'id' | 'url'> = {
  source: 'gnews',
  collected_at: new Date().toISOString(),
  segment: 'seg_a',
  location: null,
  raw_text: 'test text',
  pain_keywords: ['problema', 'multa'],
  sentiment_score: -0.5,
  salary_mean: 40000,
  income_tier: 'medium',
  signal_strength: 0.7,
  has_deadline: false,
};

describe('D1Repo — signals', () => {
  let repo: D1Repo;

  beforeEach(async () => {
    repo = new D1Repo(env.DB);
    await env.DB.prepare('DELETE FROM signals').run();
  });

  it('saves a signal and returns true', async () => {
    const ok = await repo.save({ ...baseSignal, id: 'sig-1', url: 'https://a.com/1' });
    expect(ok).toBe(true);
  });

  it('returns false for duplicate url+segment', async () => {
    await repo.save({ ...baseSignal, id: 'sig-1', url: 'https://a.com/1' });
    const dup = await repo.save({ ...baseSignal, id: 'sig-2', url: 'https://a.com/1' });
    expect(dup).toBe(false);
  });

  it('counts by segment', async () => {
    await repo.save({ ...baseSignal, id: 's1', url: 'https://a.com/1' });
    await repo.save({ ...baseSignal, id: 's2', url: 'https://a.com/2' });
    await repo.save({ ...baseSignal, id: 's3', url: 'https://b.com/1', segment: 'seg_b' });
    expect(await repo.count('seg_a')).toBe(2);
    expect(await repo.count('seg_b')).toBe(1);
    expect(await repo.count()).toBe(3);
  });

  it('deserialises pain_keywords as array', async () => {
    await repo.save({ ...baseSignal, id: 's1', url: 'https://a.com/1' });
    const [sig] = await repo.get('seg_a', 10);
    expect(sig.pain_keywords).toEqual(['problema', 'multa']);
  });
});

describe('D1Repo — opportunities', () => {
  let repo: D1Repo;

  beforeEach(async () => {
    repo = new D1Repo(env.DB);
    await env.DB.prepare('DELETE FROM opportunities').run();
  });

  const baseOpp: Opportunity = {
    id: 'opp-1', segment: 'seg_a', pain_summary: 'test dolor',
    score: 7.5,
    score_breakdown: { dolor: 8, capacidad_pago: 7, volumen: 6, competencia: 5, urgencia: 10 },
    signal_ids: ['s1', 's2'], signal_count: 2,
    first_seen: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    status: 'watching', landing_url: null, emails_captured: 0,
    validation_deadline: null, telegram_alerted_at: null,
  };

  it('upserts and retrieves by segment', async () => {
    await repo.upsert(baseOpp);
    const result = await repo.getBySegment('seg_a');
    expect(result?.score).toBe(7.5);
    expect(result?.score_breakdown.dolor).toBe(8);
  });

  it('updates score on second upsert', async () => {
    await repo.upsert(baseOpp);
    await repo.upsert({ ...baseOpp, score: 9.0, last_updated: new Date().toISOString() });
    const result = await repo.getBySegment('seg_a');
    expect(result?.score).toBe(9.0);
  });
});
```

- [ ] **Step 2: Run integration tests — expect fail**

```bash
npm run test:integration 2>&1 | tail -5
```

Expected: `Cannot find module '../../infrastructure/db/d1-repo.js'`

- [ ] **Step 3: Create `worker/infrastructure/db/d1-repo.ts`**

```typescript
import type { D1Database } from '@cloudflare/workers-types';
import type { ISignalRepo, IOpportunityRepo, ILeadRepo, IDiscoveryRepo } from '../../application/ports.js';
import type { Signal, Opportunity, Lead, DiscoveryCandidate, SegmentConfig } from '../../domain/types.js';

type D1SignalRow = Omit<Signal, 'pain_keywords' | 'has_deadline'> & {
  pain_keywords: string;
  has_deadline: 0 | 1;
};

type D1OpportunityRow = Omit<Opportunity, 'score_breakdown' | 'signal_ids'> & {
  score_breakdown: string;
  signal_ids: string;
};

function rowToSignal(r: D1SignalRow): Signal {
  return { ...r, pain_keywords: JSON.parse(r.pain_keywords || '[]'), has_deadline: r.has_deadline === 1 };
}

function rowToOpportunity(r: D1OpportunityRow): Opportunity {
  return { ...r, score_breakdown: JSON.parse(r.score_breakdown || '{}'), signal_ids: JSON.parse(r.signal_ids || '[]') };
}

export class D1Repo implements ISignalRepo, IOpportunityRepo, ILeadRepo, IDiscoveryRepo {
  constructor(private db: D1Database) {}

  // ISignalRepo
  async save(s: Signal): Promise<boolean> {
    const dup = await this.db.prepare('SELECT 1 FROM signals WHERE url=? AND segment=? LIMIT 1').bind(s.url, s.segment).first();
    if (dup) return false;
    await this.db.prepare(`
      INSERT INTO signals (id,source,collected_at,segment,location,raw_text,url,
        pain_keywords,sentiment_score,salary_mean,income_tier,signal_strength,has_deadline)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      s.id, s.source, s.collected_at, s.segment,
      s.location ?? null, (s.raw_text || '').slice(0, 2000), s.url,
      JSON.stringify(s.pain_keywords ?? []),
      s.sentiment_score ?? null, s.salary_mean ?? null,
      s.income_tier ?? null, s.signal_strength ?? null,
      s.has_deadline ? 1 : 0,
    ).run();
    return true;
  }

  async get(segment: string, limit: number): Promise<Signal[]> {
    const { results } = await this.db.prepare(
      'SELECT * FROM signals WHERE segment=? ORDER BY collected_at DESC LIMIT ?',
    ).bind(segment, limit).all<D1SignalRow>();
    return (results ?? []).map(rowToSignal);
  }

  async getAll(limit: number): Promise<Signal[]> {
    const { results } = await this.db.prepare(
      'SELECT * FROM signals ORDER BY collected_at DESC LIMIT ?',
    ).bind(limit).all<D1SignalRow>();
    return (results ?? []).map(rowToSignal);
  }

  async count(segment?: string): Promise<number> {
    const row = segment
      ? await this.db.prepare('SELECT COUNT(*) as n FROM signals WHERE segment=?').bind(segment).first<{ n: number }>()
      : await this.db.prepare('SELECT COUNT(*) as n FROM signals').first<{ n: number }>();
    return row?.n ?? 0;
  }

  // IOpportunityRepo
  async upsert(o: Opportunity): Promise<void> {
    await this.db.prepare(`
      INSERT INTO opportunities
        (id,segment,pain_summary,score,score_breakdown,signal_ids,
         signal_count,first_seen,last_updated,status,landing_url,
         emails_captured,validation_deadline,telegram_alerted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        score=excluded.score, score_breakdown=excluded.score_breakdown,
        signal_ids=excluded.signal_ids, signal_count=excluded.signal_count,
        last_updated=excluded.last_updated, status=excluded.status,
        emails_captured=excluded.emails_captured, landing_url=excluded.landing_url,
        validation_deadline=excluded.validation_deadline,
        telegram_alerted_at=excluded.telegram_alerted_at
    `).bind(
      o.id, o.segment, o.pain_summary ?? null, o.score,
      JSON.stringify(o.score_breakdown), JSON.stringify(o.signal_ids),
      o.signal_count, o.first_seen, o.last_updated,
      o.status, o.landing_url ?? null, o.emails_captured ?? 0,
      o.validation_deadline ?? null, o.telegram_alerted_at ?? null,
    ).run();
  }

  async getAll(): Promise<Opportunity[]> {
    const { results } = await this.db.prepare('SELECT * FROM opportunities ORDER BY score DESC').all<D1OpportunityRow>();
    return (results ?? []).map(rowToOpportunity);
  }

  async getBySegment(segment: string): Promise<Opportunity | null> {
    const row = await this.db.prepare('SELECT * FROM opportunities WHERE segment=? LIMIT 1').bind(segment).first<D1OpportunityRow>();
    return row ? rowToOpportunity(row) : null;
  }

  async markAlerted(id: string, at: string): Promise<void> {
    await this.db.prepare('UPDATE opportunities SET telegram_alerted_at=? WHERE id=?').bind(at, id).run();
  }

  // ILeadRepo
  async saveLead(email: string, segment: string): Promise<void> {
    await this.db.prepare(
      'INSERT OR IGNORE INTO leads (email,segment,captured_at) VALUES (?,?,?)',
    ).bind(email, segment, new Date().toISOString()).run();
  }

  async getLeads(segment?: string): Promise<Lead[]> {
    const { results } = segment
      ? await this.db.prepare('SELECT email,segment,captured_at FROM leads WHERE segment=? ORDER BY captured_at DESC').bind(segment).all<Lead>()
      : await this.db.prepare('SELECT email,segment,captured_at FROM leads ORDER BY captured_at DESC LIMIT 200').all<Lead>();
    return results ?? [];
  }

  // IDiscoveryRepo
  async saveCandidates(candidates: DiscoveryCandidate[]): Promise<void> {
    if (!candidates.length) return;
    const stmt = this.db.prepare(`
      INSERT INTO discovery_candidates
        (profile,pain,keywords,post_count,discovery_score,income_est,has_deadline,source,run_id,discovered_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    await this.db.batch(candidates.map(c => stmt.bind(
      c.profile, c.pain, JSON.stringify(c.keywords || []),
      c.post_count || 0, c.discovery_score || 0,
      c.income_est || null, c.has_deadline ? 1 : 0,
      c.source || 'reddit', c.run_id, c.discovered_at,
    )));
  }

  async getLatestCandidates(): Promise<{ run_id: string; candidates: DiscoveryCandidate[]; discovered_at: string } | null> {
    const latest = await this.db.prepare(
      'SELECT run_id,discovered_at FROM discovery_candidates ORDER BY id DESC LIMIT 1',
    ).first<{ run_id: string; discovered_at: string }>();
    if (!latest) return null;
    const { results } = await this.db.prepare(
      'SELECT * FROM discovery_candidates WHERE run_id=? ORDER BY discovery_score DESC LIMIT 20',
    ).bind(latest.run_id).all<Record<string, unknown>>();
    const candidates = (results ?? []).map(r => ({
      profile: r.profile as string,
      pain: r.pain as string,
      keywords: JSON.parse(r.keywords as string || '[]') as string[],
      post_count: r.post_count as number,
      discovery_score: r.discovery_score as number,
      income_est: r.income_est as string | null,
      has_deadline: r.has_deadline === 1,
      source: r.source as string,
      run_id: r.run_id as string,
      discovered_at: r.discovered_at as string,
    }));
    return { run_id: latest.run_id, candidates, discovered_at: latest.discovered_at };
  }

  async getSegmentsToScore(topN: number, minScore: number): Promise<SegmentConfig[]> {
    const segments = new Map<string, SegmentConfig>();
    const latestRun = await this.db.prepare(
      'SELECT run_id FROM discovery_candidates ORDER BY id DESC LIMIT 1',
    ).first<{ run_id: string }>();
    if (latestRun) {
      const { results } = await this.db.prepare(
        'SELECT * FROM discovery_candidates WHERE run_id=? AND discovery_score>=? ORDER BY discovery_score DESC LIMIT ?',
      ).bind(latestRun.run_id, minScore, topN).all<Record<string, unknown>>();
      for (const c of results ?? []) {
        const key = (c.profile as string).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
        segments.set(key, {
          key, label: c.profile as string,
          keywords: JSON.parse(c.keywords as string || '[]') as string[],
          income_tier: (c.income_est as string) || 'medium',
          has_deadline: c.has_deadline === 1,
          discovery_score: (c.discovery_score as number) ?? 0,
        });
      }
    }
    const { results: leadSegs } = await this.db.prepare('SELECT DISTINCT segment FROM leads').all<{ segment: string }>();
    for (const r of leadSegs ?? []) {
      if (!segments.has(r.segment)) {
        segments.set(r.segment, { key: r.segment, label: r.segment, keywords: [], income_tier: 'medium', has_deadline: false, discovery_score: 0 });
      }
    }
    return Array.from(segments.values());
  }

  async getLandingHtml(segment: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT html FROM landing_pages WHERE segment=? LIMIT 1').bind(segment).first<{ html: string }>();
    return row?.html ?? null;
  }

  async saveLanding(segment: string, html: string, title: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO landing_pages (segment,html,title,deployed_at) VALUES (?,?,?,?)
      ON CONFLICT(segment) DO UPDATE SET html=excluded.html,title=excluded.title,deployed_at=excluded.deployed_at
    `).bind(segment, html, title, new Date().toISOString()).run();
  }
}
```

- [ ] **Step 4: Run integration tests — expect all pass**

```bash
npm run test:integration 2>&1 | tail -10
```

Expected: all D1Repo tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/db/d1-repo.ts src/main/infrastructure/worker/test/integration/d1-repo.test.ts
git commit -m "feat: add D1Repo with integration tests"
```

---

## Task 9: Infrastructure — collectors

**Files:**
- Create: `worker/infrastructure/collectors/gnews.ts`
- Create: `worker/infrastructure/collectors/local_news.ts`

Both collectors now return `Signal[]` instead of writing to D1 directly. The `collect` use case handles persistence.

- [ ] **Step 1: Create `worker/infrastructure/collectors/gnews.ts`**

```typescript
import type { Signal, GnewsSegmentConfig } from '../../domain/types.js';

const GNEWS_BASE = 'https://news.google.com/rss/search?hl=es&gl=ES&ceid=ES:es&q=';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };
const NEG_WORDS = ['problema','horrible','imposible','multa','burocracia','lento','caro','queja','odio','caos','frustrado','harto','fallo'];

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => NEG_WORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, len: number): number {
  const kwScore  = Math.min(matchedKw / 3, 1.0);
  const sentScore = Math.min(Math.abs(sent), 1.0);
  const lenScore  = Math.min(len / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sentScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function fetchFeed(query: string): Promise<{ title: string; link: string; desc: string }[]> {
  const url = GNEWS_BASE + encodeURIComponent(query);
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const xml = await r.text();
  const items: { title: string; link: string; desc: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block) || [])[1] || '';
    const link  = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || '';
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || /<description>(.*?)<\/description>/.exec(block) || [])[1] || '';
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
  }
  return items.slice(0, 20);
}

export async function collectGnews(segments: Record<string, GnewsSegmentConfig>): Promise<Signal[]> {
  const signals: Signal[] = [];
  for (const [segment, cfg] of Object.entries(segments)) {
    for (const query of cfg.queries) {
      try {
        const items = await fetchFeed(query);
        for (const item of items) {
          const text = `${item.title}. ${item.desc}`;
          const sent = sentimentScore(text);
          const matchedKw = cfg.keywords.filter(kw => text.toLowerCase().includes(kw));
          if (matchedKw.length === 0 && sent > -0.03) continue;
          signals.push({
            id: shortId(),
            source: 'gnews',
            collected_at: new Date().toISOString(),
            segment,
            location: 'España',
            raw_text: text,
            url: item.link || `gnews://${shortId()}`,
            pain_keywords: matchedKw,
            sentiment_score: sent,
            salary_mean: cfg.salary_mean,
            income_tier: cfg.income_tier,
            signal_strength: signalStrength(matchedKw.length, sent, text.length),
            has_deadline: cfg.has_deadline,
          });
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`gnews ${segment} "${query}":`, (e as Error).message);
      }
    }
  }
  return signals;
}
```

- [ ] **Step 2: Create `worker/infrastructure/collectors/local_news.ts`**

```typescript
import type { Signal } from '../../domain/types.js';

const PAIN_KEYWORDS = [
  'problema','queja','multa','burocracia','retraso','lento','caro',
  'imposible','denuncia','fallo','error','cierre','crisis','huelga',
  'protesta','reclamación','sanción','deuda','impago','colapso',
];

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

function sentimentScore(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => PAIN_KEYWORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKw: number, sent: number, len: number): number {
  const kwScore   = Math.min(matchedKw / 3, 1.0);
  const sentScore = Math.min(Math.abs(sent), 1.0);
  const lenScore  = Math.min(len / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sentScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function fetchFeed(url: string): Promise<{ title: string; link: string; desc: string }[]> {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const xml = await r.text();
  const items: { title: string; link: string; desc: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block) || [])[1] || '';
    const link  = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || '';
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || /<description>(.*?)<\/description>/.exec(block) || [])[1] || '';
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
  }
  return items.slice(0, 20);
}

export async function collectLocalNews(cfg: { location: string; feeds: string[] }): Promise<Signal[]> {
  const signals: Signal[] = [];
  if (!cfg.feeds?.length) return signals;
  for (const feedUrl of cfg.feeds) {
    try {
      const items = await fetchFeed(feedUrl);
      for (const item of items) {
        const text    = `${item.title}. ${item.desc}`;
        const sent    = sentimentScore(text);
        const matched = PAIN_KEYWORDS.filter(kw => text.toLowerCase().includes(kw));
        if (matched.length === 0 && sent > -0.03) continue;
        signals.push({
          id: shortId(),
          source: 'local_news',
          collected_at: new Date().toISOString(),
          segment: 'general',
          location: cfg.location,
          raw_text: text,
          url: item.link || `local_news://${shortId()}`,
          pain_keywords: matched,
          sentiment_score: sent,
          salary_mean: null,
          income_tier: null,
          signal_strength: signalStrength(matched.length, sent, text.length),
          has_deadline: false,
        });
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`local_news "${feedUrl}":`, (e as Error).message);
    }
  }
  return signals;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/collectors/
git commit -m "feat: migrate collectors to TS, return Signal[] instead of writing D1 directly"
```

---

## Task 10: Application use cases

**Files:**
- Create: `worker/application/collect.ts`
- Create: `worker/application/score.ts`
- Create: `worker/application/discover.ts`
- Create: `worker/application/synthesize.ts`

- [ ] **Step 1: Create `worker/application/collect.ts`**

```typescript
import type { ISignalRepo } from './ports.js';
import type { Signal } from '../domain/types.js';

export type CollectorFn = () => Promise<Signal[]>;

export async function runCollect(
  repo: ISignalRepo,
  collectors: CollectorFn[],
): Promise<number> {
  let total = 0;
  for (const collector of collectors) {
    const signals = await collector();
    for (const signal of signals) {
      const saved = await repo.save(signal);
      if (saved) total++;
    }
  }
  console.log(`collect: ${total} new signals`);
  return total;
}
```

- [ ] **Step 2: Create `worker/application/score.ts`**

```typescript
import type { ISignalRepo, IOpportunityRepo, IDiscoveryRepo, INotifier } from './ports.js';
import type { Config, Opportunity } from '../domain/types.js';
import {
  computeOpportunityScore, incomeTierScore, urgencyScore, volumeScore,
  dolorScore, applyRules, shouldAlert, formatAlert,
} from '../domain/scoring.js';
import { ALERT_SCORE_THRESHOLD } from '../domain/rules.js';

export interface ScoreResult {
  segment: string;
  score: number;
  status: string;
  signal_count: number;
  breakdown: Record<string, number>;
  pain_summary: string;
}

export async function runScore(
  signalRepo: ISignalRepo,
  oppRepo: IOpportunityRepo & { markAlerted: (id: string, at: string) => Promise<void> },
  discoveryRepo: IDiscoveryRepo,
  notifier: INotifier,
  config: Config,
  topN = 10,
  minScore = 1.0,
  dryRun = false,
): Promise<ScoreResult[]> {
  const segments = await discoveryRepo.getSegmentsToScore(topN, minScore);
  const results: ScoreResult[] = [];

  for (const seg of segments) {
    const signals = await signalRepo.get(seg.key, 500);
    const signalCount = await signalRepo.count(seg.key);

    const { score: dolor, summary: painSummary } = dolorScore(signals);
    const breakdown = {
      dolor,
      capacidad_pago: incomeTierScore(seg.income_tier),
      volumen: volumeScore(seg.discovery_score),
      competencia: config.score.default_competencia_score,
      urgencia: urgencyScore(seg.has_deadline),
    };
    const score = computeOpportunityScore(breakdown);

    const existing = await oppRepo.getBySegment(seg.key);
    const now = new Date().toISOString();

    const opp: Opportunity = {
      id: existing?.id ?? crypto.randomUUID().slice(0, 8),
      segment: seg.key,
      pain_summary: painSummary || existing?.pain_summary || '',
      score,
      score_breakdown: breakdown,
      signal_ids: signals.slice(-50).map(s => s.id),
      signal_count: signalCount,
      first_seen: existing?.first_seen ?? now,
      last_updated: now,
      status: existing?.status ?? 'watching',
      landing_url: existing?.landing_url ?? null,
      emails_captured: existing?.emails_captured ?? 0,
      validation_deadline: null,
      telegram_alerted_at: existing?.telegram_alerted_at ?? null,
    };

    const finalOpp = applyRules(opp);

    if (!dryRun) {
      await oppRepo.upsert(finalOpp);

      if (finalOpp.score >= ALERT_SCORE_THRESHOLD && finalOpp.status === 'watching' && shouldAlert(finalOpp)) {
        const msg = formatAlert(finalOpp, seg);
        const textLines = [
          `Oportunidad detectada: ${seg.label}`,
          `Score: ${finalOpp.score}/10`,
          `Señales: ${finalOpp.signal_count}`,
          `Resumen: ${finalOpp.pain_summary}`,
        ];
        const htmlLines = [
          `<h2>Oportunidad detectada: ${seg.label}</h2>`,
          `<p>Score: ${finalOpp.score}/10</p>`,
          `<p>Señales: ${finalOpp.signal_count}</p>`,
          `<p>Resumen: ${finalOpp.pain_summary}</p>`,
        ];
        const sent = await notifier.send('Oportunidad detectada', htmlLines.join('\n'), textLines.join('\n'));
        if (sent) await oppRepo.markAlerted(finalOpp.id, now);
      }
    }

    results.push({ segment: seg.key, score: finalOpp.score, status: finalOpp.status, signal_count: finalOpp.signal_count, breakdown, pain_summary: finalOpp.pain_summary });
  }

  return results.sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 3: Create `worker/application/discover.ts`**

```typescript
import type { ILLMProvider, IDiscoveryRepo, INotifier } from './ports.js';
import type { Config, DiscoveryCandidate } from '../domain/types.js';

const CLUSTER_PROMPT = `Analiza estos textos de noticias y foros profesionales.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en: {known}.

TEXTOS:
{posts}

Para cada perfil nuevo devuelve JSON:
{"profile":"...","pain":"...","keywords":["..."],"post_count":N,"income_estimate":"high|medium_high|medium|low","has_deadline":true|false}

Devuelve SOLO un array JSON válido. Si no hay perfiles nuevos devuelve [].`;

export async function runDiscovery(
  llm: ILLMProvider,
  discoveryRepo: IDiscoveryRepo,
  notifier: INotifier,
  config: Config,
  limit = 60,
): Promise<DiscoveryCandidate[]> {
  const disc = config.discover;
  const texts = await collectBroad(disc, limit);
  if (!texts.length) return [];

  const allClusters: RawCluster[] = [];
  const toProcess = texts.slice(0, disc.text_limit);
  for (let i = 0; i < toProcess.length; i += disc.batch_size) {
    const batch = toProcess.slice(i, i + disc.batch_size);
    const clusters = await clusterBatch(batch, disc.known_segments, llm);
    allClusters.push(...clusters);
  }

  const candidates = aggregate(allClusters);
  if (!candidates.length) return [];

  const run_id = new Date().toISOString();
  const now = run_id;
  await discoveryRepo.saveCandidates(
    candidates.map(c => ({ ...c, source: 'web', run_id, discovered_at: now })),
  );

  const top5 = candidates.slice(0, 5);
  const textLines = ['Segmentos ocultos detectados\n', ...top5.map((c, i) => `${i + 1}. ${c.profile} — Dolor: ${c.pain} — Score: ${c.discovery_score}`)];
  const htmlLines = ['<h2>Segmentos ocultos detectados</h2>', ...top5.map((c, i) => `<p><strong>${i + 1}. ${c.profile}</strong><br>Dolor: ${c.pain}<br>Score: ${c.discovery_score}</p>`)];
  await notifier.send('Segmentos ocultos detectados', htmlLines.join('\n'), textLines.join('\n'));

  return candidates;
}

interface RawCluster {
  profile: string;
  pain: string;
  keywords: string[];
  post_count: number;
  income_estimate?: string;
  has_deadline?: boolean;
  batch_count: number;
}

async function collectBroad(disc: Config['discover'], limit: number): Promise<string[]> {
  const texts: string[] = [];
  for (const query of disc.hn_queries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story,ask_hn&hitsPerPage=12`;
      const res = await fetch(url, { headers: { 'User-Agent': 'market-intel/0.1' } });
      if (!res.ok) continue;
      const data = await res.json<{ hits: { title: string; story_text?: string }[] }>();
      for (const hit of data.hits ?? []) {
        const title = (hit.title || '').trim();
        const body  = (hit.story_text || '').slice(0, 200).trim();
        if (title) texts.push(body ? `${title} — ${body}` : title);
      }
    } catch (e) { console.error(`HN '${query}':`, (e as Error).message); }
  }
  for (const query of disc.news_queries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`;
      const res = await fetch(url, { headers: { 'User-Agent': 'market-intel/0.1' } });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = [...text.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)];
      for (const m of matches.slice(1, 11)) {
        const title = (m[1] || m[2] || '').trim();
        if (title) texts.push(title);
      }
    } catch (e) { console.error(`News RSS '${query}':`, (e as Error).message); }
  }
  return texts.slice(0, limit);
}

async function clusterBatch(texts: string[], known: string[], llm: ILLMProvider): Promise<RawCluster[]> {
  const prompt = CLUSTER_PROMPT
    .replace('{known}', known.join(', '))
    .replace('{posts}', texts.map((t, i) => `${i + 1}. ${t}`).join('\n'));
  try {
    let raw = await llm.complete(prompt, 600);
    raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((c: unknown) => ({ batch_count: 1, ...(c as RawCluster) }));
  } catch (e) {
    console.error('cluster batch failed:', (e as Error).message);
    return [];
  }
}

function aggregate(clusters: RawCluster[]): Omit<DiscoveryCandidate, 'source' | 'run_id' | 'discovered_at'>[] {
  const merged: RawCluster[] = [];
  for (const c of clusters) {
    if (!c.profile) continue;
    const kwLower = (c.keywords || []).map(k => k.toLowerCase());
    const existing = merged.find(m =>
      kwLower.filter(k => (m.keywords || []).map(x => x.toLowerCase()).includes(k)).length >= 2,
    );
    if (existing) {
      existing.post_count = (existing.post_count || 0) + Math.min(c.post_count || 1, 15);
      existing.batch_count += 1;
    } else {
      merged.push({ ...c, keywords: c.keywords || [], batch_count: 1, post_count: Math.min(c.post_count || 1, 15) });
    }
  }
  return merged
    .map(m => ({
      profile: m.profile,
      pain: m.pain,
      keywords: m.keywords || [],
      post_count: m.post_count || 1,
      discovery_score: Math.round((m.post_count || 1) * (1 + m.batch_count * 0.5) * 10) / 10,
      income_est: m.income_estimate || null,
      has_deadline: m.has_deadline || false,
    }))
    .sort((a, b) => b.discovery_score - a.discovery_score);
}
```

- [ ] **Step 4: Create `worker/application/synthesize.ts`**

```typescript
import type { ILLMProvider } from './ports.js';
import type { Config, LandingCopy } from '../domain/types.js';

const SYNTHESIS_PROMPT = `Eres un copywriter B2B especializado en SaaS para profesionales autónomos españoles.

Tu tarea: escribir el copy de una landing page de validación usando ÚNICAMENTE el lenguaje que aparece en las quejas reales que te doy. Nada de marketing genérico.

CONTEXTO:
- Perfil objetivo: {segment_label}
- Dolores más mencionados: {top_keywords}
- Salario medio del segmento: {salary_mean}€/año
{deadline_note}

REGLAS:
1. El headline debe nombrar el PROBLEMA, no la solución. Usa palabras del corpus.
2. El subtitle amplía el problema con datos concretos.
3. Cada uno de los 3 beneficios resuelve uno de los 3 dolores más frecuentes.
4. El CTA genera urgencia sin ser agresivo (no uses "GRATIS" ni "AHORA").
5. Todo en español. Tono directo, sin eufemismos corporativos.

Devuelve ÚNICAMENTE JSON válido, sin texto previo ni backticks:
{"headline":"...","subtitle":"...","benefits":[{"title":"...","desc":"...","emoji":"..."},{"title":"...","desc":"...","emoji":"..."},{"title":"...","desc":"...","emoji":"..."}],"cta":"..."}`;

export async function synthesizeCopy(
  segment: string,
  llm: ILLMProvider,
  config: Config,
): Promise<LandingCopy> {
  const seg = config.synthesis_segments[segment] || { label: segment, keywords: [], salary_mean: 'N/A' };
  const prompt = SYNTHESIS_PROMPT
    .replace('{segment_label}', seg.label)
    .replace('{top_keywords}', seg.keywords.join(', '))
    .replace('{salary_mean}', String(seg.salary_mean))
    .replace('{deadline_note}', '');

  let raw = await llm.complete(prompt, 800);
  if (raw.startsWith('```')) {
    raw = raw.split('```')[1];
    if (raw.startsWith('json')) raw = raw.slice(4).trim();
  }
  const parsed = JSON.parse(raw) as { headline: string; subtitle: string; benefits: { title: string; desc: string; emoji: string }[]; cta: string };
  return {
    title:    parsed.headline,
    subtitle: parsed.subtitle,
    benefits: parsed.benefits.slice(0, 3).map(b => [b.title, b.desc, b.emoji] as [string, string, string]),
    cta:      parsed.cta,
  };
}

export function buildHtml(segment: string, copy: LandingCopy): string {
  const { title, subtitle, benefits = [], cta = 'Quiero acceso prioritario' } = copy;
  const benefitsHtml = benefits.map(([t, d, e]) =>
    `<div class="benefit"><span class="emoji">${e || ''}</span><h3>${t}</h3><p>${d}</p></div>`
  ).join('\n');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 680px; padding: 48px 24px; text-align: center; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; color: #f1f5f9; line-height: 1.2; margin-bottom: 20px; }
    .subtitle { font-size: 1.1rem; color: #94a3b8; margin-bottom: 40px; line-height: 1.6; }
    .benefits { display: grid; gap: 20px; margin-bottom: 40px; text-align: left; }
    .benefit { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
    .emoji { font-size: 1.5rem; }
    .benefit h3 { font-size: 1rem; font-weight: 700; color: #f1f5f9; margin: 8px 0 4px; }
    .benefit p { font-size: 0.875rem; color: #64748b; line-height: 1.5; }
    form { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
    input[type=email] { flex: 1; min-width: 220px; padding: 14px 18px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 1rem; }
    button { padding: 14px 28px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .success { display: none; color: #22c55e; margin-top: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    <div class="benefits">${benefitsHtml}</div>
    <form id="form" action="/signup" method="POST">
      <input type="hidden" name="segment" value="${segment}">
      <input type="email" name="email" placeholder="tu@email.com" required>
      <button type="submit">${cta}</button>
    </form>
    <p class="success" id="ok">✓ Apuntado. Te avisamos primero.</p>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await fetch('/signup', { method: 'POST', body: new URLSearchParams(fd) });
      e.target.style.display = 'none';
      document.getElementById('ok').style.display = 'block';
    });
  </script>
</body>
</html>`;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/application/
git commit -m "feat: add application use cases (collect, score, discover, synthesize)"
```

---

## Task 11: index.ts — composition root + routing

**Files:**
- Create: `worker/index.ts`

- [ ] **Step 1: Create `worker/index.ts`**

```typescript
import type { D1Database } from '@cloudflare/workers-types';
import { getConfig, setConfig, invalidateCache } from './infrastructure/config.js';
import { D1Repo } from './infrastructure/db/d1-repo.js';
import { LLMChain } from './infrastructure/llm/chain.js';
import { EmailNotifier } from './infrastructure/notify.js';
import { collectGnews } from './infrastructure/collectors/gnews.js';
import { collectLocalNews } from './infrastructure/collectors/local_news.js';
import { runCollect } from './application/collect.js';
import { runScore } from './application/score.js';
import { runDiscovery } from './application/discover.js';
import { synthesizeCopy, buildHtml } from './application/synthesize.js';

export interface Env {
  DB: D1Database;
  WORKER_SECRET: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  EMAIL?: {
    send(msg: { to: string; from: { email: string; name: string }; subject: string; html: string; text: string }): Promise<void>;
  };
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function isAuthed(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') && auth.slice(7) === env.WORKER_SECRET;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url    = new URL(request.url);
    const path   = url.pathname.replace(/\/$/, '');
    const method = request.method;

    // ── Public routes ──────────────────────────────────────────────────────
    if (method === 'GET') {
      try {
        const repo = new D1Repo(env.DB);
        if (path === '/public/stats') return await getStats(repo, env.DB);
        if (path === '/public/opportunities') return await getOpportunities(env.DB, url.searchParams);
        if (path === '/public/leads') return await getLeads(repo, url.searchParams);
        if (path === '/public/discovery') return await getDiscovery(repo);
        if (path === '/public/config') return json({ config: await getConfig(env.DB) });
        if (path.startsWith('/public/landings/')) {
          const segment = path.replace('/public/landings/', '');
          const html = await repo.getLandingHtml(segment);
          if (!html) return new Response('Not found', { status: 404 });
          return new Response(html, { headers: { 'Content-Type': 'text/html' } });
        }
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    if (method === 'POST' && path === '/public/signup') {
      try {
        const body = await request.json<{ email?: string; segment?: string }>();
        if (!body.email || !body.segment) return json({ error: 'email and segment required' }, 400);
        const repo = new D1Repo(env.DB);
        await repo.saveLead(body.email, body.segment);
        return json({ saved: true });
      } catch (err) {
        return json({ error: (err as Error).message }, 500);
      }
    }

    // ── Auth ───────────────────────────────────────────────────────────────
    if (!isAuthed(request, env)) return json({ error: 'unauthorized' }, 401);

    try {
      const repo = new D1Repo(env.DB);
      const cfg  = await getConfig(env.DB);
      const llm  = new LLMChain(cfg.llm, env.GROQ_API_KEY, env.OPENROUTER_API_KEY);
      const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);

      if (path === '/health' && method === 'GET')
        return json({ status: 'ok', ts: new Date().toISOString() });

      if (path === '/signals' && method === 'GET')
        return json({ results: await repo.getAll(Math.min(parseInt(url.searchParams.get('limit') || '100'), 500)) });

      if (path === '/signals' && method === 'POST') {
        const signal = await request.json();
        const inserted = await repo.save(signal);
        return json({ inserted });
      }

      if (path === '/signals/count' && method === 'GET')
        return json({ count: await repo.count(url.searchParams.get('segment') ?? undefined) });

      if (path === '/opportunities' && method === 'GET')
        return await getOpportunities(env.DB, url.searchParams);

      if (path === '/stats' && method === 'GET')
        return await getStats(repo, env.DB);

      if (path === '/config' && method === 'GET')
        return json({ config: cfg });

      if (path === '/config' && method === 'PUT') {
        const body = await request.json();
        if (!body || typeof body !== 'object') return json({ error: 'invalid config' }, 400);
        await setConfig(env.DB, body);
        invalidateCache();
        return json({ status: 'ok' });
      }

      if (path === '/synthesize' && method === 'POST') {
        const { segment } = await request.json<{ segment?: string }>();
        if (!segment) return json({ error: 'segment required' }, 400);
        const copy = await synthesizeCopy(segment, llm, cfg);
        return json({ segment, copy });
      }

      if (path === '/deploy' && method === 'POST') {
        const { segment, copy } = await request.json<{ segment?: string; copy?: unknown }>();
        if (!segment || !copy) return json({ error: 'segment and copy required' }, 400);
        const html = buildHtml(segment, copy as Parameters<typeof buildHtml>[1]);
        await repo.saveLanding(segment, html, (copy as { title: string }).title);
        const landingUrl = `https://market-intel.pages.dev/landings/${segment}`;
        await repo.upsert({ ...(await repo.getBySegment(segment) ?? {
          id: crypto.randomUUID().slice(0, 8),
          segment, pain_summary: '', score: 0,
          score_breakdown: { dolor: 0, capacidad_pago: 0, volumen: 0, competencia: 0, urgencia: 0 },
          signal_ids: [], signal_count: 0, first_seen: new Date().toISOString(),
          last_updated: new Date().toISOString(), status: 'watching' as const,
          emails_captured: 0, validation_deadline: null, telegram_alerted_at: null, landing_url: null,
        }), landing_url: landingUrl, status: 'testing', last_updated: new Date().toISOString() });
        return json({ url: landingUrl });
      }

      if (path === '/discover' && method === 'POST') {
        if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY)
          return json({ error: 'No LLM key configured' }, 503);
        const candidates = await runDiscovery(llm, repo, notifier, cfg);
        return json({ run_id: new Date().toISOString(), candidates });
      }

      if (path === '/score' && method === 'POST') {
        const body = await request.json<{ top_n?: number; min_score?: number; dry_run?: boolean }>().catch(() => ({}));
        const results = await runScore(repo, repo, repo, notifier, cfg, body.top_n ?? 10, body.min_score ?? 1.0, body.dry_run ?? false);
        return json({ results });
      }

      if (path === '/discovery/candidates' && method === 'POST') {
        const { run_id, candidates } = await request.json<{ run_id?: string; candidates?: unknown[] }>();
        if (!run_id || !Array.isArray(candidates) || !candidates.length)
          return json({ error: 'run_id and non-empty candidates required' }, 400);
        const now = new Date().toISOString();
        await repo.saveCandidates(candidates.map((c: unknown) => ({ ...(c as object), source: 'external', run_id, discovered_at: now }) as Parameters<typeof repo.saveCandidates>[0][number]));
        return json({ saved: candidates.length });
      }

      return json({ error: 'not found' }, 404);

    } catch (err) {
      console.error(path, err);
      return json({ error: (err as Error).message }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const repo = new D1Repo(env.DB);
      const cfg  = await getConfig(env.DB);
      const notifier = new EmailNotifier(env.EMAIL, cfg.notifications);
      await runCollect(repo, [
        () => collectGnews(cfg.collectors.gnews_segments),
        () => collectLocalNews(cfg.collectors.local_news),
      ]);
      await runScore(repo, repo, repo, notifier, cfg, 10, 1.0, false);
    })());
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function getStats(repo: D1Repo, db: D1Database): Promise<Response> {
  const [sigCount, oppCount, bySegRows, topRow] = await Promise.all([
    repo.count(),
    db.prepare('SELECT COUNT(*) as n FROM opportunities').first<{ n: number }>(),
    db.prepare('SELECT segment, COUNT(*) as n FROM signals GROUP BY segment').all<{ segment: string; n: number }>(),
    db.prepare('SELECT score, pain_summary FROM opportunities ORDER BY score DESC LIMIT 1').first<{ score: number; pain_summary: string }>(),
  ]);
  const by_segment: Record<string, number> = {};
  for (const r of bySegRows.results ?? []) by_segment[r.segment] = r.n;
  return json({ total_signals: sigCount, total_opportunities: oppCount?.n ?? 0, by_segment, top_opportunity: topRow ?? null, backend: 'worker+d1' });
}

async function getOpportunities(db: D1Database, params: URLSearchParams): Promise<Response> {
  const status = params.get('status');
  const { results } = status
    ? await db.prepare('SELECT * FROM opportunities WHERE status=? ORDER BY score DESC').bind(status).all()
    : await db.prepare('SELECT * FROM opportunities ORDER BY score DESC').all();
  return json({ results });
}

async function getDiscovery(repo: D1Repo): Promise<Response> {
  const data = await repo.getLatestCandidates();
  if (!data) return json({ run_id: null, candidates: [], discovered_at: null });
  return json(data);
}

async function getLeads(repo: D1Repo, params: URLSearchParams): Promise<Response> {
  const segment = params.get('segment') ?? undefined;
  const leads = await repo.getLeads(segment);
  const bySegment: Record<string, { email: string; captured_at: string }[]> = {};
  for (const l of leads) {
    if (!bySegment[l.segment]) bySegment[l.segment] = [];
    bySegment[l.segment].push({ email: l.email, captured_at: l.captured_at });
  }
  return json({ total: leads.length, by_segment: bySegment });
}
```

- [ ] **Step 2: Update `worker/wrangler.toml` — change entry point**

Open `src/main/infrastructure/worker/wrangler.toml` and change line 2:

```toml
main = "index.ts"
```

- [ ] **Step 3: Verify wrangler can build index.ts**

```bash
cd src/main/infrastructure/worker && npx wrangler deploy --dry-run 2>&1 | tail -10
```

Expected: `Total Upload: ...` or similar success message, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/index.ts src/main/infrastructure/worker/wrangler.toml
git commit -m "feat: add index.ts composition root and update wrangler entry point"
```

---

## Task 12: Delete old JS files

**Files:**
- Delete: all original flat `.js` files in `worker/`

- [ ] **Step 1: Delete old flat JS files**

```bash
rm src/main/infrastructure/worker/index.js
rm src/main/infrastructure/worker/score.js
rm src/main/infrastructure/worker/notify.js
rm src/main/infrastructure/worker/llm.js
rm src/main/infrastructure/worker/discover.js
rm src/main/infrastructure/worker/synthesize.js
rm src/main/infrastructure/worker/config.js
rm src/main/infrastructure/worker/collectors/gnews.js
rm src/main/infrastructure/worker/collectors/local_news.js
```

- [ ] **Step 2: Verify wrangler build still succeeds**

```bash
cd src/main/infrastructure/worker && npx wrangler deploy --dry-run 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Run unit tests**

```bash
npm test 2>&1 | tail -5
```

Expected: all scoring tests pass.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck 2>&1 | grep "error TS" | wc -l
```

Expected: `0`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete old flat JS files — Worker fully migrated to TypeScript + CA"
```

---

## Self-Review

**Spec coverage:**
- ✅ Strict TypeScript (`strict: true` in tsconfig)
- ✅ `@cloudflare/workers-types` for D1, Env bindings
- ✅ Domain layer: types, rules, scoring (pure functions, no I/O)
- ✅ Application layer: ports + use cases (no direct infra imports)
- ✅ Infrastructure layer: d1-repo, llm/chain, collectors, notify, config
- ✅ index.ts is the single composition root
- ✅ Unit tests: scoring.test.ts (pure functions)
- ✅ Integration tests: d1-repo.test.ts (vitest-pool-workers)
- ✅ New endpoint: `GET /public/landings/:segment`
- ✅ New endpoint: `POST /public/signup`
- ✅ Cron scheduled handler wired through use cases
- ✅ Old .js files deleted
