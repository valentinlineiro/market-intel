<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { DiscoveryResult } from '$lib/types.js';

  export let discovery: DiscoveryResult;
  export let activeSegments: Record<string, unknown> = {};

  const dispatch = createEventDispatcher<{ promoted: { run_id: string } }>();

  function scoreColor(s: number) {
    return s > 12 ? 'var(--violet)' : s > 6 ? 'var(--text-sub)' : 'var(--text-muted)';
  }

  $: ts = discovery.discovered_at
    ? new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(discovery.discovered_at))
    : null;

  function toSlug(profile: string): string {
    return profile
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }

  let states: Record<string, 'idle' | 'loading' | 'promoted' | 'error'> = {};

  async function promote(c: DiscoveryResult['candidates'][number]) {
    const key = toSlug(c.profile ?? '');
    states = { ...states, [key]: 'loading' };
    try {
      const res = await fetch('/api/discovery/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile:      c.profile,
          keywords:     c.keywords ?? [],
          income_est:   c.income_est ?? null,
          has_deadline: c.has_deadline ?? false,
        }),
      });
      const body = await res.json() as { ok: boolean; run_id?: string; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? String(res.status));
      states = { ...states, [key]: 'promoted' };
      dispatch('promoted', { run_id: body.run_id ?? '' });
    } catch {
      states = { ...states, [key]: 'error' };
    }
  }
</script>

{#if ts}
  <p class="ts">Última actualización: {ts}</p>
{/if}

<div class="grid">
  {#if !discovery.candidates?.length}
    <div class="card"><p class="muted">Sin sectores detectados todavía.</p></div>
  {:else}
    {#each discovery.candidates.slice(0, 12) as c}
      {@const key = toSlug(c.profile ?? '')}
      {@const effectiveState = activeSegments[key] !== undefined ? 'promoted' : (states[key] ?? 'idle')}
      {@const fromServer = activeSegments[key] !== undefined}
      <div class="card">
        <div class="header">
          <strong>{c.profile}</strong>
          <span style="color: {scoreColor(c.discovery_score ?? 0)}; font-weight: 700; font-size: 0.85rem;">
            {(c.discovery_score ?? 0).toFixed(1)}
          </span>
        </div>
        <p class="pain">{c.pain}</p>
        <div class="chips">
          {#each (c.keywords || []).slice(0, 4) as kw}
            <span class="chip">{kw}</span>
          {/each}
        </div>
        <div class="meta">{c.post_count} posts · {c.income_est ?? '—'}</div>

        {#if effectiveState === 'idle'}
          <button class="promote-btn" on:click={() => promote(c)}>Promover →</button>
        {:else if effectiveState === 'loading'}
          <span class="promote-loading"><span class="spinner-sm"></span> Promoviendo…</span>
        {:else if effectiveState === 'promoted'}
          {#if fromServer}
            <span class="badge-active">✓ Activo</span>
          {:else}
            <span class="badge-active">✓ Activo · sync iniciado</span>
          {/if}
        {:else if effectiveState === 'error'}
          <button class="promote-btn promote-err" on:click={() => promote(c)}>Promover →</button>
          <span class="err-line">Error — reintentar</span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .ts   { font-size: 0.7rem; color: var(--text-muted); margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { background: var(--bg-card); border: 1px solid var(--border-sub); border-radius: 10px; padding: 16px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header strong { color: var(--text); font-size: 0.88rem; line-height: 1.3; }
  .pain  { color: var(--text-muted); font-size: 0.78rem; margin-bottom: 10px; line-height: 1.4; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip  { padding: 2px 6px; background: var(--bg-input); border-radius: 4px; font-size: 0.68rem; color: var(--text-muted); }
  .meta  { margin-top: 8px; font-size: 0.68rem; color: var(--text-dim); }
  .muted { color: var(--text-muted); font-size: 0.85rem; }
  .promote-btn   { margin-top: 10px; padding: 4px 10px; border-radius: 5px; border: 1px solid var(--violet); background: transparent; color: var(--violet); font-size: 0.72rem; cursor: pointer; }
  .promote-btn:hover { background: var(--accent-bg); }
  .promote-err   { border-color: #ef4444; color: #ef4444; }
  .promote-loading { margin-top: 10px; font-size: 0.72rem; color: var(--text-dim); display: flex; align-items: center; gap: 5px; }
  .spinner-sm    { width: 10px; height: 10px; border: 2px solid var(--border); border-top-color: var(--violet); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .badge-active  { margin-top: 10px; display: inline-block; font-size: 0.7rem; color: var(--violet); font-weight: 600; }
  .err-line      { display: block; margin-top: 3px; font-size: 0.68rem; color: #ef4444; }
</style>
