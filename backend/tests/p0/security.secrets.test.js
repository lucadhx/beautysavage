// tests/p0/security.secrets.test.js
// P0 (Phase 1A — FIXED): hardcoded fallback secrets (e.g. 'beautysavage-gift-card-secret',
// 'beautysavage-email-verification-secret') were removed. Required secrets now go
// through utils/secretEnv.js#requireSecret, which throws (refuses an insecure
// default) when neither the primary var nor its fallback is set.
import { describe, it, expect } from 'vitest';
import { requireSecret } from '../../utils/secretEnv.js';

describe('P0 — required secrets have no insecure hardcoded fallback', () => {
  it('returns the primary value when set', () => {
    process.env.__SEC_PRIMARY = 'value-a';
    try {
      expect(requireSecret('__SEC_PRIMARY')).toBe('value-a');
    } finally {
      delete process.env.__SEC_PRIMARY;
    }
  });

  it('uses the fallback env var when the primary is missing', () => {
    delete process.env.__SEC_PRIMARY;
    process.env.__SEC_FALLBACK = 'value-b';
    try {
      expect(requireSecret('__SEC_PRIMARY', { fallback: '__SEC_FALLBACK' })).toBe('value-b');
    } finally {
      delete process.env.__SEC_FALLBACK;
    }
  });

  it('THROWS when neither primary nor fallback is set (no public default key)', () => {
    delete process.env.__SEC_PRIMARY;
    delete process.env.__SEC_FALLBACK;
    expect(() => requireSecret('__SEC_PRIMARY', { fallback: '__SEC_FALLBACK' })).toThrow(/required/i);
  });

  it('GIFT_CARD_PASSWORD_SECRET resolves in the configured (test) environment', () => {
    // The harness sets a fake GIFT_CARD_PASSWORD_SECRET; SESSION_SECRET also covers it.
    expect(requireSecret('GIFT_CARD_PASSWORD_SECRET', { fallback: 'SESSION_SECRET' })).toBeTruthy();
  });

  it('email-verification secret resolves (EMAIL_VERIFICATION_SECRET or SESSION_SECRET)', () => {
    expect(requireSecret('EMAIL_VERIFICATION_SECRET', { fallback: 'SESSION_SECRET' })).toBeTruthy();
  });

  it('never returns a known hardcoded legacy default', () => {
    const giftSecret = requireSecret('GIFT_CARD_PASSWORD_SECRET', { fallback: 'SESSION_SECRET' });
    expect(giftSecret).not.toBe('beautysavage-gift-card-secret');
  });
});
