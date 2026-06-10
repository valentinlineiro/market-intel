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
      <button class="btn-icon" on:click={() => theme.toggle()} title="Cambiar tema">
        {$theme === 'dark' ? '☀' : '☾'}
      </button>
      <form method="POST" action="?/logout" style="display:contents">
        <button class="btn-sm">Salir</button>
      </form>
    </div>
  </header>

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
