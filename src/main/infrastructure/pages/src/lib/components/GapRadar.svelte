<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { GapEntry } from '$lib/types.js';

  export let entries: GapEntry[] = [];

  const dispatch = createEventDispatcher<{ deploy: string }>();

  let filterNoLanding = false;
  let minGap = 0;

  $: filtered = entries
    .filter(e => !filterNoLanding || !e.has_landing)
    .filter(e => e.gap_score >= minGap);

  function gapColor(score: number): string {
    if (score >= 70) return '#22c55e';
    if (score >= 40) return '#f59e0b';
    return '#64748b';
  }
</script>

<div class="radar">
  <div class="filters">
    <label class="toggle">
      <input type="checkbox" bind:checked={filterNoLanding} />
      Solo sin landing
    </label>
    <label class="range-label">
      Gap mínimo: {minGap}
      <input type="range" min="0" max="90" step="5" bind:value={minGap} />
    </label>
  </div>

  {#if filtered.length === 0}
    <p class="empty">Sin datos de gap todavía — espera al próximo cron (cada 12h).</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Segmento</th>
          <th>🔥 Dolor</th>
          <th>🕳 Vacío</th>
          <th>Gap</th>
          <th>Acción</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as entry}
          <tr>
            <td class="seg">{entry.label}</td>
            <td>{entry.avg_pain.toFixed(1)}</td>
            <td>{entry.whitespace}%</td>
            <td>
              <span class="badge" style="color:{gapColor(entry.gap_score)}">
                {entry.gap_score}
              </span>
            </td>
            <td>
              {#if entry.has_landing}
                <a class="btn-sm" href="/landings/{entry.segment}" target="_blank">Ver</a>
              {:else}
                <button class="btn-sm btn-primary" on:click={() => dispatch('deploy', entry.segment)}>
                  Desplegar
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .radar        { display: flex; flex-direction: column; gap: 12px; }
  .filters      { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .toggle       { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #64748b; cursor: pointer; }
  .range-label  { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #64748b; }
  input[type="range"] { width: 100px; accent-color: #3b82f6; }
  table         { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th            { color: #475569; font-weight: 500; text-align: left; padding: 6px 10px; border-bottom: 1px solid #1e293b; }
  td            { padding: 8px 10px; border-bottom: 1px solid #0f172a; color: #94a3b8; }
  .seg          { color: #f1f5f9; font-weight: 500; }
  .badge        { font-weight: 700; font-size: 0.9rem; }
  .btn-sm       { padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; text-decoration: none; display: inline-block; }
  .btn-primary  { background: #3b82f6; color: white; border: none; }
  .btn-primary:hover { background: #2563eb; }
  a.btn-sm      { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
  a.btn-sm:hover { background: #334155; }
  .empty        { color: #475569; font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
