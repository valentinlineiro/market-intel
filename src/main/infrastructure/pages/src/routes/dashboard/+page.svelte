<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import StatGrid           from '$lib/components/StatGrid.svelte';
  import SectorsGrid        from '$lib/components/SectorsGrid.svelte';
  import OpportunitiesTable from '$lib/components/OpportunitiesTable.svelte';
  import LeadsTable         from '$lib/components/LeadsTable.svelte';
  import SettingsPanel      from '$lib/components/SettingsPanel.svelte';

  export let data: PageData;

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
      <SettingsPanel config={data.config} onSave={() => invalidateAll()} />
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
