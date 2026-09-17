// RX-GO-2 — Validation auth pure.
import { describe, it, expect } from 'vitest';
import { isEmailValid, passwordError, normalizeCode, isCodeComplete } from './validation';

describe('auth validation', () => {
  it('isEmailValid', () => {
    expect(isEmailValid('a@b.fr')).toBe(true);
    expect(isEmailValid('bad')).toBe(false);
    expect(isEmailValid('a@b')).toBe(false);
  });
  it('passwordError applique 8 + lettre + chiffre', () => {
    expect(passwordError('short1')).toMatch(/8/);
    expect(passwordError('longenough')).toMatch(/lettre|chiffre/);
    expect(passwordError('12345678')).toMatch(/lettre|chiffre/);
    expect(passwordError('abcd1234')).toBeNull();
  });
  it('normalizeCode garde 6 chiffres max', () => {
    expect(normalizeCode('12ab34cd56789')).toBe('123456');
    expect(isCodeComplete('123456')).toBe(true);
    expect(isCodeComplete('123')).toBe(false);
  });
});
