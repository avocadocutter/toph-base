import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

const mql = window.matchMedia('(prefers-color-scheme: dark)');

function applyThemeClass(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && mql.matches);
  document.documentElement.classList.toggle('dark', dark);
}

interface UiState {
  sidebarCollapsed: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      theme: 'dark',
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setTheme: (theme) => {
        applyThemeClass(theme);
        set({ theme });
      },
      cycleTheme: () => {
        const order: Theme[] = ['light', 'dark', 'system'];
        const next = order[(order.indexOf(get().theme) + 1) % order.length];
        applyThemeClass(next);
        set({ theme: next });
      },
    }),
    { name: 'toph-ui' },
  ),
);

// Sync DOM after hydration from localStorage.
const unsub = useUiStore.persist.onFinishHydration((state) => {
  applyThemeClass(state.theme);
  unsub();
});
if (useUiStore.persist.hasHydrated()) {
  applyThemeClass(useUiStore.getState().theme);
}

// React to OS preference changes when theme is 'system'.
mql.addEventListener('change', () => {
  const { theme } = useUiStore.getState();
  if (theme === 'system') applyThemeClass('system');
});

// Subscribe to OS dark mode preference for reactive hooks.
function subscribeSystemDark(cb: () => void) {
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}
function getSystemDark() {
  return mql.matches;
}

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useUiStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark);
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}
