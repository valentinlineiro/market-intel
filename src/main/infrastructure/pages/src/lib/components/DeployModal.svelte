<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { synthesizeCopy } from '$lib/api.js';
  import type { LandingCopy } from '$lib/types.js';

  export let segment: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  let copy: LandingCopy | null = null;
  let title = '';
  let subtitle = '';
  let cta = '';
  let status = 'Generando copy con LLM...';
  let deploying = false;

  async function loadCopy() {
    try {
      copy = await synthesizeCopy(segment);
      title    = copy.title    ?? '';
      subtitle = copy.subtitle ?? '';
      cta      = copy.cta      ?? '';
      status   = 'Revisa y edita el copy antes de deployar.';
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    }
  }

  loadCopy();

  async function deploy() {
    if (!copy) return;
    deploying = true;
    status = 'Deployando...';
    const finalCopy: LandingCopy = { ...copy, title, subtitle, cta };
    try {
      const fd = new FormData();
      fd.set('segment', segment);
      fd.set('copy', JSON.stringify(finalCopy));
      const res = await fetch('?/deploy', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean; url?: string; error?: string };
      if (data.success && data.url) {
        status = `✓ Deployado: ${data.url}`;
        setTimeout(() => dispatch('close'), 2500);
      } else {
        status = `Error: ${data.error ?? 'unknown'}`;
      }
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    } finally {
      deploying = false;
    }
  }
</script>

<div class="overlay" role="dialog" aria-modal="true">
  <div class="modal">
    <h3>Editar copy · <span>{segment}</span></h3>
    <div class="fields">
      <label>Headline</label>
      <input type="text" bind:value={title} />
      <label>Subtitle</label>
      <textarea rows="3" bind:value={subtitle}></textarea>
      <label>CTA</label>
      <input type="text" bind:value={cta} />
    </div>
    <p class="status">{status}</p>
    <div class="actions">
      <button class="btn-primary" on:click={deploy} disabled={deploying || !copy}>Deployar</button>
      <button class="btn-secondary" on:click={() => dispatch('close')}>Cancelar</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; }
  .modal   { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; width: min(600px, 90vw); max-height: 90vh; overflow-y: auto; }
  h3       { color: #f1f5f9; margin-bottom: 20px; }
  .fields  { display: flex; flex-direction: column; gap: 12px; }
  label    { font-size: 0.75rem; color: #64748b; }
  input, textarea { padding: 10px; background: #020817; border: 1px solid #1e293b; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem; width: 100%; }
  textarea { resize: vertical; }
  .status  { margin-top: 12px; font-size: 0.8rem; color: #64748b; min-height: 1.2em; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  .btn-primary   { flex: 1; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { padding: 12px 20px; background: #1e293b; color: #94a3b8; border: none; border-radius: 8px; cursor: pointer; }
</style>
