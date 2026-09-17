import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from './apiFetch';
import { ApiError } from './types';

function mockFetch(status: number, payload: unknown, ok = status >= 200 && status < 300) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })),
  );
  // Response.ok dérive du status ; pas besoin de forcer `ok`.
  void ok;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('renvoie le JSON parsé sur succès', async () => {
    mockFetch(200, { ok: true, value: 42 });
    const res = await apiFetch<{ ok: boolean; value: number }>('/api/x');
    expect(res.value).toBe(42);
  });

  it('lève une ApiError avec code+status sur réponse non-ok', async () => {
    mockFetch(409, { ok: false, error: 'Complet', code: 'SESSION_FULL' });
    await expect(apiFetch('/api/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'SESSION_FULL',
    });
  });

  it('gère une erreur sans JSON propre (body non parsable)', async () => {
    mockFetch(500, 'oops not json');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});
