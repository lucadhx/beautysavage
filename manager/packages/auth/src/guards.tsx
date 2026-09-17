import { Navigate, Outlet } from 'react-router-dom';
import { LoadingState, ErrorState } from '@bs/ui';
import type { Role } from '@bs/api-client';
import { useAuth } from './AuthProvider';

export interface RequireAuthProps {
  /** Où rediriger un visiteur non authentifié. */
  loginPath?: string;
}

/** Bloque l'accès si non authentifié (l'autorité reste le backend 401/403). */
export function RequireAuth({ loginPath = '/connexion' }: RequireAuthProps) {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingState label="Vérification de la session…" />;
  if (status === 'anonymous') return <Navigate to={loginPath} replace />;
  return <Outlet />;
}

export interface RequireRoleProps {
  /** Rôles backend autorisés (client/admin/dev). */
  allow: Role[];
  loginPath?: string;
  /** Où rediriger si authentifié mais rôle insuffisant (sinon écran refus). */
  deniedPath?: string;
}

/** Bloque l'accès si le rôle n'est pas autorisé. UX seulement — le backend tranche. */
export function RequireRole({ allow, loginPath = '/connexion', deniedPath }: RequireRoleProps) {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingState label="Vérification des droits…" />;
  if (status === 'anonymous' || !user) return <Navigate to={loginPath} replace />;
  if (!allow.includes(user.role)) {
    return deniedPath ? <Navigate to={deniedPath} replace /> : <ErrorState title="Accès réservé." />;
  }
  return <Outlet />;
}
