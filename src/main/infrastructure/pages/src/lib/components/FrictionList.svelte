<script lang="ts">
  import type { PainProfile } from '$lib/types.js';
  export let profiles: PainProfile[] = [];

  $: grouped = profiles.reduce<Record<string, PainProfile[]>>((acc, p) => {
    (acc[p.segment] ??= []).push(p);
    return acc;
  }, {});

  function intensityBar(v: number): string {
    return `${Math.round(Math.min(v / 10, 1) * 100)}%`;
  }
</script>

{#if profiles.length === 0}
  <p class="empty">Sin análisis de fricción todavía — espera al próximo sync.</p>
{:else}
  <div class="list">
    {#each Object.entries(grouped) as [segment, items]}
      <div class="group">
        <div class="group-header">{segment}</div>
        {#each items as p}
          <div class="profile">
            <div class="profile-top">
              <span class="type">{p.problem_type}</span>
              <div class="bar-track">
                <div class="bar-fill" style="width:{intensityBar(p.intensity)}"></div>
              </div>
              <span class="intensity">{p.intensity.toFixed(1)}</span>
              <span class="count">{p.count} señal{p.count !== 1 ? 'es' : ''}</span>
            </div>
            {#if p.pain_summary}
              <p class="summary">{p.pain_summary}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .list         { display: flex; flex-direction: column; gap: 16px; }
  .group        { background: var(--bg-card); border: 1px solid var(--border-sub); border-radius: 9px; overflow: hidden; }
  .group-header { padding: 9px 14px; font-weight: 700; font-size: 0.82rem; color: var(--text); border-bottom: 1px solid var(--border-sub); background: var(--bg); }
  .profile      { padding: 9px 14px; border-bottom: 1px solid var(--border-sub); }
  .profile:last-child { border-bottom: none; }
  .profile-top  { display: flex; align-items: center; gap: 8px; }
  .type         { font-size: 0.72rem; font-weight: 600; color: var(--violet); min-width: 80px; }
  .bar-track    { flex: 1; height: 5px; background: var(--border); border-radius: 3px; }
  .bar-fill     { height: 100%; background: var(--violet); border-radius: 3px; }
  .intensity    { font-size: 0.72rem; font-weight: 700; color: var(--text-sub); width: 28px; text-align: right; }
  .count        { font-size: 0.68rem; color: var(--text-dim); white-space: nowrap; }
  .summary      { font-size: 0.75rem; color: var(--text-muted); margin-top: 5px; line-height: 1.45; }
  .empty        { color: var(--text-muted); font-size: 0.85rem; padding: 32px 0; text-align: center; }
</style>
