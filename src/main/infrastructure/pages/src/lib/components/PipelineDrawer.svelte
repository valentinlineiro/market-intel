<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { CronRun, CollectorHealth } from '$lib/types.js';

  export let runs:       CronRun[];
  export let collectors: CollectorHealth[];

  const dispatch = createEventDispatcher<{ close: void }>();

  function fmtAge(iso: string | null): string {
    if (!iso) return '—';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 2)  return 'hace un momento';
    if (mins < 60) return `hace ${mins} min`;
    return `hace ${Math.round(mins / 60)}h`;
  }

  function fmtDuration(run: CronRun): string {
    if (!run.finished_at) return 'en curso…';
    const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60_000)}m`;
  }

  function runStatus(run: CronRun): 'running' | 'ok' | 'error' {
    if (!run.finished_at) return 'running';
    return run.error ? 'error' : 'ok';
  }
</script>

<div class="drawer" role="complementary" aria-label="Estado del pipeline">
  <div class="drawer-header">
    <span class="drawer-title">Pipeline</span>
    <button class="close-btn" on:click={() => dispatch('close')}>✕</button>
  </div>

  <div class="drawer-body">

    <!-- Collector health -->
    <section>
      <div class="section-label">Colectores (última ejecución)</div>
      {#if collectors.length === 0}
        <div class="empty-hint">Sin datos. Ejecuta un sync para ver los colectores.</div>
      {:else}
        <div class="collector-grid">
          {#each collectors as c}
            <div class="collector-row" class:err={!!c.error}>
              <span class="coll-id">{c.collector_id}</span>
              <span class="coll-count">{c.signal_count} señales</span>
              <span class="coll-age">{fmtAge(c.last_run_at)}</span>
              {#if c.error}
                <span class="coll-err" title={c.error}>✗ {c.error.slice(0, 60)}</span>
              {:else}
                <span class="coll-ok">✓</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Cron run history -->
    <section>
      <div class="section-label">Últimas ejecuciones</div>
      {#if runs.length === 0}
        <div class="empty-hint">Ninguna ejecución registrada todavía.</div>
      {:else}
        {#each runs as run}
          {@const st = runStatus(run)}
          <div class="run-row" class:run-ok={st === 'ok'} class:run-err={st === 'error'} class:run-running={st === 'running'}>
            <div class="run-top">
              <span class="run-status-dot" class:ok={st === 'ok'} class:err={st === 'error'} class:spin={st === 'running'}></span>
              <span class="run-trigger">{run.trigger === 'manual' ? 'Manual' : 'Cron'}</span>
              <span class="run-age">{fmtAge(run.started_at)}</span>
              <span class="run-dur">{fmtDuration(run)}</span>
            </div>
            {#if st !== 'running'}
              <div class="run-stats">
                <span>{run.fresh_signals ?? 0} nuevas</span>
                <span>{run.analyzed_signals ?? 0} analizadas</span>
                <span>{run.opps_updated ?? 0} oportunidades</span>
              </div>
            {/if}
            {#if run.error}
              <div class="run-error">{run.error}</div>
            {/if}
          </div>
        {/each}
      {/if}
    </section>

  </div>
</div>

<style>
  .drawer         { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: min(860px, 100vw); max-height: 55vh; background: var(--bg); border-top: 1px solid var(--border); border-left: 1px solid var(--border); border-right: 1px solid var(--border); border-radius: 12px 12px 0 0; display: flex; flex-direction: column; z-index: 100; box-shadow: 0 -4px 24px rgba(0,0,0,.18); }
  .drawer-header  { display: flex; justify-content: space-between; align-items: center; padding: 11px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .drawer-title   { font-size: 0.82rem; font-weight: 700; color: var(--text); }
  .close-btn      { background: none; border: none; cursor: pointer; font-size: 0.85rem; color: var(--text-dim); }
  .drawer-body    { overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 20px; }

  section { display: flex; flex-direction: column; gap: 6px; }
  .section-label { font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
  .empty-hint { font-size: 0.78rem; color: var(--text-dim); padding: 4px 0; }

  /* Collector grid */
  .collector-grid { display: flex; flex-direction: column; gap: 3px; }
  .collector-row  { display: grid; grid-template-columns: 110px 80px 100px 1fr; gap: 8px; align-items: center; font-size: 0.75rem; padding: 4px 6px; border-radius: 5px; }
  .collector-row.err { background: rgba(239,68,68,.06); }
  .coll-id        { color: var(--text); font-weight: 600; }
  .coll-count     { color: var(--text-sub); }
  .coll-age       { color: var(--text-dim); }
  .coll-ok        { color: var(--violet); }
  .coll-err       { color: #ef4444; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Run rows */
  .run-row        { padding: 8px 10px; border-radius: 7px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
  .run-ok         { border-color: color-mix(in srgb, var(--violet) 30%, transparent); }
  .run-err        { border-color: rgba(239,68,68,.35); }
  .run-running    { border-color: var(--violet); animation: border-pulse 1.2s ease-in-out infinite; }
  @keyframes border-pulse { 0%,100%{opacity:1} 50%{opacity:.55} }

  .run-top        { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
  .run-status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .run-status-dot.ok   { background: var(--violet); }
  .run-status-dot.err  { background: #ef4444; }
  .run-status-dot.spin { background: var(--violet); animation: pulse .9s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

  .run-trigger    { font-weight: 600; color: var(--text); }
  .run-age        { color: var(--text-dim); }
  .run-dur        { color: var(--text-muted); margin-left: auto; }

  .run-stats      { display: flex; gap: 14px; font-size: 0.72rem; color: var(--text-sub); padding-left: 15px; }
  .run-error      { font-size: 0.72rem; color: #ef4444; padding-left: 15px; }
</style>
