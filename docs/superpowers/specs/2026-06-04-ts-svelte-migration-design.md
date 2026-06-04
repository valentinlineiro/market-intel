# TypeScript + SvelteKit Migration — market-intel

**Date:** 2026-06-04
**Status:** Approved

---

## Context

The backend is a Cloudflare Worker in plain JavaScript with flat module structure. The frontend is a single 375-line HTML file with inline CSS and vanilla JS. The Python pipeline has already been deleted. This migration:

1. Converts the Worker to strict TypeScript with Clean Architecture layering
2. Replaces the static HTML dashboard with a SvelteKit app (Cloudflare adapter)
3. Adds password-based authentication to the dashboard
4. Establishes a three-tier test strategy: unit, integration, E2E

---

## High-Level Architecture

Two independent deployables in the same repo, each with its own `package.json`:

- **Worker** — Cloudflare Worker, strict TypeScript, Clean Architecture layers
- **Pages** — SvelteKit app, `@sveltejs/adapter-cloudflare`, deployed to CF Pages

**Boundary:** Worker owns all business logic and data access. SvelteKit owns UI, auth, and routing. SvelteKit server routes talk to the Worker via HTTP — no direct D1 bindings in the Pages project, no duplicated data logic.

---

## Folder Structure

```
/
├── package.json                        # wrangler + vitest (Worker tests)
└── src/main/infrastructure/
    ├── worker/
    │   ├── tsconfig.json               # strict: true, @cloudflare/workers-types
    │   ├── wrangler.toml               # entry point: index.ts
    │   ├── domain/
    │   │   ├── types.ts                # Signal, Opportunity, Lead, DiscoveryCandidate, Config
    │   │   ├── scoring.ts              # pure functions: computeOpportunityScore, dolorScore, etc.
    │   │   └── rules.ts                # SCORE_WEIGHTS, KILL/SCALE/ALERT thresholds
    │   ├── application/
    │   │   ├── ports.ts                # ISignalRepo, IOpportunityRepo, ILLMProvider, INotifier
    │   │   ├── score.ts                # Score use case
    │   │   ├── discover.ts             # Discover use case
    │   │   ├── synthesize.ts           # Synthesize use case
    │   │   └── collect.ts              # Collect use case
    │   ├── infrastructure/
    │   │   ├── db/d1-repo.ts           # D1 implementations of ISignalRepo + IOpportunityRepo
    │   │   ├── llm/chain.ts            # Groq → OpenRouter fallback (implements ILLMProvider)
    │   │   ├── collectors/
    │   │   │   ├── gnews.ts
    │   │   │   └── local_news.ts
    │   │   └── notify.ts               # Email (implements INotifier)
    │   ├── index.ts                    # composition root + HTTP routing + Env interface
    │   └── test/
    │       ├── unit/
    │       │   └── scoring.test.ts     # pure function tests, no mocks
    │       └── integration/
    │           ├── d1-repo.test.ts     # real D1 queries via vitest-pool-workers
    │           ├── llm-chain.test.ts   # real HTTP calls (CI_INTEGRATION=1 gate)
    │           └── collectors.test.ts  # real RSS/HTTP (CI_INTEGRATION=1 gate)
    └── pages/
        ├── package.json                # svelte, @sveltejs/kit, @sveltejs/adapter-cloudflare, vite, playwright
        ├── svelte.config.ts
        ├── vite.config.ts
        ├── tsconfig.json
        ├── wrangler.toml
        └── src/
            ├── app.d.ts                # Env typings, App.Locals (session)
            ├── app.html
            ├── hooks.server.ts         # auth guard
            ├── lib/
            │   ├── types.ts            # shared UI types (mirrors Worker domain types)
            │   ├── api.ts              # typed fetch helpers wrapping /api/* proxy
            │   └── components/
            │       ├── StatGrid.svelte
            │       ├── SectorsGrid.svelte
            │       ├── OpportunitiesTable.svelte
            │       ├── LeadsTable.svelte
            │       ├── SettingsPanel.svelte
            │       └── DeployModal.svelte
            └── routes/
                ├── +layout.svelte
                ├── login/
                │   ├── +page.svelte
                │   └── +page.server.ts     # validate password → set cookie
                ├── dashboard/
                │   ├── +page.svelte
                │   └── +page.server.ts     # load() + form actions
                ├── landings/[segment]/
                │   └── +server.ts          # proxy raw HTML from Worker
                └── api/
                    ├── [...path]/
                    │   └── +server.ts      # authenticated proxy to Worker
                    └── signup/
                        └── +server.ts      # lead capture → Worker
```

---

## Worker — Clean Architecture

### Layer rules

| Layer | Can import | Cannot import |
|-------|-----------|---------------|
| `domain/` | stdlib, own files | `application/`, `infrastructure/` |
| `application/` | `domain/`, `ports.ts` | `infrastructure/` |
| `infrastructure/` | `domain/`, `application/ports.ts`, third-party | — |

### Domain layer

**`types.ts`** — interfaces only:
- `Signal`, `Opportunity`, `Lead`, `DiscoveryCandidate`, `Config`
- `SignalSource` string union: `'gnews' | 'local_news'`

**`scoring.ts`** — pure functions (currently in `score.ts`):
- `computeOpportunityScore(breakdown)`, `dolorScore(signals)`, `incomeTierScore(tier)`, `urgencyScore(hasDeadline)`, `volumeScore(discoveryScore)`, `applyRules(opp)`, `shouldAlert(opp)`, `formatAlert(opp, seg)`

**`rules.ts`** — constants:
- `SCORE_WEIGHTS`, `KILL_SCORE_THRESHOLD`, `SCALE_SCORE_THRESHOLD`, `ALERT_SCORE_THRESHOLD`

### Application layer

**`ports.ts`**:
```ts
interface ISignalRepo  { save(s: Signal): Promise<boolean>; get(segment: string, limit: number): Promise<Signal[]>; count(segment: string): Promise<number> }
interface IOpportunityRepo { upsert(o: Opportunity): Promise<void>; getAll(): Promise<Opportunity[]>; getBySegment(segment: string): Promise<Opportunity | null> }
interface ILLMProvider { complete(prompt: string, maxTokens: number): Promise<string> }
interface INotifier    { send(subject: string, html: string, text: string): Promise<boolean> }
```

**Use cases** receive dependencies as parameters, never import infrastructure:
- `score.ts` — `runScore(repos, notifier, topN, minScore, dryRun)`
- `discover.ts` — `runDiscovery(llm, notifier)`
- `synthesize.ts` — `synthesizeCopy(segment, llm)` / `buildHtml(segment, copy)`
- `collect.ts` — `runCollect(repo, collectors)`

### Infrastructure layer

**`db/d1-repo.ts`** — implements `ISignalRepo` + `IOpportunityRepo`. All SQL lives here. Receives `D1Database` in constructor.

**`llm/chain.ts`** — implements `ILLMProvider`. Tries Groq → OpenRouter in order, falls back on error.

**`collectors/gnews.ts`, `collectors/local_news.ts`** — async functions called by the collect use case. Not injected via ports.

**`notify.ts`** — implements `INotifier` using the existing email sender.

### `index.ts` — composition root

Defines `Env` interface (all Worker bindings typed strictly: `DB: D1Database`, `WORKER_SECRET: string`, `GROQ_API_KEY: string`, `OPENROUTER_API_KEY: string`, `EMAIL_*` vars).

Instantiates adapters, wires use cases, handles HTTP routing. The only file that imports from both application and infrastructure.

Also adds two new Worker endpoints:
- `GET /public/landings/:segment` — reads raw HTML from `landing_pages` D1 table, returns as `text/html`. Required by the SvelteKit landing page proxy.
- `POST /public/signup` — unauthenticated lead capture, writes email + segment to `leads` table. Replaces the current `pages/functions/signup.js` which wrote to D1 directly.

The scheduled cron handler wires through the application layer: `runCollect(d1repo, [gnews, localNews])` then `runScore(repos, notifier, 10, 1.0, false)`.

---

## SvelteKit App

### Auth

**Environment variables (CF Pages):**
- `DASHBOARD_PASSWORD` — the password
- `SESSION_SECRET` — 32-byte hex, used to HMAC-sign the session cookie
- `WORKER_URL` — Worker base URL
- `WORKER_SECRET` — Worker Bearer token (never sent to browser)

**Login flow:**
1. `GET /login` → login form
2. `POST /login` form action → timing-safe compare against `DASHBOARD_PASSWORD` → sign token with `HMAC-SHA256(SESSION_SECRET, expiry)` → set `session` cookie (HttpOnly, Secure, SameSite=Strict, 7-day expiry) → redirect to `/dashboard`

**`hooks.server.ts`** — runs on every request:
- Exempt: `/login`, `/landings/*`, `/api/signup`
- All others: verify cookie signature + expiry → valid → attach session to `event.locals` → continue; invalid/missing → redirect to `/login`

**Logout:** Form action clears `session` cookie → redirect to `/login`.

### Data flow

**`dashboard/+page.server.ts` `load()`** calls Worker public endpoints in parallel (stats, opportunities, leads, discovery) and returns typed data. Page renders SSR with data already populated.

**Mutations** use SvelteKit form actions in `+page.server.ts` — discover, deploy, save config. Each action calls the Worker via the authenticated proxy, then the page data is invalidated and reloaded.

**`api/[...path]/+server.ts`** — forwards all methods to `WORKER_URL/{path}` with `Authorization: Bearer {WORKER_SECRET}`. Strips `/api` prefix. Returns Worker response verbatim.

**`landings/[segment]/+server.ts`** — GETs `WORKER_URL/public/landings/{segment}` and returns raw HTML with `Content-Type: text/html`. No Svelte layout wrapping.

**`api/signup/+server.ts`** — handles lead capture POST, forwards to Worker `POST /signup` (unauthenticated).

**Deploy modal** — the one component that calls `/api/synthesize` directly on open to show copy generation feedback interactively.

---

## Testing Strategy

### Unit — `worker/test/unit/`

- Vitest
- Covers `domain/scoring.ts` exclusively
- No mocks, no network, no D1
- Existing `score.test.js` maps 1:1 to `scoring.test.ts`
- Always runs on every commit

### Integration — `worker/test/integration/`

- Vitest with `@cloudflare/vitest-pool-workers` (real Workers runtime, local D1)
- `d1-repo.test.ts` — seeds a test D1, verifies save/get/upsert/count
- `llm-chain.test.ts` — real HTTP to Groq/OpenRouter, gated on `CI_INTEGRATION=1`
- `collectors.test.ts` — real RSS/HTTP fetch, gated on `CI_INTEGRATION=1`

### E2E — `pages/tests/e2e/`

- Playwright against local `wrangler dev` + `vite dev` running concurrently
- Local D1 seeded with fixture data via a setup script
- Test files per use case:
  - `login.test.ts` — correct/wrong password, logout
  - `dashboard.test.ts` — all sections render with fixture data
  - `discovery.test.ts` — trigger discovery, candidates appear
  - `deploy.test.ts` — open modal, edit copy, deploy, URL appears in table
  - `config.test.ts` — edit settings, save, verify persisted on reload

### CI matrix

| Job | Trigger | Notes |
|-----|---------|-------|
| `unit` | every push | fast, no secrets |
| `integration` | every push | skips LLM/collector tests unless `CI_INTEGRATION=1` |
| `e2e` | every push | starts wrangler dev + vite dev, runs Playwright |
| `build-pages` | every push | `npm ci && npm run build` in pages/ |

---

## Build & Deployment

**Worker:**
- `wrangler deploy` from `worker/` — wrangler compiles TypeScript natively
- `wrangler.toml` entry point updated: `main = "index.ts"`

**SvelteKit:**
- `npm run build` in `pages/` → outputs to `.svelte-kit/cloudflare/`
- `wrangler pages deploy .svelte-kit/cloudflare`
- `pages/wrangler.toml` updated: remove `pages_build_output_dir = "static/"` (adapter handles output)

**New CF Pages env vars to configure:**
- `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `WORKER_URL`, `WORKER_SECRET`
