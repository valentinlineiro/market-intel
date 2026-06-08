<script lang="ts">
  import { cleanSegment } from '$lib/utils.js';

  export let bySegment: Record<string, { email: string; captured_at: string }[]>;
  export let total: number;

  let openSegment: string | null = null;

  $: segments = Object.entries(bySegment ?? {}).sort((a, b) => b[1].length - a[1].length);
</script>

{#if !total}
  <p class="empty">Sin leads todavía.</p>
{:else}
  <div class="list">
    {#each segments as [seg, leads]}
      <div class="group">
        <button class="group-header" on:click={() => openSegment = openSegment === seg ? null : seg}>
          <span class="seg-name">{cleanSegment(seg)}</span>
          <span class="count">{leads.length} leads</span>
          <span class="chevron" class:rotated={openSegment === seg}>›</span>
        </button>
        {#if openSegment === seg}
          <div class="leads">
            {#each leads as lead}
              <div class="lead-row">
                <span class="email">{lead.email}</span>
                <span class="date">{new Date(lead.captured_at).toLocaleDateString('es')}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .list         { display: flex; flex-direction: column; gap: 4px; }
  .group        { background: var(--bg-card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-sub); }
  .group-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; background: none; border: none; cursor: pointer; text-align: left; }
  .group-header:hover { background: var(--bg-input); }
  .seg-name     { flex: 1; font-size: 0.85rem; font-weight: 600; color: var(--text); }
  .count        { font-size: 0.75rem; color: var(--accent); font-weight: 600; }
  .chevron      { color: var(--text-dim); font-size: 1rem; transition: transform 0.15s; display: inline-block; }
  .chevron.rotated { transform: rotate(90deg); }
  .leads        { border-top: 1px solid var(--border-sub); }
  .lead-row     { display: flex; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid var(--border-sub); }
  .lead-row:last-child { border-bottom: none; }
  .email        { font-size: 0.78rem; color: var(--text-sub); }
  .date         { font-size: 0.72rem; color: var(--text-muted); }
  .empty        { color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
</style>
