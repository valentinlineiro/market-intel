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
