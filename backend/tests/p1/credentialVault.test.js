// tests/p1/credentialVault.test.js
// Unit tests for the AES-256-GCM credential vault (no DB needed).
import { describe, it, expect } from 'vitest';
import {
  encryptCredential,
  decryptCredential,
  validateCredentialVaultKey,
  isUnfilledSentinel,
  lastFour
} from '../../utils/credentialVault.js';

describe('credentialVault', () => {
  it('round-trips: decrypt(encrypt(x)) === x', () => {
    const secret = 'sk_test_some_value_123';
    const enc = encryptCredential(secret);
    expect(decryptCredential(enc)).toBe(secret);
  });

  it('two encryptions of the same secret produce different ciphertexts (random IV)', () => {
    const secret = 'identical-secret';
    const a = encryptCredential(secret);
    const b = encryptCredential(secret);
    expect(a).not.toBe(b);
    // both still decrypt to the same plaintext
    expect(decryptCredential(a)).toBe(secret);
    expect(decryptCredential(b)).toBe(secret);
  });

  it('never stores the plaintext in the encrypted blob', () => {
    const secret = 'super-secret-value';
    const enc = encryptCredential(secret);
    expect(enc).not.toContain(secret);
    expect(enc.split('.')).toHaveLength(3); // iv.authTag.ciphertext
  });

  it('detects tampering (auth tag) on decrypt', () => {
    const enc = encryptCredential('tamper-me');
    const [iv, tag, ct] = enc.split('.');
    // Flip a byte of the ciphertext segment
    const tamperedCt = Buffer.from(ct, 'base64');
    tamperedCt[0] = tamperedCt[0] ^ 0xff;
    const tampered = `${iv}.${tag}.${tamperedCt.toString('base64')}`;
    expect(() => decryptCredential(tampered)).toThrow();
  });

  it('rejects malformed encrypted input', () => {
    expect(() => decryptCredential('not-three-segments')).toThrow();
  });

  it('validateCredentialVaultKey returns true with the (fake) test key', () => {
    expect(validateCredentialVaultKey()).toBe(true);
  });

  it('S1C — refuse de démarrer (throw) si clé absente/invalide, dans TOUT environnement', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.CREDENTIAL_VAULT_KEY;
    try {
      // Politique uniforme : aucune logique d'environnement. On teste dev/test ET production.
      for (const env of ['test', 'development', 'production', undefined]) {
        if (env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = env;

        delete process.env.CREDENTIAL_VAULT_KEY;
        expect(() => validateCredentialVaultKey()).toThrow(/Refusing to boot/i);

        process.env.CREDENTIAL_VAULT_KEY = 'too-short';
        expect(() => validateCredentialVaultKey()).toThrow(/Refusing to boot/i);
      }
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevEnv;
      if (prevKey === undefined) delete process.env.CREDENTIAL_VAULT_KEY;
      else process.env.CREDENTIAL_VAULT_KEY = prevKey;
    }
  });

  it('helpers: sentinel detection and lastFour', () => {
    expect(isUnfilledSentinel('__UNFILLED__')).toBe(true);
    expect(isUnfilledSentinel('__UNFILLED_BREVO__')).toBe(true);
    expect(isUnfilledSentinel('a-real-non-sentinel-value')).toBe(false);
    expect(lastFour('abcdef')).toBe('cdef');
  });
});
