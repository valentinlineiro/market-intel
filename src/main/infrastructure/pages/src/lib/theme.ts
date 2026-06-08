import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'dark' | 'light';

function createThemeStore() {
  const initial: Theme = browser
    ? (localStorage.getItem('theme') as Theme) ?? 'dark'
    : 'dark';

  const { subscribe, set } = writable<Theme>(initial);

  return {
    subscribe,
    toggle() {
      const next: Theme = (browser ? localStorage.getItem('theme') ?? 'dark' : 'dark') === 'dark' ? 'light' : 'dark';
      if (browser) localStorage.setItem('theme', next);
      set(next);
    },
    init() {
      if (!browser) return;
      const saved = (localStorage.getItem('theme') as Theme) ?? 'dark';
      set(saved);
    },
  };
}

export const theme = createThemeStore();
