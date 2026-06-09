<script lang="ts">
  import { cleanSegment } from '$lib/utils.js';

  export let bySegment: Record<string, { email: string; captured_at: string; price_tier: string | null; lead_score: number }[]>;
  export let total: number;

  let openSegment: string | null = null;

  $: segments = Object.entries(bySegment ?? {}).sort((a, b) => b[1].length - a[1].length);

  function scoreColor(s: number): string {
    if (s >= 7) return 'var(--accent)';
    if (s >= 4) return 'var(--amber)';
    return 'var(--text-dim)';
  }

  function tierLabel(tier: string | null): string {
    if (!tier) return '—';
    const map: Record<string, string> = { '0-10': '€0–10', '10-30': '€10–30', '30-50': '€30–50', '50+': '€50+' };
    return map[tier] ?? tier;
  }
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
            <div class="lead-row header-row">
              <span class="email">Email</span>
              <span class="tier-col">Precio</span>
              <span class="score-col">Calidad</span>
              <span class="date">Fecha</span>
            </div>
            {#each leads as lead}
              <div class="lead-row">
                <span class="email">{lead.email}</span>
                <span class="tier-col">{tierLabel(lead.price_tier)}</span>
                <div class="score-col">
                  <div class="bar-wrap">
                    <div class="bar" style="width:{lead.lead_score * 10}%; background:{scoreColor(lead.lead_score)}"></div>
                  </div>
                  <span class="score-num" style="color:{scoreColor(lead.lead_score)}">{lead.lead_score.toFixed(1)}</span>
                </div>
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
  .lead-row     { display: grid; grid-template-columns: 1fr 70px 100px 70px; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--border-sub); }
  .lead-row:last-child { border-bottom: none; }
  .header-row   { background: var(--bg-input); }
  .header-row span { font-size: 0.68rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .email        { font-size: 0.78rem; color: var(--text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tier-col     { font-size: 0.72rem; color: var(--text-muted); }
  .score-col    { display: flex; align-items: center; gap: 6px; }
  .bar-wrap     { flex: 1; background: var(--bg-input); border-radius: 9999px; height: 4px; overflow: hidden; }
  .bar          { height: 100%; border-radius: 9999px; transition: width 0.3s; }
  .score-num    { font-size: 0.68rem; font-weight: 700; min-width: 24px; text-align: right; }
  .date         { font-size: 0.72rem; color: var(--text-muted); }
  .empty        { color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
</style>
