// Environnement front — valeurs NON secrètes uniquement.
// Le base URL est vide par défaut (same-origin via proxy Vite `/api`+`/auth`).
// Override possible via VITE_API_BASE si l'API est servie sur une origine dédiée.

export type AppKind = 'vitrine' | 'manager';

interface ViteEnvLike {
  VITE_API_BASE?: string;
  VITE_APP_KIND?: string;
}

// import.meta.env est injecté par Vite ; en test (jsdom) on retombe sur des valeurs sûres.
const rawEnv: ViteEnvLike =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: ViteEnvLike }).env) || {};

/** Base URL de l'API. Vide = same-origin (proxy). Jamais une clé/secret. */
export const API_BASE_URL: string = (rawEnv.VITE_API_BASE ?? '').replace(/\/$/, '');

/** Type d'app courante. Renseigné par chaque app via VITE_APP_KIND. */
export const APP_KIND: AppKind = rawEnv.VITE_APP_KIND === 'manager' ? 'manager' : 'vitrine';

/** Préfixes de l'API backend (cf. app.js : `/auth` hors `/api`). */
export const AUTH_BASE = '/auth';
export const API_BASE = '/api';
