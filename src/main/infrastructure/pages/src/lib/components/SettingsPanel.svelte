<script lang="ts">
  import type { Config } from '$lib/types.js';

  export let config: Config;
  export let onSave: (config: Config) => void;

  const sections: { key: keyof Config; label: string; desc: string }[] = [
    { key: 'score',         label: 'Scoring',        desc: 'Pesos y umbrales del sistema de puntuación' },
    { key: 'llm',           label: 'LLM',            desc: 'Modelos y proveedores' },
    { key: 'discover',      label: 'Descubrimiento', desc: 'Límites y queries de exploración' },
    { key: 'notifications', label: 'Notificaciones', desc: 'Email de destino para alertas' },
  ];

  let drafts: Record<string, string> = {};
  let saveStatus = '';

  $: {
    for (const s of sections) {
      drafts[s.key] = JSON.stringify(config[s.key] ?? {}, null, 2);
    }
  }

  async function save() {
    saveStatus = 'Guardando...';
    try {
      const full: Config = { ...config };
      for (const s of sections) {
        (full as Record<string, unknown>)[s.key] = JSON.parse(drafts[s.key]);
      }
      const fd = new FormData();
      fd.set('config', JSON.stringify(full));
      const res = await fetch('?/saveConfig', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean };
      saveStatus = data.success ? '✓ Guardado' : 'Error al guardar';
      if (data.success) onSave(full);
    } catch (e) {
      saveStatus = `Error: ${(e as Error).message}`;
    }
  }
</script>

<div class="settings">
  {#each sections as s}
    <div class="section">
      <div class="section-title">{s.label}</div>
      <div class="section-desc">{s.desc}</div>
      <textarea
        bind:value={drafts[s.key]}
        rows="6"
        spellcheck="false"
      ></textarea>
    </div>
  {/each}
  <button on:click={save}>Guardar configuración</button>
  {#if saveStatus}<p class="status">{saveStatus}</p>{/if}
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 16px; }
  .section  { background: #020817; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; }
  .section-title { font-size: 0.85rem; font-weight: 600; color: #f1f5f9; margin-bottom: 2px; }
  .section-desc  { font-size: 0.7rem; color: #475569; margin-bottom: 10px; }
  textarea { width: 100%; padding: 10px; background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; color: #94a3b8; font-family: monospace; font-size: 0.78rem; resize: vertical; }
  button   { padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .status  { font-size: 0.8rem; color: #64748b; }
</style>
