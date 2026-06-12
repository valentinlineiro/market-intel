<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { navigating }    from '$app/stores';

  let refreshing = false;
  async function refresh() {
    refreshing = true;
    await invalidateAll();
    refreshing = false;
  }
  import { theme }         from '$lib/theme.js';
  import PipelineBar       from '$lib/components/PipelineBar.svelte';
  import PipelineDrawer    from '$lib/components/PipelineDrawer.svelte';
  import SignalsTable       from '$lib/components/SignalsTable.svelte';
  import FrictionList       from '$lib/components/FrictionList.svelte';
  import SectorsGrid        from '$lib/components/SectorsGrid.svelte';
  import OpportunityList    from '$lib/components/OpportunityList.svelte';
  import GapRadar           from '$lib/components/GapRadar.svelte';
  import LeadsTable         from '$lib/components/LeadsTable.svelte';
  import ConfigForm         from '$lib/components/ConfigForm.svelte';
  import DeployModal        from '$lib/components/DeployModal.svelte';
  import VelocityChart      from '$lib/components/VelocityChart.svelte';

  export let data: PageData;

  type Tab = 'info' | 'dolor' | 'oportunidades' | 'leads';
  let activeTab: Tab = 'info';

  // Config overlay
  let showConfig = false;

  // Pipeline drawer
  let showPipeline = false;

  // Deploy modal (triggered from GapRadar)
  let deploySegment = '';
  let showDeploy    = false;

  // Seed form
  let seedDesc     = '';
  let seedLoading  = false;
  let seedResult: { ok: boolean; message: string } | null = null;

  async function submitSeed() {
    if (!seedDesc.trim() || seedLoading) return;
    seedLoading = true;
    seedResult  = null;
    try {
      const fd = new FormData();
      fd.set('description', seedDesc.trim());
      const res = await fetch('?/generateSeed', { method: 'POST', body: fd });
      const json = await res.json() as { type: string; data: { success: boolean; count?: number; error?: string } };
      const d = json.data;
      seedResult = d.success
        ? { ok: true,  message: `${d.count} segmentos generados. Haz sync para iniciar la recolección.` }
        : { ok: false, message: d.error ?? 'Error desconocido' };
      if (d.success) await refresh();
    } catch (e) {
      seedResult = { ok: false, message: String(e) };
    } finally {
      seedLoading = false;
    }
  }

  // ── Sync status ─────────────────────────────────────────────────────────────
  let syncRunning   = false;
  let syncRunId: string | null = null;
  let syncPollTimer: ReturnType<typeof setInterval> | null = null;
  let syncMsg: { ok: boolean; text: string } | null = null;
  let syncMsgTimer: ReturnType<typeof setTimeout> | null = null;

  function showSyncMsg(ok: boolean, text: string) {
    if (syncMsgTimer) clearTimeout(syncMsgTimer);
    syncMsg = { ok, text };
    syncMsgTimer = setTimeout(() => { syncMsg = null; }, 6000);
  }

  function lastRunAge(runs: PageData['pipeline']['runs']): string {
    const finished = runs.find(r => r.finished_at);
    if (!finished?.finished_at) return 'nunca';
    const mins = Math.round((Date.now() - new Date(finished.finished_at).getTime()) / 60_000);
    if (mins < 2)  return 'hace un momento';
    if (mins < 60) return `hace ${mins} min`;
    return `hace ${Math.round(mins / 60)}h`;
  }

  $: syncAge = lastRunAge(data.pipeline.runs);

  async function pollSync() {
    if (!syncRunId) return;
    try {
      const res  = await fetch(`/api/pipeline-status/${encodeURIComponent(syncRunId)}`);
      if (!res.ok) return;
      const body = await res.json() as { run: { finished_at: string | null; error: string | null; fresh_signals: number | null; analyzed_signals: number | null } | null };
      if (body.run?.finished_at) {
        if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
        syncRunning = false;
        syncRunId   = null;
        await refresh();
        if (body.run.error) {
          showSyncMsg(false, `Error en sync: ${body.run.error.slice(0, 80)}`);
        } else {
          const fresh    = body.run.fresh_signals    ?? 0;
          const analyzed = body.run.analyzed_signals ?? 0;
          showSyncMsg(true, `Sync completado · ${fresh} señales nuevas · ${analyzed} analizadas`);
        }
      }
    } catch { /* non-fatal */ }
  }

  async function forceSync() {
    if (syncRunning) return;
    syncRunning = true;
    syncMsg = null;
    try {
      const res  = await fetch('/api/run-cron', { method: 'POST' });
      const body = await res.json() as { run_id?: string; error?: string };
      if (!res.ok) {
        syncRunning = false;
        showSyncMsg(false, `No se pudo iniciar el sync: ${body.error ?? res.status}`);
        return;
      }
      syncRunId = body.run_id ?? null;
    } catch (e) {
      syncRunning = false;
      showSyncMsg(false, `Error de red: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    // Poll every 5s; give up after 10 min
    if (syncPollTimer) clearInterval(syncPollTimer);
    syncPollTimer = setInterval(pollSync, 5_000);
    setTimeout(() => {
      if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
      if (syncRunning) {
        syncRunning = false;
        syncRunId   = null;
        showSyncMsg(false, 'Sync tardó demasiado — comprueba el pipeline');
      }
    }, 600_000);
  }

  // ── Signal diversity map (segment → { sources, days }) ─────────────────────
  $: diversityMap = (() => {
    const acc: Record<string, { sources: Set<string>; oldest: number; newest: number }> = {};
    for (const s of data.signals) {
      const t = new Date(s.collected_at).getTime();
      if (!acc[s.segment]) acc[s.segment] = { sources: new Set(), oldest: t, newest: t };
      acc[s.segment].sources.add(s.source);
      if (t < acc[s.segment].oldest) acc[s.segment].oldest = t;
      if (t > acc[s.segment].newest) acc[s.segment].newest = t;
    }
    return Object.fromEntries(
      Object.entries(acc).map(([seg, m]) => [seg, {
        sources: m.sources.size,
        days: Math.max(1, Math.round((m.newest - m.oldest) / 86_400_000)),
      }])
    );
  })();

  // ── Pipeline stage derivation ───────────────────────────────────────────────
  $: pipelineStages = [
    {
      key:   'info',
      label: 'Info',
      sub:   syncRunning ? 'en curso' : data.stats.total_signals > 0 ? `${data.stats.total_signals} señales` : '—',
      state: (syncRunning ? 'running' : data.stats.total_signals > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
    {
      key:   'dolor',
      label: 'Dolor',
      sub:   data.stats.analyzed_count > 0 ? `${data.stats.analyzed_count} perfiles` : '—',
      state: (data.stats.analyzed_count > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
    },
    {
      key:   'oportunidades',
      label: 'Oportunidades',
      sub:   data.opportunities.length > 0 ? `${data.opportunities.length}` : '—',
      state: (data.opportunities.length > 0 ? 'done' : 'pending') as 'done' | 'running' | 'pending',
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
        <button class="sync-btn" on:click={() => showPipeline = !showPipeline} title="Estado del pipeline">≡</button>
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

  {#if syncMsg}
    <div class="sync-toast" class:toast-ok={syncMsg.ok} class:toast-err={!syncMsg.ok}>
      {syncMsg.text}
    </div>
  {/if}

  <PipelineBar
    stages={pipelineStages}
    activeTab={activeTab}
    onStageClick={(key) => activeTab = key as Tab}
  />

  {#if showPipeline}
    <PipelineDrawer
      runs={data.pipeline.runs}
      collectors={data.pipeline.collectors}
      bySource={data.pipeline.bySource ?? []}
      on:close={() => showPipeline = false}
    />
  {/if}

  <main>
    {#if $navigating || refreshing}
      <div class="skeleton-wrap">
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line med"></div>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line narrow"></div>
        <div class="skeleton-line med"></div>
      </div>
    {/if}

    {#if !$navigating && !refreshing && data.stats.total_signals === 0 && data.pipeline.runs.length === 0}
      <!-- Empty state: no data, never run -->
      <div class="empty-state">
        <div class="empty-icon">🌱</div>
        <h2 class="empty-title">Sin datos todavía</h2>
        <p class="empty-body">Describe el mercado o profesional que quieres analizar y generamos la configuración automáticamente. Luego haz sync para empezar a recoger señales.</p>
        <form class="seed-form" on:submit|preventDefault={submitSeed}>
          <textarea
            class="seed-input"
            placeholder="Ej: gestores fiscales y asesores contables en España que necesitan herramientas para Verifactu y cumplimiento AEAT"
            rows="3"
            bind:value={seedDesc}
            disabled={seedLoading}
          ></textarea>
          <div class="seed-actions">
            <button class="btn-primary" type="submit" disabled={!seedDesc.trim() || seedLoading}>
              {seedLoading ? 'Generando…' : 'Generar configuración'}
            </button>
            <button class="btn-sm" type="button" on:click={forceSync} disabled={syncRunning}>
              {syncRunning ? 'En curso…' : '↻ Sync ahora'}
            </button>
          </div>
          {#if seedResult}
            <p class="seed-result" class:ok={seedResult.ok}>{seedResult.message}</p>
          {/if}
        </form>
      </div>

    {:else if !$navigating && !refreshing && activeTab === 'info'}
      {#if data.velocity.length > 0}
        <div class="velocity-section">
          <div class="velocity-label">Actividad de señales (últimas 12 semanas)</div>
          <VelocityChart rows={data.velocity} segment={null} />
        </div>
      {/if}
      {#if data.discovery.candidates.length > 0}
        <div class="section-label">Segmentos detectados</div>
        <SectorsGrid
          discovery={data.discovery}
          activeSegments={data.config?.segments ?? {}}
          on:promoted={({ detail }) => {
            syncRunId = detail.run_id;
            syncRunning = true;
            pollSync();
          }}
        />
        <div class="section-sep"></div>
      {/if}
      <div class="section-label">Señales</div>
      <SignalsTable
        signals={data.signals}
        total={data.signalsTotal}
        sources={data.signalsSources}
        segments={Object.keys(data.stats.by_segment)}
        page={data.signalsPage}
      />

    {:else if !$navigating && !refreshing && activeTab === 'dolor'}
      {#if data.painProfiles.length === 0}
        <div class="tab-empty">Sin perfiles de dolor todavía. El análisis de fricción se ejecuta automáticamente en el próximo sync.</div>
      {:else}
        <FrictionList profiles={data.painProfiles} />
      {/if}

    {:else if !$navigating && !refreshing && activeTab === 'oportunidades'}
      {#if data.opportunities.length === 0}
        <div class="tab-empty">Sin oportunidades todavía. Necesitas señales analizadas para que aparezcan aquí.</div>
      {:else}
        <OpportunityList opportunities={data.opportunities} {diversityMap} velocity={data.velocity} onStatusChange={() => refresh()} />
      {/if}
      {#if data.gapRadar.length > 0}
        <div class="section-sep"></div>
        <div class="section-label">Huecos sin desplegar</div>
        <GapRadar
          entries={data.gapRadar}
          on:deploy={e => { deploySegment = e.detail; showDeploy = true; }}
        />
      {/if}

    {:else if !$navigating && !refreshing && activeTab === 'leads'}
      <LeadsTable bySegment={data.leads.by_segment} total={data.leads.total} />

    {/if}
  </main>
</div>

{#if showDeploy && deploySegment}
  <DeployModal
    segment={deploySegment}
    on:close={() => { showDeploy = false; deploySegment = ''; refresh(); }}
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
        <ConfigForm config={data.config} onSave={() => { showConfig = false; refresh(); }} />
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

  /* Sync toast */
  .sync-toast   { padding: 7px 16px; font-size: 0.75rem; text-align: center; border-bottom: 1px solid var(--border); }
  .toast-ok     { background: color-mix(in srgb, var(--violet) 10%, transparent); color: var(--violet); }
  .toast-err    { background: rgba(239,68,68,.08); color: #ef4444; }

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

  .skeleton-wrap { display: flex; flex-direction: column; gap: 12px; padding: 8px 0; }
  .skeleton-line  { height: 18px; border-radius: 6px; background: var(--border); animation: shimmer 1.4s ease-in-out infinite; }
  .skeleton-line.wide   { width: 100%; }
  .skeleton-line.med    { width: 65%; }
  .skeleton-line.narrow { width: 40%; }
  @keyframes shimmer { 0%,100%{opacity:.45} 50%{opacity:.9} }

  /* Empty state */
  .empty-state  { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 24px; text-align: center; }
  .empty-icon   { font-size: 2.4rem; }
  .empty-title  { font-size: 1.1rem; font-weight: 700; color: var(--text); margin: 0; }
  .empty-body   { font-size: 0.82rem; color: var(--text-muted); max-width: 480px; line-height: 1.5; margin: 0; }

  .seed-form    { width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
  .seed-input   { width: 100%; padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.82rem; resize: vertical; font-family: inherit; }
  .seed-input:focus { outline: none; border-color: var(--violet); }
  .seed-actions { display: flex; gap: 8px; }
  .seed-result  { font-size: 0.78rem; color: var(--text-muted); }
  .seed-result.ok { color: var(--violet); }

  .btn-primary  { padding: 8px 18px; background: var(--violet); color: #fff; border: none; border-radius: 7px; font-size: 0.82rem; cursor: pointer; font-weight: 600; }
  .btn-primary:disabled { opacity: .5; cursor: default; }

  /* Per-tab empty state */
  .tab-empty { padding: 40px 0; text-align: center; font-size: 0.82rem; color: var(--text-muted); }

  /* Velocity chart header */
  .velocity-section { margin-bottom: 16px; padding: 12px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; }
  .velocity-label   { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }

  /* Section dividers inside tabs */
  .section-label { font-size: 0.68rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; margin: 20px 0 10px; }
  .section-sep   { height: 1px; background: var(--border); margin: 24px 0; }

  /* Config overlay */
  .config-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 200; display: flex; justify-content: flex-end; }
  .config-panel   { width: min(540px, 100vw); background: var(--bg); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
  .config-header  { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .config-title   { font-weight: 700; font-size: 0.9rem; color: var(--text); }
  .config-body    { flex: 1; overflow-y: auto; padding: 16px; }
</style>
