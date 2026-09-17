// RX-GO-2 — Endpoints auth (signup/verify/resend/reset). Réutilise les routes backend existantes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { signup, verifyEmail, resendVerification, validateResetToken, completePasswordReset } from './auth';

function json(p: unknown, status = 200) { return new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json' } }); }
const calls: { url: string; init?: RequestInit }[] = [];
function installFetch(p: unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return json(p, status); }));
}
afterEach(() => vi.unstubAllGlobals());

describe('auth api (RX-GO-2)', () => {
  it('signup poste email/password/passwordConfirm', async () => {
    installFetch({ ok: true, email: 'a@b.fr', resendAfterSeconds: 30 });
    const res = await signup('a@b.fr', 'abcd1234', 'abcd1234');
    expect(res.email).toBe('a@b.fr');
    expect(calls[0].url).toContain('/auth/signup');
    expect(String(calls[0].init?.body)).toContain('passwordConfirm');
  });
  it('verifyEmail poste email+code', async () => {
    installFetch({ ok: true, role: 'client' });
    const res = await verifyEmail('a@b.fr', '123456');
    expect(res.role).toBe('client');
    expect(calls[0].url).toContain('/auth/verify-email');
  });
  it('resendVerification renvoie le cooldown', async () => {
    installFetch({ ok: true, resendAfterSeconds: 30 });
    const res = await resendVerification('a@b.fr');
    expect(res.resendAfterSeconds).toBe(30);
    expect(calls[0].url).toContain('/auth/resend-verification');
  });
  it('validateResetToken cible /password-reset/validate', async () => {
    installFetch({ ok: true, expiresAt: 'x' });
    await validateResetToken('tok');
    expect(calls[0].url).toContain('/auth/password-reset/validate');
  });
  it('completePasswordReset poste token+password', async () => {
    installFetch({ ok: true });
    await completePasswordReset('tok', 'abcd1234');
    expect(calls[0].url).toContain('/auth/password-reset/complete');
    expect(String(calls[0].init?.body)).toContain('abcd1234');
  });
});
