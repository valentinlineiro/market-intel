<script lang="ts">
  import type { Opportunity } from '$lib/types.js';

  export let totalSignals: number;
  export let opportunities: Opportunity[];
  export let health: { status: string; last_runs: Record<string, { error: string | null }> };

  $: topScore    = opportunities.length ? Math.max(...opportunities.map(o => o.score)) : null;
  $: scoreColor  = topScore === null ? 'var(--text-muted)' : topScore >= 6 ? 'var(--accent)' : topScore >= 4 ? 'var(--amber)' : 'var(--text-muted)';

  $: runs        = Object.values(health.last_runs ?? {});
  $: totalC      = runs.length;
  $: healthyC    = runs.filter(r => !r.error).length;
  $: collectorOk = totalC > 0 && healthyC === totalC;
  $: collectorColor = totalC === 0 ? 'var(--text-muted)' : collectorOk ? 'var(--accent)' : 'var(--red)';
  $: collectorLabel = totalC === 0 ? '—' : `${healthyC}/${totalC}`;
</script>

<div class="bar">
  <div class="kpi">
    <span class="val">{totalSignals}</span>
    <span class="lbl">señales</span>
  </div>
  <div class="kpi">
    <span class="val">{opportunities.length}</span>
    <span class="lbl">oportunidades</span>
  </div>
  <div class="kpi">
    <span class="val" style="color: {scoreColor}">{topScore !== null ? topScore.toFixed(1) : '—'}</span>
    <span class="lbl">top score</span>
  </div>
  <div class="kpi">
    <span class="val" style="color: {collectorColor}">{collectorLabel}</span>
    <span class="lbl">collectors</span>
  </div>
</div>

<style>
  .bar  { display: flex; background: var(--bg-card); border-bottom: 1px solid var(--border); }
  .kpi  { flex: 1; padding: 10px 4px; text-align: center; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
  .kpi:last-child { border-right: none; }
  .val  { font-size: 1.1rem; font-weight: 700; color: var(--text); }
  .lbl  { font-size: 0.65rem; color: var(--text-muted); }
</style>
