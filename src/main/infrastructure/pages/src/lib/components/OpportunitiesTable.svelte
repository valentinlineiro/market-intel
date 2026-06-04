<script lang="ts">
  import type { Opportunity } from '$lib/types.js';
  import DeployModal from './DeployModal.svelte';

  export let opportunities: Opportunity[];

  let deploySegment: string | null = null;
</script>

<div class="card" style="overflow-x:auto">
  <table>
    <thead>
      <tr>
        <th>Segmento</th><th>Score</th><th>Estado</th>
        <th>Señales</th><th>Resumen</th><th>Landing</th><th></th>
      </tr>
    </thead>
    <tbody>
      {#if !opportunities.length}
        <tr><td colspan="7" class="muted">Sin oportunidades todavía.</td></tr>
      {:else}
        {#each opportunities as o}
          <tr>
            <td>{o.segment}</td>
            <td><strong>{(o.score || 0).toFixed(1)}</strong>/10</td>
            <td><span class="badge badge-{o.status}">{o.status}</span></td>
            <td>{o.signal_count ?? 0}</td>
            <td class="summary">{(o.pain_summary || '').slice(0, 60)}</td>
            <td>
              {#if o.landing_url}
                <a href={o.landing_url} target="_blank" class="link">ver</a>
              {:else}—{/if}
            </td>
            <td>
              <button class="btn-sm" on:click={() => deploySegment = o.segment}>
                {o.landing_url ? 'Regenerar' : 'Deploy'}
              </button>
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

{#if deploySegment}
  <DeployModal segment={deploySegment} on:close={() => deploySegment = null} />
{/if}

<style>
  .card  { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  table  { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th     { text-align: left; padding: 8px 12px; color: #475569; font-weight: 600; border-bottom: 1px solid #1e293b; }
  td     { padding: 10px 12px; border-bottom: 1px solid #0f172a; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
  .badge-watching { background: #1e3a5f; color: #60a5fa; }
  .badge-testing  { background: #1a3a2a; color: #34d399; }
  .badge-scaling  { background: #3b1f5e; color: #a78bfa; }
  .badge-killed   { background: #3b1f1f; color: #f87171; }
  .summary { color: #94a3b8; font-size: 0.8rem; }
  .link    { color: #60a5fa; font-size: 0.75rem; }
  .btn-sm  { padding: 4px 10px; background: #1e293b; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; font-size: 0.75rem; cursor: pointer; white-space: nowrap; }
  .muted   { color: #475569; }
</style>
