import { create } from 'zustand';

type Theme = 'dark' | 'light';

function initial(): Theme {
  try {
    const saved = localStorage.getItem('sims-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sims-theme', t); } catch { /* ignore */ }
}

export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => {
  const theme = initial();
  apply(theme);
  return {
    theme,
    toggle() {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      apply(next);
      set({ theme: next });
    },
  };
});
