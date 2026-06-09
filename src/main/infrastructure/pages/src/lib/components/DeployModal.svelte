<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { synthesizeCopy } from '$lib/api.js';
  import type { LandingCopy } from '$lib/types.js';

  export let segment: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  interface PageSummary {
    page_slug: string;
    title: string | null;
    deployed_at: string;
    copy: LandingCopy | null;
  }

  // ── Campaign view ─────────────────────────────────────────────────────────
  let view: 'campaign' | 'editor' = 'campaign';
  let pages: PageSummary[] = [];
  let loadingPages = true;
  let campaignError = '';

  async function loadPages() {
    loadingPages = true;
    campaignError = '';
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(segment)}`);
      const data = await res.json() as { pages: PageSummary[] };
      pages = data.pages ?? [];
    } catch {
      campaignError = 'Error al cargar páginas.';
    } finally {
      loadingPages = false;
    }
  }

  loadPages();

  // ── Page editor ───────────────────────────────────────────────────────────
  let pageSlug    = 'index';
  let headline    = '';
  let subheadline = '';
  let painPoints: string[] = [''];
  let cta         = '';
  let previewHtml = '';
  let advancedMode    = false;
  let advancedHtml    = '';
  let htmlModified    = false;
  let status      = '';
  let deploying   = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function openNewPage() {
    pageSlug = 'nueva-pagina';
    headline = ''; subheadline = ''; painPoints = ['']; cta = '';
    previewHtml = ''; advancedMode = false; advancedHtml = ''; htmlModified = false;
    status = 'Generando copy con LLM...';
    view = 'editor';
    fetchSynthesize();
  }

  async function openEditPage(p: PageSummary) {
    pageSlug = p.page_slug;
    advancedMode = false; advancedHtml = ''; htmlModified = false;
    view = 'editor';
    if (p.copy) {
      headline    = p.copy.headline;
      subheadline = p.copy.subheadline;
      painPoints  = p.copy.pain_points.length ? [...p.copy.pain_points] : [''];
      cta         = p.copy.cta;
      status      = 'Edita la página y despliégala.';
      schedulePreview();
    } else {
      headline = ''; subheadline = ''; painPoints = ['']; cta = '';
      status = 'Generando copy con LLM...';
      fetchSynthesize();
    }
  }

  async function fetchSynthesize() {
    try {
      const result = await synthesizeCopy(segment);
      headline    = result.copy.headline;
      subheadline = result.copy.subheadline;
      painPoints  = result.copy.pain_points.length ? result.copy.pain_points : [''];
      cta         = result.copy.cta;
      previewHtml = result.html;
      status      = 'Edita la página y despliégala.';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status = msg.includes('404')
        ? 'Segmento sin datos de señales — escribe el copy manualmente.'
        : 'LLM no disponible — escribe el copy manualmente.';
    }
  }

  function schedulePreview() {
    if (advancedMode) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchPreview, 300);
  }

  async function fetchPreview() {
    const copy: LandingCopy = {
      headline, subheadline,
      pain_points: painPoints.filter(Boolean),
      cta,
    };
    try {
      const res = await fetch('/api/render', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ segment, copy }),
      });
      const data = await res.json() as { html: string };
      previewHtml = data.html;
    } catch { /* keep old preview */ }
  }

  function addPainPoint() { painPoints = [...painPoints, '']; }
  function removePainPoint(i: number) {
    painPoints = painPoints.filter((_, j) => j !== i);
    if (!painPoints.length) painPoints = [''];
    schedulePreview();
  }
  function updatePainPoint(i: number, val: string) {
    painPoints = painPoints.map((p, j) => j === i ? val : p);
    schedulePreview();
  }

  function enableAdvanced() {
    advancedHtml = previewHtml;
    advancedMode = true;
  }

  async function deploy() {
    deploying = true;
    status = 'Desplegando...';
    const copy: LandingCopy = {
      headline, subheadline,
      pain_points: painPoints.filter(Boolean),
      cta,
    };
    const finalHtml = (advancedMode && htmlModified) ? advancedHtml : previewHtml;
    try {
      const fd = new FormData();
      fd.set('segment',   segment);
      fd.set('page_slug', pageSlug);
      if (finalHtml) fd.set('html', finalHtml);
      if (!advancedMode || !htmlModified) fd.set('copy', JSON.stringify(copy));
      const res  = await fetch('?/deploy', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean; url?: string; error?: string };
      if (data.success) {
        status = `✓ Desplegado: ${data.url ?? ''}`;
        await loadPages();
        setTimeout(() => { view = 'campaign'; status = ''; deploying = false; }, 1500);
      } else {
        status = `Error: ${data.error ?? 'unknown'}`;
        deploying = false;
      }
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
      deploying = false;
    }
  }

  async function removePage(slug: string) {
    const fd = new FormData();
    fd.set('segment',   segment);
    fd.set('page_slug', slug);
    await fetch('?/deletePage', { method: 'POST', body: fd });
    pages = pages.filter(p => p.page_slug !== slug);
  }
</script>

<div class="overlay" role="dialog" aria-modal="true">
  <div class="modal">

    {#if view === 'campaign'}
      <h3>Páginas · <span>{segment}</span></h3>

      {#if loadingPages}
        <p class="status">Cargando...</p>
      {:else if campaignError}
        <p class="status">{campaignError}</p>
      {:else if pages.length === 0}
        <p class="empty">Sin páginas — crea la primera.</p>
      {:else}
        <div class="page-list">
          {#each pages as p}
            <div class="page-row">
              <div class="page-info">
                <span class="slug">/{p.page_slug}</span>
                <span class="page-title">{p.title ?? ''}</span>
                <span class="deployed-at">{new Date(p.deployed_at).toLocaleDateString('es')}</span>
              </div>
              <div class="page-btns">
                <button class="btn-sm" on:click={() => openEditPage(p)}>Editar</button>
                <button class="btn-sm btn-danger" on:click={() => removePage(p.page_slug)}>Eliminar</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="actions">
        <button class="btn-primary" on:click={openNewPage}>+ Nueva página</button>
        <button class="btn-secondary" on:click={() => dispatch('close')}>Cerrar</button>
      </div>

    {:else}
      <h3>
        <button class="back-btn" on:click={() => { view = 'campaign'; }}>←</button>
        Editar · <span>{segment} / {pageSlug}</span>
      </h3>

      <div class="editor-layout">
        <div class="fields-pane">
          {#if !advancedMode}
            <label class="field-label">Slug
              <input type="text" bind:value={pageSlug} on:input={schedulePreview} />
            </label>
            <label class="field-label">Headline
              <input type="text" bind:value={headline} on:input={schedulePreview} />
            </label>
            <label class="field-label">Subtítulo
              <textarea rows="3" bind:value={subheadline} on:input={schedulePreview}></textarea>
            </label>
            <span class="field-label">Puntos de dolor</span>
            {#each painPoints as point, i}
              <div class="pain-row">
                <input
                  type="text"
                  value={point}
                  on:input={e => updatePainPoint(i, (e.target as HTMLInputElement).value)}
                />
                <button class="btn-remove" on:click={() => removePainPoint(i)} aria-label="Eliminar">✕</button>
              </div>
            {/each}
            <button class="btn-add" on:click={addPainPoint}>+ Añadir punto</button>
            <label class="field-label">CTA
              <input type="text" bind:value={cta} on:input={schedulePreview} />
            </label>
            <button class="btn-advanced" on:click={enableAdvanced}>Modo avanzado →</button>
          {:else}
            <p class="advanced-warning">
              {#if htmlModified}
                Editando HTML directamente. Para volver al editor estructurado cierra y vuelve a abrir.
              {:else}
                Modo avanzado — edita el HTML directamente.
                <button class="btn-back-structured" on:click={() => { advancedMode = false; }}>← Volver</button>
              {/if}
            </p>
            <textarea
              class="html-ta"
              bind:value={advancedHtml}
              on:input={() => { htmlModified = true; previewHtml = advancedHtml; }}
              spellcheck="false"
            ></textarea>
          {/if}
        </div>

        <div class="preview-pane">
          <div class="pane-label">Vista previa</div>
          <iframe
            title="Vista previa"
            srcdoc={previewHtml || '<body style="background:#020817;color:#94a3b8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><p>Completando campos…</p></body>'}
          ></iframe>
        </div>
      </div>

      <p class="status">{status}</p>
      <div class="actions">
        <button
          class="btn-primary"
          on:click={deploy}
          disabled={deploying || (advancedMode && htmlModified ? !advancedHtml : (!pageSlug || !headline))}
        >Desplegar</button>
        <button class="btn-secondary" on:click={() => { view = 'campaign'; }}>Cancelar</button>
      </div>
    {/if}

  </div>
</div>

<style>
  .overlay      { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .modal        { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; width: min(1100px, 96vw); max-height: 92vh; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
  h3            { color: #f1f5f9; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; }
  h3 span       { color: #64748b; font-weight: 400; }
  .back-btn     { background: none; border: none; color: #64748b; cursor: pointer; font-size: 1rem; padding: 0 4px; }
  .back-btn:hover { color: #f1f5f9; }

  /* Campaign view */
  .page-list    { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 50vh; }
  .page-row     { display: flex; align-items: center; justify-content: space-between; background: #1e293b; border-radius: 8px; padding: 10px 14px; }
  .page-info    { display: flex; align-items: center; gap: 16px; }
  .slug         { font-size: 0.8rem; color: #f1f5f9; font-family: monospace; }
  .page-title   { font-size: 0.78rem; color: #64748b; }
  .deployed-at  { font-size: 0.7rem; color: #475569; }
  .page-btns    { display: flex; gap: 6px; }
  .btn-sm       { padding: 5px 12px; background: #334155; border: none; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer; }
  .btn-sm:hover { background: #475569; color: #f1f5f9; }
  .btn-danger   { background: #450a0a; color: #f87171; }
  .btn-danger:hover { background: #7f1d1d; }
  .empty        { color: #475569; font-size: 0.85rem; padding: 24px 0; text-align: center; }

  /* Editor layout */
  .editor-layout  { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex: 1; min-height: 0; height: 58vh; }
  .fields-pane    { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; }
  .preview-pane   { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .pane-label     { font-size: 0.65rem; color: #475569; text-transform: uppercase; letter-spacing: 0.07em; }
  iframe          { flex: 1; border: 1px solid #1e293b; border-radius: 8px; background: #020817; min-height: 0; }

  /* Fields */
  .field-label    { display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; color: #64748b; }
  input, textarea { padding: 8px 10px; background: #020817; border: 1px solid #1e293b; border-radius: 6px; color: #f1f5f9; font-size: 0.85rem; width: 100%; }
  input:focus, textarea:focus { outline: none; border-color: #334155; }
  textarea        { resize: vertical; }
  .pain-row       { display: flex; gap: 6px; align-items: center; }
  .pain-row input { flex: 1; }
  .btn-remove     { background: none; border: none; color: #475569; cursor: pointer; font-size: 0.8rem; padding: 4px; }
  .btn-remove:hover { color: #f87171; }
  .btn-add        { background: none; border: 1px dashed #334155; border-radius: 6px; color: #475569; cursor: pointer; font-size: 0.75rem; padding: 6px; text-align: left; width: 100%; }
  .btn-add:hover  { color: #94a3b8; border-color: #475569; }
  .btn-advanced   { background: none; border: none; color: #475569; cursor: pointer; font-size: 0.72rem; text-align: left; padding: 4px 0; margin-top: 4px; }
  .btn-advanced:hover { color: #94a3b8; }
  .btn-back-structured { background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 0.72rem; padding: 0; }

  /* Advanced mode */
  .advanced-warning { font-size: 0.75rem; color: #64748b; line-height: 1.5; }
  .html-ta        { flex: 1; font-family: ui-monospace, monospace; font-size: 0.72rem; line-height: 1.5; resize: none; min-height: 200px; }

  /* Bottom bar */
  .status         { font-size: 0.78rem; color: #64748b; min-height: 1.2em; }
  .actions        { display: flex; gap: 12px; }
  .btn-primary    { flex: 1; padding: 11px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary  { padding: 11px 20px; background: #1e293b; color: #94a3b8; border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
</style>
