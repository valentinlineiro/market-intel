<script lang="ts">
  import { theme } from '$lib/theme.js';
  import { onMount } from 'svelte';

  onMount(() => theme.init());
</script>

<svelte:head>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #111827;
      --bg-card:   #1f2937;
      --bg-input:  #374151;
      --border:    #374151;
      --border-sub:#1f2937;
      --text:      #f9fafb;
      --text-sub:  #9ca3af;
      --text-muted:#6b7280;
      --text-dim:  #4b5563;
      --accent:    #10b981;
      --accent-bg: #064e3b;
      --violet:    #a78bfa;
      --violet-bg: #2e1065;
      --amber:     #f59e0b;
      --amber-bg:  #1c1917;
      --blue:      #60a5fa;
      --blue-bg:   #1e3a5f;
      --red:       #f87171;
      --red-bg:    #3b1f1f;
    }

    :root.light {
      --bg:        #f8fafc;
      --bg-card:   #ffffff;
      --bg-input:  #f1f5f9;
      --border:    #e2e8f0;
      --border-sub:#f1f5f9;
      --text:      #0f172a;
      --text-sub:  #475569;
      --text-muted:#94a3b8;
      --text-dim:  #cbd5e1;
      --accent:    #059669;
      --accent-bg: #dcfce7;
      --violet:    #7c3aed;
      --violet-bg: #ede9fe;
      --amber:     #d97706;
      --amber-bg:  #fef3c7;
      --blue:      #2563eb;
      --blue-bg:   #dbeafe;
      --red:       #dc2626;
      --red-bg:    #fee2e2;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
    }
  </style>
</svelte:head>

<slot />
