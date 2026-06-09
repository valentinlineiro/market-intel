<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { synthesizeCopy } from '$lib/api.js';
  import type { LandingCopy } from '$lib/types.js';

  export let segment: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  let copy: LandingCopy | null = null;
  let html = '';
  let status = 'Generando página con LLM...';
  let deploying = false;

  async function loadCopy() {
    try {
      const result = await synthesizeCopy(segment);
      copy = result.copy;
      html = result.html;
      status = 'Edita la página y despliégala.';
    } catch (e) {
      copy = { headline: '', subheadline: '', cta: '', pain_points: [] };
      html = '';
      status = 'LLM no disponible — pega tu propio HTML o deja en blanco.';
    }
  }

  loadCopy();

  async function deploy() {
    deploying = true;
    status = 'Desplegando...';
    try {
      const fd = new FormData();
      fd.set('segment', segment);
      fd.set('html', html);
      const res = await fetch('?/deploy', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean; url?: string; error?: string };
      if (data.success && data.url) {
        status = `✓ Desplegado: ${data.url}`;
        setTimeout(() => dispatch('close'), 2500);
      } else {
        status = `Error: ${data.error ?? 'unknown'}`;
        deploying = false;
      }
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
      deploying = false;
    }
  }
</script>

<div class="overlay" role="dialog" aria-modal="true">
  <div class="modal">
    <h3>Editar página · <span>{segment}</span></h3>
    <div class="editor">
      <div class="pane pane-code">
        <div class="pane-label">HTML</div>
        <textarea bind:value={html} spellcheck="false" placeholder="Generando..."></textarea>
      </div>
      <div class="pane pane-preview">
        <div class="pane-label">Vista previa</div>
        <iframe title="Vista previa" srcdoc={html || '<body style="background:#020817;color:#94a3b8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><p>Generando…</p></body>'}></iframe>
      </div>
    </div>
    <p class="status">{status}</p>
    <div class="actions">
      <button class="btn-primary" on:click={deploy} disabled={deploying || !html}>Desplegar</button>
      <button class="btn-secondary" on:click={() => dispatch('close')}>Cancelar</button>
    </div>
  </div>
</div>

<style>
  .overlay    { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .modal      { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; width: min(1100px, 96vw); max-height: 92vh; display: flex; flex-direction: column; gap: 16px; }
  h3          { color: #f1f5f9; font-size: 0.95rem; }
  h3 span     { color: #64748b; font-weight: 400; }
  .editor     { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex: 1; min-height: 0; height: 60vh; }
  .pane       { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .pane-label { font-size: 0.65rem; color: #475569; text-transform: uppercase; letter-spacing: 0.07em; }
  textarea    { flex: 1; background: #020817; border: 1px solid #1e293b; border-radius: 8px; color: #94a3b8; font-family: ui-monospace, monospace; font-size: 0.72rem; line-height: 1.5; padding: 12px; resize: none; min-height: 0; }
  textarea:focus { outline: none; border-color: #334155; }
  iframe      { flex: 1; border: 1px solid #1e293b; border-radius: 8px; background: #020817; min-height: 0; }
  .status     { font-size: 0.78rem; color: #64748b; min-height: 1.2em; }
  .actions    { display: flex; gap: 12px; }
  .btn-primary        { flex: 1; padding: 11px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary      { padding: 11px 20px; background: #1e293b; color: #94a3b8; border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
</style>
