import * as React from 'react';
import { api, hasSession } from '@/lib/api';
import type { Role, RoleAppearance, RoleStyle } from '@/types';

interface Ctx {
  appearance: RoleAppearance | null;
  styleFor: (role: Role) => RoleStyle;
  set: (a: RoleAppearance) => void;
  reload: () => Promise<void>;
}

const RoleAppearanceContext = React.createContext<Ctx | null>(null);

// Couleurs de secours (identiques aux défauts serveur) le temps du chargement
// ou hors authentification.
const FALLBACK: Record<Role, RoleStyle> = {
  DEV: { background: '#7c3aed', foreground: '#ffffff' },
  ADMIN: { background: '#2563eb', foreground: '#ffffff' },
};

/**
 * Apparence des badges de rôle (couleurs), pilotée depuis un compte DEV.
 * Chargée une fois authentifié ; `reload()` est appelé après connexion et
 * après une sauvegarde côté DEV.
 */
export function RoleAppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] = React.useState<RoleAppearance | null>(null);

  const reload = React.useCallback(async () => {
    // Pas de session -> aucune requête authentifiée (401 garanti sur /login).
    if (!hasSession()) return;
    try {
      setAppearance(await api.getRoleAppearance());
    } catch {
      /* non authentifié — garde le secours */
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  const styleFor = React.useCallback(
    (role: Role): RoleStyle => appearance?.roles?.[role] || FALLBACK[role] || FALLBACK.ADMIN,
    [appearance]
  );

  const value = React.useMemo(
    () => ({ appearance, styleFor, set: setAppearance, reload }),
    [appearance, styleFor, reload]
  );

  return (
    <RoleAppearanceContext.Provider value={value}>{children}</RoleAppearanceContext.Provider>
  );
}

export function useRoleAppearance() {
  const ctx = React.useContext(RoleAppearanceContext);
  if (!ctx) throw new Error('useRoleAppearance must be used within RoleAppearanceProvider');
  return ctx;
}
