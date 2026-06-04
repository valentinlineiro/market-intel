<script lang="ts">
  import type { ActionData } from './$types';
  export let form: ActionData;
</script>

<svelte:head><title>Login — Market Intel</title></svelte:head>

<div class="login-container">
  <h1>Market Intel</h1>
  <form method="POST">
    <label for="password">Contraseña</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" />
    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}
    <button type="submit">Entrar</button>
  </form>
</div>

<style>
  .login-container {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; min-height: 100vh;
    background: #020817; color: #e2e8f0; gap: 24px;
  }
  h1 { font-size: 1.5rem; font-weight: 700; color: #f1f5f9; }
  form { display: flex; flex-direction: column; gap: 12px; width: 280px; }
  label { font-size: 0.75rem; color: #64748b; }
  input { padding: 10px; background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem; }
  button { padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .error { color: #f87171; font-size: 0.8rem; }
</style>
