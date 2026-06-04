<script lang="ts">
  import type { Stats } from '$lib/types.js';
  export let stats: Stats;
</script>

<div class="grid">
  <div class="card">
    <div class="stat">
      <span class="stat-value">{stats.total_signals ?? 0}</span>
      <span class="stat-label">Total señales</span>
    </div>
  </div>
  <div class="card">
    <div class="stat">
      <span class="stat-value">{stats.total_opportunities ?? 0}</span>
      <span class="stat-label">Oportunidades</span>
    </div>
  </div>
  <div class="card">
    {#each Object.entries(stats.by_segment ?? {}) as [seg, n]}
      <div class="stat">
        <span class="stat-value">{n}</span>
        <span class="stat-label">{seg}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  .stat { display: flex; flex-direction: column; gap: 4px; }
  .stat-value { font-size: 2rem; font-weight: 700; color: #f1f5f9; }
  .stat-label { font-size: 0.75rem; color: #64748b; }
</style>
