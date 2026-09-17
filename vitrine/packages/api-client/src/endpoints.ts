// Endpoints minimaux R0 : session uniquement (boot auth). Aucun appel métier complexe.
import { apiFetch, apiPost } from './apiFetch';
import { ApiError, type AuthUser, type ApiResult } from './types';

/** GET /auth/me → utilisateur courant, ou null si non authentifié (401). */
export async function getSession(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const res = await apiFetch<ApiResult<{ user: AuthUser }>>('/auth/me', { signal });
    return res.user ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** POST /auth/logout. */
export async function logout(): Promise<void> {
  await apiPost('/auth/logout');
}
