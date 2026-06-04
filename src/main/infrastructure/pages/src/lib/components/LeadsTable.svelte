<script lang="ts">
  export let bySegment: Record<string, { email: string; captured_at: string }[]>;
  export let total: number;

  interface FlatLead { seg: string; email: string; captured_at: string; }

  $: allLeads = Object.entries(bySegment ?? {})
    .flatMap(([seg, entries]) => entries.map(e => ({ seg, ...e })))
    .sort((a: FlatLead, b: FlatLead) => b.captured_at.localeCompare(a.captured_at));
</script>

<div class="card" style="overflow-x:auto">
  <table>
    <thead>
      <tr><th>Segmento</th><th>Email</th><th>Fecha</th></tr>
    </thead>
    <tbody>
      {#if !allLeads.length}
        <tr><td colspan="3" class="muted">Sin leads todavía.</td></tr>
      {:else}
        {#each allLeads as l}
          <tr>
            <td>{l.seg}</td>
            <td class="mono">{l.email}</td>
            <td class="date">{l.captured_at.slice(0, 16).replace('T', ' ')}</td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>

<style>
  .card  { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
  table  { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th     { text-align: left; padding: 8px 12px; color: #475569; font-weight: 600; border-bottom: 1px solid #1e293b; }
  td     { padding: 10px 12px; border-bottom: 1px solid #0f172a; }
  .mono  { font-family: monospace; font-size: 0.8rem; }
  .date  { color: #64748b; font-size: 0.8rem; }
  .muted { color: #475569; }
</style>
