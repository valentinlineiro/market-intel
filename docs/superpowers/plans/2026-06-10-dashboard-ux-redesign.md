# Dashboard UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual Ingestar/Explorar buttons with a pipeline-first dashboard where 6 labelled stages (Señales → Dolor → Segmentos → Oportunidades → Radar → Leads) are always visible, tabs align 1:1 with stages, and no action blocks the UI.

**Architecture:** Worker gains `analyzed_count` in stats and a `/public/pain-profiles` endpoint. The SvelteKit dashboard gets a new `PipelineBar` component, two new tab components (`SignalsTable`, `FrictionList`), and the main page is restructured to remove all blocking ingest/discover logic. `StatsBar` is deleted. Deploy action moves exclusively to `GapRadar`.

**Tech Stack:** Cloudflare Worker (TypeScript), SvelteKit, Svelte components, D1 SQL.

---

## File map

**Worker (backend)**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts` — add `analyzed_count` to `getStats()`; add `getPainProfiles()` method
- Modify: `src/main/infrastructure/worker/index.ts` — update `handleGetStats()`; add `GET /public/pain-profiles` route

**Frontend types**
- Modify: `src/main/infrastructure/pages/src/lib/types.ts` — add `analyzed_count` to `Stats`; add `PainProfile`, `SignalRow` types

**Frontend server**
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts` — add signals + pain-profiles loads; remove `discover` action

**New components**
- Create: `src/main/infrastructure/pages/src/lib/components/PipelineBar.svelte`
- Create: `src/main/infrastructure/pages/src/lib/components/SignalsTable.svelte`
- Create: `src/main/infrastructure/pages/src/lib/components/FrictionList.svelte`

**Modified components**
- Modify: `src/main/infrastructure/pages/src/lib/components/OpportunityList.svelte` — remove deploy button and DeployModal
- Modify: `src/main/infrastructure/pages/src/lib/components/GapRadar.svelte` — card layout, violet/gray colors, dimmed deployed rows, sole deploy button
- Modify: `src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte` — accept + show `discovered_at`

**Delete**
- Delete: `src/main/infrastructure/pages/src/lib/components/StatsBar.svelte`

**Main page**
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte` — full restructure

---

## Task 1: Backend — `analyzed_count` in stats

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts:563-578`
- Modify: `src/main/infrastructure/worker/index.ts:746-761`

- [ ] **Step 1: Update `getStats()` in d1-repo.ts**

Replace the existing `getStats()` method (lines 563–578):

```typescript
async getStats(): Promise<{
  signals: number;
  opportunities: number;
  leads: number;
  analyzed_count: number;
}> {
  const [sigRow, oppRow, leadRow, analyzedRow] = await Promise.all([
    this.db.prepare('SELECT COUNT(*) as n FROM signals').first<Record<string, unknown>>(),
    this.db.prepare('SELECT COUNT(*) as n FROM opportunities').first<Record<string, unknown>>(),
    this.db.prepare('SELECT COUNT(*) as n FROM leads').first<Record<string, unknown>>(),
    this.db.prepare('SELECT COUNT(*) as n FROM signals WHERE friction_analysis IS NOT NULL').first<Record<string, unknown>>(),
  ]);
  return {
    signals:        (sigRow?.['n']      as number) ?? 0,
    opportunities:  (oppRow?.['n']      as number) ?? 0,
    leads:          (leadRow?.['n']     as number) ?? 0,
    analyzed_count: (analyzedRow?.['n'] as number) ?? 0,
  };
}
```

- [ ] **Step 2: Update `handleGetStats()` in index.ts**

Replace the body of `handleGetStats` (lines 746–761):

```typescript
async function handleGetStats(d1repo: D1Repo): Promise<Response> {
  const [stats, bySegRows, topRow] = await Promise.all([
    d1repo.getStats(),
    d1repo.getStatsBySegment(),
    d1repo.getTopOpportunity(),
  ]);
  const by_segment: Record<string, number> = {};
  for (const r of bySegRows) by_segment[r.segment] = r.count;
  return json({
    total_signals:       stats.signals,
    total_opportunities: stats.opportunities,
    analyzed_count:      stats.analyzed_count,
    by_segment,
    top_opportunity: topRow ?? null,
    backend: 'worker+d1',
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd src/main/infrastructure/worker && npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/db/d1-repo.ts \
        src/main/infrastructure/worker/index.ts
git commit -m "feat: add analyzed_count to stats endpoint"
```

---

## Task 2: Backend — `/public/pain-profiles` endpoint

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts` — add `getPainProfiles()`
- Modify: `src/main/infrastructure/worker/index.ts` — add public route + no-auth allow-list

- [ ] **Step 1: Add `getPainProfiles()` to d1-repo.ts**

Add after `getStats()` (after line 578):

```typescript
async getPainProfiles(): Promise<Array<{
  segment: string;
  problem_type: string;
  intensity: number;
  pain_summary: string;
  confidence: number;
  count: number;
}>> {
  const { results } = await this.db
    .prepare(`
      SELECT
        segment,
        json_extract(friction_analysis, '$.problem_type') as problem_type,
        AVG(json_extract(friction_analysis, '$.intensity')) as intensity,
        json_extract(friction_analysis, '$.pain_summary') as pain_summary,
        AVG(json_extract(friction_analysis, '$.confidence')) as confidence,
        COUNT(*) as count
      FROM signals
      WHERE friction_analysis IS NOT NULL
      GROUP BY segment, json_extract(friction_analysis, '$.pain_summary')
      ORDER BY segment, intensity DESC
      LIMIT 100
    `)
    .all<Record<string, unknown>>();
  return (results ?? []).map(r => ({
    segment:      r['segment']      as string,
    problem_type: r['problem_type'] as string ?? 'unknown',
    intensity:    Number(r['intensity'])   || 0,
    pain_summary: r['pain_summary'] as string ?? '',
    confidence:   Number(r['confidence'])  || 0,
    count:        Number(r['count'])       || 0,
  }));
}
```

- [ ] **Step 2: Add route to index.ts**

In the no-auth public path check (around line 104 where `/public/stats` etc. are listed), add `'/public/pain-profiles'`:

```typescript
path === '/public/stats'          ||
path === '/public/opportunities'  ||
path === '/public/leads'          ||
path === '/public/discovery'      ||
path === '/public/config'         ||
path === '/public/pain-profiles'  ||
path.startsWith('/public/landings/')
```

Then in the public routes handler block (after the existing `/public/discovery` handler), add:

```typescript
if (path === '/public/pain-profiles' && method === 'GET') {
  const profiles = await d1repo.getPainProfiles();
  return json(profiles);
}
```

- [ ] **Step 3: Typecheck**

```bash
cd src/main/infrastructure/worker && npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/db/d1-repo.ts \
        src/main/infrastructure/worker/index.ts
git commit -m "feat: add /public/pain-profiles endpoint"
```

---

## Task 3: Frontend types

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/types.ts`

- [ ] **Step 1: Update types.ts**

Replace the file content with:

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
  price_tier: string | null;
  lead_score: number;
}

export interface Stats {
  total_signals: number;
  total_opportunities: number;
  analyzed_count: number;
  by_segment: Record<string, number>;
  top_opportunity: { score: number; pain_summary: string } | null;
}

export interface DiscoveryResult {
  run_id: string | null;
  candidates: DiscoveryCandidate[];
  discovered_at: string | null;
}

export interface Config {
  segments: Record<string, unknown>;
  score: Record<string, unknown>;
  llm: Record<string, unknown>;
  discover: Record<string, unknown>;
  notifications: Record<string, unknown>;
  collectors?: Record<string, unknown>;
  synthesis_segments?: Record<string, unknown>;
}

export interface LandingCopy {
  headline: string;
  subheadline: string;
  pain_points: string[];
  cta: string;
}

export interface GapEntry {
  segment:        string;
  label:          string;
  avg_pain:       number;
  whitespace:     number;
  gap_score:      number;
  has_landing:    boolean;
  opportunity_id: string | null;
}

export interface SignalRow {
  id: string;
  segment: string;
  source: string;
  raw_text: string;
  collected_at: string;
  signal_strength: number | null;
}

export interface PainProfile {
  segment: string;
  problem_type: string;
  intensity: number;
  pain_summary: string;
  confidence: number;
  count: number;
}
```

- [ ] **Step 2: Typecheck frontend**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/types.ts
git commit -m "feat: add SignalRow, PainProfile types; analyzed_count in Stats"
```

---

## Task 4: Update `+page.server.ts`

**Files:**
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts`

- [ ] **Step 1: Rewrite `+page.server.ts`**

Replace the entire file:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Stats, DiscoveryResult, Opportunity, Config, GapEntry, SignalRow, PainProfile } from '$lib/types.js';

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

async function safeJson<T>(res: Response, fallback: T): Promise<T> {
  if (!res.ok) return fallback;
  try { return await res.json() as T; } catch { return fallback; }
}

export const load: PageServerLoad = async ({ platform }) => {
  const env  = (platform as App.Platform).env;
  const base = env.WORKER_URL.replace(/\/$/, '');

  const [statsRes, oppsRes, leadsRes, discoveryRes, configRes, healthRes, gapRes, signalsRes, painRes] = await Promise.all([
    fetch(`${base}/public/stats`),
    fetch(`${base}/public/opportunities`),
    fetch(`${base}/public/leads`),
    fetch(`${base}/public/discovery`),
    fetch(`${base}/public/config`),
    workerFetch(`${base}/health`, env),
    workerFetch(`${base}/gap-radar`, env),
    workerFetch(`${base}/signals?limit=200`, env),
    fetch(`${base}/public/pain-profiles`),
  ]);

  const [statsData, oppsData, leadsData, discoveryData, configData, healthData, gapData, signalsData, painData] = await Promise.all([
    safeJson<Stats>(statsRes, { total_signals: 0, total_opportunities: 0, analyzed_count: 0, by_segment: {}, top_opportunity: null }),
    safeJson<{ results: Opportunity[] }>(oppsRes, { results: [] }),
    safeJson<{ total: number; by_segment: Record<string, { email: string; captured_at: string; price_tier: string | null; lead_score: number }[]> }>(leadsRes, { total: 0, by_segment: {} }),
    safeJson<DiscoveryResult>(discoveryRes, { candidates: [], discovered_at: null, run_id: '' }),
    safeJson<{ config: Config }>(configRes, { config: {} as Config }),
    safeJson<{ status: string; last_runs: Record<string, { last_run_at: string; signal_count: number; error: string | null }> }>(healthRes, { status: 'error', last_runs: {} }),
    safeJson<GapEntry[]>(gapRes, []),
    safeJson<SignalRow[]>(signalsRes, []),
    safeJson<PainProfile[]>(painRes, []),
  ]);

  return {
    stats:         statsData,
    opportunities: oppsData.results ?? [],
    leads:         leadsData,
    discovery:     discoveryData,
    config:        configData.config,
    health:        healthData,
    gapRadar:      gapData,
    signals:       signalsData,
    painProfiles:  painData,
  };
};

export const actions: Actions = {
  runCron: async ({ platform }) => {
    const env = (platform as App.Platform).env;
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/run-cron`, env, { method: 'POST' });
    if (!res.ok) return { success: false, error: `Error ${res.status}` };
    return { success: true };
  },

  deploy: async ({ request, platform }) => {
    const env      = (platform as App.Platform).env;
    const formData = await request.formData();
    const segment  = formData.get('segment') as string;
    const pageSlug = (formData.get('page_slug') as string | null) ?? 'index';
    const rawHtml  = formData.get('html') as string | null;
    const rawCopy  = formData.get('copy') as string | null;
    const body: Record<string, unknown> = { segment, page_slug: pageSlug };
    if (rawHtml) body.html = rawHtml;
    if (rawCopy) body.copy = JSON.parse(rawCopy);
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/deploy`, env, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return { success: false, error: `${res.status}` };
    const data = await res.json() as { url: string };
    return { success: true, url: data.url };
  },

  deletePage: async ({ request, platform }) => {
    const env      = (platform as App.Platform).env;
    const formData = await request.formData();
    const segment  = formData.get('segment') as string;
    const pageSlug = formData.get('page_slug') as string;
    await workerFetch(
      `${env.WORKER_URL.replace(/\/$/, '')}/pages/${encodeURIComponent(segment)}/${encodeURIComponent(pageSlug)}`,
      env,
      { method: 'DELETE' },
    );
    return { success: true };
  },

  saveConfig: async ({ request, platform }) => {
    const env    = (platform as App.Platform).env;
    const formData = await request.formData();
    const config = JSON.parse(formData.get('config') as string) as Config;
    const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/config`, env, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
    return { success: res.ok };
  },

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

  generateSeed: async ({ request, platform }) => {
    const env  = (platform as App.Platform).env;
    const fd   = await request.formData();
    const desc = fd.get('description') as string;
    const res  = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/generate-seed`, env, {
      method: 'POST',
      body:   JSON.stringify({ description: desc }),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: string };
      return { success: false, error: err.error ?? `Error ${res.status}` };
    }
    const data = await res.json() as { segments: Record<string, unknown> };
    return { success: true, count: Object.keys(data.segments).length };
  },

  logout: async ({ cookies }) => {
    cookies.delete('session', { path: '/' });
    throw redirect(302, '/login');
  },
};
```

- [ ] **Step 2: Typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts
git commit -m "feat: load signals and pain-profiles in dashboard; remove discover action"
```

---

## Task 5: New `PipelineBar.svelte`

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/PipelineBar.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  export let stages: Array<{
    key:   string;
    label: string;
    sub:   string;
    state: 'done' | 'running' | 'pending';
  }>;
  export let activeTab: string;
  export let onStageClick: (key: string) => void;
</script>

<div class="pipeline-zone">
  <div class="pipeline">
    {#each stages as stage, i}
      <button
        class="stage {stage.state}"
        class:tab-active={activeTab === stage.key}
        on:click={() => onStageClick(stage.key)}
        title={stage.label}
      >
        <div class="circle">
          {#if stage.state === 'done'}✓{:else if stage.state === 'running'}···{:else}○{/if}
        </div>
        <div class="label">{stage.label}</div>
        <div class="sub">{stage.sub}</div>
        <div class="bar"></div>
      </button>
      {#if i < stages.length - 1}
        <div class="conn {stage.state === 'done' && stages[i + 1].state !== 'pending' ? 'done' : stage.state === 'done' ? 'half' : 'pending'}"></div>
      {/if}
    {/each}
  </div>

  <div class="tabs">
    {#each stages as stage}
      <button
        class="tab"
        class:active={activeTab === stage.key}
        on:click={() => onStageClick(stage.key)}
      >{stage.label}</button>
    {/each}
  </div>
</div>

<style>
  .pipeline-zone { border-bottom: 1px solid var(--border); background: var(--bg-card); }

  .pipeline { display: flex; align-items: flex-end; padding: 14px 16px 0; gap: 0; overflow-x: auto; }

  .stage { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; background: none; border: none; padding: 0; }
  .stage:hover .circle { opacity: .8; }

  .circle { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-bottom: 4px; flex-shrink: 0; transition: opacity .15s; }
  .label  { font-size: 10px; font-weight: 600; white-space: nowrap; color: var(--text-muted); }
  .sub    { font-size: 9px; color: var(--text-dim); margin-top: 2px; white-space: nowrap; }
  .bar    { width: 100%; height: 3px; margin-top: 7px; border-radius: 2px 2px 0 0; }

  /* done */
  .done .circle { background: var(--violet); color: #fff; }
  .done .label  { color: var(--violet); }
  .done .bar    { background: var(--violet); }

  /* running — pulse */
  .running .circle { background: var(--violet); color: #fff; animation: pulse .9s ease-in-out infinite; }
  .running .label  { color: var(--violet); font-weight: 700; }
  .running .bar    { background: var(--violet); opacity: .3; animation: pulse .9s ease-in-out infinite; }

  /* pending */
  .pending .circle { background: var(--bg-input); color: var(--border); }
  .pending .bar    { background: var(--bg-input); }

  /* selected tab highlighted */
  .tab-active .bar  { background: var(--violet) !important; opacity: 1 !important; height: 3px; }
  .tab-active .label { color: var(--violet) !important; font-weight: 700; }

  /* connectors */
  .conn { flex: 0 0 10px; height: 2px; margin-bottom: 22px; flex-shrink: 0; }
  .conn.done    { background: var(--violet); }
  .conn.half    { background: linear-gradient(90deg, var(--violet) 50%, var(--border) 50%); }
  .conn.pending { background: var(--border); }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }

  /* TABS */
  .tabs { display: flex; background: var(--bg); border-top: 1px solid var(--border-sub); }
  .tab  { flex: 1; padding: 8px 2px; text-align: center; font-size: 10.5px; color: var(--text-dim); cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab.active { color: var(--violet); border-bottom-color: var(--violet); font-weight: 600; }

  /* Responsive: hide sub-label on narrow viewports */
  @media (max-width: 600px) {
    .sub { display: none; }
    .label { font-size: 9px; }
    .conn { flex: 0 0 6px; }
  }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/PipelineBar.svelte
git commit -m "feat: add PipelineBar component"
```

---

## Task 6: New `SignalsTable.svelte`

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/SignalsTable.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { SignalRow } from '$lib/types.js';
  export let signals: SignalRow[] = [];

  function fmt(iso: string): string {
    return new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  }
  function strengthPct(v: number | null): string {
    return `${Math.round((v ?? 0) * 100)}%`;
  }
</script>

{#if signals.length === 0}
  <p class="empty">Sin señales todavía.</p>
{:else}
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Segmento</th>
          <th>Fuente</th>
          <th class="col-text">Texto</th>
          <th>Fuerza</th>
        </tr>
      </thead>
      <tbody>
        {#each signals as s}
          <tr>
            <td class="nowrap">{fmt(s.collected_at)}</td>
            <td class="nowrap seg">{s.segment}</td>
            <td class="nowrap">{s.source}</td>
            <td class="col-text excerpt">{s.raw_text.slice(0, 120)}{s.raw_text.length > 120 ? '…' : ''}</td>
            <td>
              <div class="bar-track">
                <div class="bar-fill" style="width:{strengthPct(s.signal_strength)}"></div>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .wrap     { overflow-x: auto; }
  table     { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  th        { color: var(--text-muted); font-weight: 500; text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td        { padding: 7px 10px; border-bottom: 1px solid var(--border-sub); color: var(--text-sub); vertical-align: top; }
  .nowrap   { white-space: nowrap; }
  .seg      { color: var(--text); font-weight: 500; }
  .col-text { max-width: 340px; }
  .excerpt  { color: var(--text-muted); line-height: 1.4; }
  .bar-track { width: 60px; height: 5px; background: var(--border); border-radius: 3px; }
  .bar-fill  { height: 100%; background: var(--violet); border-radius: 3px; }
  .empty    { color: var(--text-muted); font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/SignalsTable.svelte
git commit -m "feat: add SignalsTable component"
```

---

## Task 7: New `FrictionList.svelte`

**Files:**
- Create: `src/main/infrastructure/pages/src/lib/components/FrictionList.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { PainProfile } from '$lib/types.js';
  export let profiles: PainProfile[] = [];

  // Group by segment
  $: grouped = profiles.reduce<Record<string, PainProfile[]>>((acc, p) => {
    (acc[p.segment] ??= []).push(p);
    return acc;
  }, {});

  function intensityBar(v: number): string {
    return `${Math.round(Math.min(v / 10, 1) * 100)}%`;
  }
</script>

{#if profiles.length === 0}
  <p class="empty">Sin análisis de fricción todavía — espera al próximo sync.</p>
{:else}
  <div class="list">
    {#each Object.entries(grouped) as [segment, items]}
      <div class="group">
        <div class="group-header">{segment}</div>
        {#each items as p}
          <div class="profile">
            <div class="profile-top">
              <span class="type">{p.problem_type}</span>
              <div class="bar-track">
                <div class="bar-fill" style="width:{intensityBar(p.intensity)}"></div>
              </div>
              <span class="intensity">{p.intensity.toFixed(1)}</span>
              <span class="count">{p.count} señal{p.count !== 1 ? 'es' : ''}</span>
            </div>
            {#if p.pain_summary}
              <p class="summary">{p.pain_summary}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .list         { display: flex; flex-direction: column; gap: 16px; }
  .group        { background: var(--bg-card); border: 1px solid var(--border-sub); border-radius: 9px; overflow: hidden; }
  .group-header { padding: 9px 14px; font-weight: 700; font-size: 0.82rem; color: var(--text); border-bottom: 1px solid var(--border-sub); background: var(--bg); }
  .profile      { padding: 9px 14px; border-bottom: 1px solid var(--border-sub); }
  .profile:last-child { border-bottom: none; }
  .profile-top  { display: flex; align-items: center; gap: 8px; }
  .type         { font-size: 0.72rem; font-weight: 600; color: var(--violet); min-width: 80px; }
  .bar-track    { flex: 1; height: 5px; background: var(--border); border-radius: 3px; }
  .bar-fill     { height: 100%; background: var(--violet); border-radius: 3px; }
  .intensity    { font-size: 0.72rem; font-weight: 700; color: var(--text-sub); width: 28px; text-align: right; }
  .count        { font-size: 0.68rem; color: var(--text-dim); white-space: nowrap; }
  .summary      { font-size: 0.75rem; color: var(--text-muted); margin-top: 5px; line-height: 1.45; }
  .empty        { color: var(--text-muted); font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/FrictionList.svelte
git commit -m "feat: add FrictionList component"
```

---

## Task 8: Modify `OpportunityList.svelte` — remove deploy

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/components/OpportunityList.svelte`

- [ ] **Step 1: Remove deploy button and DeployModal**

Replace the entire file:

```svelte
<script lang="ts">
  import type { Opportunity } from '$lib/types.js';
  import { cleanSegment }     from '$lib/utils.js';
  import { deserialize }      from '$app/forms';

  export let opportunities: Opportunity[];
  export let onStatusChange: () => void;

  let openSegment: string | null = null;
  let changingStatus = false;

  function toggle(seg: string) {
    openSegment = openSegment === seg ? null : seg;
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
    const res    = await fetch('?/changeStatus', { method: 'POST', body: fd });
    const result = deserialize(await res.text()) as { type: string; data?: { success: boolean } };
    changingStatus = false;
    if (result.type === 'success' && result.data?.success) onStatusChange();
  }
</script>

{#if !opportunities.length}
  <p class="empty">Sin oportunidades todavía.</p>
{:else}
  <ul class="list">
    {#each opportunities as o (o.segment)}
      {@const open = openSegment === o.segment}
      <li class="item" class:open>
        <button class="row" on:click={() => toggle(o.segment)}>
          <div class="row-left">
            <span class="name">{cleanSegment(o.segment)}</span>
            <span class="badge badge-{o.status}">{o.status}</span>
            {#if o.pain_summary}
              <span class="pain">{o.pain_summary.slice(0, 60)}{o.pain_summary.length > 60 ? '…' : ''}</span>
            {/if}
          </div>
          <div class="row-right">
            <span class="score">{o.score.toFixed(1)}</span>
            <span class="signals">{o.signal_count ?? 0} señ.</span>
            <span class="chevron" class:rotated={open}>›</span>
          </div>
        </button>

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
              <span class="hint">→ Ve al Radar para desplegar</span>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .list  { list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .item  { background: var(--bg-card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-sub); }
  .row   { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 10px 12px; background: none; border: none; cursor: pointer; gap: 8px; text-align: left; }
  .row:hover { background: var(--bg-input); }
  .row-left  { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .name   { font-size: 0.85rem; font-weight: 600; color: var(--text); }
  .pain   { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .score  { font-size: 0.9rem; font-weight: 700; color: var(--violet); }
  .signals{ font-size: 0.68rem; color: var(--text-dim); }
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
  .bar-fill     { height: 100%; background: var(--violet); border-radius: 3px; }
  .pain-full    { font-size: 0.78rem; color: var(--text-sub); line-height: 1.5; margin-bottom: 8px; }
  .meta-row     { margin-bottom: 10px; }
  .meta         { font-size: 0.7rem; color: var(--text-muted); }
  .actions      { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .status-select{ padding: 4px 8px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text-sub); font-size: 0.75rem; cursor: pointer; }
  .hint         { font-size: 0.7rem; color: var(--text-dim); font-style: italic; }
  .empty { color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/OpportunityList.svelte
git commit -m "feat: remove deploy button from OpportunityList; hint to use Radar"
```

---

## Task 9: Modify `GapRadar.svelte` — card layout, violet/gray, sole deploy

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/components/GapRadar.svelte`

- [ ] **Step 1: Rewrite GapRadar.svelte**

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { GapEntry } from '$lib/types.js';

  export let entries: GapEntry[] = [];

  const dispatch = createEventDispatcher<{ deploy: string }>();

  $: sorted = [...entries].sort((a, b) => b.gap_score - a.gap_score);
</script>

{#if sorted.length === 0}
  <p class="empty">Sin datos de gap todavía — espera al próximo sync.</p>
{:else}
  <div class="list">
    {#each sorted as entry}
      <div class="row" class:deployed={entry.has_landing}>
        <div class="gap-badge" class:high={entry.gap_score >= 70} class:mid={entry.gap_score >= 40 && entry.gap_score < 70}>
          <span class="gap-score">{entry.gap_score}</span>
          <span class="gap-label">gap</span>
        </div>
        <div class="body">
          <div class="seg-name">{entry.label}</div>
          <div class="meta">
            dolor {entry.avg_pain.toFixed(1)} · vacío {entry.whitespace}%
            {#if entry.has_landing}<span class="live-tag">· landing activa</span>{/if}
          </div>
        </div>
        <div class="action">
          {#if entry.has_landing}
            <span class="deployed-tag">Desplegado ✓</span>
          {:else}
            <button class="btn-deploy" on:click={() => dispatch('deploy', entry.segment)}>
              Desplegar →
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .list { display: flex; flex-direction: column; gap: 8px; }

  .row { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border-sub); border-radius: 9px; background: var(--bg-card); transition: border-color .12s; }
  .row:hover:not(.deployed) { border-color: var(--border); }
  .row.deployed { opacity: 0.45; }

  .gap-badge { min-width: 48px; height: 48px; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-input); flex-shrink: 0; }
  .gap-badge.high { background: var(--violet-bg); }
  .gap-badge.mid  { background: var(--bg-input); }
  .gap-score { font-size: 15px; font-weight: 700; color: var(--text-muted); }
  .gap-badge.high .gap-score { color: var(--violet); }
  .gap-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim); }

  .body { flex: 1; min-width: 0; }
  .seg-name { font-weight: 600; font-size: 0.85rem; color: var(--text); }
  .meta     { font-size: 0.72rem; color: var(--text-muted); margin-top: 3px; }
  .live-tag { color: var(--violet); }

  .action { flex-shrink: 0; }
  .btn-deploy   { padding: 6px 13px; background: var(--violet); color: #fff; border: none; border-radius: 7px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .btn-deploy:hover { opacity: .88; }
  .deployed-tag { font-size: 0.72rem; color: var(--text-dim); font-weight: 600; white-space: nowrap; }

  .empty { color: var(--text-muted); font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/GapRadar.svelte
git commit -m "feat: redesign GapRadar as card list; sole deploy location; violet/gray colors"
```

---

## Task 10: Modify `SectorsGrid.svelte` — add discovered_at

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte`

- [ ] **Step 1: Add `discovered_at` prop and timestamp header**

Replace the file:

```svelte
<script lang="ts">
  import type { DiscoveryResult } from '$lib/types.js';
  export let discovery: DiscoveryResult;

  function scoreColor(s: number) {
    return s > 12 ? 'var(--violet)' : s > 6 ? 'var(--text-sub)' : 'var(--text-muted)';
  }

  $: ts = discovery.discovered_at
    ? new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(discovery.discovered_at))
    : null;
</script>

{#if ts}
  <p class="ts">Última actualización: {ts}</p>
{/if}

<div class="grid">
  {#if !discovery.candidates?.length}
    <div class="card"><p class="muted">Sin sectores detectados todavía.</p></div>
  {:else}
    {#each discovery.candidates.slice(0, 12) as c}
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
  .ts   { font-size: 0.7rem; color: var(--text-muted); margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { background: var(--bg-card); border: 1px solid var(--border-sub); border-radius: 10px; padding: 16px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header strong { color: var(--text); font-size: 0.88rem; line-height: 1.3; }
  .pain  { color: var(--text-muted); font-size: 0.78rem; margin-bottom: 10px; line-height: 1.4; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip  { padding: 2px 6px; background: var(--bg-input); border-radius: 4px; font-size: 0.68rem; color: var(--text-muted); }
  .meta  { margin-top: 8px; font-size: 0.68rem; color: var(--text-dim); }
  .muted { color: var(--text-muted); font-size: 0.85rem; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/main/infrastructure/pages/src/lib/components/SectorsGrid.svelte
git commit -m "feat: show discovered_at timestamp in SectorsGrid; remove green color"
```

---

## Task 11: Delete `StatsBar.svelte`

**Files:**
- Delete: `src/main/infrastructure/pages/src/lib/components/StatsBar.svelte`

- [ ] **Step 1: Delete the file**

```bash
rm src/main/infrastructure/pages/src/lib/components/StatsBar.svelte
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: delete StatsBar component (replaced by PipelineBar sub-labels)"
```

---

## Task 12: Rewrite `+page.svelte`

**Files:**
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.svelte`

This is the largest task. It replaces the entire page script and template.

- [ ] **Step 1: Rewrite `+page.svelte`**

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { theme }          from '$lib/theme.js';
  import PipelineBar        from '$lib/components/PipelineBar.svelte';
  import SignalsTable        from '$lib/components/SignalsTable.svelte';
  import FrictionList        from '$lib/components/FrictionList.svelte';
  import SectorsGrid         from '$lib/components/SectorsGrid.svelte';
  import OpportunityList     from '$lib/components/OpportunityList.svelte';
  import GapRadar            from '$lib/components/GapRadar.svelte';
  import LeadsTable          from '$lib/components/LeadsTable.svelte';
  import ConfigForm          from '$lib/components/ConfigForm.svelte';
  import DeployModal         from '$lib/components/DeployModal.svelte';

  export let data: PageData;

  type Tab = 'senales' | 'dolor' | 'segmentos' | 'oportunidades' | 'radar' | 'leads';
  let activeTab: Tab = 'oportunidades';

  // Config overlay
  let showConfig = false;

  // Deploy modal (triggered from GapRadar)
  let deploySegment = '';
  let showDeploy    = false;

  // ── Sync status ─────────────────────────────────────────────────────────────
  let syncRunning   = false;
  let syncPollTimer: ReturnType<typeof setInterval> | null = null;
  let lastRunSnapshot: Record<string, string> = {};  // collector_id → last_run_at

  function syncAgeLabel(health: PageData['health']): string {
    const runs = Object.values(health.last_runs ?? {});
    if (!runs.length) return 'nunca';
    const latest = runs.reduce((max, r) => r.last_run_at > max ? r.last_run_at : max, '');
    if (!latest) return 'nunca';
    const mins = Math.round((Date.now() - new Date(latest).getTime()) / 60_000);
    if (mins < 2)   return 'hace un momento';
    if (mins < 60)  return `hace ${mins} min`;
    const hrs = Math.round(mins / 60);
    return `hace ${hrs}h`;
  }

  $: syncAge = syncAgeLabel(data.health);

  async function pollSync() {
    try {
      const res  = await fetch('/api/health');
      if (!res.ok) return;
      const body = await res.json() as { last_runs: Record<string, { last_run_at: string }> };
      const changed = Object.entries(body.last_runs ?? {}).some(
        ([id, r]) => lastRunSnapshot[id] !== r.last_run_at
      );
      if (changed) {
        if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
        syncRunning = false;
        await invalidateAll();
      }
    } catch { /* non-fatal */ }
  }

  async function forceSync() {
    if (syncRunning) return;
    syncRunning = true;
    // Snapshot current last_run_at values so we can detect change
    lastRunSnapshot = Object.fromEntries(
      Object.entries(data.health.last_runs ?? {}).map(([id, r]) => [id, r.last_run_at])
    );
    try {
      await fetch('/api/run-cron', { method: 'POST' });
    } catch { /* non-fatal — cron started fire-and-forget */ }
    // Poll every 5s; stop after 10 min
    if (syncPollTimer) clearInterval(syncPollTimer);
    syncPollTimer = setInterval(pollSync, 5_000);
    setTimeout(() => {
      if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
      syncRunning = false;
    }, 600_000);
  }

  // ── Pipeline stage derivation ───────────────────────────────────────────────
  $: pipelineStages = [
    {
      key:   'senales',
      label: 'Señales',
      sub:   data.stats.total_signals > 0 ? `${data.stats.total_signals}` : '—',
      state: (data.stats.total_signals > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
    {
      key:   'dolor',
      label: 'Dolor',
      sub:   data.stats.analyzed_count > 0 ? `${data.stats.analyzed_count} perfiles` : '—',
      state: (data.stats.analyzed_count > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
    {
      key:   'segmentos',
      label: 'Segmentos',
      sub:   syncRunning && activeTab !== 'segmentos'
               ? 'en curso'
               : data.discovery.candidates.length > 0
                 ? `${data.discovery.candidates.length}`
                 : '—',
      state: (syncRunning
        ? 'running'
        : data.discovery.candidates.length > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
    {
      key:   'oportunidades',
      label: 'Oportunidades',
      sub:   data.opportunities.length > 0 ? `${data.opportunities.length}` : '—',
      state: (data.opportunities.length > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
    {
      key:   'radar',
      label: 'Radar',
      sub:   data.gapRadar.length > 0 ? `${data.gapRadar.filter(e => !e.has_landing).length} huecos` : '—',
      state: (data.gapRadar.length > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
    {
      key:   'leads',
      label: 'Leads',
      sub:   data.leads.total > 0 ? `${data.leads.total}` : '—',
      state: (data.leads.total > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
  ];
</script>

<svelte:head><title>Market Intel</title></svelte:head>

<div class="shell">
  <header>
    <div>
      <div class="title">Market Intel</div>
      <div class="subtitle">Señales de dolor · Cádiz / España</div>
    </div>
    <div class="header-actions">
      <div class="sync-pill" class:running={syncRunning}>
        <span class="sync-dot" class:running={syncRunning}></span>
        {#if syncRunning}en curso{:else}{syncAge}{/if}
        <button class="sync-btn" on:click={forceSync} disabled={syncRunning} title="Forzar sync">↻</button>
      </div>
      <button class="btn-icon" on:click={() => showConfig = true} title="Configuración">⚙</button>
      <button class="btn-icon" on:click={() => theme.toggle()} title="Cambiar tema">
        {$theme === 'dark' ? '☀' : '☾'}
      </button>
      <form method="POST" action="?/logout" style="display:contents">
        <button class="btn-sm">Salir</button>
      </form>
    </div>
  </header>

  <PipelineBar
    stages={pipelineStages}
    activeTab={activeTab}
    onStageClick={(key) => activeTab = key as Tab}
  />

  <main>
    {#if activeTab === 'senales'}
      <SignalsTable signals={data.signals} />
    {:else if activeTab === 'dolor'}
      <FrictionList profiles={data.painProfiles} />
    {:else if activeTab === 'segmentos'}
      <SectorsGrid discovery={data.discovery} />
    {:else if activeTab === 'oportunidades'}
      <OpportunityList opportunities={data.opportunities} onStatusChange={() => invalidateAll()} />
    {:else if activeTab === 'radar'}
      <GapRadar
        entries={data.gapRadar}
        on:deploy={e => { deploySegment = e.detail; showDeploy = true; }}
      />
    {:else if activeTab === 'leads'}
      <LeadsTable bySegment={data.leads.by_segment} total={data.leads.total} />
    {/if}
  </main>
</div>

{#if showDeploy && deploySegment}
  <DeployModal
    segment={deploySegment}
    on:close={() => { showDeploy = false; deploySegment = ''; invalidateAll(); }}
  />
{/if}

{#if showConfig}
  <div class="config-overlay" role="dialog" aria-modal="true">
    <div class="config-panel">
      <div class="config-header">
        <span class="config-title">Configuración</span>
        <button class="btn-icon" on:click={() => showConfig = false}>✕</button>
      </div>
      <div class="config-body">
        <ConfigForm config={data.config} onSave={() => { showConfig = false; invalidateAll(); }} />
      </div>
    </div>
  </div>
{/if}

<style>
  .shell   { max-width: 860px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; }

  header   { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; background: var(--bg); border-bottom: 1px solid var(--border); }
  .title   { font-size: 1.05rem; font-weight: 700; color: var(--text); }
  .subtitle{ font-size: 0.68rem; color: var(--text-muted); margin-top: 1px; }
  .header-actions { display: flex; align-items: center; gap: 8px; }

  /* Sync pill */
  .sync-pill { display: flex; align-items: center; gap: 5px; padding: 4px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; font-size: 0.72rem; color: var(--text-sub); }
  .sync-pill.running { border-color: var(--violet); }
  .sync-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
  .sync-dot.running { background: var(--violet); animation: pulse .9s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  .sync-btn { background: none; border: none; cursor: pointer; font-size: 0.9rem; color: var(--text-dim); opacity: .5; padding: 0 0 0 2px; transition: opacity .15s; }
  .sync-btn:hover:not(:disabled) { opacity: 1; }
  .sync-btn:disabled { cursor: default; }

  .btn-icon { background: none; border: 1px solid var(--border); border-radius: 6px; padding: 5px 9px; font-size: 0.8rem; color: var(--text-sub); cursor: pointer; }
  .btn-icon:hover { background: var(--bg-card); }
  .btn-sm   { padding: 5px 12px; background: var(--bg-card); color: var(--text-sub); border: 1px solid var(--border); border-radius: 6px; font-size: 0.72rem; cursor: pointer; }

  main { flex: 1; padding: 16px; overflow-x: hidden; }

  /* Config overlay */
  .config-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; display: flex; justify-content: flex-end; }
  .config-panel   { width: min(540px, 100vw); background: var(--bg); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  .config-header  { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .config-title   { font-weight: 700; font-size: 0.9rem; color: var(--text); }
  .config-body    { flex: 1; overflow-y: auto; padding: 16px; }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Test manually**

```bash
cd src/main/infrastructure/pages && npm run dev
```

Open http://localhost:5173/dashboard and verify:
- Header shows sync pill with age and ↻ button — no Ingestar button
- Pipeline bar shows 6 stages with correct states
- Clicking each stage navigates to its tab
- Oportunidades tab: list with no deploy button
- Radar tab: card list ordered by gap score, "Desplegar →" only on rows without landing
- Sectores tab: grid with timestamp, no Explorar button
- Señales tab: table of raw signals
- Dolor tab: grouped friction profiles
- ⚙ button opens config slide-over panel
- ↻ triggers sync and shows "en curso" state

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/dashboard/+page.svelte
git commit -m "feat: restructure dashboard — pipeline bar, 6 tabs, sync pill, config overlay"
```

---

## Task 13: Deploy worker + pages

- [ ] **Step 1: Deploy worker**

```bash
npx wrangler deploy
```
Expected: `Deployed market-intel-api triggers`

- [ ] **Step 2: Deploy pages**

```bash
cd src/main/infrastructure/pages && npm run build
```
Then push to trigger Cloudflare Pages CI, or deploy via:
```bash
npx wrangler pages deploy .svelte-kit/cloudflare
```

- [ ] **Step 3: Push**

```bash
git push
```
