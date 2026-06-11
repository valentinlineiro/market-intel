<script lang="ts">
  import type { Opportunity, VelocityRow } from '$lib/types.js';
  import { cleanSegment }     from '$lib/utils.js';
  import { deserialize }      from '$app/forms';
  import VelocityChart        from './VelocityChart.svelte';

  export let opportunities: Opportunity[];
  export let onStatusChange: () => void;
  export let diversityMap: Record<string, { sources: number; days: number }> = {};
  export let velocity: VelocityRow[] = [];

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
            <span class="signals">
              {o.signal_count ?? 0} señ.
              {#if diversityMap[o.segment]}
                · {diversityMap[o.segment].sources} src
                · {diversityMap[o.segment].days}d
              {/if}
            </span>
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

            {#if o.score_narrative}
              <p class="narrative">{o.score_narrative}</p>
            {:else if o.pain_summary}
              <p class="pain-full">{o.pain_summary}</p>
            {/if}

            <div class="meta-row">
              <span class="meta">{o.signal_count ?? 0} señales</span>
              {#if diversityMap[o.segment]}
                <span class="meta sep">·</span>
                <span class="meta">{diversityMap[o.segment].sources} fuentes</span>
                <span class="meta sep">·</span>
                <span class="meta">{diversityMap[o.segment].days} días de datos</span>
              {/if}
            </div>

            {#if velocity.length > 0}
              <div class="chart-section">
                <div class="chart-label">Velocidad de señales (12 semanas)</div>
                <VelocityChart rows={velocity} segment={o.segment} />
              </div>
            {/if}

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
  .narrative    { font-size: 0.78rem; color: var(--text-sub); line-height: 1.55; margin-bottom: 8px; font-style: italic; border-left: 2px solid var(--violet); padding-left: 8px; }
  .pain-full    { font-size: 0.78rem; color: var(--text-sub); line-height: 1.5; margin-bottom: 8px; }
  .meta-row     { margin-bottom: 10px; }
  .meta         { font-size: 0.7rem; color: var(--text-muted); }
  .sep          { margin: 0 3px; opacity: .4; }
  .chart-section{ margin-bottom: 10px; }
  .chart-label  { font-size: 0.65rem; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
  .actions      { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .status-select{ padding: 4px 8px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; color: var(--text-sub); font-size: 0.75rem; cursor: pointer; }
  .hint         { font-size: 0.7rem; color: var(--text-dim); font-style: italic; }
  .empty { color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
</style>
