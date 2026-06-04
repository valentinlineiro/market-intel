# SvelteKit Dashboard Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static HTML dashboard with a SvelteKit app on Cloudflare Pages, adding password authentication and decomposing the UI into typed Svelte components.

**Architecture:** SvelteKit with `@sveltejs/adapter-cloudflare`. Auth uses a single password in a CF Pages env var, validated in `hooks.server.ts` with an HMAC-signed cookie. All data loading is server-side in `+page.server.ts`. Worker proxy at `api/[...path]` injects the Bearer token. The old `pages/static/` and `pages/functions/` directories are replaced entirely.

**Prerequisite:** Worker TS + CA migration (plan `2026-06-04-worker-ts-ca.md`) must be complete — specifically the `POST /public/signup` and `GET /public/landings/:segment` Worker endpoints.

**Tech Stack:** SvelteKit, `@sveltejs/adapter-cloudflare`, TypeScript (strict), Vite, Playwright (E2E)

---

## File Map

**Create `src/main/infrastructure/pages/`** (SvelteKit project root):

```
pages/
├── package.json
├── svelte.config.ts
├── vite.config.ts
├── tsconfig.json
├── wrangler.toml
├── playwright.config.ts
└── src/
    ├── app.d.ts
    ├── app.html
    ├── hooks.server.ts
    ├── lib/
    │   ├── auth.ts
    │   ├── types.ts
    │   ├── api.ts
    │   └── components/
    │       ├── StatGrid.svelte
    │       ├── SectorsGrid.svelte
    │       ├── OpportunitiesTable.svelte
    │       ├── DeployModal.svelte
    │       ├── LeadsTable.svelte
    │       └── SettingsPanel.svelte
    └── routes/
        ├── +layout.svelte
        ├── +page.server.ts          (redirect / → /dashboard)
        ├── login/
        │   ├── +page.svelte
        │   └── +page.server.ts
        ├── dashboard/
        │   ├── +page.svelte
        │   └── +page.server.ts
        ├── landings/[segment]/
        │   └── +server.ts
        └── api/
            ├── [...path]/
            │   └── +server.ts
            └── signup/
                └── +server.ts
```

**Delete after this plan completes:**
- `pages/static/index.html`
- `pages/static/landings/dentista.html`
- `pages/functions/api/[[path]].js`
- `pages/functions/landings/[segment].js`
- `pages/functions/signup.js`

All paths below are relative to `src/main/infrastructure/pages/`.

---

## Task 1: SvelteKit project scaffold

**Files:** `package.json`, `svelte.config.ts`, `vite.config.ts`, `tsconfig.json`, `wrangler.toml`, `src/app.html`, `src/app.d.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "market-intel-dashboard",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@sveltejs/kit": "^2.0.0",
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "@sveltejs/adapter-cloudflare": "^5.0.0",
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `svelte.config.ts`**

```typescript
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import type { Config } from '@sveltejs/kit';

const config: Config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

- [ ] **Step 3: Create `vite.config.ts`**

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
});
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true
  }
}
```

- [ ] **Step 5: Create `wrangler.toml`**

```toml
name = "market-intel"
compatibility_date = "2025-01-01"
pages_build_output_dir = ".svelte-kit/cloudflare"
```

- [ ] **Step 6: Create `src/app.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 7: Create `src/app.d.ts`**

```typescript
declare global {
  namespace App {
    interface Locals {
      session: { authenticated: boolean } | null;
    }
    interface Platform {
      env: {
        DASHBOARD_PASSWORD: string;
        SESSION_SECRET: string;
        WORKER_URL: string;
        WORKER_SECRET: string;
      };
    }
  }
}

export {};
```

- [ ] **Step 8: Install dependencies**

Run from the `pages/` directory:
```bash
cd src/main/infrastructure/pages && npm install
```

Expected: `node_modules/@sveltejs/kit` appears, no errors.

- [ ] **Step 9: Verify SvelteKit sync runs**

```bash
cd src/main/infrastructure/pages && npx svelte-kit sync 2>&1 | head -5
```

Expected: creates `.svelte-kit/` directory, no errors.

- [ ] **Step 10: Commit**

```bash
git add src/main/infrastructure/pages/package.json src/main/infrastructure/pages/package-lock.json src/main/infrastructure/pages/svelte.config.ts src/main/infrastructure/pages/vite.config.ts src/main/infrastructure/pages/tsconfig.json src/main/infrastructure/pages/wrangler.toml src/main/infrastructure/pages/src/app.html src/main/infrastructure/pages/src/app.d.ts
git commit -m "chore: scaffold SvelteKit project for dashboard"
```

---

## Task 2: Auth library + hooks + login route (TDD)

**Files:** `src/lib/auth.ts`, `src/hooks.server.ts`, `src/routes/login/+page.svelte`, `src/routes/login/+page.server.ts`

- [ ] **Step 1: Create `src/lib/auth.ts`**

Uses Web Crypto (available in Cloudflare Workers + modern browsers):

```typescript
const enc = new TextEncoder();

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signSession(secret: string): Promise<string> {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = String(expiry);
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function validateSession(token: string, secret: string): Promise<boolean> {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return false;
  const payload = token.slice(0, dotIdx);
  const sig     = token.slice(dotIdx + 1);
  const expiry  = parseInt(payload, 10);
  if (isNaN(expiry) || Date.now() > expiry) return false;
  const expected = await hmacSign(secret, payload);
  return sig === expected;
}
```

- [ ] **Step 2: Create `src/hooks.server.ts`**

```typescript
import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/auth.js';

const PUBLIC_PATHS = new Set(['/login']);
const PUBLIC_PREFIXES = ['/landings/', '/api/signup'];

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const isPublic = PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some(p => path.startsWith(p));

  if (!isPublic) {
    const token    = event.cookies.get('session');
    const platform = event.platform as App.Platform;
    const valid    = token ? await validateSession(token, platform.env.SESSION_SECRET) : false;
    if (!valid) throw redirect(302, '/login');
    event.locals.session = { authenticated: true };
  }

  return resolve(event);
};
```

- [ ] **Step 3: Create `src/routes/login/+page.server.ts`**

```typescript
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { signSession } from '$lib/auth.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.session?.authenticated) throw redirect(302, '/dashboard');
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, platform }) => {
    const env  = (platform as App.Platform).env;
    const data = await request.formData();
    const password = data.get('password');

    if (typeof password !== 'string' || password !== env.DASHBOARD_PASSWORD) {
      return fail(401, { error: 'Contraseña incorrecta' });
    }

    const token = await signSession(env.SESSION_SECRET);
    cookies.set('session', token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
    });
    throw redirect(302, '/dashboard');
  },
};
```

- [ ] **Step 4: Create `src/routes/login/+page.svelte`**

```svelte
<script lang="ts">
  import type { ActionData } from './$types';
  export let form: ActionData;
</script>

<svelte:head><title>Login — Market Intel</title></svelte:head>

<div class="login-container">
  <h1>Market Intel</h1>
  <form method="POST">
    <label for="password">Contraseña</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" />
    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}
    <button type="submit">Entrar</button>
  </form>
</div>

<style>
  .login-container {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; min-height: 100vh;
    background: #020817; color: #e2e8f0; gap: 24px;
  }
  h1 { font-size: 1.5rem; font-weight: 700; color: #f1f5f9; }
  form { display: flex; flex-direction: column; gap: 12px; width: 280px; }
  label { font-size: 0.75rem; color: #64748b; }
  input { padding: 10px; background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem; }
  button { padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .error { color: #f87171; font-size: 0.8rem; }
</style>
```

- [ ] **Step 5: Create root redirect `src/routes/+page.server.ts`**

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(302, '/dashboard');
};
```

- [ ] **Step 6: Verify build succeeds**

```bash
cd src/main/infrastructure/pages && npm run build 2>&1 | tail -10
```

Expected: build completes, `.svelte-kit/cloudflare/` directory created.

- [ ] **Step 7: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/auth.ts src/main/infrastructure/pages/src/hooks.server.ts src/main/infrastructure/pages/src/routes/
git commit -m "feat: add auth library, hooks guard, and login route"
```

---

## Task 3: API proxy + signup endpoint

**Files:** `src/routes/api/[...path]/+server.ts`, `src/routes/api/signup/+server.ts`

- [ ] **Step 1: Create `src/routes/api/[...path]/+server.ts`**

Forwards all authenticated requests to the Worker, stripping the `/api` prefix and injecting the Bearer token:

```typescript
import type { RequestHandler } from './$types';

export const GET: RequestHandler     = (e) => proxy(e);
export const POST: RequestHandler    = (e) => proxy(e);
export const PUT: RequestHandler     = (e) => proxy(e);
export const DELETE: RequestHandler  = (e) => proxy(e);
export const OPTIONS: RequestHandler = (e) => proxy(e);

async function proxy({ request, params, platform, url }: Parameters<RequestHandler>[0]): Promise<Response> {
  const env = (platform as App.Platform).env;
  const workerPath = '/' + (params.path ?? '');
  const workerUrl  = env.WORKER_URL.replace(/\/$/, '') + workerPath + (url.search || '');

  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${env.WORKER_SECRET}`);
  headers.delete('host');

  return fetch(workerUrl, {
    method:  request.method,
    headers,
    body:    ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    // @ts-expect-error — CF Workers supports duplex
    duplex: 'half',
  });
}
```

- [ ] **Step 2: Create `src/routes/api/signup/+server.ts`**

```typescript
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = (platform as App.Platform).env;
  const body = await request.text();
  const res = await fetch(`${env.WORKER_URL}/public/signup`, {
    method: 'POST',
    headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
    body,
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
};
```

- [ ] **Step 3: Verify build**

```bash
cd src/main/infrastructure/pages && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/api/
git commit -m "feat: add API proxy and signup endpoint"
```

---

## Task 4: Landing page proxy

**Files:** `src/routes/landings/[segment]/+server.ts`

- [ ] **Step 1: Create `src/routes/landings/[segment]/+server.ts`**

```typescript
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, platform }) => {
  const env = (platform as App.Platform).env;
  const res = await fetch(`${env.WORKER_URL}/public/landings/${params.segment}`);
  if (!res.ok) return new Response('Not found', { status: 404 });
  const html = await res.text();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/landings/
git commit -m "feat: add landing page proxy route"
```

---

## Task 5: Shared types + API helpers

**Files:** `src/lib/types.ts`, `src/lib/api.ts`

- [ ] **Step 1: Create `src/lib/types.ts`**

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

export interface Opportunity {
  id: string;
  segment: string;
  pain_summary: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  signal_count: number;
  status: OpportunityStatus;
  landing_url: string | null;
  emails_captured: number;
  last_updated: string;
}

export interface DiscoveryCandidate {
  profile: string;
  pain: string;
  keywords: string[];
  post_count: number;
  discovery_score: number;
  income_est: string | null;
  has_deadline: boolean;
}

export interface Lead {
  email: string;
  segment: string;
  captured_at: string;
}

export interface Stats {
  total_signals: number;
  total_opportunities: number;
  by_segment: Record<string, number>;
  top_opportunity: { score: number; pain_summary: string } | null;
}

export interface DiscoveryResult {
  run_id: string | null;
  candidates: DiscoveryCandidate[];
  discovered_at: string | null;
}

export interface Config {
  score: Record<string, unknown>;
  llm: Record<string, unknown>;
  discover: Record<string, unknown>;
  notifications: Record<string, unknown>;
  collectors?: Record<string, unknown>;
  synthesis_segments?: Record<string, unknown>;
}

export interface LandingCopy {
  title: string;
  subtitle: string;
  benefits: [string, string, string][];
  cta: string;
}
```

- [ ] **Step 2: Create `src/lib/api.ts`**

Client-side helpers that call the `/api/*` proxy (used only in DeployModal for interactive synthesize call):

```typescript
import type { LandingCopy } from './types.js';

export async function synthesizeCopy(segment: string): Promise<LandingCopy> {
  const res = await fetch('/api/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { copy: LandingCopy };
  return data.copy;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/types.ts src/main/infrastructure/pages/src/lib/api.ts
git commit -m "feat: add shared types and client API helpers"
```

---

## Task 6: Dashboard server load + form actions

**Files:** `src/routes/dashboard/+page.server.ts`

- [ ] **Step 1: Create `src/routes/dashboard/+page.server.ts`**

```typescript
import type { PageServerLoad, Actions } from './$types';
import type { Stats, DiscoveryResult, Opportunity, Lead, Config } from '$lib/types.js';

function workerFetch(url: string, env: App.Platform['env'], init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.WORKER_SECRET}`,
      ...(init?.headers ?? {}),
    },
  });
}

export const load: PageServerLoad = async ({ platform }) => {
  const env  = (platform as App.Platform).env;
  const base = env.WORKER_URL;

  const [statsRes, oppsRes, leadsRes, discoveryRes] = await Promise.all([
    fetch(`${base}/public/stats`),
    fetch(`${base}/public/opportunities`),
    fetch(`${base}/public/leads`),
    fetch(`${base}/public/discovery`),
  ]);

  const [statsData, oppsData, leadsData, discoveryData] = await Promise.all([
    statsRes.json() as Promise<Stats>,
    oppsRes.json() as Promise<{ results: Opportunity[] }>,
    leadsRes.json() as Promise<{ total: number; by_segment: Record<string, { email: string; captured_at: string }[]> }>,
    discoveryRes.json() as Promise<DiscoveryResult>,
  ]);

  return {
    stats:       statsData,
    opportunities: oppsData.results ?? [],
    leads:       leadsData,
    discovery:   discoveryData,
  };
};

export const actions: Actions = {
  discover: async ({ platform }) => {
    const env = (platform as App.Platform).env;
    const res = await workerFetch(`${env.WORKER_URL}/discover`, env, { method: 'POST', body: '{}' });
    if (!res.ok) return { success: false, error: `${res.status}` };
    const data = await res.json() as { run_id: string; candidates: unknown[] };
    return { success: true, count: data.candidates?.length ?? 0 };
  },

  deploy: async ({ request, platform }) => {
    const env      = (platform as App.Platform).env;
    const formData = await request.formData();
    const segment  = formData.get('segment') as string;
    const copy     = JSON.parse(formData.get('copy') as string);
    const res = await workerFetch(`${env.WORKER_URL}/deploy`, env, {
      method: 'POST',
      body: JSON.stringify({ segment, copy }),
    });
    if (!res.ok) return { success: false, error: `${res.status}` };
    const data = await res.json() as { url: string };
    return { success: true, url: data.url };
  },

  saveConfig: async ({ request, platform }) => {
    const env    = (platform as App.Platform).env;
    const formData = await request.formData();
    const config = JSON.parse(formData.get('config') as string) as Config;
    const res = await workerFetch(`${env.WORKER_URL}/config`, env, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
    return { success: res.ok };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts
git commit -m "feat: add dashboard server load and form actions"
```

---

## Task 7: Layout + StatGrid + SectorsGrid components

**Files:** `src/routes/+layout.svelte`, `src/lib/components/StatGrid.svelte`, `src/lib/components/SectorsGrid.svelte`

- [ ] **Step 1: Create `src/routes/+layout.svelte`**

```svelte
<script lang="ts">
  import { page } from '$app/stores';
</script>

<svelte:head>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; }
  </style>
</svelte:head>

<slot />
```

- [ ] **Step 2: Create `src/lib/components/StatGrid.svelte`**

```svelte
<script lang="ts">
  import type { Stats } from '$lib/types.js';
  export let stats: Stats;
</script>

<div class="grid">
  <div class="card">
    <div class="stat">
      <span class="stat-value">{stats.total_signals ?? 0}</span>
      <span class="stat-label">Total señales</span>
    </div>
  </div>
  <div class="card">
    <div class="stat">
      <span class="stat-value">{stats.total_opportunities ?? 0}</span>
      <span class="stat-label">Oportunidades</span>
    </div>
  </div>
  <div class="card">
    {#each Object.entries(stats.by_segment ?? {}) as [seg, n]}
      <div class="stat">
        <span class="stat-value">{n}</span>
        <span class="stat-label">{seg}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  .stat { display: flex; flex-direction: column; gap: 4px; }
  .stat-value { font-size: 2rem; font-weight: 700; color: #f1f5f9; }
  .stat-label { font-size: 0.75rem; color: #64748b; }
</style>
```

- [ ] **Step 3: Create `src/lib/components/SectorsGrid.svelte`**

```svelte
<script lang="ts">
  import type { DiscoveryResult } from '$lib/types.js';
  export let discovery: DiscoveryResult;
</script>

<div class="grid">
  {#if !discovery.candidates?.length}
    <div class="card"><p class="muted">Sin sectores detectados todavía.</p></div>
  {:else}
    {#each discovery.candidates.slice(0, 6) as c}
      {@const scorePct = Math.min((c.discovery_score ?? 0) / 20, 1)}
      {@const scoreColor = scorePct > 0.6 ? '#34d399' : scorePct > 0.3 ? '#fbbf24' : '#94a3b8'}
      <div class="card">
        <div class="header">
          <strong>{c.profile}</strong>
          <span style="color: {scoreColor}; font-weight: 700; font-size: 0.85rem;">{(c.discovery_score ?? 0).toFixed(1)}</span>
        </div>
        <p class="pain">{c.pain}</p>
        <div class="chips">
          {#each (c.keywords || []).slice(0, 4) as kw}
            <span class="chip">{kw}</span>
          {/each}
        </div>
        <div class="meta">{c.post_count} posts · {c.income_est ?? '—'}</div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .grid  { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .card  { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header strong { color: #f1f5f9; font-size: 0.9rem; line-height: 1.3; }
  .pain  { color: #64748b; font-size: 0.8rem; margin-bottom: 10px; line-height: 1.4; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip  { padding: 2px 6px; background: #1e293b; border-radius: 4px; font-size: 0.7rem; color: #64748b; }
  .meta  { margin-top: 8px; font-size: 0.7rem; color: #334155; }
  .muted { color: #475569; font-size: 0.875rem; }
</style>
```

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/+layout.svelte src/main/infrastructure/pages/src/lib/components/StatGrid.svelte src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte
git commit -m "feat: add layout, StatGrid, SectorsGrid components"
```

---

## Task 8: OpportunitiesTable + DeployModal

**Files:** `src/lib/components/OpportunitiesTable.svelte`, `src/lib/components/DeployModal.svelte`

- [ ] **Step 1: Create `src/lib/components/OpportunitiesTable.svelte`**

```svelte
<script lang="ts">
  import type { Opportunity } from '$lib/types.js';
  import DeployModal from './DeployModal.svelte';

  export let opportunities: Opportunity[];

  let deploySegment: string | null = null;
</script>

<div class="card" style="overflow-x:auto">
  <table>
    <thead>
      <tr>
        <th>Segmento</th><th>Score</th><th>Estado</th>
        <th>Señales</th><th>Resumen</th><th>Landing</th><th></th>
      </tr>
    </thead>
    <tbody>
      {#if !opportunities.length}
        <tr><td colspan="7" class="muted">Sin oportunidades todavía.</td></tr>
      {:else}
        {#each opportunities as o}
          <tr>
            <td>{o.segment}</td>
            <td><strong>{(o.score || 0).toFixed(1)}</strong>/10</td>
            <td><span class="badge badge-{o.status}">{o.status}</span></td>
            <td>{o.signal_count ?? 0}</td>
            <td class="summary">{(o.pain_summary || '').slice(0, 60)}</td>
            <td>
              {#if o.landing_url}
                <a href={o.landing_url} target="_blank" class="link">ver</a>
              {:else}—{/if}
            </td>
            <td>
              <button class="btn-sm" on:click={() => deploySegment = o.segment}>
                {o.landing_url ? 'Regenerar' : 'Deploy'}
              </button>
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

{#if deploySegment}
  <DeployModal segment={deploySegment} on:close={() => deploySegment = null} />
{/if}

<style>
  .card  { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  table  { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th     { text-align: left; padding: 8px 12px; color: #475569; font-weight: 600; border-bottom: 1px solid #1e293b; }
  td     { padding: 10px 12px; border-bottom: 1px solid #0f172a; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
  .badge-watching { background: #1e3a5f; color: #60a5fa; }
  .badge-testing  { background: #1a3a2a; color: #34d399; }
  .badge-scaling  { background: #3b1f5e; color: #a78bfa; }
  .badge-killed   { background: #3b1f1f; color: #f87171; }
  .summary { color: #94a3b8; font-size: 0.8rem; }
  .link    { color: #60a5fa; font-size: 0.75rem; }
  .btn-sm  { padding: 4px 10px; background: #1e293b; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; font-size: 0.75rem; cursor: pointer; white-space: nowrap; }
  .muted   { color: #475569; }
</style>
```

- [ ] **Step 2: Create `src/lib/components/DeployModal.svelte`**

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { synthesizeCopy } from '$lib/api.js';
  import type { LandingCopy } from '$lib/types.js';

  export let segment: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  let copy: LandingCopy | null = null;
  let title = '';
  let subtitle = '';
  let cta = '';
  let status = 'Generando copy con LLM...';
  let deploying = false;

  async function loadCopy() {
    try {
      copy = await synthesizeCopy(segment);
      title    = copy.title    ?? '';
      subtitle = copy.subtitle ?? '';
      cta      = copy.cta      ?? '';
      status   = 'Revisa y edita el copy antes de deployar.';
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    }
  }

  loadCopy();

  async function deploy() {
    if (!copy) return;
    deploying = true;
    status = 'Deployando...';
    const finalCopy: LandingCopy = { ...copy, title, subtitle, cta };
    try {
      const fd = new FormData();
      fd.set('segment', segment);
      fd.set('copy', JSON.stringify(finalCopy));
      const res = await fetch('?/deploy', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean; url?: string; error?: string };
      if (data.success && data.url) {
        status = `✓ Deployado: ${data.url}`;
        setTimeout(() => dispatch('close'), 2500);
      } else {
        status = `Error: ${data.error ?? 'unknown'}`;
      }
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    } finally {
      deploying = false;
    }
  }
</script>

<div class="overlay" role="dialog" aria-modal="true">
  <div class="modal">
    <h3>Editar copy · <span>{segment}</span></h3>
    <div class="fields">
      <label>Headline</label>
      <input type="text" bind:value={title} />
      <label>Subtitle</label>
      <textarea rows="3" bind:value={subtitle}></textarea>
      <label>CTA</label>
      <input type="text" bind:value={cta} />
    </div>
    <p class="status">{status}</p>
    <div class="actions">
      <button class="btn-primary" on:click={deploy} disabled={deploying || !copy}>Deployar</button>
      <button class="btn-secondary" on:click={() => dispatch('close')}>Cancelar</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal   { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; width: min(600px, 90vw); max-height: 90vh; overflow-y: auto; }
  h3       { color: #f1f5f9; margin-bottom: 20px; }
  .fields  { display: flex; flex-direction: column; gap: 12px; }
  label    { font-size: 0.75rem; color: #64748b; }
  input, textarea { padding: 10px; background: #020817; border: 1px solid #1e293b; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem; width: 100%; }
  textarea { resize: vertical; }
  .status  { margin-top: 12px; font-size: 0.8rem; color: #64748b; min-height: 1.2em; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  .btn-primary   { flex: 1; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { padding: 12px 20px; background: #1e293b; color: #94a3b8; border: none; border-radius: 8px; cursor: pointer; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/OpportunitiesTable.svelte src/main/infrastructure/pages/src/lib/components/DeployModal.svelte
git commit -m "feat: add OpportunitiesTable and DeployModal components"
```

---

## Task 9: LeadsTable + SettingsPanel

**Files:** `src/lib/components/LeadsTable.svelte`, `src/lib/components/SettingsPanel.svelte`

- [ ] **Step 1: Create `src/lib/components/LeadsTable.svelte`**

```svelte
<script lang="ts">
  export let bySegment: Record<string, { email: string; captured_at: string }[]>;
  export let total: number;

  interface FlatLead { seg: string; email: string; captured_at: string; }

  $: allLeads = Object.entries(bySegment ?? {})
    .flatMap(([seg, entries]) => entries.map(e => ({ seg, ...e })))
    .sort((a: FlatLead, b: FlatLead) => b.captured_at.localeCompare(a.captured_at));
</script>

<div class="card" style="overflow-x:auto">
  <table>
    <thead>
      <tr><th>Segmento</th><th>Email</th><th>Fecha</th></tr>
    </thead>
    <tbody>
      {#if !allLeads.length}
        <tr><td colspan="3" class="muted">Sin leads todavía.</td></tr>
      {:else}
        {#each allLeads as l}
          <tr>
            <td>{l.seg}</td>
            <td class="mono">{l.email}</td>
            <td class="date">{l.captured_at.slice(0, 16).replace('T', ' ')}</td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .card  { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  table  { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th     { text-align: left; padding: 8px 12px; color: #475569; font-weight: 600; border-bottom: 1px solid #1e293b; }
  td     { padding: 10px 12px; border-bottom: 1px solid #0f172a; }
  .mono  { font-family: monospace; font-size: 0.8rem; }
  .date  { color: #64748b; font-size: 0.8rem; }
  .muted { color: #475569; }
</style>
```

- [ ] **Step 2: Create `src/lib/components/SettingsPanel.svelte`**

```svelte
<script lang="ts">
  import type { Config } from '$lib/types.js';

  export let config: Config;
  export let onSave: (config: Config) => void;

  const sections: { key: keyof Config; label: string; desc: string }[] = [
    { key: 'score',         label: 'Scoring',        desc: 'Pesos y umbrales del sistema de puntuación' },
    { key: 'llm',           label: 'LLM',            desc: 'Modelos y proveedores' },
    { key: 'discover',      label: 'Descubrimiento', desc: 'Límites y queries de exploración' },
    { key: 'notifications', label: 'Notificaciones', desc: 'Email de destino para alertas' },
  ];

  let drafts: Record<string, string> = {};
  let saveStatus = '';

  $: {
    for (const s of sections) {
      drafts[s.key] = JSON.stringify(config[s.key] ?? {}, null, 2);
    }
  }

  async function save() {
    saveStatus = 'Guardando...';
    try {
      const full: Config = { ...config };
      for (const s of sections) {
        (full as Record<string, unknown>)[s.key] = JSON.parse(drafts[s.key]);
      }
      const fd = new FormData();
      fd.set('config', JSON.stringify(full));
      const res = await fetch('?/saveConfig', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean };
      saveStatus = data.success ? '✓ Guardado' : 'Error al guardar';
      if (data.success) onSave(full);
    } catch (e) {
      saveStatus = `Error: ${(e as Error).message}`;
    }
  }
</script>

<div class="settings">
  {#each sections as s}
    <div class="section">
      <div class="section-title">{s.label}</div>
      <div class="section-desc">{s.desc}</div>
      <textarea
        bind:value={drafts[s.key]}
        rows="6"
        spellcheck="false"
      ></textarea>
    </div>
  {/each}
  <button on:click={save}>Guardar configuración</button>
  {#if saveStatus}<p class="status">{saveStatus}</p>{/if}
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 16px; }
  .section  { background: #020817; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; }
  .section-title { font-size: 0.85rem; font-weight: 600; color: #f1f5f9; margin-bottom: 2px; }
  .section-desc  { font-size: 0.7rem; color: #475569; margin-bottom: 10px; }
  textarea { width: 100%; padding: 10px; background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; color: #94a3b8; font-family: monospace; font-size: 0.78rem; resize: vertical; }
  button   { padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .status  { font-size: 0.8rem; color: #64748b; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte src/main/infrastructure/pages/src/lib/components/SettingsPanel.svelte
git commit -m "feat: add LeadsTable and SettingsPanel components"
```

---

## Task 10: Dashboard page + logout

**Files:** `src/routes/dashboard/+page.svelte`

- [ ] **Step 1: Create `src/routes/dashboard/+page.svelte`**

```svelte
<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import StatGrid           from '$lib/components/StatGrid.svelte';
  import SectorsGrid        from '$lib/components/SectorsGrid.svelte';
  import OpportunitiesTable from '$lib/components/OpportunitiesTable.svelte';
  import LeadsTable         from '$lib/components/LeadsTable.svelte';
  import SettingsPanel      from '$lib/components/SettingsPanel.svelte';

  export let data: PageData;
  export let form: ActionData;

  let settingsOpen = false;
  let discoverStatus = '';
  let discovering = false;

  async function runDiscovery() {
    discovering = true;
    discoverStatus = 'Explorando...';
    const fd = new FormData();
    const res = await fetch('?/discover', { method: 'POST', body: fd });
    const result = await res.json() as { success: boolean; count?: number };
    if (result.success) {
      discoverStatus = `✓ ${result.count ?? 0} sectores encontrados`;
      await invalidateAll();
    } else {
      discoverStatus = 'Error al descubrir';
    }
    discovering = false;
    setTimeout(() => { discoverStatus = ''; }, 3000);
  }
</script>

<svelte:head><title>Market Intel — Dashboard</title></svelte:head>

<div class="container">
  <div class="header">
    <div>
      <div class="title">Market Intel</div>
      <div class="subtitle">Señales de dolor · Cádiz / España</div>
    </div>
    <form method="POST" action="?/logout" style="display:contents">
      <button class="btn-sm">Salir</button>
    </form>
  </div>

  <h2>Resumen</h2>
  <div style="margin-bottom:32px">
    <StatGrid stats={data.stats} />
  </div>

  <div class="section-header">
    <h2>Sectores Emergentes</h2>
    <div style="display:flex;align-items:center;gap:12px;">
      {#if data.discovery.discovered_at}
        <span class="ts">
          Última exploración: hace
          {Math.round((Date.now() - new Date(data.discovery.discovered_at).getTime()) / 60000)} min
        </span>
      {/if}
      <button class="btn-sm" on:click={runDiscovery} disabled={discovering}>
        {discoverStatus || 'Descubrir ahora'}
      </button>
    </div>
  </div>
  <div style="margin-bottom:32px">
    <SectorsGrid discovery={data.discovery} />
  </div>

  <h2>Oportunidades</h2>
  <div style="margin-bottom:32px">
    <OpportunitiesTable opportunities={data.opportunities} />
  </div>

  <h2>Leads</h2>
  <div style="margin-bottom:32px">
    <LeadsTable bySegment={data.leads.by_segment} total={data.leads.total} />
  </div>

  <div class="section-header">
    <h2>Configuración</h2>
    <button class="btn-sm" on:click={() => settingsOpen = !settingsOpen}>
      {settingsOpen ? 'Ocultar' : 'Mostrar'}
    </button>
  </div>
  {#if settingsOpen}
    <div class="card" style="margin-top:16px">
      <SettingsPanel config={data.stats as unknown as import('$lib/types.js').Config} onSave={() => invalidateAll()} />
    </div>
  {/if}
</div>

<style>
  .container { max-width: 1100px; margin: 0 auto; padding: 32px 16px; }
  h2         { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; color: #475569; text-transform: uppercase; margin-bottom: 16px; }
  .header    { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
  .title     { font-size: 1.5rem; font-weight: 700; color: #f1f5f9; }
  .subtitle  { font-size: 0.8rem; color: #475569; margin-top: 2px; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .section-header h2 { margin: 0; }
  .ts        { font-size: 0.7rem; color: #334155; }
  .btn-sm    { padding: 6px 14px; background: #1e293b; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; font-size: 0.75rem; cursor: pointer; }
  .card      { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
</style>
```

- [ ] **Step 2: Add logout action to `src/routes/dashboard/+page.server.ts`**

Open the file and add the `logout` action inside the existing `actions` object:

```typescript
logout: async ({ cookies }) => {
  cookies.delete('session', { path: '/' });
  throw redirect(302, '/login');
},
```

Add the `redirect` import at the top of the file if not already present:
```typescript
import { redirect } from '@sveltejs/kit';
```

- [ ] **Step 3: Add `config` to the load return value**

In `src/routes/dashboard/+page.server.ts`, add a `config` fetch to the parallel load:

```typescript
// Add to the Promise.all:
fetch(`${base}/public/config`),
```

And to the destructuring:
```typescript
const [statsData, oppsData, leadsData, discoveryData, configData] = await Promise.all([
  statsRes.json() as Promise<Stats>,
  oppsRes.json() as Promise<{ results: Opportunity[] }>,
  leadsRes.json() as Promise<{ total: number; by_segment: Record<string, { email: string; captured_at: string }[]> }>,
  discoveryRes.json() as Promise<DiscoveryResult>,
  (await fetch(`${base}/public/config`)).json() as Promise<{ config: Config }>,
]);

return {
  stats:         statsData,
  opportunities: oppsData.results ?? [],
  leads:         leadsData,
  discovery:     discoveryData,
  config:        configData.config,
};
```

Then update `+page.svelte` to pass `data.config` to `SettingsPanel`:

```svelte
<SettingsPanel config={data.config} onSave={() => invalidateAll()} />
```

- [ ] **Step 4: Build and verify**

```bash
cd src/main/infrastructure/pages && npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/dashboard/
git commit -m "feat: add dashboard page with all sections and logout action"
```

---

## Task 11: Playwright E2E setup + login tests (TDD)

**Files:** `playwright.config.ts`, `tests/e2e/login.test.ts`

- [ ] **Step 1: Install Playwright**

```bash
cd src/main/infrastructure/pages && npx playwright install chromium 2>&1 | tail -3
```

Expected: Chromium downloaded.

- [ ] **Step 2: Create `playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 3: Write failing login tests**

Create `tests/e2e/login.test.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('redirects unauthenticated users to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('login with wrong password shows error', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=password]', 'wrong-password');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('.error')).toBeVisible();
});

test('login with correct password redirects to dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=password]', process.env.DASHBOARD_PASSWORD ?? 'test-password');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator('.title')).toHaveText('Market Intel');
});

test('logout clears session and redirects to login', async ({ page }) => {
  // Log in first
  await page.goto('/login');
  await page.fill('input[name=password]', process.env.DASHBOARD_PASSWORD ?? 'test-password');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);
  // Log out
  await page.click('button:has-text("Salir")');
  await expect(page).toHaveURL(/\/login/);
  // Verify session is gone
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 4: Add a `.env.test` with test credentials**

Create `src/main/infrastructure/pages/.env.test`:

```
DASHBOARD_PASSWORD=test-password-e2e
SESSION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
WORKER_URL=http://localhost:8787
WORKER_SECRET=test-worker-secret
```

This file is used when running `wrangler pages dev` locally for E2E tests.

- [ ] **Step 5: Run E2E tests (expect connection failure — dev server not running)**

```bash
cd src/main/infrastructure/pages && DASHBOARD_PASSWORD=test-password-e2e npm run test:e2e 2>&1 | tail -5
```

Expected: `Error: connect ECONNREFUSED` (dev server not running — this confirms the test runner works).

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/pages/playwright.config.ts src/main/infrastructure/pages/tests/e2e/login.test.ts src/main/infrastructure/pages/.env.test
git commit -m "test: add Playwright setup and login E2E tests"
```

---

## Task 12: Dashboard E2E tests

**Files:** `tests/e2e/dashboard.test.ts`

- [ ] **Step 1: Create `tests/e2e/dashboard.test.ts`**

```typescript
import { test, expect, type Page } from '@playwright/test';

async function loginAs(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name=password]', process.env.DASHBOARD_PASSWORD ?? 'test-password-e2e');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard/);
}

test('dashboard renders stats section', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Total señales')).toBeVisible();
  await expect(page.locator('text=Oportunidades')).toBeVisible();
});

test('dashboard renders sectors grid', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Sectores Emergentes')).toBeVisible();
});

test('dashboard renders opportunities table', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Oportunidades').first()).toBeVisible();
  await expect(page.locator('table')).toBeVisible();
});

test('dashboard renders leads table', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Leads')).toBeVisible();
});

test('settings panel toggles open and closed', async ({ page }) => {
  await loginAs(page);
  await expect(page.locator('text=Configuración')).toBeVisible();
  await page.click('button:has-text("Mostrar")');
  await expect(page.locator('text=Scoring')).toBeVisible();
  await page.click('button:has-text("Ocultar")');
  await expect(page.locator('text=Scoring')).not.toBeVisible();
});

test('discover button triggers discovery flow', async ({ page }) => {
  await loginAs(page);
  await page.click('button:has-text("Descubrir ahora")');
  // Button shows loading state
  await expect(page.locator('button:has-text("Explorando...")')).toBeVisible();
  // Eventually shows result (may take a few seconds with a live worker)
  await expect(page.locator('button').filter({ hasText: /sectores|Descubrir/ })).toBeVisible({ timeout: 15_000 });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/tests/e2e/dashboard.test.ts
git commit -m "test: add dashboard E2E tests"
```

---

## Task 13: CI updates + delete old pages files

**Files:** `.github/workflows/ci.yml`

- [ ] **Step 1: Delete old pages files**

```bash
rm src/main/infrastructure/pages/static/index.html
rm -f src/main/infrastructure/pages/static/landings/dentista.html
rm src/main/infrastructure/pages/functions/api/'[[path]]'.js
rm src/main/infrastructure/pages/functions/landings/'[segment]'.js
rm src/main/infrastructure/pages/functions/signup.js
rmdir src/main/infrastructure/pages/functions/api 2>/dev/null || true
rmdir src/main/infrastructure/pages/functions/landings 2>/dev/null || true
rmdir src/main/infrastructure/pages/functions 2>/dev/null || true
rmdir src/main/infrastructure/pages/static/landings 2>/dev/null || true
rmdir src/main/infrastructure/pages/static 2>/dev/null || true
```

- [ ] **Step 2: Update `.github/workflows/ci.yml` — add pages build job**

Open `.github/workflows/ci.yml` and add a new job after the existing `test` job:

```yaml
  build-pages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install pages deps
        run: npm ci
        working-directory: src/main/infrastructure/pages

      - name: Build SvelteKit
        run: npm run build
        working-directory: src/main/infrastructure/pages
```

- [ ] **Step 3: Verify wrangler deploy still works for pages**

The `wrangler pages deploy` command in any existing deploy step should target `.svelte-kit/cloudflare`. Check any existing deploy job and update the deploy path if needed:

```yaml
# Old:
# wrangler pages deploy static/ --project-name market-intel
# New:
run: npx wrangler pages deploy .svelte-kit/cloudflare --project-name market-intel
working-directory: src/main/infrastructure/pages
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete SvelteKit migration — delete old pages files, update CI"
```

---

## Self-Review

**Spec coverage:**
- ✅ SvelteKit with `@sveltejs/adapter-cloudflare`
- ✅ Strict TypeScript
- ✅ `DASHBOARD_PASSWORD` + `SESSION_SECRET` env vars
- ✅ HMAC-SHA256 signed cookie (7-day expiry, HttpOnly, Secure, SameSite=Strict)
- ✅ `hooks.server.ts` guards all routes except `/login`, `/landings/*`, `/api/signup`
- ✅ `api/[...path]` proxy injects Bearer token, never exposes `WORKER_SECRET` to browser
- ✅ `api/signup` unauthenticated lead capture
- ✅ `landings/[segment]` proxy returns raw HTML
- ✅ Dashboard load is server-side (SSR, no client-side fetch on initial render)
- ✅ Form actions for discover, deploy, saveConfig, logout
- ✅ All 6 components: StatGrid, SectorsGrid, OpportunitiesTable, DeployModal, LeadsTable, SettingsPanel
- ✅ Playwright E2E: login tests + dashboard tests
- ✅ Old static files + Pages Functions deleted
- ✅ CI build-pages job added
- ✅ Config loaded in dashboard load and passed to SettingsPanel (Task 10 Step 3)
