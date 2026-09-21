import * as React from 'react';
import { api, hasSession } from '@/lib/api';
import type { SiteStatus } from '@/types';

interface Ctx {
  status: SiteStatus | null;
  reload: () => Promise<void>;
  set: (s: SiteStatus) => void;
}

const SiteStatusContext = React.createContext<Ctx | null>(null);

export function SiteStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SiteStatus | null>(null);

  const reload = React.useCallback(async () => {
    // Pas de session -> aucune requête authentifiée (401 garanti sur /login).
    if (!hasSession()) return;
    try {
      setStatus(await api.getSiteStatus());
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  return (
    <SiteStatusContext.Provider value={{ status, reload, set: setStatus }}>
      {children}
    </SiteStatusContext.Provider>
  );
}

export function useSiteStatus() {
  const ctx = React.useContext(SiteStatusContext);
  if (!ctx) throw new Error('useSiteStatus must be used within SiteStatusProvider');
  return ctx;
}
