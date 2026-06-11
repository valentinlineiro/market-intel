<script lang="ts">
  import type { DiscoveryResult } from '$lib/types.js';
  export let discovery: DiscoveryResult;

  function scoreColor(s: number) {
    return s > 12 ? 'var(--violet)' : s > 6 ? 'var(--text-sub)' : 'var(--text-muted)';
  }

  $: ts = discovery.discovered_at
    ? new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(discovery.discovered_at))
    : null;
</script>

{#if ts}
  <p class="ts">Última actualización: {ts}</p>
{/if}

<div class="grid">
  {#if !discovery.candidates?.length}
    <div class="card"><p class="muted">Sin sectores detectados todavía.</p></div>
  {:else}
    {#each discovery.candidates.slice(0, 12) as c}
      <div class="card">
        <div class="header">
          <strong>{c.profile}</strong>
          <span style="color: {scoreColor(c.discovery_score ?? 0)}; font-weight: 700; font-size: 0.85rem;">
            {(c.discovery_score ?? 0).toFixed(1)}
          </span>
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
  .ts   { font-size: 0.7rem; color: var(--text-muted); margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { background: var(--bg-card); border: 1px solid var(--border-sub); border-radius: 10px; padding: 16px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header strong { color: var(--text); font-size: 0.88rem; line-height: 1.3; }
  .pain  { color: var(--text-muted); font-size: 0.78rem; margin-bottom: 10px; line-height: 1.4; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip  { padding: 2px 6px; background: var(--bg-input); border-radius: 4px; font-size: 0.68rem; color: var(--text-muted); }
  .meta  { margin-top: 8px; font-size: 0.68rem; color: var(--text-dim); }
  .muted { color: var(--text-muted); font-size: 0.85rem; }
</style>
