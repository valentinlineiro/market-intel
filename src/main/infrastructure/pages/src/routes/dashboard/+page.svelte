<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { deserialize }   from '$app/forms';
  import { theme }           from '$lib/theme.js';
  import StatsBar            from '$lib/components/StatsBar.svelte';
  import SectorsGrid         from '$lib/components/SectorsGrid.svelte';
  import OpportunityList     from '$lib/components/OpportunityList.svelte';
  import LeadsTable          from '$lib/components/LeadsTable.svelte';
  import ConfigForm          from '$lib/components/ConfigForm.svelte';
  import GapRadar            from '$lib/components/GapRadar.svelte';
  import DeployModal         from '$lib/components/DeployModal.svelte';

  export let data: PageData;

  type Tab = 'oportunidades' | 'sectores' | 'leads' | 'config' | 'radar';
  let activeTab: Tab = 'oportunidades';

  let showDeploy    = false;
  let deploySegment = '';

  type DiscoverState = { type: 'idle' } | { type: 'loading' } | { type: 'success'; count: number } | { type: 'error'; message: string };
  let discoverState: DiscoverState = { type: 'idle' };

  // ── Ingesta ──────────────────────────────────────────────────────────────

  type CollectorRun = { signal_count: number; error: string | null; last_run_at: string };
  type HealthData   = { status: string; last_runs: Record<string, CollectorRun> };

  let ingestRunning  = false;
  let ingestError    = '';
  let ingestStarted  = '';                          // ISO timestamp of last trigger
  let liveRuns: Record<string, CollectorRun> = {};  // refreshed by polling
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Collectors to show progress for (all registered ones)
  const COLLECTOR_LABELS: Record<string, string> = {
    gnews: 'GNews', local_news: 'Noticias locales', github: 'GitHub',
    stackoverflow: 'Stack Overflow', reddit: 'Reddit', youtube: 'YouTube',
    bluesky: 'Bluesky', mastodon: 'Mastodon',
    hackernews: 'Hacker News', boe: 'BOE', boja: 'BOJA',
    bocas: 'BOCAs', betalist: 'BetaList', appsumo: 'AppSumo',
    producthunt: 'Product Hunt', ine: 'INE',
  };

  $: ingestCollectors = Object.entries(liveRuns).map(([id, run]) => ({
    id,
    label:  COLLECTOR_LABELS[id] ?? id,
    done:   ingestStarted ? run.last_run_at >= ingestStarted : false,
    count:  run.signal_count,
    error:  run.error,
  }));

  $: allDone = ingestCollectors.length > 0 && ingestCollectors.every(c => c.done);

  async function pollHealth() {
    try {
      const res  = await fetch('/api/health');
      if (!res.ok) return;
      const data = await res.json() as HealthData;
      liveRuns = data.last_runs ?? {};
    } catch { /* non-fatal */ }
  }

  async function runCron() {
    ingestRunning = true;
    ingestError   = '';
    ingestStarted = new Date().toISOString();
    liveRuns      = {};

    try {
      const res = await fetch('/api/run-cron', { method: 'POST' });
      if (!res.ok) {
        ingestError   = `Error ${res.status}`;
        ingestRunning = false;
        return;
      }
    } catch (e) {
      ingestError   = e instanceof Error ? e.message : 'Error';
      ingestRunning = false;
      return;
    }

    // Poll health every 4 s until all collectors report back or 5 min timeout
    if (pollTimer) clearInterval(pollTimer);
    await pollHealth();
    pollTimer = setInterval(async () => {
      await pollHealth();
      if (allDone) {
        clearInterval(pollTimer!);
        pollTimer     = null;
        ingestRunning = false;
        await invalidateAll();
      }
    }, 4000);

    // Safety timeout: stop polling after 5 min regardless
    setTimeout(() => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      ingestRunning = false;
    }, 300_000);
  }

  async function runDiscovery() {
    discoverState = { type: 'loading' };
    try {
      const fd  = new FormData();
      const res = await fetch('?/discover', { method: 'POST', body: fd });
      const result = deserialize(await res.text()) as { type: string; data?: { success: boolean; count?: number; error?: string; message?: string } };
      if (result.type === 'success' && result.data?.success) {
        discoverState = { type: 'success', count: result.data.count ?? 0 };
        await invalidateAll();
      } else {
        const msg = result.data?.error ?? 'Error desconocido';
        discoverState = { type: 'error', message: msg };
      }
    } catch (e) {
      discoverState = { type: 'error', message: e instanceof Error ? e.message : 'Error desconocido' };
    }
  }
</script>

<svelte:head><title>Market Intel</title></svelte:head>

<div class="shell">
  <header>
    <div>
      <div class="title">Market Intel</div>
      <div class="subtitle">Señales de dolor · Cádiz / España</div>
    </div>
    <div class="header-actions">
      <button
        class="btn-sm btn-ingest"
        disabled={ingestRunning}
        on:click={runCron}
        title="Disparar ingesta ahora"
      >
        {#if ingestRunning}
          <span class="spinner"></span> Ingestando...
        {:else if ingestError}
          ✗ Error
        {:else}
          ▶ Ingestar
        {/if}
      </button>
      <button class="btn-icon" on:click={() => theme.toggle()} title="Cambiar tema">
        {$theme === 'dark' ? '☀' : '☾'}
      </button>
      <form method="POST" action="?/logout" style="display:contents">
        <button class="btn-sm">Salir</button>
      </form>
    </div>
  </header>

  {#if ingestRunning || ingestError || (ingestStarted && allDone)}
    <div class="ingest-panel">
      <div class="ingest-header">
        {#if ingestError}
          <span class="ingest-status err">✗ {ingestError}</span>
        {:else if allDone}
          <span class="ingest-status ok">✓ Ingesta completa</span>
        {:else}
          <span class="ingest-status running"><span class="spinner spinner-dark"></span> Ingesta en curso…</span>
        {/if}
        <button class="banner-close" on:click={() => { ingestStarted = ''; ingestError = ''; liveRuns = {}; }}>×</button>
      </div>
      {#if ingestCollectors.length > 0}
        <div class="collector-list">
          {#each ingestCollectors as c}
            <div class="collector-row" class:done={c.done} class:has-error={!!c.error}>
              <span class="c-icon">{c.error ? '✗' : c.done ? '✓' : '…'}</span>
              <span class="c-label">{c.label}</span>
              {#if c.done}
                <span class="c-count">{c.count} señal{c.count !== 1 ? 'es' : ''}</span>
              {/if}
              {#if c.error}
                <span class="c-err">{c.error}</span>
              {/if}
            </div>
          {/each}
        </div>
      {:else if ingestRunning}
        <div class="progress-bar"><div class="progress-fill"></div></div>
      {/if}
    </div>
  {/if}

  <StatsBar
    totalSignals={data.stats.total_signals ?? 0}
    opportunities={data.opportunities}
    health={data.health}
  />

  <nav class="tabs">
    {#each [['oportunidades','Oportunidades'],['sectores','Sectores'],['leads','Leads'],['config','Config'],['radar','Radar']] as [id, label]}
      <button
        class="tab"
        class:active={activeTab === id}
        on:click={() => activeTab = id as Tab}
      >{label}</button>
    {/each}
  </nav>

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
        <button class="btn-primary" on:click={runDiscovery} disabled={discoverState.type === 'loading'}>
          {#if discoverState.type === 'loading'}
            <span class="spinner"></span> Explorando...
          {:else}
            Descubrir ahora
          {/if}
        </button>
      </div>
      {#if discoverState.type === 'loading'}
        <div class="progress-bar"><div class="progress-fill"></div></div>
      {:else if discoverState.type === 'success'}
        <div class="discover-banner discover-ok">
          ✓ {discoverState.count > 0 ? `${discoverState.count} sectores encontrados` : 'Completado — sin segmentos nuevos esta vez'}
          <button class="banner-close" on:click={() => discoverState = { type: 'idle' }}>×</button>
        </div>
      {:else if discoverState.type === 'error'}
        <div class="discover-banner discover-err">
          {discoverState.message}
          <button class="banner-close" on:click={() => discoverState = { type: 'idle' }}>×</button>
        </div>
      {/if}
      <SectorsGrid discovery={data.discovery} />
    {:else if activeTab === 'leads'}
      <LeadsTable bySegment={data.leads.by_segment} total={data.leads.total} />
    {:else if activeTab === 'config'}
      <ConfigForm config={data.config} onSave={() => invalidateAll()} />
    {:else if activeTab === 'radar'}
      <GapRadar
        entries={data.gapRadar}
        on:deploy={e => { deploySegment = e.detail; showDeploy = true; }}
      />
    {/if}
  </main>

  {#if showDeploy && deploySegment}
    <DeployModal
      segment={deploySegment}
      on:close={() => { showDeploy = false; deploySegment = ''; }}
    />
  {/if}
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
  .btn-ingest { background: var(--accent); color: #fff; border-color: transparent; font-weight: 600; min-width: 90px; }
  .btn-ingest:hover:not(:disabled) { opacity: 0.88; }
  .btn-ingest:disabled { opacity: 0.6; cursor: default; }
  /* Ingest progress panel */
  .ingest-panel   { border-bottom: 1px solid var(--border); padding: 10px 16px; background: var(--bg-card); display: flex; flex-direction: column; gap: 8px; }
  .ingest-header  { display: flex; justify-content: space-between; align-items: center; }
  .ingest-status  { font-size: 0.78rem; font-weight: 600; }
  .ingest-status.running { color: var(--text-sub); }
  .ingest-status.ok  { color: var(--accent); }
  .ingest-status.err { color: var(--red); }
  .collector-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .collector-row  { display: flex; align-items: center; gap: 4px; font-size: 0.72rem; padding: 3px 8px; border-radius: 20px; background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); }
  .collector-row.done { border-color: var(--accent); color: var(--text-sub); }
  .collector-row.has-error { border-color: var(--red); color: var(--red); }
  .c-icon  { font-size: 0.65rem; }
  .c-label { font-weight: 500; }
  .c-count { color: var(--accent); font-size: 0.68rem; }
  .c-err   { font-size: 0.68rem; opacity: 0.8; }
  .spinner-dark { border-color: rgba(0,0,0,0.2); border-top-color: var(--text-sub); }
  .tabs    { display: flex; background: var(--bg); border-bottom: 1px solid var(--border); overflow-x: auto; flex-shrink: 0; }
  .tab     { flex: 1; min-width: 70px; padding: 10px 4px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-dim); font-size: 0.78rem; cursor: pointer; white-space: nowrap; }
  .tab.active { color: var(--violet); border-bottom-color: var(--violet); font-weight: 600; }
  main     { flex: 1; padding: 16px; overflow-x: hidden; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 8px; }
  .section-ts { font-size: 0.7rem; color: var(--text-muted); }
  .btn-primary { padding: 7px 14px; background: var(--accent); color: #fff; border: none; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .btn-primary:disabled { opacity: 0.5; }
  .spinner { display: inline-block; width: 10px; height: 10px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 4px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .discover-banner { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 8px; font-size: 0.78rem; margin-bottom: 12px; }
  .discover-ok  { background: var(--accent-bg); color: var(--accent); }
  .discover-err { background: var(--red-bg); color: var(--red); }
  .banner-close { background: none; border: none; cursor: pointer; font-size: 1rem; color: inherit; padding: 0 0 0 8px; line-height: 1; }
  .progress-bar  { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; margin-bottom: 12px; }
  .progress-fill { height: 100%; width: 40%; background: var(--accent); border-radius: 2px; animation: progress-slide 1.4s ease-in-out infinite; }
  @keyframes progress-slide { 0% { transform: translateX(-150%); } 100% { transform: translateX(350%); } }
</style>
