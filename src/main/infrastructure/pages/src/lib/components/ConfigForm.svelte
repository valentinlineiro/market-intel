<script lang="ts">
  import type { Config } from '$lib/types.js';
  import { cleanSegment } from '$lib/utils.js';
  import { deserialize } from '$app/forms';
  import TagInput from './TagInput.svelte';

  export let config: Config;
  export let onSave: () => void;

  let draft: Config = structuredClone(config);
  let saveStatus = '';
  let openSection: string | null = null;

  function toggleSection(id: string) {
    openSection = openSection === id ? null : id;
  }

  async function save() {
    saveStatus = 'Guardando...';
    try {
      const fd = new FormData();
      fd.set('config', JSON.stringify(draft));
      const res    = await fetch('?/saveConfig', { method: 'POST', body: fd });
      const result = deserialize(await res.text()) as { type: string; data?: { success: boolean } };
      if (result.type === 'success' && result.data?.success) {
        saveStatus = '✓ Guardado';
        onSave();
      } else {
        saveStatus = 'Error al guardar';
      }
    } catch (e) {
      saveStatus = `Error: ${(e as Error).message}`;
    }
    setTimeout(() => { saveStatus = ''; }, 3000);
  }

  const collectorKeys = ['gnews', 'local_news', 'reddit', 'youtube', 'bluesky', 'mastodon', 'hackernews', 'boe', 'boja', 'bocas', 'betalist', 'appsumo', 'producthunt', 'ine'] as const;
  type CollectorKey = typeof collectorKeys[number];

  function collectorLabel(key: CollectorKey): string {
    const labels: Record<CollectorKey, string> = {
      gnews: 'GNews', local_news: 'Noticias locales', reddit: 'Reddit',
      youtube: 'YouTube', bluesky: 'Bluesky', mastodon: 'Mastodon',
      hackernews: 'Hacker News', boe: 'BOE', boja: 'BOJA',
      bocas: 'BOCAs (DOGC/DOCV/BORM/BOCyL)', betalist: 'BetaList',
      appsumo: 'AppSumo', producthunt: 'Product Hunt', ine: 'INE',
    };
    return labels[key];
  }

  $: score   = (draft.score         ?? {}) as Record<string, unknown>;
  $: llm     = (draft.llm           ?? {}) as Record<string, unknown>;
  $: discover = (draft.discover      ?? {}) as Record<string, unknown>;
  $: notifs  = (draft.notifications  ?? {}) as Record<string, unknown>;
  $: collectors = (draft.collectors ?? {}) as Record<string, Record<string, unknown>>;
  $: gnewsSegments = Object.keys((collectors.gnews?.segments ?? {}) as Record<string, unknown>);
  $: synthSegments = Object.keys(draft.synthesis_segments ?? {});
</script>

<div class="form">

  <div class="section">
    <button class="section-head" on:click={() => toggleSection('scoring')}>
      <span class="section-icon" style="background:var(--accent-bg);color:var(--accent)">⚖</span>
      <span>Scoring</span>
      <span class="chevron" class:rotated={openSection === 'scoring'}>›</span>
    </button>
    {#if openSection === 'scoring'}
      <div class="section-body">
        <div class="field">
          <label>Top N segmentos</label>
          <input type="number" bind:value={score.top_n} min="1" max="50" />
        </div>
        <div class="field">
          <label>Score mínimo</label>
          <input type="number" bind:value={score.min_score} min="0" max="10" step="0.1" />
        </div>
        <div class="field field-row">
          <label>Dry run</label>
          <input type="checkbox" checked={!!score.dry_run} on:change={(e) => { score.dry_run = e.currentTarget.checked; }} />
        </div>
      </div>
    {/if}
  </div>

  <div class="section">
    <button class="section-head" on:click={() => toggleSection('llm')}>
      <span class="section-icon" style="background:var(--violet-bg);color:var(--violet)">✦</span>
      <span>LLM</span>
      <span class="chevron" class:rotated={openSection === 'llm'}>›</span>
    </button>
    {#if openSection === 'llm'}
      <div class="section-body">
        <div class="field">
          <label>Proveedor</label>
          <select bind:value={llm.provider}>
            <option value="groq">Groq</option>
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
        <div class="field">
          <label>Modelo</label>
          <input type="text" bind:value={llm.model} />
        </div>
        <div class="field">
          <label>Temperature</label>
          <input type="number" bind:value={llm.temperature} min="0" max="1" step="0.1" />
        </div>
        <div class="field">
          <label>Max tokens</label>
          <input type="number" bind:value={llm.max_tokens} min="128" max="8192" step="128" />
        </div>
      </div>
    {/if}
  </div>

  <div class="section">
    <button class="section-head" on:click={() => toggleSection('discover')}>
      <span class="section-icon" style="background:var(--blue-bg);color:var(--blue)">◎</span>
      <span>Descubrimiento</span>
      <span class="chevron" class:rotated={openSection === 'discover'}>›</span>
    </button>
    {#if openSection === 'discover'}
      <div class="section-body">
        <div class="field">
          <label>Max clusters</label>
          <input type="number" bind:value={discover.max_clusters} min="1" max="50" />
        </div>
        <div class="field">
          <label>Min señales</label>
          <input type="number" bind:value={discover.min_signals} min="1" max="20" />
        </div>
      </div>
    {/if}
  </div>

  <div class="section">
    <button class="section-head" on:click={() => toggleSection('notif')}>
      <span class="section-icon" style="background:var(--amber-bg);color:var(--amber)">✉</span>
      <span>Notificaciones</span>
      <span class="chevron" class:rotated={openSection === 'notif'}>›</span>
    </button>
    {#if openSection === 'notif'}
      <div class="section-body">
        <div class="field">
          <label>Email origen</label>
          <input type="email" bind:value={notifs.from_email} />
        </div>
        <div class="field">
          <label>Email destino</label>
          <input type="email" bind:value={notifs.to_email} />
        </div>
        <div class="field">
          <label>Umbral alerta</label>
          <input type="number" bind:value={notifs.alert_score_threshold} min="0" max="10" step="0.1" />
        </div>
      </div>
    {/if}
  </div>

  <div class="section">
    <button class="section-head" on:click={() => toggleSection('collectors')}>
      <span class="section-icon" style="background:var(--bg-input);color:var(--text-sub)">⚙</span>
      <span>Collectors</span>
      <span class="chevron" class:rotated={openSection === 'collectors'}>›</span>
    </button>
    {#if openSection === 'collectors'}
      <div class="section-body">
        {#each collectorKeys as key}
          {@const c = collectors[key]}
          {#if c !== undefined}
            <div class="subsection">
              <div class="subsection-head">
                <span class="subsection-title">{collectorLabel(key)}</span>
                <input type="checkbox" checked={!!c.enabled} on:change={(e) => { c.enabled = e.currentTarget.checked; }} />
              </div>
              {#if key === 'gnews'}
                <div class="field"><label>Max resultados</label><input type="number" bind:value={c.max_results} min="1" max="100" /></div>
              {:else if key === 'local_news'}
                <div class="field"><label>Pain keywords</label><TagInput bind:values={c.pain_keywords as string[]} placeholder="añadir keyword..." /></div>
              {:else if key === 'reddit'}
                <div class="field"><label>Subreddits</label><TagInput bind:values={c.subreddits as string[]} placeholder="nombre subreddit..." /></div>
              {:else if key === 'youtube'}
                <div class="field"><label>Max videos</label><input type="number" bind:value={c.max_videos} min="1" max="50" /></div>
                <div class="field"><label>Max comentarios / video</label><input type="number" bind:value={c.max_comments_per_video} min="1" max="200" /></div>
              {:else if key === 'bluesky'}
                <div class="field"><label>Max resultados</label><input type="number" bind:value={c.max_results} min="1" max="100" /></div>
              {:else if key === 'mastodon'}
                <div class="field"><label>Instancias</label><TagInput bind:values={c.instances as string[]} placeholder="mastodon.social..." /></div>
                <div class="field"><label>Max resultados</label><input type="number" bind:value={c.max_results} min="1" max="100" /></div>
              {:else if key === 'hackernews'}
                <div class="field"><label>Max resultados</label><input type="number" bind:value={c.max_results} min="1" max="100" /></div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <div class="section">
    <button class="section-head" on:click={() => toggleSection('gnews-segments')}>
      <span class="section-icon" style="background:var(--accent-bg);color:var(--accent)">◈</span>
      <span>Segmentos GNews</span>
      <span class="chevron" class:rotated={openSection === 'gnews-segments'}>›</span>
    </button>
    {#if openSection === 'gnews-segments'}
      <div class="section-body">
        {#each gnewsSegments as segKey}
          {@const seg = ((collectors.gnews?.segments ?? {}) as Record<string, Record<string, unknown>>)[segKey]}
          <div class="subsection">
            <div class="subsection-head"><span class="subsection-title">{cleanSegment(segKey)}</span></div>
            <div class="field"><label>Label</label><input type="text" bind:value={seg.label} /></div>
            <div class="field">
              <label>Queries (una por línea)</label>
              <textarea rows="3" value={(seg.queries as string[] ?? []).join('\n')}
                on:change={(e) => { seg.queries = e.currentTarget.value.split('\n').map((s: string) => s.trim()).filter(Boolean); }}
              ></textarea>
            </div>
            <div class="field"><label>Keywords</label><TagInput bind:values={seg.keywords as string[]} /></div>
            <div class="field"><label>Salario medio (€)</label><input type="number" bind:value={seg.salary_mean} min="0" step="500" /></div>
            <div class="field">
              <label>Income tier</label>
              <select bind:value={seg.income_tier}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="medium_high">Medium high</option><option value="high">High</option>
              </select>
            </div>
            <div class="field field-row"><label>Has deadline</label><input type="checkbox" checked={!!seg.has_deadline} on:change={(e) => { seg.has_deadline = e.currentTarget.checked; }} /></div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="section">
    <button class="section-head" on:click={() => toggleSection('synth-segments')}>
      <span class="section-icon" style="background:var(--violet-bg);color:var(--violet)">◈</span>
      <span>Segmentos Síntesis</span>
      <span class="chevron" class:rotated={openSection === 'synth-segments'}>›</span>
    </button>
    {#if openSection === 'synth-segments'}
      <div class="section-body">
        {#each synthSegments as segKey}
          {@const seg = ((draft.synthesis_segments ?? {}) as Record<string, Record<string, unknown>>)[segKey]}
          <div class="subsection">
            <div class="subsection-head"><span class="subsection-title">{cleanSegment(segKey)}</span></div>
            <div class="field"><label>Label</label><input type="text" bind:value={seg.label} /></div>
            <div class="field"><label>Keywords</label><TagInput bind:values={seg.keywords as string[]} /></div>
            <div class="field">
              <label>Income tier</label>
              <select bind:value={seg.income_tier}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="medium_high">Medium high</option><option value="high">High</option>
              </select>
            </div>
            <div class="field field-row"><label>Has deadline</label><input type="checkbox" checked={!!seg.has_deadline} on:change={(e) => { seg.has_deadline = e.currentTarget.checked; }} /></div>
            <div class="field"><label>Discovery score</label><input type="number" value={seg.discovery_score} disabled /></div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="save-row">
    <button class="btn-save" on:click={save}>Guardar cambios</button>
    {#if saveStatus}<span class="save-status">{saveStatus}</span>{/if}
  </div>

</div>

<style>
  .form { display: flex; flex-direction: column; gap: 4px; }
  .section      { background: var(--bg-card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-sub); }
  .section-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; background: none; border: none; cursor: pointer; text-align: left; color: var(--text); font-size: 0.85rem; font-weight: 600; }
  .section-head:hover { background: var(--bg-input); }
  .section-icon { width: 22px; height: 22px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; flex-shrink: 0; }
  .section-body { padding: 12px 14px; border-top: 1px solid var(--border-sub); display: flex; flex-direction: column; gap: 10px; }
  .chevron { margin-left: auto; color: var(--text-dim); font-size: 1rem; transition: transform 0.15s; display: inline-block; }
  .chevron.rotated { transform: rotate(90deg); }
  .field       { display: flex; flex-direction: column; gap: 4px; }
  .field-row   { flex-direction: row; align-items: center; justify-content: space-between; }
  label        { font-size: 0.72rem; color: var(--text-muted); font-weight: 500; }
  input[type="text"], input[type="email"], input[type="number"], select, textarea {
    padding: 7px 10px; background: var(--bg-input); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); font-size: 0.82rem; width: 100%;
  }
  input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
  textarea { resize: vertical; font-family: inherit; }
  select   { cursor: pointer; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--violet); }
  .subsection      { border: 1px solid var(--border-sub); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--bg); }
  .subsection-head { display: flex; justify-content: space-between; align-items: center; }
  .subsection-title{ font-size: 0.8rem; font-weight: 600; color: var(--text); }
  .save-row    { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  .btn-save    { padding: 9px 20px; background: var(--accent); color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
  .btn-save:hover { opacity: 0.9; }
  .save-status { font-size: 0.78rem; color: var(--text-muted); }
</style>
