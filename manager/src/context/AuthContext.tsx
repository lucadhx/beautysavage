import * as React from 'react';
import { toast } from 'sonner';

import { ApiError, api, tokenStore } from '@/lib/api';
import { clearCompanyCache } from '@/context/CompanyContext';
import { stopLiveChannel } from '@/lib/liveInvalidation';
import { isPanelPrincipal } from '@/types';
import type { User } from '@/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /**
   * Le serveur n'a pas pu répondre — la session n'est PAS invalidée pour
   * autant. L'écran doit proposer de réessayer, pas renvoyer au login.
   */
  unreachable: boolean;
  isDev: boolean;
  login: (email: string, password: string) => Promise<void>;
  setSession: (token: string, user: User) => void;
  updateUser: (user: User) => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [unreachable, setUnreachable] = React.useState(false);

  /**
   * LA PROVENANCE DE LA SESSION QUI VIENT DE TOMBER.
   *
   * Une `ref` et non un état : au moment où l'on apprend le refus, `user` est
   * sur le point d'être vidé, et lire l'état donnerait la valeur d'après. On
   * retient donc la provenance au fil de l'eau, pour pouvoir dire à un DEV
   * fédéré POURQUOI il vient d'être déconnecté.
   */
  const etaitFedere = React.useRef(false);

  const loadUser = React.useCallback(async () => {
    if (!tokenStore.get()) {
      etaitFedere.current = false;
      setUser(null);
      setUnreachable(false);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      etaitFedere.current = isPanelPrincipal(me);
      setUser(me);
      setUnreachable(false);
    } catch (err) {
      /**
       * « JE N'AI PAS PU DEMANDER » N'EST PAS « TU N'ES PLUS CONNECTÉ ».
       *
       * Ce `catch` effaçait le jeton sur N'IMPORTE QUEL échec. Un backend qui
       * redémarre, un flux qui coupe la connexion, une passerelle qui répond
       * 502 : l'utilisateur se retrouvait au login, session détruite, alors
       * qu'aucun serveur n'avait jamais contesté son identité. Cela annulait
       * au passage la prudence déjà en place côté client HTTP, qui ne purge
       * que sur un 401 confirmé par `/auth/me`.
       *
       * Seul un refus EXPLICITE (401/403) déconnecte. Tout le reste laisse la
       * session intacte et signale que le serveur est injoignable.
       */
      const refus = err instanceof ApiError && (err.status === 401 || err.status === 403);
      if (refus) {
        /**
         * UN ACCÈS FÉDÉRÉ RÉVOQUÉ N'EST PAS UNE SESSION EXPIRÉE (L12.B-UI).
         *
         * Quand le Panel désactive un compte, retire son accès au projet ou
         * incrémente sa version de session, la revalidation du backend refuse
         * — et l'utilisateur se retrouverait au login sans rien comprendre,
         * persuadé d'un bug. Le dire coûte une phrase et évite un ticket.
         *
         * Le message reste vrai dans tous les cas de révocation : ce n'est pas
         * une panne, c'est une décision prise ailleurs.
         */
        if (etaitFedere.current) {
          toast.error('Votre accès L.Y Solution à ce projet n’est plus actif.');
        }
        tokenStore.clear();
        setUser(null);
        setUnreachable(false);
      } else {
        setUnreachable(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = React.useCallback(async (email: string, password: string) => {
    const { token, user: u } = await api.login(email, password);
    tokenStore.set(token);
    // Une connexion locale n'est jamais fédérée : la remise à zéro évite qu'un
    // refus ultérieur soit attribué au Panel.
    etaitFedere.current = false;
    setUser(u);
    setUnreachable(false);
  }, []);

  const setSession = React.useCallback((token: string, u: User) => {
    tokenStore.set(token);
    etaitFedere.current = isPanelPrincipal(u);
    setUser(u);
  }, []);

  const logout = React.useCallback(() => {
    tokenStore.clear();
    /**
     * LE FLUX APPARTIENT À LA SESSION QUI SE TERMINE.
     *
     * Il n'était refermé nulle part. Trois conséquences, toutes réelles :
     * une connexion longue survivait à la déconnexion avec le jeton capturé à
     * son ouverture ; une reconnexion sous un AUTRE compte retombait sur ce
     * flux-là, puisque le canal se croyait déjà ouvert ; et le backend gardait
     * un abonné pour un utilisateur parti.
     *
     * Le flux se ferme AVANT l'oubli de l'identité : l'ordre évite qu'une
     * invalidation en vol ne rappelle une API qui n'a plus de jeton.
     */
    stopLiveChannel();
    // L'identité mémorisée appartient à la session qui se termine.
    clearCompanyCache();
    etaitFedere.current = false;
    setUser(null);
    setUnreachable(false);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      unreachable,
      isDev: user?.role === 'DEV',
      login,
      setSession,
      updateUser: setUser,
      logout,
      refresh: loadUser,
    }),
    [user, loading, unreachable, login, setSession, logout, loadUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
