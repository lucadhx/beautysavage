import { createContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ThemeScope, ThemeTokens, PartialThemeTokens } from './themeTypes';
import { defaultVitrineTheme } from './defaultVitrineTheme';
import { defaultPanelTheme } from './defaultPanelTheme';
import { applyThemeVars, mergeTheme } from './themeCssVariables';

export interface ThemeContextValue {
  scope: ThemeScope;
  tokens: ThemeTokens;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEFAULTS: Record<ThemeScope, ThemeTokens> = {
  vitrine: defaultVitrineTheme,
  panel: defaultPanelTheme,
};

export interface ThemeProviderProps {
  scope: ThemeScope;
  /** Surcharge partielle (ex. thème backend vitrine). Fusionnée sur le défaut du scope. */
  theme?: PartialThemeTokens | null;
  /** Élément cible des CSS variables (défaut : <html>). */
  target?: HTMLElement | null;
  children: ReactNode;
}

/** Fournit les tokens du scope + applique les CSS variables `--bs-*`. Jamais bloquant (fallback). */
export function ThemeProvider({ scope, theme, target, children }: ThemeProviderProps) {
  const tokens = useMemo(() => mergeTheme(DEFAULTS[scope], theme), [scope, theme]);

  useEffect(() => {
    applyThemeVars(tokens, target);
  }, [tokens, target]);

  const value = useMemo<ThemeContextValue>(() => ({ scope, tokens }), [scope, tokens]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
