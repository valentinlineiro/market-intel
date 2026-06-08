# Dashboard UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-scroll dashboard with a mobile-first tabbed UI (Oportunidades · Sectores · Leads · Config), a persistent stats bar with collector health, dark/light theme toggle, and proper config forms.

**Architecture:** Pure frontend work (Svelte + SvelteKit on Cloudflare Pages) except Task 1 which adds a `PATCH /opportunities/:segment/status` endpoint to the Worker. Theme is CSS custom properties toggled via a writable Svelte store persisted in `localStorage`. Config replaces raw JSON textareas with typed form fields per section.

**Tech Stack:** Svelte 5 (legacy syntax — use `export let` / `on:click`), SvelteKit, TypeScript, Cloudflare Workers (D1), CSS custom properties

---

## File Map

**Create:**
- `src/main/infrastructure/pages/src/lib/utils.ts` — `cleanSegment`, `formatRelativeTime`
- `src/main/infrastructure/pages/src/lib/theme.ts` — writable store + localStorage persistence
- `src/main/infrastructure/pages/src/lib/components/StatsBar.svelte` — 4-KPI bar (signals, opps, top score, collector health)
- `src/main/infrastructure/pages/src/lib/components/OpportunityList.svelte` — compact list with inline drawer
- `src/main/infrastructure/pages/src/lib/components/TagInput.svelte` — comma-separated tag editor
- `src/main/infrastructure/pages/src/lib/components/ConfigForm.svelte` — full config form replacing SettingsPanel

**Modify:**
- `src/main/infrastructure/worker/index.ts` — add `PATCH /opportunities/:segment/status`, add PATCH to CORS
- `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts` — add `updateOpportunityStatus`
- `src/main/infrastructure/pages/src/routes/+layout.svelte` — CSS vars for dark/light, theme class on `<body>`
- `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts` — add health fetch + `changeStatus` action
- `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte` — tab layout
- `src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte` — theme vars + readable timestamp
- `src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte` — grouped by segment

**Delete (replaced):**
- `src/main/infrastructure/pages/src/lib/components/StatGrid.svelte` — replaced by StatsBar
- `src/main/infrastructure/pages/src/lib/components/SettingsPanel.svelte` — replaced by ConfigForm

---

## Task 1: Worker — status change endpoint

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`
- Modify: `src/main/infrastructure/worker/index.ts`

- [ ] **Step 1: Add `updateOpportunityStatus` to D1Repo**

Open `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`. After the `updateOpportunityLanding` method (around line 396), add:

```ts
async updateOpportunityStatus(segment: string, status: string, now: string): Promise<void> {
  await this.db
    .prepare('UPDATE opportunities SET status = ?, last_updated = ? WHERE segment = ?')
    .bind(status, now, segment)
    .run();
}
```

- [ ] **Step 2: Add PATCH to CORS and add route in worker**

In `src/main/infrastructure/worker/index.ts`:

Change the CORS methods line from:
```ts
'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
```
To:
```ts
'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
```

After the `if (path === '/opportunities' && method === 'POST')` block (around line 173), add:

```ts
const statusMatch = path.match(/^\/opportunities\/([^/]+)\/status$/);
if (statusMatch && method === 'PATCH') {
  const segment = decodeURIComponent(statusMatch[1]);
  const body = await request.json() as { status?: string };
  const valid = ['watching', 'testing', 'scaling', 'killed'];
  if (!body.status || !valid.includes(body.status))
    return json({ error: 'invalid status' }, 400);
  await new D1Repo(env.DB).updateOpportunityStatus(segment, body.status, new Date().toISOString());
  return json({ ok: true });
}
```

- [ ] **Step 3: Test the endpoint**

```bash
# From project root — replace TOKEN with value from src/main/infrastructure/worker/.dev.vars
npx wrangler dev --config wrangler.toml &
sleep 3
curl -s -X PATCH http://localhost:8787/opportunities/dentista/status \
  -H "Authorization: Bearer test-secret-123" \
  -H "Content-Type: application/json" \
  -d '{"status":"testing"}' | jq .
# Expected: {"ok":true}
curl -s -X PATCH http://localhost:8787/opportunities/dentista/status \
  -H "Authorization: Bearer test-secret-123" \
  -H "Content-Type: application/json" \
  -d '{"status":"invalid"}' | jq .
# Expected: {"error":"invalid status"}
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/index.ts \
        src/main/infrastructure/worker/infrastructure/db/d1-repo.ts
git commit -m "feat: PATCH /opportunities/:segment/status endpoint"
```

---

## Task 2: Theme system

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/theme.ts`
- Modify: `src/main/infrastructure/pages/src/routes/+layout.svelte`

- [ ] **Step 1: Create theme store**

Create `src/main/infrastructure/pages/src/lib/theme.ts`:

```ts
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'dark' | 'light';

function createThemeStore() {
  const initial: Theme = browser
    ? (localStorage.getItem('theme') as Theme) ?? 'dark'
    : 'dark';

  const { subscribe, set } = writable<Theme>(initial);

  return {
    subscribe,
    toggle() {
      const next: Theme = (browser ? localStorage.getItem('theme') ?? 'dark' : 'dark') === 'dark' ? 'light' : 'dark';
      if (browser) localStorage.setItem('theme', next);
      set(next);
    },
    init() {
      if (!browser) return;
      const saved = (localStorage.getItem('theme') as Theme) ?? 'dark';
      set(saved);
    },
  };
}

export const theme = createThemeStore();
```

- [ ] **Step 2: Add CSS custom properties and theme class to layout**

Replace the full content of `src/main/infrastructure/pages/src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { theme } from '$lib/theme.js';
  import { onMount } from 'svelte';

  onMount(() => theme.init());
</script>

<svelte:head>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #111827;
      --bg-card:   #1f2937;
      --bg-input:  #374151;
      --border:    #374151;
      --border-sub:#1f2937;
      --text:      #f9fafb;
      --text-sub:  #9ca3af;
      --text-muted:#6b7280;
      --text-dim:  #4b5563;
      --accent:    #10b981;
      --accent-bg: #064e3b;
      --violet:    #a78bfa;
      --violet-bg: #2e1065;
      --amber:     #f59e0b;
      --amber-bg:  #1c1917;
      --blue:      #60a5fa;
      --blue-bg:   #1e3a5f;
      --red:       #f87171;
      --red-bg:    #3b1f1f;
    }

    :root.light {
      --bg:        #f8fafc;
      --bg-card:   #ffffff;
      --bg-input:  #f1f5f9;
      --border:    #e2e8f0;
      --border-sub:#f1f5f9;
      --text:      #0f172a;
      --text-sub:  #475569;
      --text-muted:#94a3b8;
      --text-dim:  #cbd5e1;
      --accent:    #059669;
      --accent-bg: #dcfce7;
      --violet:    #7c3aed;
      --violet-bg: #ede9fe;
      --amber:     #d97706;
      --amber-bg:  #fef3c7;
      --blue:      #2563eb;
      --blue-bg:   #dbeafe;
      --red:       #dc2626;
      --red-bg:    #fee2e2;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
    }
  </style>
</svelte:head>

<svelte:element this="html" class={$theme === 'light' ? 'light' : ''} />

<slot />
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd src/main/infrastructure/pages && npm run typecheck 2>&1 | tail -5
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/theme.ts \
        src/main/infrastructure/pages/src/routes/+layout.svelte
git commit -m "feat: dark/light theme store + CSS custom properties"
```

---

## Task 3: Utils — cleanSegment and formatRelativeTime

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/utils.ts`

- [ ] **Step 1: Create utils**

Create `src/main/infrastructure/pages/src/lib/utils.ts`:

```ts
export function cleanSegment(slug: string): string {
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

export function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return 'ahora mismo';
  if (mins  < 60) return `hace ${mins} min`;
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${days}d`;
}
```

- [ ] **Step 2: Verify with quick inline check**

```bash
cd /home/valentin/code/market-intel
node --input-type=module <<'EOF'
import { cleanSegment, formatRelativeTime } from './src/main/infrastructure/pages/src/lib/utils.ts';
// This will fail on .ts — just check logic mentally or use the typecheck step
EOF
# This step is just a reminder — verify visually that:
# cleanSegment('contador_asesoria_fiscal') === 'Contador Asesoria Fiscal'
# cleanSegment('aut_nomo_self_employed')   === 'Aut Nomo Self Employed'
# formatRelativeTime(null) === '—'
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/utils.ts
git commit -m "feat: cleanSegment and formatRelativeTime utils"
```

---

## Task 4: StatsBar component + health fetch

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/StatsBar.svelte`
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts`

- [ ] **Step 1: Add health fetch to page.server.ts**

In `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts`, add `healthRes` to the `Promise.all`:

```ts
const [statsRes, oppsRes, leadsRes, discoveryRes, configRes, healthRes] = await Promise.all([
  fetch(`${base}/public/stats`),
  fetch(`${base}/public/opportunities`),
  fetch(`${base}/public/leads`),
  fetch(`${base}/public/discovery`),
  fetch(`${base}/public/config`),
  workerFetch(`${base}/health`, env),
]);
```

Add healthData to the second `Promise.all`:

```ts
const [statsData, oppsData, leadsData, discoveryData, configData, healthData] = await Promise.all([
  safeJson<Stats>(statsRes, { total_signals: 0, total_opportunities: 0, total_leads: 0, top_segment: null }),
  safeJson<{ results: Opportunity[] }>(oppsRes, { results: [] }),
  safeJson<{ total: number; by_segment: Record<string, { email: string; captured_at: string }[]> }>(leadsRes, { total: 0, by_segment: {} }),
  safeJson<DiscoveryResult>(discoveryRes, { candidates: [], discovered_at: null }),
  safeJson<{ config: Config }>(configRes, { config: {} as Config }),
  safeJson<{ status: string; last_runs: Record<string, { last_run_at: string; signal_count: number; error: string | null }> }>(healthRes, { status: 'error', last_runs: {} }),
]);
```

Update the return to include health:

```ts
return {
  stats:         statsData,
  opportunities: oppsData.results ?? [],
  leads:         leadsData,
  discovery:     discoveryData,
  config:        configData.config,
  health:        healthData,
};
```

Also add `changeStatus` to the `actions` export:

```ts
changeStatus: async ({ request, platform }) => {
  const env     = (platform as App.Platform).env;
  const fd      = await request.formData();
  const segment = fd.get('segment') as string;
  const status  = fd.get('status') as string;
  const res = await workerFetch(
    `${env.WORKER_URL.replace(/\/$/, '')}/opportunities/${encodeURIComponent(segment)}/status`,
    env,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
  return { success: res.ok };
},
```

- [ ] **Step 2: Create StatsBar.svelte**

Create `src/main/infrastructure/pages/src/lib/components/StatsBar.svelte`:

```svelte
<script lang="ts">
  import type { Opportunity } from '$lib/types.js';

  export let totalSignals: number;
  export let opportunities: Opportunity[];
  export let health: { status: string; last_runs: Record<string, { error: string | null }> };

  $: topScore    = opportunities.length ? Math.max(...opportunities.map(o => o.score)) : null;
  $: scoreColor  = topScore === null ? 'var(--text-muted)' : topScore >= 6 ? 'var(--accent)' : topScore >= 4 ? 'var(--amber)' : 'var(--text-muted)';

  $: runs        = Object.values(health.last_runs ?? {});
  $: totalC      = runs.length;
  $: healthyC    = runs.filter(r => !r.error).length;
  $: collectorOk = totalC > 0 && healthyC === totalC;
  $: collectorColor = totalC === 0 ? 'var(--text-muted)' : collectorOk ? 'var(--accent)' : 'var(--red)';
  $: collectorLabel = totalC === 0 ? '—' : `${healthyC}/${totalC}`;
</script>

<div class="bar">
  <div class="kpi">
    <span class="val">{totalSignals}</span>
    <span class="lbl">señales</span>
  </div>
  <div class="kpi">
    <span class="val">{opportunities.length}</span>
    <span class="lbl">oportunidades</span>
  </div>
  <div class="kpi">
    <span class="val" style="color: {scoreColor}">{topScore !== null ? topScore.toFixed(1) : '—'}</span>
    <span class="lbl">top score</span>
  </div>
  <div class="kpi">
    <span class="val" style="color: {collectorColor}">{collectorLabel}</span>
    <span class="lbl">collectors</span>
  </div>
</div>

<style>
  .bar  { display: flex; background: var(--bg-card); border-bottom: 1px solid var(--border); }
  .kpi  { flex: 1; padding: 10px 4px; text-align: center; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
  .kpi:last-child { border-right: none; }
  .val  { font-size: 1.1rem; font-weight: 700; color: var(--text); }
  .lbl  { font-size: 0.65rem; color: var(--text-muted); }
</style>
```

- [ ] **Step 3: Typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck 2>&1 | tail -10
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/StatsBar.svelte \
        src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts
git commit -m "feat: StatsBar component + health data in page load"
```

---

## Task 5: Tab layout — restructure +page.svelte

**Files:**
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte`

- [ ] **Step 1: Replace page.svelte with tab layout**

Replace the full content of `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte`:

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { theme }           from '$lib/theme.js';
  import StatsBar            from '$lib/components/StatsBar.svelte';
  import SectorsGrid         from '$lib/components/SectorsGrid.svelte';
  import OpportunityList     from '$lib/components/OpportunityList.svelte';
  import LeadsTable          from '$lib/components/LeadsTable.svelte';
  import ConfigForm          from '$lib/components/ConfigForm.svelte';

  export let data: PageData;

  type Tab = 'oportunidades' | 'sectores' | 'leads' | 'config';
  let activeTab: Tab = 'oportunidades';

  let discoverStatus = '';
  let discovering = false;

  async function runDiscovery() {
    discovering = true;
    discoverStatus = 'Explorando...';
    try {
      const fd  = new FormData();
      const res = await fetch('?/discover', { method: 'POST', body: fd });
      const result = await res.json() as { success: boolean; count?: number };
      discoverStatus = result.success ? `✓ ${result.count ?? 0} sectores` : 'Error';
      if (result.success) await invalidateAll();
    } catch {
      discoverStatus = 'Error';
    } finally {
      discovering = false;
      setTimeout(() => { discoverStatus = ''; }, 3000);
    }
  }
</script>

<svelte:head><title>Market Intel</title></svelte:head>

<div class="shell">
  <!-- Header -->
  <header>
    <div>
      <div class="title">Market Intel</div>
      <div class="subtitle">Señales de dolor · Cádiz / España</div>
    </div>
    <div class="header-actions">
      <button class="btn-icon" on:click={() => theme.toggle()} title="Cambiar tema">
        {$theme === 'dark' ? '☀' : '☾'}
      </button>
      <form method="POST" action="?/logout" style="display:contents">
        <button class="btn-sm">Salir</button>
      </form>
    </div>
  </header>

  <!-- Stats bar -->
  <StatsBar
    totalSignals={data.stats.total_signals ?? 0}
    opportunities={data.opportunities}
    health={data.health}
  />

  <!-- Tabs -->
  <nav class="tabs">
    {#each [['oportunidades','Oportunidades'],['sectores','Sectores'],['leads','Leads'],['config','Config']] as [id, label]}
      <button
        class="tab"
        class:active={activeTab === id}
        on:click={() => activeTab = id as Tab}
      >{label}</button>
    {/each}
  </nav>

  <!-- Tab content -->
  <main>
    {#if activeTab === 'oportunidades'}
      <OpportunityList opportunities={data.opportunities} onStatusChange={() => invalidateAll()} />
    {:else if activeTab === 'sectores'}
      <div class="section-header">
        <span class="section-ts">
          {#if data.discovery.discovered_at}
            Última exploración: {new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(data.discovery.discovered_at))}
          {:else}
            Sin exploración reciente
          {/if}
        </span>
        <button class="btn-primary" on:click={runDiscovery} disabled={discovering}>
          {discoverStatus || 'Descubrir ahora'}
        </button>
      </div>
      <SectorsGrid discovery={data.discovery} />
    {:else if activeTab === 'leads'}
      <LeadsTable bySegment={data.leads.by_segment} total={data.leads.total} />
    {:else if activeTab === 'config'}
      <ConfigForm config={data.config} onSave={() => invalidateAll()} />
    {/if}
  </main>
</div>

<style>
  .shell   { max-width: 800px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; }
  header   { display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--bg); border-bottom: 1px solid var(--border); }
  .title   { font-size: 1.1rem; font-weight: 700; color: var(--text); }
  .subtitle{ font-size: 0.7rem; color: var(--text-muted); margin-top: 1px; }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  .btn-icon{ background: none; border: none; font-size: 1rem; cursor: pointer; color: var(--text-sub); padding: 4px 6px; border-radius: 6px; }
  .btn-icon:hover { background: var(--bg-card); }
  .btn-sm  { padding: 6px 12px; background: var(--bg-card); color: var(--text-sub); border: 1px solid var(--border); border-radius: 6px; font-size: 0.75rem; cursor: pointer; }
  .tabs    { display: flex; background: var(--bg); border-bottom: 1px solid var(--border); overflow-x: auto; flex-shrink: 0; }
  .tab     { flex: 1; min-width: 70px; padding: 10px 4px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-dim); font-size: 0.78rem; cursor: pointer; white-space: nowrap; }
  .tab.active { color: var(--violet); border-bottom-color: var(--violet); font-weight: 600; }
  main     { flex: 1; padding: 16px; overflow-x: hidden; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 8px; }
  .section-ts { font-size: 0.7rem; color: var(--text-muted); }
  .btn-primary { padding: 7px 14px; background: var(--accent); color: #fff; border: none; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .btn-primary:disabled { opacity: 0.5; }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck 2>&1 | tail -10
# Expected: errors about missing OpportunityList and ConfigForm — those are created in later tasks, this is expected
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/dashboard/+page.svelte
git commit -m "feat: tab layout with stats bar and theme toggle"
```

---

## Task 6: OpportunityList — compact list with inline drawer

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/OpportunityList.svelte`

- [ ] **Step 1: Create OpportunityList.svelte**

Create `src/main/infrastructure/pages/src/lib/components/OpportunityList.svelte`:

```svelte
<script lang="ts">
  import type { Opportunity } from '$lib/types.js';
  import { cleanSegment }     from '$lib/utils.js';
  import DeployModal          from './DeployModal.svelte';

  export let opportunities: Opportunity[];
  export let onStatusChange: () => void;

  let openSegment: string | null = null;
  let deploySegment: string | null = null;
  let changingStatus = false;

  function toggle(seg: string) {
    openSegment = openSegment === seg ? null : seg;
  }

  function scoreColor(s: number): string {
    return s >= 6 ? 'var(--accent)' : s >= 4 ? 'var(--amber)' : 'var(--text-muted)';
  }

  function barWidth(val: number | undefined): string {
    return `${Math.round(Math.min((val ?? 0) / 10, 1) * 100)}%`;
  }

  const statusOptions: Opportunity['status'][] = ['watching', 'testing', 'scaling', 'killed'];

  async function changeStatus(segment: string, newStatus: string) {
    changingStatus = true;
    const fd = new FormData();
    fd.set('segment', segment);
    fd.set('status',  newStatus);
    await fetch('?/changeStatus', { method: 'POST', body: fd });
    changingStatus = false;
    onStatusChange();
  }
</script>

{#if !opportunities.length}
  <p class="empty">Sin oportunidades todavía.</p>
{:else}
  <ul class="list">
    {#each opportunities as o (o.segment)}
      {@const open = openSegment === o.segment}
      <li class="item" class:open>
        <!-- Row -->
        <button class="row" on:click={() => toggle(o.segment)}>
          <div class="row-left">
            <span class="name">{cleanSegment(o.segment)}</span>
            <span class="badge badge-{o.status}">{o.status}</span>
            {#if o.pain_summary}
              <span class="pain">{o.pain_summary.slice(0, 50)}{o.pain_summary.length > 50 ? '…' : ''}</span>
            {/if}
          </div>
          <div class="row-right">
            <span class="score" style="color: {scoreColor(o.score)}">{o.score.toFixed(1)}</span>
            <span class="chevron" class:rotated={open}>›</span>
          </div>
        </button>

        <!-- Inline drawer -->
        {#if open}
          <div class="drawer">
            <div class="drawer-title">{cleanSegment(o.segment)}</div>

            {#if o.score_breakdown}
              <div class="breakdown">
                {#each [['Dolor', o.score_breakdown.dolor], ['Pago', o.score_breakdown.capacidad_pago], ['Volumen', o.score_breakdown.volumen], ['Urgencia', o.score_breakdown.urgencia], ['Compet.', o.score_breakdown.competencia]] as [lbl, val]}
                  <div class="bar-item">
                    <span class="bar-lbl">{lbl}</span>
                    <div class="bar-track">
                      <div class="bar-fill" style="width: {barWidth(val as number)}"></div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}

            {#if o.pain_summary}
              <p class="pain-full">{o.pain_summary}</p>
            {/if}

            <div class="meta-row">
              <span class="meta">{o.signal_count ?? 0} señales</span>
            </div>

            <div class="actions">
              {#if o.landing_url}
                <a href={o.landing_url} target="_blank" class="btn-action btn-outline">Ver landing</a>
              {/if}
              <button class="btn-action btn-primary" on:click={() => deploySegment = o.segment}>
                {o.landing_url ? 'Regenerar' : 'Deploy'}
              </button>
              <select
                class="status-select"
                value={o.status}
                disabled={changingStatus}
                on:change={(e) => changeStatus(o.segment, e.currentTarget.value)}
              >
                {#each statusOptions as s}
                  <option value={s}>{s}</option>
                {/each}
              </select>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if deploySegment}
  <DeployModal segment={deploySegment} on:close={() => { deploySegment = null; onStatusChange(); }} />
{/if}

<style>
  .list  { list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .item  { background: var(--bg-card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-sub); }
  .row   { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 10px 12px; background: none; border: none; cursor: pointer; gap: 8px; text-align: left; }
  .row:hover { background: var(--bg-input); }
  .row-left  { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .name  { font-size: 0.85rem; font-weight: 600; color: var(--text); }
  .pain  { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .score { font-size: 0.9rem; font-weight: 700; }
  .chevron { color: var(--text-dim); font-size: 1rem; transition: transform 0.15s; display: inline-block; }
  .chevron.rotated { transform: rotate(90deg); }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 0.65rem; font-weight: 600; width: fit-content; }
  .badge-watching { background: var(--blue-bg);   color: var(--blue); }
  .badge-testing  { background: var(--accent-bg); color: var(--accent); }
  .badge-scaling  { background: var(--violet-bg); color: var(--violet); }
  .badge-killed   { background: var(--red-bg);    color: var(--red); }

  .drawer       { padding: 12px; border-top: 1px solid var(--border); background: var(--bg); }
  .drawer-title { font-size: 0.9rem; font-weight: 700; color: var(--text); margin-bottom: 10px; }
  .breakdown    { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
  .bar-item     { display: flex; align-items: center; gap: 8px; }
  .bar-lbl      { font-size: 0.65rem; color: var(--text-muted); width: 50px; flex-shrink: 0; }
  .bar-track    { flex: 1; height: 5px; background: var(--border); border-radius: 3px; }
  .bar-fill     { height: 100%; background: var(--accent); border-radius: 3px; }
  .pain-full    { font-size: 0.78rem; color: var(--text-sub); line-height: 1.5; margin-bottom: 8px; }
  .meta-row     { margin-bottom: 10px; }
  .meta         { font-size: 0.7rem; color: var(--text-muted); }
  .actions      { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .btn-action   { padding: 5px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; border: none; text-decoration: none; }
  .btn-primary  { background: var(--accent); color: #fff; }
  .btn-outline  { background: none; border: 1px solid var(--border); color: var(--text-sub); }
  .status-select{ padding: 4px 8px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text-sub); font-size: 0.75rem; cursor: pointer; }
  .empty { color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck 2>&1 | grep -v "ConfigForm" | tail -10
# Expected: only errors about ConfigForm (not yet created)
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/OpportunityList.svelte
git commit -m "feat: OpportunityList with inline drawer and status change"
```

---

## Task 7: SectorsGrid + LeadsTable — theme update

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte`
- Modify: `src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte`

- [ ] **Step 1: Update SectorsGrid to use CSS vars**

Replace the full content of `src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte`:

```svelte
<script lang="ts">
  import type { DiscoveryResult } from '$lib/types.js';
  export let discovery: DiscoveryResult;

  function scoreColor(s: number) {
    return s > 12 ? 'var(--accent)' : s > 6 ? 'var(--amber)' : 'var(--text-muted)';
  }
</script>

<div class="grid">
  {#if !discovery.candidates?.length}
    <div class="card"><p class="muted">Sin sectores detectados todavía.</p></div>
  {:else}
    {#each discovery.candidates.slice(0, 6) as c}
      <div class="card">
        <div class="header">
          <strong>{c.profile}</strong>
          <span style="color: {scoreColor(c.discovery_score ?? 0)}; font-weight: 700; font-size: 0.85rem;">
            {(c.discovery_score ?? 0).toFixed(1)}
          </span>
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
  .grid   { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card   { background: var(--bg-card); border: 1px solid var(--border-sub); border-radius: 10px; padding: 16px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header strong { color: var(--text); font-size: 0.88rem; line-height: 1.3; }
  .pain   { color: var(--text-muted); font-size: 0.78rem; margin-bottom: 10px; line-height: 1.4; }
  .chips  { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip   { padding: 2px 6px; background: var(--bg-input); border-radius: 4px; font-size: 0.68rem; color: var(--text-muted); }
  .meta   { margin-top: 8px; font-size: 0.68rem; color: var(--text-dim); }
  .muted  { color: var(--text-muted); font-size: 0.85rem; }
</style>
```

- [ ] **Step 2: Update LeadsTable to grouped view with CSS vars**

Replace the full content of `src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte`:

```svelte
<script lang="ts">
  import { cleanSegment } from '$lib/utils.js';

  export let bySegment: Record<string, { email: string; captured_at: string }[]>;
  export let total: number;

  let openSegment: string | null = null;

  $: segments = Object.entries(bySegment ?? {}).sort((a, b) => b[1].length - a[1].length);
</script>

{#if !total}
  <p class="empty">Sin leads todavía.</p>
{:else}
  <div class="list">
    {#each segments as [seg, leads]}
      <div class="group">
        <button class="group-header" on:click={() => openSegment = openSegment === seg ? null : seg}>
          <span class="seg-name">{cleanSegment(seg)}</span>
          <span class="count">{leads.length} leads</span>
          <span class="chevron" class:rotated={openSegment === seg}>›</span>
        </button>
        {#if openSegment === seg}
          <div class="leads">
            {#each leads as lead}
              <div class="lead-row">
                <span class="email">{lead.email}</span>
                <span class="date">{new Date(lead.captured_at).toLocaleDateString('es')}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .list         { display: flex; flex-direction: column; gap: 4px; }
  .group        { background: var(--bg-card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-sub); }
  .group-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; background: none; border: none; cursor: pointer; text-align: left; }
  .group-header:hover { background: var(--bg-input); }
  .seg-name     { flex: 1; font-size: 0.85rem; font-weight: 600; color: var(--text); }
  .count        { font-size: 0.75rem; color: var(--accent); font-weight: 600; }
  .chevron      { color: var(--text-dim); font-size: 1rem; transition: transform 0.15s; display: inline-block; }
  .chevron.rotated { transform: rotate(90deg); }
  .leads        { border-top: 1px solid var(--border-sub); }
  .lead-row     { display: flex; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid var(--border-sub); }
  .lead-row:last-child { border-bottom: none; }
  .email        { font-size: 0.78rem; color: var(--text-sub); }
  .date         { font-size: 0.72rem; color: var(--text-muted); }
  .empty        { color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte \
        src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte
git commit -m "feat: SectorsGrid + LeadsTable updated to CSS vars"
```

---

## Task 8: TagInput component

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/TagInput.svelte`

- [ ] **Step 1: Create TagInput.svelte**

Create `src/main/infrastructure/pages/src/lib/components/TagInput.svelte`:

```svelte
<script lang="ts">
  export let values: string[] = [];
  export let placeholder = 'Añadir...';

  let input = '';

  function add() {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      values = [...values, trimmed];
    }
    input = '';
  }

  function remove(v: string) {
    values = values.filter(x => x !== v);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
    if (e.key === 'Backspace' && !input && values.length) {
      values = values.slice(0, -1);
    }
  }
</script>

<div class="wrap">
  {#each values as v}
    <span class="tag">
      {v}
      <button type="button" class="remove" on:click={() => remove(v)}>×</button>
    </span>
  {/each}
  <input
    bind:value={input}
    on:keydown={onKeydown}
    on:blur={add}
    {placeholder}
    class="input"
  />
</div>

<style>
  .wrap  { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px; min-height: 36px; align-items: center; }
  .tag   { display: flex; align-items: center; gap: 3px; padding: 2px 7px; background: var(--violet-bg); color: var(--violet); border-radius: 9999px; font-size: 0.72rem; }
  .remove{ background: none; border: none; color: var(--violet); cursor: pointer; font-size: 0.85rem; padding: 0; line-height: 1; }
  .input { border: none; background: none; outline: none; font-size: 0.78rem; color: var(--text); flex: 1; min-width: 80px; }
  .input::placeholder { color: var(--text-dim); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/TagInput.svelte
git commit -m "feat: TagInput component"
```

---

## Task 9: ConfigForm — simple sections (Scoring, LLM, Discover, Notifications)

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/ConfigForm.svelte`

- [ ] **Step 1: Create ConfigForm.svelte with simple sections**

Create `src/main/infrastructure/pages/src/lib/components/ConfigForm.svelte`. This is the first pass — simple sections only (collectors and segments added in Task 10):

```svelte
<script lang="ts">
  import type { Config } from '$lib/types.js';
  import { cleanSegment } from '$lib/utils.js';
  import TagInput from './TagInput.svelte';

  export let config: Config;
  export let onSave: () => void;

  // Deep clone so edits don't mutate the original until save
  let draft: Config = structuredClone(config);

  let saveStatus = '';
  let openSection: string | null = 'scoring';

  function toggleSection(id: string) {
    openSection = openSection === id ? null : id;
  }

  async function save() {
    saveStatus = 'Guardando...';
    try {
      const fd = new FormData();
      fd.set('config', JSON.stringify(draft));
      const res  = await fetch('?/saveConfig', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean };
      if (data.success) {
        saveStatus = '✓ Guardado';
        onSave();
      } else {
        saveStatus = 'Error al guardar';
      }
    } catch (e) {
      saveStatus = `Error: ${(e as Error).message}`;
    }
    setTimeout(() => { saveStatus = ''; }, 3000);
  }

  // Collector list in display order
  const collectorKeys = ['gnews', 'local_news', 'reddit', 'youtube', 'bluesky', 'mastodon'] as const;
  type CollectorKey = typeof collectorKeys[number];

  function collectorLabel(key: CollectorKey): string {
    const labels: Record<CollectorKey, string> = {
      gnews: 'GNews', local_news: 'Noticias locales', reddit: 'Reddit',
      youtube: 'YouTube', bluesky: 'Bluesky', mastodon: 'Mastodon',
    };
    return labels[key];
  }

  $: gnewsSegments = Object.keys(draft.collectors?.gnews?.segments ?? {});
  $: synthSegments = Object.keys(draft.synthesis_segments ?? {});
</script>

<div class="form">

  <!-- SCORING -->
  <div class="section">
    <button class="section-head" on:click={() => toggleSection('scoring')}>
      <span class="section-icon" style="background:var(--accent-bg);color:var(--accent)">⚖</span>
      <span>Scoring</span>
      <span class="chevron" class:rotated={openSection === 'scoring'}>›</span>
    </button>
    {#if openSection === 'scoring'}
      <div class="section-body">
        <div class="field">
          <label>Top N segmentos</label>
          <input type="number" bind:value={draft.score.top_n} min="1" max="50" />
        </div>
        <div class="field">
          <label>Score mínimo</label>
          <input type="number" bind:value={draft.score.min_score} min="0" max="10" step="0.1" />
        </div>
        <div class="field field-row">
          <label>Dry run</label>
          <input type="checkbox" bind:checked={draft.score.dry_run} />
        </div>
      </div>
    {/if}
  </div>

  <!-- LLM -->
  <div class="section">
    <button class="section-head" on:click={() => toggleSection('llm')}>
      <span class="section-icon" style="background:var(--violet-bg);color:var(--violet)">✦</span>
      <span>LLM</span>
      <span class="chevron" class:rotated={openSection === 'llm'}>›</span>
    </button>
    {#if openSection === 'llm'}
      <div class="section-body">
        <div class="field">
          <label>Proveedor</label>
          <select bind:value={draft.llm.provider}>
            <option value="groq">Groq</option>
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div class="field">
          <label>Modelo</label>
          <input type="text" bind:value={draft.llm.model} />
        </div>
        <div class="field">
          <label>Temperature</label>
          <input type="number" bind:value={draft.llm.temperature} min="0" max="1" step="0.1" />
        </div>
        <div class="field">
          <label>Max tokens</label>
          <input type="number" bind:value={draft.llm.max_tokens} min="128" max="8192" step="128" />
        </div>
      </div>
    {/if}
  </div>

  <!-- DISCOVER -->
  <div class="section">
    <button class="section-head" on:click={() => toggleSection('discover')}>
      <span class="section-icon" style="background:var(--blue-bg);color:var(--blue)">◎</span>
      <span>Descubrimiento</span>
      <span class="chevron" class:rotated={openSection === 'discover'}>›</span>
    </button>
    {#if openSection === 'discover'}
      <div class="section-body">
        <div class="field">
          <label>Max clusters</label>
          <input type="number" bind:value={draft.discover.max_clusters} min="1" max="50" />
        </div>
        <div class="field">
          <label>Min señales</label>
          <input type="number" bind:value={draft.discover.min_signals} min="1" max="20" />
        </div>
      </div>
    {/if}
  </div>

  <!-- NOTIFICATIONS -->
  <div class="section">
    <button class="section-head" on:click={() => toggleSection('notif')}>
      <span class="section-icon" style="background:var(--amber-bg);color:var(--amber)">✉</span>
      <span>Notificaciones</span>
      <span class="chevron" class:rotated={openSection === 'notif'}>›</span>
    </button>
    {#if openSection === 'notif'}
      <div class="section-body">
        <div class="field">
          <label>Email origen</label>
          <input type="email" bind:value={draft.notifications.from_email} />
        </div>
        <div class="field">
          <label>Email destino</label>
          <input type="email" bind:value={draft.notifications.to_email} />
        </div>
        <div class="field">
          <label>Umbral alerta</label>
          <input type="number" bind:value={draft.notifications.alert_score_threshold} min="0" max="10" step="0.1" />
        </div>
      </div>
    {/if}
  </div>

  <!-- COLLECTORS -->
  <div class="section">
    <button class="section-head" on:click={() => toggleSection('collectors')}>
      <span class="section-icon" style="background:var(--bg-input);color:var(--text-sub)">⚙</span>
      <span>Collectors</span>
      <span class="chevron" class:rotated={openSection === 'collectors'}>›</span>
    </button>
    {#if openSection === 'collectors'}
      <div class="section-body">
        {#each collectorKeys as key}
          {@const c = (draft.collectors ?? {})[key] as Record<string, unknown> | undefined}
          {#if c !== undefined}
            <div class="subsection">
              <div class="subsection-head">
                <span class="subsection-title">{collectorLabel(key)}</span>
                <input type="checkbox" bind:checked={c.enabled} />
              </div>

              {#if key === 'gnews'}
                <div class="field">
                  <label>Max resultados</label>
                  <input type="number" bind:value={c.max_results} min="1" max="100" />
                </div>
              {:else if key === 'local_news'}
                <div class="field">
                  <label>Pain keywords</label>
                  <TagInput bind:values={c.pain_keywords as string[]} placeholder="añadir keyword..." />
                </div>
              {:else if key === 'reddit'}
                <div class="field">
                  <label>Subreddits</label>
                  <TagInput bind:values={c.subreddits as string[]} placeholder="nombre subreddit..." />
                </div>
              {:else if key === 'youtube'}
                <div class="field">
                  <label>Max videos</label>
                  <input type="number" bind:value={c.max_videos} min="1" max="50" />
                </div>
                <div class="field">
                  <label>Max comentarios / video</label>
                  <input type="number" bind:value={c.max_comments_per_video} min="1" max="200" />
                </div>
              {:else if key === 'bluesky'}
                <div class="field">
                  <label>Max resultados</label>
                  <input type="number" bind:value={c.max_results} min="1" max="100" />
                </div>
              {:else if key === 'mastodon'}
                <div class="field">
                  <label>Instancias</label>
                  <TagInput bind:values={c.instances as string[]} placeholder="mastodon.social..." />
                </div>
                <div class="field">
                  <label>Max resultados</label>
                  <input type="number" bind:value={c.max_results} min="1" max="100" />
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- GNEWS SEGMENTS -->
  <div class="section">
    <button class="section-head" on:click={() => toggleSection('gnews-segments')}>
      <span class="section-icon" style="background:var(--accent-bg);color:var(--accent)">◈</span>
      <span>Segmentos GNews</span>
      <span class="chevron" class:rotated={openSection === 'gnews-segments'}>›</span>
    </button>
    {#if openSection === 'gnews-segments'}
      <div class="section-body">
        {#each gnewsSegments as segKey}
          {@const seg = (draft.collectors?.gnews?.segments ?? {})[segKey] as Record<string, unknown>}
          <div class="subsection">
            <div class="subsection-head">
              <span class="subsection-title">{cleanSegment(segKey)}</span>
            </div>
            <div class="field">
              <label>Label</label>
              <input type="text" bind:value={seg.label} />
            </div>
            <div class="field">
              <label>Queries (una por línea)</label>
              <textarea
                rows="3"
                value={(seg.queries as string[]).join('\n')}
                on:change={(e) => { seg.queries = e.currentTarget.value.split('\n').map(s => s.trim()).filter(Boolean); }}
              ></textarea>
            </div>
            <div class="field">
              <label>Keywords</label>
              <TagInput bind:values={seg.keywords as string[]} />
            </div>
            <div class="field">
              <label>Salario medio (€)</label>
              <input type="number" bind:value={seg.salary_mean} min="0" step="500" />
            </div>
            <div class="field">
              <label>Income tier</label>
              <select bind:value={seg.income_tier}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="medium_high">Medium high</option>
                <option value="high">High</option>
              </select>
            </div>
            <div class="field field-row">
              <label>Has deadline</label>
              <input type="checkbox" bind:checked={seg.has_deadline} />
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- SYNTHESIS SEGMENTS -->
  <div class="section">
    <button class="section-head" on:click={() => toggleSection('synth-segments')}>
      <span class="section-icon" style="background:var(--violet-bg);color:var(--violet)">◈</span>
      <span>Segmentos Síntesis</span>
      <span class="chevron" class:rotated={openSection === 'synth-segments'}>›</span>
    </button>
    {#if openSection === 'synth-segments'}
      <div class="section-body">
        {#each synthSegments as segKey}
          {@const seg = (draft.synthesis_segments ?? {})[segKey] as Record<string, unknown>}
          <div class="subsection">
            <div class="subsection-head">
              <span class="subsection-title">{cleanSegment(segKey)}</span>
            </div>
            <div class="field">
              <label>Label</label>
              <input type="text" bind:value={seg.label} />
            </div>
            <div class="field">
              <label>Keywords</label>
              <TagInput bind:values={seg.keywords as string[]} />
            </div>
            <div class="field">
              <label>Income tier</label>
              <select bind:value={seg.income_tier}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="medium_high">Medium high</option>
                <option value="high">High</option>
              </select>
            </div>
            <div class="field field-row">
              <label>Has deadline</label>
              <input type="checkbox" bind:checked={seg.has_deadline} />
            </div>
            <div class="field">
              <label>Discovery score</label>
              <input type="number" value={seg.discovery_score} disabled />
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- SAVE -->
  <div class="save-row">
    <button class="btn-save" on:click={save}>Guardar cambios</button>
    {#if saveStatus}<span class="save-status">{saveStatus}</span>{/if}
  </div>

</div>

<style>
  .form { display: flex; flex-direction: column; gap: 4px; }

  .section      { background: var(--bg-card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-sub); }
  .section-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; background: none; border: none; cursor: pointer; text-align: left; color: var(--text); font-size: 0.85rem; font-weight: 600; }
  .section-head:hover { background: var(--bg-input); }
  .section-icon { width: 22px; height: 22px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; flex-shrink: 0; }
  .section-body { padding: 12px 14px; border-top: 1px solid var(--border-sub); display: flex; flex-direction: column; gap: 10px; }

  .chevron { margin-left: auto; color: var(--text-dim); font-size: 1rem; transition: transform 0.15s; display: inline-block; }
  .chevron.rotated { transform: rotate(90deg); }

  .field       { display: flex; flex-direction: column; gap: 4px; }
  .field-row   { flex-direction: row; align-items: center; justify-content: space-between; }
  label        { font-size: 0.72rem; color: var(--text-muted); font-weight: 500; }
  input[type="text"], input[type="email"], input[type="number"], select, textarea {
    padding: 7px 10px; background: var(--bg-input); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); font-size: 0.82rem; width: 100%;
  }
  input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
  textarea { resize: vertical; font-family: inherit; }
  select   { cursor: pointer; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--violet); }

  .subsection      { border: 1px solid var(--border-sub); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--bg); }
  .subsection-head { display: flex; justify-content: space-between; align-items: center; }
  .subsection-title{ font-size: 0.8rem; font-weight: 600; color: var(--text); }

  .save-row    { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  .btn-save    { padding: 9px 20px; background: var(--accent); color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
  .btn-save:hover { opacity: 0.9; }
  .save-status { font-size: 0.78rem; color: var(--text-muted); }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck 2>&1 | tail -10
# Expected: no errors (all components now exist)
```

- [ ] **Step 3: Delete old components**

```bash
rm src/main/infrastructure/pages/src/lib/components/StatGrid.svelte
rm src/main/infrastructure/pages/src/lib/components/SettingsPanel.svelte
```

- [ ] **Step 4: Final typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck 2>&1 | tail -10
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/ConfigForm.svelte
git rm src/main/infrastructure/pages/src/lib/components/StatGrid.svelte \
       src/main/infrastructure/pages/src/lib/components/SettingsPanel.svelte
git commit -m "feat: ConfigForm with full typed forms for all config sections"
```

---

## Task 10: Build + deploy

**Files:** none

- [ ] **Step 1: Build**

```bash
cd src/main/infrastructure/pages && npm run build 2>&1 | tail -20
# Expected: ✓ built in X.XXs — no errors
```

- [ ] **Step 2: Deploy to Cloudflare Pages**

```bash
npx wrangler pages deploy .svelte-kit/cloudflare --project-name market-intel
# Expected: ✨ Deployment complete! ...
```

- [ ] **Step 3: Smoke test in browser**

Open https://market-intel-36d.pages.dev/login, log in, and verify:
1. Stats bar shows 4 KPIs
2. Tabs switch between sections
3. Opportunity rows expand inline with score breakdown
4. Theme toggle switches dark ↔ light and persists on reload
5. Config tab shows forms (not raw JSON)
6. Mobile layout works at 375px width

- [ ] **Step 4: Commit**

No code changes — deployment is sufficient. Final git log:

```bash
git log --oneline -10
```
