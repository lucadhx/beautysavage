import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

/**
 * Compteur de demandes de contact NON LUES — source unique pour le badge sidebar.
 *
 * Le compte est calculé PAR LE BACKEND (`GET /unread-count`, léger : un
 * `countDocuments`, jamais la liste entière). Ce contexte le met en cache et
 * expose `refresh()` : la page « Demandes de contact » l'appelle après une lecture
 * ou une résolution, pour que le badge baisse immédiatement — sans polling.
 */
interface ContactUnreadValue {
  count: number;
  refresh: () => void;
}

const ContactUnreadContext = React.createContext<ContactUnreadValue | null>(null);

export function ContactUnreadProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [count, setCount] = React.useState(0);

  const refresh = React.useCallback(() => {
    // ADMIN et DEV voient les demandes ; personne d'autre n'a la route.
    if (!user) return;
    api
      .getContactUnreadCount()
      .then((r) => setCount(r.count))
      .catch((err) => {
        // 403 (rôle sans accès) ou hors-ligne : pas de badge, jamais d'erreur bruyante.
        if (!(err instanceof ApiError)) return;
      });
  }, [user]);

  // Au montage / changement de session : une lecture. Aucun intervalle.
  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ContactUnreadContext.Provider value={{ count, refresh }}>
      {children}
    </ContactUnreadContext.Provider>
  );
}

export function useContactUnread(): ContactUnreadValue {
  const ctx = React.useContext(ContactUnreadContext);
  // Hors provider (tests, écrans publics) : valeur neutre, jamais une exception.
  return ctx ?? { count: 0, refresh: () => {} };
}
