<script lang="ts">
  import type { SignalRow } from '$lib/types.js';
  export let signals: SignalRow[] = [];

  function fmt(iso: string): string {
    return new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  }
  function strengthPct(v: number | null): string {
    return `${Math.round((v ?? 0) * 100)}%`;
  }

  $: sources     = new Set(signals.map(s => s.source)).size;
  $: segments    = new Set(signals.map(s => s.segment)).size;
  $: oldestTs    = signals.length ? Math.min(...signals.map(s => new Date(s.collected_at).getTime())) : 0;
  $: newestTs    = signals.length ? Math.max(...signals.map(s => new Date(s.collected_at).getTime())) : 0;
  $: spanDays    = signals.length ? Math.max(1, Math.round((newestTs - oldestTs) / 86_400_000)) : 0;
</script>

{#if signals.length === 0}
  <p class="empty">Sin señales todavía.</p>
{:else}
  <div class="summary">
    <span>{signals.length} señales</span>
    <span class="sep">·</span>
    <span>{sources} {sources === 1 ? 'fuente' : 'fuentes'}</span>
    <span class="sep">·</span>
    <span>{segments} {segments === 1 ? 'segmento' : 'segmentos'}</span>
    <span class="sep">·</span>
    <span>{spanDays} {spanDays === 1 ? 'día' : 'días'}</span>
  </div>
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Segmento</th>
          <th>Fuente</th>
          <th class="col-text">Texto</th>
          <th>Fuerza</th>
        </tr>
      </thead>
      <tbody>
        {#each signals as s}
          <tr>
            <td class="nowrap">{fmt(s.collected_at)}</td>
            <td class="nowrap seg">{s.segment}</td>
            <td class="nowrap">{s.source}</td>
            <td class="col-text excerpt">{s.raw_text.slice(0, 120)}{s.raw_text.length > 120 ? '…' : ''}</td>
            <td>
              <div class="bar-track">
                <div class="bar-fill" style="width:{strengthPct(s.signal_strength)}"></div>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .wrap     { overflow-x: auto; }
  table     { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  th        { color: var(--text-muted); font-weight: 500; text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td        { padding: 7px 10px; border-bottom: 1px solid var(--border-sub); color: var(--text-sub); vertical-align: top; }
  .nowrap   { white-space: nowrap; }
  .seg      { color: var(--text); font-weight: 500; }
  .col-text { max-width: 340px; }
  .excerpt  { color: var(--text-muted); line-height: 1.4; }
  .bar-track { width: 60px; height: 5px; background: var(--border); border-radius: 3px; }
  .bar-fill  { height: 100%; background: var(--violet); border-radius: 3px; }
  .summary  { display: flex; gap: 4px; align-items: center; font-size: 0.72rem; color: var(--text-muted); padding: 0 0 10px; }
  .sep      { opacity: .4; }
  .empty    { color: var(--text-muted); font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
