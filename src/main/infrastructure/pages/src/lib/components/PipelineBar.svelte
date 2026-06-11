<script lang="ts">
  export let stages: Array<{
    key:   string;
    label: string;
    sub:   string;
    state: 'done' | 'running' | 'pending';
  }>;
  export let activeTab: string;
  export let onStageClick: (key: string) => void;
</script>

<div class="pipeline-zone">
  <div class="pipeline">
    {#each stages as stage, i}
      <button
        class="stage {stage.state}"
        class:tab-active={activeTab === stage.key}
        on:click={() => onStageClick(stage.key)}
        title={stage.label}
      >
        <div class="circle">
          {#if stage.state === 'done'}✓{:else if stage.state === 'running'}···{:else}○{/if}
        </div>
        <div class="label">{stage.label}</div>
        <div class="sub">{stage.sub}</div>
        <div class="bar"></div>
      </button>
      {#if i < stages.length - 1}
        <div class="conn {stage.state === 'done' && stages[i + 1].state !== 'pending' ? 'done' : stage.state === 'done' ? 'half' : 'pending'}"></div>
      {/if}
    {/each}
  </div>

  <div class="tabs">
    {#each stages as stage}
      <button
        class="tab"
        class:active={activeTab === stage.key}
        on:click={() => onStageClick(stage.key)}
      >{stage.label}</button>
    {/each}
  </div>
</div>

<style>
  .pipeline-zone { border-bottom: 1px solid var(--border); background: var(--bg-card); }

  .pipeline { display: flex; align-items: flex-end; padding: 14px 16px 0; gap: 0; overflow-x: auto; }

  .stage { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; background: none; border: none; padding: 0; }
  .stage:hover .circle { opacity: .8; }

  .circle { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; margin-bottom: 4px; flex-shrink: 0; transition: opacity .15s; }
  .label  { font-size: 10px; font-weight: 600; white-space: nowrap; color: var(--text-muted); }
  .sub    { font-size: 9px; color: var(--text-dim); margin-top: 2px; white-space: nowrap; }
  .bar    { width: 100%; height: 3px; margin-top: 7px; border-radius: 2px 2px 0 0; }

  /* done */
  .done .circle { background: var(--violet); color: #fff; }
  .done .label  { color: var(--violet); }
  .done .bar    { background: var(--violet); }

  /* running — pulse */
  .running .circle { background: var(--violet); color: #fff; animation: pulse .9s ease-in-out infinite; }
  .running .label  { color: var(--violet); font-weight: 700; }
  .running .bar    { background: var(--violet); opacity: .3; animation: pulse .9s ease-in-out infinite; }

  /* pending */
  .pending .circle { background: var(--bg-input); color: var(--border); }
  .pending .bar    { background: var(--bg-input); }

  /* selected tab highlighted */
  .tab-active .bar  { background: var(--violet) !important; opacity: 1 !important; height: 3px; }
  .tab-active .label { color: var(--violet) !important; font-weight: 700; }

  /* connectors */
  .conn { flex: 0 0 10px; height: 2px; margin-bottom: 22px; flex-shrink: 0; }
  .conn.done    { background: var(--violet); }
  .conn.half    { background: linear-gradient(90deg, var(--violet) 50%, var(--border) 50%); }
  .conn.pending { background: var(--border); }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }

  /* TABS */
  .tabs { display: flex; background: var(--bg); border-top: 1px solid var(--border-sub); }
  .tab  { flex: 1; padding: 8px 2px; text-align: center; font-size: 10.5px; color: var(--text-dim); cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab.active { color: var(--violet); border-bottom-color: var(--violet); font-weight: 600; }

  /* Responsive: hide sub-label on narrow viewports */
  @media (max-width: 600px) {
    .sub { display: none; }
    .label { font-size: 9px; }
    .conn { flex: 0 0 6px; }
  }
</style>
