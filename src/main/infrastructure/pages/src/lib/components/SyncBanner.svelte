<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { CronStep } from '$lib/types.js';

  /** The cron run ID to poll. */
  export let runId: string;
  /** true = full pipeline (5 steps); false = focused sync (3 steps). */
  export let fullPipeline = true;

  const dispatch = createEventDispatcher<{ complete: { error: string | null } }>();

  type StepState = 'pending' | 'running' | 'done' | 'error';

  const FULL_STEPS  = ['collect', 'friction', 'discovery', 'score', 'snapshot'] as const;
  const SHORT_STEPS = ['collect', 'friction', 'score'] as const;
  const STEP_LABELS: Record<string, string> = {
    collect:   'Collect',
    friction:  'Friction',
    discovery: 'Discovery',
    score:     'Score',
    snapshot:  'Snapshot',
  };

  $: expectedKeys = (fullPipeline ? FULL_STEPS : SHORT_STEPS) as readonly string[];

  let steps:  CronStep[] = [];
  let elapsed = 0;
  const started = Date.now();

  const tickTimer = setInterval(() => { elapsed = Math.round((Date.now() - started) / 1000); }, 1000);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function poll() {
    try {
      const res  = await fetch(`/api/pipeline-status/${encodeURIComponent(runId)}`);
      if (!res.ok) return;
      const body = await res.json() as {
        run:   { finished_at: string | null; error: string | null } | null;
        steps: CronStep[];
      };
      steps = body.steps ?? [];
      if (body.run?.finished_at) {
        stop();
        await invalidateAll();
        dispatch('complete', { error: body.run.error });
      }
    } catch { /* non-fatal */ }
  }

  function stop() {
    clearInterval(tickTimer);
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  pollTimer = setInterval(poll, 2000);
  poll();

  onDestroy(stop);

  function stepDetail(step: CronStep): string {
    const d = step.detail;
    if (!d)                      return '';
    if (d['skipped'])            return '—';
    if (d['error'])              return String(d['error']).slice(0, 40);
    if (d['signals']   != null)  return `${d['signals']} señales`;
    if (d['analyzed']  != null)  return `${d['analyzed']} analizadas`;
    if (d['candidates'] != null) return `${d['candidates']} candidatos`;
    if (d['opps']      != null)  return `${d['opps']} opps`;
    return '';
  }

  $: nodes = expectedKeys.map(key => {
    const s = steps.find(st => st.step === key);
    return {
      key,
      label:  STEP_LABELS[key] ?? key,
      state:  (s?.status ?? 'pending') as StepState,
      detail: s ? stepDetail(s) : '',
    };
  });

  function connClass(i: number): string {
    const cur  = nodes[i]?.state;
    const next = nodes[i + 1]?.state;
    if (cur === 'done' && next !== 'pending') return 'done';
    if (cur === 'done') return 'half';
    return 'pending';
  }
</script>

<div class="sync-banner">
  <div class="banner-top">
    <span class="dot"></span>
    Pipeline · en curso
    <span class="timer">{elapsed}s</span>
  </div>
  <div class="stages">
    {#each nodes as node, i}
      <div class="stage">
        <div class="circle {node.state}">
          {#if node.state === 'done'}✓{:else if node.state === 'running'}···{:else if node.state === 'error'}✗{:else}○{/if}
        </div>
        <div class="name {node.state}">{node.label}</div>
        {#if node.detail}<div class="count">{node.detail}</div>{/if}
      </div>
      {#if i < nodes.length - 1}
        <div class="conn {connClass(i)}"></div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .sync-banner {
    background: #13131f;
    border-bottom: 1px solid color-mix(in srgb, var(--violet) 25%, transparent);
    padding: 7px 16px;
  }
  .banner-top {
    display: flex; align-items: center; gap: 7px;
    font-size: 0.72rem; color: var(--violet); font-weight: 700; margin-bottom: 8px;
  }
  .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--violet); flex-shrink: 0;
    animation: pulse .9s ease-in-out infinite;
  }
  .timer { margin-left: auto; color: var(--text-dim); font-weight: 400; }

  .stages { display: flex; align-items: flex-end; }

  .stage {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; align-items: center; padding: 0 2px;
  }

  .circle {
    width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.65rem; font-weight: 700; margin-bottom: 4px; flex-shrink: 0;
  }
  .circle.done    { background: var(--violet); color: #fff; }
  .circle.running { background: var(--violet); color: #fff; animation: pulse .9s ease-in-out infinite; }
  .circle.error   { background: #ef4444; color: #fff; }
  .circle.pending { background: var(--bg-input); color: var(--border); border: 1px solid var(--border); }

  .name         { font-size: 0.65rem; color: var(--text-muted); white-space: nowrap; }
  .name.done    { color: var(--violet); }
  .name.running { color: var(--violet); font-weight: 700; }
  .name.error   { color: #ef4444; }

  .count { font-size: 0.6rem; color: var(--violet); margin-top: 2px; white-space: nowrap; }

  .conn { flex: 0 0 8px; height: 2px; margin-bottom: 22px; }
  .conn.done    { background: var(--violet); }
  .conn.half    { background: linear-gradient(90deg, var(--violet) 50%, var(--border) 50%); }
  .conn.pending { background: var(--border); }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
</style>
