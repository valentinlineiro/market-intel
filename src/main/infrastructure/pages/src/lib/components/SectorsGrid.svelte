<script lang="ts">
  import type { DiscoveryResult } from '$lib/types.js';
  export let discovery: DiscoveryResult;
</script>

<div class="grid">
  {#if !discovery.candidates?.length}
    <div class="card"><p class="muted">Sin sectores detectados todavía.</p></div>
  {:else}
    {#each discovery.candidates.slice(0, 6) as c}
      {@const scorePct = Math.min((c.discovery_score ?? 0) / 20, 1)}
      {@const scoreColor = scorePct > 0.6 ? '#34d399' : scorePct > 0.3 ? '#fbbf24' : '#94a3b8'}
      <div class="card">
        <div class="header">
          <strong>{c.profile}</strong>
          <span style="color: {scoreColor}; font-weight: 700; font-size: 0.85rem;">{(c.discovery_score ?? 0).toFixed(1)}</span>
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
  .grid  { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .card  { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header strong { color: #f1f5f9; font-size: 0.9rem; line-height: 1.3; }
  .pain  { color: #64748b; font-size: 0.8rem; margin-bottom: 10px; line-height: 1.4; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip  { padding: 2px 6px; background: #1e293b; border-radius: 4px; font-size: 0.7rem; color: #64748b; }
  .meta  { margin-top: 8px; font-size: 0.7rem; color: #334155; }
  .muted { color: #475569; font-size: 0.875rem; }
</style>
