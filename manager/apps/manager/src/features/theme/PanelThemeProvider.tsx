import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ThemeProvider, mapBackendThemeToTokens } from '@bs/ui';
import { getThemeByScope } from '@bs/api-client';

// Charge le thème scope=manager (best-effort) puis applique le ThemeProvider scope=panel.
// Fallback systématique sur defaultPanelTheme (aucune config backend → theme:null → surcharge vide).
export function PanelThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ['panel-theme'],
    queryFn: ({ signal }) => getThemeByScope('manager', signal),
    retry: false,
    staleTime: 5 * 60_000,
  });

  return (
    <ThemeProvider scope="panel" theme={mapBackendThemeToTokens(data)}>
      {children}
    </ThemeProvider>
  );
}
