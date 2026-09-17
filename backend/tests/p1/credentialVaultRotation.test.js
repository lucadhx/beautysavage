// tests/p1/credentialVaultRotation.test.js
// Vault key rotation: re-encrypt stored credentials from an OLD key to a NEW key.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import IntegratedApi from '../../models/IntegratedApi.js';
import { encryptCredentialWithKey, decryptCredentialWithKey } from '../../utils/credentialVault.js';
import { rotateVaultKey } from '../../scripts/rotateCredentialVaultKey.js';

const OLD = '00'.repeat(32); // 64 hex
const NEW = 'ff'.repeat(32); // 64 hex

async function seedWithOldKey(value) {
  await IntegratedApi.create({
    slug: 'brevo', name: 'Brevo', provider: 'brevo', runtimeModel: 'single', mode: 'test',
    credentials: [{ role: 'api_key', type: 'api_key', runtime: null, encryptedValue: encryptCredentialWithKey(value, OLD), lastFourChars: value.slice(-4), isActive: true }]
  });
}

describe('credentialVault rotation', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('dry-run reports "migrated" but does NOT persist (data still on OLD key)', async () => {
    await seedWithOldKey('VALUE_A');
    const { summary, counts } = await rotateVaultKey({ oldKeyHex: OLD, newKeyHex: NEW, apply: false });
    expect(counts.migrated).toBe(1);
    expect(summary[0]).toMatchObject({ slug: 'brevo', role: 'api_key', runtime: null, status: 'migrated' });
    const doc = await IntegratedApi.findOne({ slug: 'brevo' });
    expect(decryptCredentialWithKey(doc.credentials[0].encryptedValue, OLD)).toBe('VALUE_A');
    expect(() => decryptCredentialWithKey(doc.credentials[0].encryptedValue, NEW)).toThrow();
  });

  it('--apply re-encrypts to the NEW key (old key no longer decrypts)', async () => {
    await seedWithOldKey('VALUE_B');
    const { counts } = await rotateVaultKey({ oldKeyHex: OLD, newKeyHex: NEW, apply: true });
    expect(counts.migrated).toBe(1);
    const doc = await IntegratedApi.findOne({ slug: 'brevo' });
    expect(decryptCredentialWithKey(doc.credentials[0].encryptedValue, NEW)).toBe('VALUE_B');
    expect(() => decryptCredentialWithKey(doc.credentials[0].encryptedValue, OLD)).toThrow();
  });

  it('is idempotent: re-applying skips already-rotated credentials', async () => {
    await seedWithOldKey('VALUE_C');
    await rotateVaultKey({ oldKeyHex: OLD, newKeyHex: NEW, apply: true });
    const second = await rotateVaultKey({ oldKeyHex: OLD, newKeyHex: NEW, apply: true });
    expect(second.counts.migrated).toBe(0);
    expect(second.counts.skipped).toBe(1);
  });

  it('rejects invalid keys', async () => {
    await expect(rotateVaultKey({ oldKeyHex: 'too-short', newKeyHex: NEW })).rejects.toThrow();
    await expect(rotateVaultKey({ oldKeyHex: OLD, newKeyHex: 'nope' })).rejects.toThrow();
  });

  it('never exposes a secret value in the summary', async () => {
    await seedWithOldKey('SENSITIVE_VALUE');
    const { summary } = await rotateVaultKey({ oldKeyHex: OLD, newKeyHex: NEW, apply: false });
    expect(JSON.stringify(summary)).not.toContain('SENSITIVE_VALUE');
  });
});
