import * as React from 'react';
import { api, API_ROOT } from '@/lib/api';

interface Ctx {
  backendUrl: string;
  websiteUrl: string;
  loading: boolean;
  refresh: () => Promise<void>;
}

const NetworkConfigContext = React.createContext<Ctx | null>(null);

// Valeur de secours issue des URL actuelles (VITE_API_URL / origine courante).
const fallback = {
  backendUrl: API_ROOT || (typeof window !== 'undefined' ? window.location.origin : ''),
  websiteUrl: '',
};

/**
 * Fournit les URL réseau publiques (backend + vitrine) pour les liens
 * applicatifs (« Voir la vitrine ») et la résolution des médias. Chargé une
 * seule fois via l'endpoint public ; `refresh()` est appelé après une
 * sauvegarde DEV de la configuration réseau.
 */
export function NetworkConfigProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = React.useState(fallback);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const net = await api.getPublicNetwork();
      setValue({ backendUrl: net.backendUrl || fallback.backendUrl, websiteUrl: net.websiteUrl || '' });
    } catch {
      /* garde le secours */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <NetworkConfigContext.Provider value={{ ...value, loading, refresh }}>
      {children}
    </NetworkConfigContext.Provider>
  );
}

export function useNetworkConfiguration() {
  const ctx = React.useContext(NetworkConfigContext);
  if (!ctx) throw new Error('useNetworkConfiguration must be used within NetworkConfigProvider');
  return ctx;
}
