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
      if (!browser) return;
      const next: Theme = (localStorage.getItem('theme') ?? 'dark') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('light', next === 'light');
      set(next);
    },
    init() {
      if (!browser) return;
      const saved = (localStorage.getItem('theme') as Theme) ?? 'dark';
      document.documentElement.classList.toggle('light', saved === 'light');
      set(saved);
    },
  };
}

export const theme = createThemeStore();
