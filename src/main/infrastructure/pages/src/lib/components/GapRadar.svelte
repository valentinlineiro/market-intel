<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { GapEntry } from '$lib/types.js';

  export let entries: GapEntry[] = [];

  const dispatch = createEventDispatcher<{ deploy: string }>();

  $: sorted = [...entries].sort((a, b) => b.gap_score - a.gap_score);
</script>

{#if sorted.length === 0}
  <p class="empty">Sin datos de gap todavía — espera al próximo sync.</p>
{:else}
  <div class="list">
    {#each sorted as entry}
      <div class="row" class:deployed={entry.has_landing}>
        <div class="gap-badge" class:high={entry.gap_score >= 70} class:mid={entry.gap_score >= 40 && entry.gap_score < 70}>
          <span class="gap-score">{entry.gap_score}</span>
          <span class="gap-label">gap</span>
        </div>
        <div class="body">
          <div class="seg-name">{entry.label}</div>
          <div class="meta">
            dolor {entry.avg_pain.toFixed(1)} · vacío {entry.whitespace}%
            {#if entry.has_landing}<span class="live-tag">· landing activa</span>{/if}
          </div>
        </div>
        <div class="action">
          {#if entry.has_landing}
            <span class="deployed-tag">Desplegado ✓</span>
          {:else}
            <button class="btn-deploy" on:click={() => dispatch('deploy', entry.segment)}>
              Desplegar →
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .list { display: flex; flex-direction: column; gap: 8px; }

  .row { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border-sub); border-radius: 9px; background: var(--bg-card); transition: border-color .12s; }
  .row:hover:not(.deployed) { border-color: var(--border); }
  .row.deployed { opacity: 0.45; }

  .gap-badge { min-width: 48px; height: 48px; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-input); flex-shrink: 0; }
  .gap-badge.high { background: var(--violet-bg); }
  .gap-score { font-size: 15px; font-weight: 700; color: var(--text-muted); }
  .gap-badge.high .gap-score { color: var(--violet); }
  .gap-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim); }

  .body { flex: 1; min-width: 0; }
  .seg-name { font-weight: 600; font-size: 0.85rem; color: var(--text); }
  .meta     { font-size: 0.72rem; color: var(--text-muted); margin-top: 3px; }
  .live-tag { color: var(--violet); }

  .action { flex-shrink: 0; }
  .btn-deploy   { padding: 6px 13px; background: var(--violet); color: #fff; border: none; border-radius: 7px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .btn-deploy:hover { opacity: .88; }
  .deployed-tag { font-size: 0.72rem; color: var(--text-dim); font-weight: 600; white-space: nowrap; }

  .empty { color: var(--text-muted); font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
