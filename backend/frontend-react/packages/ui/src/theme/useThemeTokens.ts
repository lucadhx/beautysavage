import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeProvider';
import { defaultVitrineTheme } from './defaultVitrineTheme';

/** Renvoie les tokens du thème courant. Hors provider → fallback vitrine (jamais d'erreur). */
export function useThemeTokens(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) return { scope: 'vitrine', tokens: defaultVitrineTheme };
  return ctx;
}
