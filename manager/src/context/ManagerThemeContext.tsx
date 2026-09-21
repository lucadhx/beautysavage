import * as React from 'react';
import { api, hasSession } from '@/lib/api';
import type { ManagerTheme } from '@/types';

interface Ctx {
  theme: ManagerTheme | null;
  apply: (t: ManagerTheme) => void;
  reload: () => Promise<void>;
}

const ManagerThemeContext = React.createContext<Ctx | null>(null);

const VAR_MAP: Record<string, string> = {
  primary: '--m-primary',
  primaryForeground: '--m-primary-foreground',
  accent: '--m-accent',
  accentForeground: '--m-accent-foreground',
  background: '--m-background',
  foreground: '--m-foreground',
  muted: '--m-muted',
  mutedForeground: '--m-muted-foreground',
  border: '--m-border',
  sidebar: '--m-sidebar',
  sidebarForeground: '--m-sidebar-foreground',
};

export function applyManagerTheme(theme: ManagerTheme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    const cssVar = VAR_MAP[key];
    if (cssVar) root.style.setProperty(cssVar, value as string);
  }
  root.style.setProperty('--m-radius', theme.radius || '0.5rem');
}

export function ManagerThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<ManagerTheme | null>(null);

  const apply = React.useCallback((t: ManagerTheme) => {
    setTheme(t);
    applyManagerTheme(t);
  }, []);

  const reload = React.useCallback(async () => {
    // Pas de session -> aucune requête authentifiée (401 garanti sur /login).
    if (!hasSession()) return;
    try {
      const t = await api.getManagerTheme();
      apply(t);
    } catch {
      /* not authenticated yet — ignore */
    }
  }, [apply]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  return (
    <ManagerThemeContext.Provider value={{ theme, apply, reload }}>
      {children}
    </ManagerThemeContext.Provider>
  );
}

export function useManagerTheme() {
  const ctx = React.useContext(ManagerThemeContext);
  if (!ctx) throw new Error('useManagerTheme must be used within ManagerThemeProvider');
  return ctx;
}
