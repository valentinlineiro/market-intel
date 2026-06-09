# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Task Management (arch)

This repo uses **arch** for human+AI task governance. Always follow this loop:

```
arch capture <task>  →  arch task start <id>  →  implement  →  arch task done <id>  →  arch govern
```

- One focused task at a time — `arch govern` assigns focus.
- Every M/L/XL task requires a hansei (retrospective) on close.
- Run `arch review` before shipping. If it fails, fix it or file a task.
- Task files live in `docs/tasks/`, archived in `docs/archive/`, format defined in `docs/TASK-FORMAT.md`.
- Protected paths that require a preceding ADR: `docs/adr/`, `arch.config.json`.

## Commands

**Worker (root)**
```bash
npm test                    # unit tests (src/main/infrastructure/worker/test/unit/)
npm run test:integration    # integration tests against real D1 via Cloudflare pool
npm run typecheck           # tsc --noEmit for the worker
```

**Worker dev server**
```bash
cd src/main/infrastructure/worker
wrangler dev                # local worker with miniflare D1
wrangler d1 migrations apply market-intel --local   # apply pending migrations
```

**Frontend (SvelteKit + Pages)**
```bash
cd src/main/infrastructure/pages
npm run dev                 # local dev server
npm run build               # production build
npm run typecheck           # svelte-check
npm run test:e2e            # Playwright e2e tests
```

**Run a single unit test file**
```bash
npx vitest run src/main/infrastructure/worker/test/unit/scoring.test.ts
```

## Architecture

Two deployed services share one D1 database:

```
┌─────────────────────────────────┐    ┌──────────────────────────────────────┐
│  Cloudflare Pages (SvelteKit)   │    │  Cloudflare Worker (market-intel-api) │
│  src/main/infrastructure/pages  │───▶│  src/main/infrastructure/worker       │
│  Dashboard UI + auth            │    │  REST API + cron every 12h            │
└─────────────────────────────────┘    └──────────────────────────────────────┘
                                                        │
                                               Cloudflare D1 (market_intel)
```

The Pages app proxies all `/api/...` calls to the worker via `routes/api/[...path]/+server.ts`, injecting the `WORKER_SECRET` bearer token. The Pages app itself has no business logic.

### Worker internals (hexagonal)

```
domain/          Pure types and logic: Signal, Opportunity, FrictionProfile, ScoreBreakdown, cluster/scoring rules
application/     Use cases: collect.ts, friction.ts, score.ts, discover.ts, synthesize.ts, market-test.ts
                 All depend on port interfaces (ports.ts), never on infrastructure directly
infrastructure/  collectors/, db/d1-repo.ts, llm/chain.ts, config.ts, notify.ts
index.ts         Composition root, HTTP router, cron handler
```

### Data pipeline (cron, every 12h)

1. **Collect** — `buildRegistry()` instantiates enabled collectors from config; each returns `Signal[]`. Collector health stats are written to `collector_health`.
2. **Friction analysis** — `analyzeFriction()` clusters eligible signals by keyword Jaccard similarity (threshold 0.85 via `domain/cluster.ts`), picks one representative per cluster, calls LLM in batches of 10, then propagates the `FrictionProfile` to all cluster members.
3. **Score** — `runScore()` groups signals by segment, computes a weighted score (`ScoreBreakdown`: dolor, capacidad_pago, volumen, competencia, urgencia), upserts `Opportunity` rows, and emails alerts above threshold.

### Config

`infrastructure/config.ts` — `DEFAULT_CONFIG` is the in-code baseline. `getConfig(db)` deep-merges stored JSON from the `config` table on top of it, so missing stored fields always fall back to defaults. `invalidateCache()` must be called after `setConfig()`.

### Adding a collector

1. Implement `Collector` interface (`application/ports.ts`): `{ id: string; collect(): Promise<Signal[]> }`.
2. Register it in `infrastructure/collectors/registry.ts` `buildRegistry()`, gated by its `config.collectors.<id>.enabled` flag.
3. Add a `CollectorStat` entry — the cron loop automatically calls `upsertHealth`.

### Auth

Worker routes are protected by `Authorization: Bearer <WORKER_SECRET>`. Public routes (`/public/*`) require no auth and are used by the Pages frontend for the landing pages and lead capture.

### LLM

`LLMChain` (`infrastructure/llm/chain.ts`) supports Groq and OpenRouter. The active provider/model is controlled by `config.llm`. The `discover`, `friction`, `synthesize`, and `market-test` application services all depend on `ILLMProvider` (ports), so they're testable without a real LLM key.

### D1 schema

Migrations in `src/main/infrastructure/worker/migrations/`. Key tables:
- `signals` — raw collected posts/articles with `signal_strength`, `friction_analysis` (JSON `FrictionProfile`)
- `opportunities` — scored segments with status lifecycle: `watching → testing → scaling / killed`
- `discovery_candidates` — LLM-generated segment candidates (latest run wins)
- `market_tests` — async test runs; status polled via `GET /market-test/:id`
- `config` — single row `key='app'`, stores partial `Config` JSON merged onto defaults
- `collector_health` — last run stats per collector id
- `leads`, `landing_pages` — email capture and deployed HTML for segments
