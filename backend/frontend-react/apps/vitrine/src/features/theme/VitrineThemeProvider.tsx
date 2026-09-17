import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ThemeProvider } from '@bs/ui';
import { getVitrineTheme } from '@bs/api-client';
import { mapVitrineThemeToTokens } from './vitrineThemeAdapter';

// Charge le thème vitrine backend (best-effort) puis applique le ThemeProvider scope=vitrine.
// Fallback systématique sur defaultVitrineTheme tant que les données ne sont pas là / en erreur.
export function VitrineThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ['vitrine-theme'],
    queryFn: ({ signal }) => getVitrineTheme(signal),
    retry: false,
    staleTime: 5 * 60_000,
  });

  return (
    <ThemeProvider scope="vitrine" theme={mapVitrineThemeToTokens(data)}>
      {children}
    </ThemeProvider>
  );
}
