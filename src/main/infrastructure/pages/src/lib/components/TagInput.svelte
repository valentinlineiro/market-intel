<script lang="ts">
  export let values: string[] = [];
  export let placeholder = 'Añadir...';

  let input = '';

  function add() {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      values = [...values, trimmed];
    }
    input = '';
  }

  function remove(v: string) {
    values = values.filter(x => x !== v);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
    if (e.key === 'Backspace' && !input && values.length) {
      values = values.slice(0, -1);
    }
  }
</script>

<div class="wrap">
  {#each values as v}
    <span class="tag">
      {v}
      <button type="button" class="remove" on:click={() => remove(v)}>×</button>
    </span>
  {/each}
  <input
    bind:value={input}
    on:keydown={onKeydown}
    on:blur={add}
    {placeholder}
    class="input"
  />
</div>

<style>
  .wrap  { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px; min-height: 36px; align-items: center; }
  .tag   { display: flex; align-items: center; gap: 3px; padding: 2px 7px; background: var(--violet-bg); color: var(--violet); border-radius: 9999px; font-size: 0.72rem; }
  .remove{ background: none; border: none; color: var(--violet); cursor: pointer; font-size: 0.85rem; padding: 0; line-height: 1; }
  .input { border: none; background: none; outline: none; font-size: 0.78rem; color: var(--text); flex: 1; min-width: 80px; }
  .input::placeholder { color: var(--text-dim); }
</style>
