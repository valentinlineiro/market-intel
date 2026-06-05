# Friction Detection — Design Spec

**Date:** 2026-06-05  
**Status:** Approved

## Goal

Enrich signal quality by running LLM friction analysis on high-value signals before scoring. The result is written back to `signal.signal_strength`, so `dolorScore` and all existing scoring logic remain unchanged.

---

## Approach

New module `application/friction.ts`. Runs between `collect` and `runScore` in the cron pipeline. Enriches `signal_strength` in-place — domain layer sees no change.

```
collect → analyzeFriction → runScore → alert
```

`dolorScore` signature unchanged. Tests unchanged. Separation preserved: friction is infrastructure enrichment, scoring is pure domain.

---

## Signal Filter

Not all signals are worth LLM analysis:

| Source | Condition | Rationale |
|--------|-----------|-----------|
| `github` | Always | Heterogeneous quality, ~26 signals/cycle, high ROI |
| `gnews` / `local_news` | `ss >= 0.35` only | Below that is homogeneous noise; confidence multiplier would keep it low anyway |

Expected volume: ~1–2 GNews signals + all GitHub signals per cycle. Token budget negligible.

---

## Types (domain/types.ts)

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
  workaround: boolean | null;  // null = unknown
  has_solution: boolean | null;
  regulatory_body: string | null;
  affected_role: string | null;
  pain_summary: string;
  confidence: number;          // 0–1
}
```

---

## Module (application/friction.ts)

```typescript
export async function analyzeFriction(
  signals: Signal[],
  llm: ILLMProvider,
  repo: ISignalRepo,
): Promise<void>
```

**Filter:** applies source/ss threshold before any LLM calls.

**Per-signal LLM call** (not batched): given the volume (~28 signals/cycle), one call per signal avoids array-indexing fragility. Each call returns a single `FrictionProfile` JSON object.

**Signal strength update:**
```typescript
const quality = (fp.intensity / 10) * (0.6 + 0.4 * fp.confidence);
await repo.updateFriction(signal.id, quality, fp);
```

**Fallback:** if LLM call fails or returns invalid JSON for a signal, skip it silently — the original `signal_strength` from collection is preserved. No partial state.

---

## LLM Prompt

```
Eres un analista de pain points de profesionales. Analiza este texto y extrae el perfil de fricción.

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
}
```

Same JSON extraction pattern as `market-test.ts`: `indexOf('{')` / `lastIndexOf('}')` to handle LLM preamble.

---

## Repo Changes (ISignalRepo + d1-repo.ts)

New method on `ISignalRepo`:

```typescript
updateFriction(id: string, strength: number, profile: FrictionProfile): Promise<void>;
```

D1 implementation:
```sql
UPDATE signals
SET signal_strength = ?, friction_analysis = ?, updated_at = ?
WHERE id = ?
```

`friction_analysis` stored as JSON string.

---

## Database Migration (0008_add_friction_analysis.sql)

```sql
ALTER TABLE signals ADD COLUMN friction_analysis TEXT;
ALTER TABLE signals ADD COLUMN updated_at TEXT;
```

`signal_strength` column already exists — no schema change needed, only value updates.

---

## Cron Integration (index.ts)

```typescript
// existing
await runCollect(signalRepo, collectors);

// new — between collect and score
const freshSignals = await signalRepo.getAll(200);
await analyzeFriction(freshSignals, llm, signalRepo);

// existing
await runScore(...);
```

`getAll(200)` fetches recent signals. Friction analysis filters internally to eligible signals.

---

## Files Changed

| File | Change |
|------|--------|
| `domain/types.ts` | Add `FrictionProfile`, `ProblemType`, `PainFrequency` |
| `application/friction.ts` | New — `analyzeFriction` use case |
| `application/ports.ts` | Add `updateFriction` to `ISignalRepo` |
| `infrastructure/db/d1-repo.ts` | Implement `updateFriction` |
| `migrations/0008_add_friction_analysis.sql` | Add `friction_analysis`, `updated_at` columns |
| `index.ts` | Wire `analyzeFriction` between collect and score in cron |
| `test/unit/friction.test.ts` | New — unit tests with mock LLM |

`dolorScore`, `scoring.ts`, `runScore`, and all existing tests are unchanged.

---

## Out of Scope

- Friction analysis in market tests (market test uses `InMemorySignalRepo`, no D1)
- Dashboard display of `friction_analysis` field
- Batched LLM calls (volume doesn't justify the complexity)
- Retry logic for failed LLM calls (original `signal_strength` preserved as fallback)
