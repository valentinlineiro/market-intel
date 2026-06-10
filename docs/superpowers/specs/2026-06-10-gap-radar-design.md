# Gap Radar — Market Intelligence Expansion

**Date:** 2026-06-10  
**Status:** Approved

## Goal

Expand market signal coverage and surface unexplored opportunity gaps — segments with rising pain, low existing-solution density, and no competitor traction. The output is a ranked "Radar de Oportunidades" table in the dashboard.

## Context

The system already collects signals from 8 sources, scores segments (dolor, capacidad_pago, volumen, competencia, urgencia), and deploys landing pages. What's missing: trend tracking over time and whitespace detection (is anyone already solving this?). This design adds both.

---

## Section 1 — Data Model

### New table: `signal_snapshots`

```sql
CREATE TABLE signal_snapshots (
  segment        TEXT NOT NULL,
  week           TEXT NOT NULL,          -- ISO week: '2026-W23'
  count          INTEGER NOT NULL,
  avg_pain       REAL NOT NULL,
  solution_ratio REAL NOT NULL DEFAULT 0, -- 0 = pure pain, 1 = all solutions
  PRIMARY KEY (segment, week)
);
```

Written at the end of each cron run. Upsert semantics — safe to re-run. Retains full history (no TTL).

### Modified table: `opportunities`

```sql
ALTER TABLE opportunities ADD COLUMN gap_score REAL;
```

Computed after each snapshot run. `NULL` for segments without enough history (< 1 week).

### Modified domain type: `Opportunity` (`domain/types.ts`)

Add `gap_score?: number` to the `Opportunity` interface (after `telegram_alerted_at`).

### Modified domain type: `Config` (`domain/types.ts`)

Each new collector needs an `enabled: boolean` toggle inside `config.collectors`. Add entries for `hackernews`, `boe`, `boja`, `bocas`, `betalist`, `appsumo`, `producthunt`, `ine`. Corresponding defaults must be added to `DEFAULT_CONFIG` in `infrastructure/config.ts` (all `enabled: false` initially — opt-in).

---

## Section 2 — New Collectors

All collectors implement the existing `Collector` interface (`application/ports.ts`) and register in `infrastructure/collectors/registry.ts` behind individual config flags.

### Batch 1 — RSS / public API (no key)

| File | Source | Signal type | API |
|---|---|---|---|
| `hackernews.ts` | Hacker News | Pain | Algolia `hn.algolia.com/api/v1/search` |
| `boe.ts` | BOE | Regulation | `boe.es/datosabiertos/api/search` |
| `boja.ts` | BOJA | Regulation | RSS |
| `bocas.ts` | DOGC, DOCV, BORM, BOCyL | Regulation | RSS per community |
| `betalist.ts` | BetaList | Solution density | RSS |
| `appsumo.ts` | AppSumo | Solution density | RSS |

### Batch 2 — Free API key required

| File | Source | Signal type | Notes |
|---|---|---|---|
| `producthunt.ts` | Product Hunt | Solution density | GraphQL API, free key |
| `ine.ts` | INE | Economic context | `ine.es` JSON API |

### Batch 3 — Medium effort (separate task)

| File | Source | Signal type | Notes |
|---|---|---|---|
| `indiehackers.ts` | Indie Hackers | Pain | Structured HTML |
| `trustpilot.ts` | Trustpilot | Pain + solution | Unofficial API |
| `upwork.ts` | Upwork | Demand + budget | Unofficial API; needs ToS check |

### Signal tagging conventions

- **Regulation collectors** (`boe`, `boja`, `bocas`): pre-populate `friction_analysis` with a JSON-stringified `FrictionProfile` (`JSON.stringify({ problem_type: 'regulation', has_deadline: true, ... })`). `Signal.friction_analysis` is `string | null`, so the value must be serialized at collection time — no LLM pass needed.
- **Solution-density collectors** (`producthunt`, `betalist`, `appsumo`): add `'__solution__'` sentinel to `pain_keywords`. The gap scorer uses this to compute `solution_ratio` without LLM.
- **English solution keywords** (for HN, BetaList, AppSumo signals): `"use "`, `"tool"`, `"there is"`, `"alternative"`, `"already exists"`. Combined with the Spanish set (`"uso "`, `"utilizo "`, `"existe "`, `"herramienta"`, `"ya hay"`). Applied to `raw_text` of non-regulation signals.

---

## Section 3 — Gap Scoring Pipeline

The cron gains a new step after `runScore()`:

```
Collect → Friction → Score → Snapshot + GapScore
```

Note: alerting is embedded inside `runScore()` (not a separate step). Gap-based alerting (e.g. notify when gap_score crosses a threshold) is out of scope for v1 — the existing score-based alert remains unchanged.

### `runSnapshot()` — `application/gap.ts`

For each active segment:
1. Count signals with `collected_at` in the current ISO week.
2. Compute `avg_pain` = mean `signal_strength`, **filtering out null values** (`Signal.signal_strength` is `number | null`). If all values are null, default to 0.
3. Compute `solution_ratio` = fraction of signals with `'__solution__'` sentinel OR whose `raw_text` contains solution keywords (Spanish: `"uso "`, `"utilizo "`, `"existe "`, `"herramienta"`, `"ya hay"`; English: `"use "`, `"tool"`, `"there is"`, `"alternative"`, `"already exists"`).
4. Upsert into `signal_snapshots`.

### `runGapScore()` — `application/gap.ts`

For each segment with at least 1 snapshot:

```
momentum  = this_week_count / max(avg(last_4_weeks_count), 1)
           // max(..., 1) guards against division by zero when all prior weeks had 0 signals
           // defaults to 1.0 if < 4 weeks of history

gap_score = avg_pain × momentum × (1 − solution_ratio)
           normalized to 0–100
```

Writes result to `opportunities.gap_score`.

### Design constraints

- `gap.ts` depends on `ISignalRepo` (read signals), `IOpportunityRepo` (write gap_score), and a new `ISignalSnapshotRepo` port (read/write snapshots). No LLM dependency.
- `ISignalSnapshotRepo` needs two methods: `upsertSnapshot(snapshot)` and `getSnapshots(segment, weeksBack): SignalSnapshot[]`.
- Fully testable with mocked snapshot data.
- Idempotent: re-running the same cron week produces the same snapshot row (upsert).

---

## Section 4 — Dashboard: Radar de Oportunidades

### New API endpoint

`GET /api/gap-radar` — returns top-N segments sorted by `gap_score` descending, joining last week's `signal_snapshots` with `opportunities`. Response cached 1h (only changes after cron).

```ts
interface GapEntry {
  segment:        string;
  label:          string;
  avg_pain:       number;   // 0–10
  momentum:       number;   // ratio, e.g. 1.43 = +43%
  solution_ratio: number;   // 0–1
  gap_score:      number;   // 0–100
  has_landing:    boolean;
  opportunity_id: string | null;
}
```

### UI — new tab in dashboard

Added as a tab alongside existing Opportunities and Discovery views. No new route — server load function extended to fetch gap data in parallel.

**Table columns:**

| Segmento | 🔥 Dolor | 📈 Tendencia | 🕳 Vacío | Gap Score | Acción |
|---|---|---|---|---|---|
| contador_asesoria_fiscal | 8.2 | ▲ +43% | 82% | 94 | Desplegar |
| autonomo_logistica | 6.1 | ▲ +18% | 91% | 78 | Desplegar |
| disenador_freelance | 7.4 | → 0% | 45% | 42 | Ver |

- **Dolor** — `avg_pain` (0–10)
- **Tendencia** — momentum as `▲ +X%` / `→ 0%` / `▼ −X%` with color coding (green/grey/red)
- **Vacío** — `(1 − solution_ratio)` as percentage
- **Gap Score** — composite 0–100, sorted `gap_score DESC, avg_pain DESC` (avg_pain as tiebreaker)
- **Acción** — "Desplegar" opens DeployModal; "Ver" links to existing opportunity row

**Filters:**
- Toggle: Solo sin landing page
- Toggle: Solo regulatorios (signals from BOE/BOJA/BOCAs)
- Slider: Puntuación mínima de gap

---

## Implementation Order

1. Migration: `signal_snapshots` table + `opportunities.gap_score` column
2. `application/gap.ts`: `runSnapshot()` + `runGapScore()`
3. Wire into cron in `index.ts`
4. Batch 1 collectors (HN, BOE, BOJA, BOCAs, BetaList, AppSumo)
5. Batch 2 collectors (Product Hunt, INE)
6. `GET /gap-radar` endpoint
7. Dashboard Radar tab (SvelteKit component)
8. Unit + integration tests for gap scoring
9. Batch 3 collectors (separate task, needs ToS investigation)

---

## Out of Scope

- LLM-based solution classification (keyword heuristic is sufficient for v1)
- Google Trends (no stable API)
- LinkedIn (API restrictions)
- Exportable reports / PDF (future)
- Multi-user access / selling access (future)
