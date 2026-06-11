<script lang="ts">
  import type { SignalRow } from '$lib/types.js';
  import { goto } from '$app/navigation';

  export let signals: SignalRow[] = [];
  export let total:   number = 0;
  export let sources: string[] = [];
  export let segments: string[] = [];
  export let page: {
    offset: number; limit: number; q: string;
    segment: string; source: string; sort: string; order: string;
  } = { offset: 0, limit: 50, q: '', segment: '', source: '', sort: 'collected_at', order: 'desc' };

  let qInput = page.q;
  $: qInput = page.q;

  $: from       = total === 0 ? 0 : page.offset + 1;
  $: to         = Math.min(page.offset + page.limit, total);
  $: totalPages = Math.ceil(total / page.limit);
  $: curPage    = Math.floor(page.offset / page.limit) + 1;

  function nav(patch: Record<string, unknown>, resetOffset = true) {
    const next = { ...page, ...patch };
    if (resetOffset) next.offset = 0;
    const p = new URLSearchParams();
    if (next.offset)                      p.set('offset',  String(next.offset));
    if (next.segment)                     p.set('segment', next.segment);
    if (next.source)                      p.set('source',  next.source);
    if (next.q)                           p.set('q',       next.q);
    if (next.sort !== 'collected_at')     p.set('sort',    next.sort);
    if (next.order !== 'desc')            p.set('order',   next.order);
    goto(`?${p.toString()}`, { keepFocus: true, noScroll: true });
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Enter') nav({ q: qInput });
  }

  function sortBy(col: string) {
    if (page.sort === col) {
      nav({ sort: col, order: page.order === 'desc' ? 'asc' : 'desc' });
    } else {
      nav({ sort: col, order: 'desc' });
    }
  }

  function sortArrow(col: string): string {
    if (page.sort !== col) return '';
    return page.order === 'desc' ? ' ↓' : ' ↑';
  }

  function fmt(iso: string): string {
    return new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  }
  function strengthPct(v: number | null): string {
    return `${Math.round((v ?? 0) * 100)}%`;
  }
</script>

<div class="controls">
  <input
    class="search"
    type="search"
    placeholder="Buscar en texto…"
    bind:value={qInput}
    on:keydown={onSearchKey}
  />
  <select value={page.segment} on:change={e => nav({ segment: e.currentTarget.value })}>
    <option value="">Todos los segmentos</option>
    {#each segments as seg}
      <option value={seg}>{seg}</option>
    {/each}
  </select>
  <select value={page.source} on:change={e => nav({ source: e.currentTarget.value })}>
    <option value="">Todas las fuentes</option>
    {#each sources as src}
      <option value={src}>{src}</option>
    {/each}
  </select>
  <span class="count">{total} señales</span>
</div>

{#if signals.length === 0}
  <p class="empty">Sin señales para los filtros seleccionados.</p>
{:else}
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th class="sortable" on:click={() => sortBy('collected_at')}>Fecha{sortArrow('collected_at')}</th>
          <th class="sortable" on:click={() => sortBy('segment')}>Segmento{sortArrow('segment')}</th>
          <th class="sortable" on:click={() => sortBy('source')}>Fuente{sortArrow('source')}</th>
          <th class="col-text">Texto</th>
          <th class="sortable" on:click={() => sortBy('signal_strength')}>Fuerza{sortArrow('signal_strength')}</th>
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

  {#if totalPages > 1}
    <div class="pagination">
      <button disabled={curPage <= 1} on:click={() => nav({ offset: page.offset - page.limit }, false)}>← Anterior</button>
      <span>{from}–{to} de {total}</span>
      <button disabled={curPage >= totalPages} on:click={() => nav({ offset: page.offset + page.limit }, false)}>Siguiente →</button>
    </div>
  {/if}
{/if}

<style>
  .controls  { display: flex; gap: 8px; align-items: center; padding-bottom: 12px; flex-wrap: wrap; }
  .search    { flex: 1; min-width: 160px; max-width: 280px; padding: 5px 9px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font-size: 0.78rem; }
  select     { padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font-size: 0.78rem; cursor: pointer; }
  .count     { margin-left: auto; font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; }
  .wrap      { overflow-x: auto; }
  table      { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  th         { color: var(--text-muted); font-weight: 500; text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .sortable  { cursor: pointer; user-select: none; }
  .sortable:hover { color: var(--text); }
  td         { padding: 7px 10px; border-bottom: 1px solid var(--border-sub); color: var(--text-sub); vertical-align: top; }
  .nowrap    { white-space: nowrap; }
  .seg       { color: var(--text); font-weight: 500; }
  .col-text  { max-width: 340px; }
  .excerpt   { color: var(--text-muted); line-height: 1.4; }
  .bar-track { width: 60px; height: 5px; background: var(--border); border-radius: 3px; }
  .bar-fill  { height: 100%; background: var(--violet); border-radius: 3px; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 14px 0 4px; font-size: 0.78rem; color: var(--text-muted); }
  .pagination button { padding: 4px 12px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font-size: 0.78rem; cursor: pointer; }
  .pagination button:disabled { opacity: 0.35; cursor: default; }
  .pagination button:not(:disabled):hover { border-color: var(--violet); color: var(--violet); }
  .empty     { color: var(--text-muted); font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
