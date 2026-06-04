<script lang="ts">
  import { page } from '$app/stores';
</script>

<svelte:head>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; }
  </style>
</svelte:head>

<slot />
