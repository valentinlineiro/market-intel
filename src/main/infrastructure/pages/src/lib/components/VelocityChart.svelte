<script lang="ts">
  import type { VelocityRow } from '$lib/types.js';

  export let rows:     VelocityRow[];
  export let segment:  string | null = null; // null = all segments combined

  // ── Data prep ──────────────────────────────────────────────────────────────
  // Collect all distinct weeks in order
  $: allWeeks = [...new Set(rows.map(r => r.week))].sort();

  // Aggregate: if segment given → filter; else sum across all segments per week
  $: weekTotals = allWeeks.map(w => {
    const matching = rows.filter(r => r.week === w && (segment == null || r.segment === segment));
    return { week: w, count: matching.reduce((s, r) => s + r.count, 0) };
  });

  // ── SVG geometry ───────────────────────────────────────────────────────────
  const W = 480, H = 72, PAD_L = 8, PAD_R = 8, PAD_T = 8, PAD_B = 20;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  $: maxCount = Math.max(...weekTotals.map(w => w.count), 1);

  function x(i: number): number {
    if (weekTotals.length < 2) return PAD_L + chartW / 2;
    return PAD_L + (i / (weekTotals.length - 1)) * chartW;
  }
  function y(count: number): number {
    return PAD_T + chartH - (count / maxCount) * chartH;
  }

  $: polyline = weekTotals.map((w, i) => `${x(i)},${y(w.count)}`).join(' ');
  $: area = weekTotals.length > 0
    ? `M ${x(0)},${y(0)} ` +
      weekTotals.map((w, i) => `L ${x(i)},${y(w.count)}`).join(' ') +
      ` L ${x(weekTotals.length - 1)},${PAD_T + chartH} L ${x(0)},${PAD_T + chartH} Z`
    : '';

  // Week label formatter: "W42" from "2025-W42"
  function wLabel(w: string): string {
    const m = w.match(/W(\d+)$/);
    return m ? `W${m[1]}` : w.slice(-3);
  }

  // Show label every N weeks so they don't overlap
  $: labelStep = weekTotals.length <= 6 ? 1
               : weekTotals.length <= 12 ? 2
               : 4;
</script>

{#if weekTotals.length < 2 || maxCount === 0}
  <div class="empty">Sin datos de velocidad todavía.</div>
{:else}
  <div class="chart-wrap">
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="chart-svg">
      <!-- Area fill -->
      <path d={area} class="area" />
      <!-- Line -->
      <polyline points={polyline} class="line" />
      <!-- Dots on each week -->
      {#each weekTotals as w, i}
        <circle cx={x(i)} cy={y(w.count)} r="2.5" class="dot">
          <title>{wLabel(w.week)}: {w.count} señales</title>
        </circle>
      {/each}
      <!-- X-axis labels -->
      {#each weekTotals as w, i}
        {#if i % labelStep === 0 || i === weekTotals.length - 1}
          <text x={x(i)} y={H - 4} class="x-label" text-anchor="middle">{wLabel(w.week)}</text>
        {/if}
      {/each}
    </svg>
    <!-- Peak annotation -->
    <div class="legend">
      <span class="peak">pico {maxCount}</span>
      <span class="latest">última semana: {weekTotals[weekTotals.length - 1]?.count ?? 0}</span>
    </div>
  </div>
{/if}

<style>
  .chart-wrap  { width: 100%; }
  .chart-svg   { width: 100%; height: 72px; display: block; overflow: visible; }

  .area { fill: color-mix(in srgb, var(--violet) 12%, transparent); }
  .line { fill: none; stroke: var(--violet); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
  .dot  { fill: var(--violet); opacity: .75; cursor: default; }
  .dot:hover { opacity: 1; r: 3.5; }

  .x-label { font-size: 8px; fill: var(--text-dim); font-family: inherit; }

  .legend  { display: flex; justify-content: space-between; font-size: 0.68rem; color: var(--text-dim); padding: 2px 8px 0; }
  .peak    { color: var(--violet); }
  .empty   { font-size: 0.75rem; color: var(--text-dim); padding: 8px 0; }
</style>
