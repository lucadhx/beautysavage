// Types partagés du client API. Le serveur fait foi (montants jamais recalculés côté client).

/** Rôles backend (inchangés). Relabel UI dans `@bs/auth`, pas ici. */
export type Role = 'client' | 'admin' | 'dev';

/** Montant en euros (Number, 2 décimales). Formatage à l'affichage (Intl fr-FR). */
export type MoneyAmount = number;

/** Date ISO 8601 en transport. */
export type DateIso = string;

/** Utilisateur authentifié (réponse de GET /auth/me). */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  currentMode?: string;
  createdAt?: DateIso;
  isActive?: boolean;
  mustChangePassword?: boolean;
  emailVerified?: boolean;
}

/** Enveloppe de succès générique : { ok:true, ...data }. */
export type ApiResult<T> = { ok: true } & T;

/** Erreur API normalisée (issue de { ok:false, error, code } ou d'un échec réseau). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: unknown;

  constructor(params: { status: number; code?: string | null; message: string; body?: unknown }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code ?? null;
    this.body = params.body ?? null;
  }
}
