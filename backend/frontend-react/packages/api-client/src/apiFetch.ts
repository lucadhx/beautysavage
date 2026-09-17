// Client fetch minimal. credentials:'include' (cookie HttpOnly), JSON, erreurs normalisées.
import { API_BASE_URL } from '@bs/config';
import { ApiError } from './types';

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, params?: ApiFetchOptions['params']): string {
  const base = API_BASE_URL ? `${API_BASE_URL}${path}` : path;
  if (!params) return base;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Appel API typé. Renvoie le JSON parsé (typé T) ou lève une ApiError.
 * - credentials:'include' → cookie de session transmis.
 * - non-ok → ApiError { status, code, message, body } construite depuis { code, error }.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, params, signal, headers } = options;
  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new ApiError({ status: 0, code: 'NETWORK', message: 'Erreur réseau.', body: cause });
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Réponse non-JSON : conservée brute dans body.
      parsed = text;
    }
  }

  if (!response.ok) {
    const payload = (parsed && typeof parsed === 'object' ? parsed : {}) as {
      code?: string;
      error?: string;
      message?: string;
    };
    throw new ApiError({
      status: response.status,
      code: payload.code ?? null,
      message: payload.message || payload.error || `HTTP ${response.status}`,
      body: parsed,
    });
  }

  return parsed as T;
}

export const apiGet = <T = unknown>(path: string, params?: ApiFetchOptions['params']): Promise<T> =>
  apiFetch<T>(path, { method: 'GET', params });

export const apiPost = <T = unknown>(path: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'POST', body });

export const apiPatch = <T = unknown>(path: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PATCH', body });

export const apiPut = <T = unknown>(path: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'PUT', body });

export const apiDelete = <T = unknown>(path: string, body?: unknown): Promise<T> =>
  apiFetch<T>(path, { method: 'DELETE', body });

/** Upload multipart (FormData). Ne fixe PAS Content-Type (le boundary est géré par le navigateur). */
export async function apiUpload<T = unknown>(path: string, formData: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path), { method: 'POST', credentials: 'include', body: formData, headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new ApiError({ status: 0, code: 'NETWORK', message: 'Erreur réseau.', body: cause });
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!response.ok) {
    const payload = (parsed && typeof parsed === 'object' ? parsed : {}) as { code?: string; error?: string; message?: string };
    throw new ApiError({ status: response.status, code: payload.code ?? null, message: payload.message || payload.error || `HTTP ${response.status}`, body: parsed });
  }
  return parsed as T;
}
