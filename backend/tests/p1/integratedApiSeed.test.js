// tests/p1/integratedApiSeed.test.js
// Seeder: creates stripe-institut / stripe-dev / brevo from .env, idempotently,
// with encrypted values (never clear), and never logs a secret.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import IntegratedApi from '../../models/IntegratedApi.js';
import { decryptCredential } from '../../utils/credentialVault.js';
import { seedIntegratedApisFromEnv } from '../../seeders/seedIntegratedApisFromEnv.js';
import { getCredential } from '../../services/integratedApiCredentialService.js';

describe('seedIntegratedApisFromEnv', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await stopMemoryDb();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('creates the three integrations with the expected shape', async () => {
    await seedIntegratedApisFromEnv();

    const institut = await IntegratedApi.findOne({ slug: 'stripe-institut' });
    expect(institut).toBeTruthy();
    expect(institut.provider).toBe('stripe');
    expect(institut.runtimeModel).toBe('dual_environment');
    expect(institut.mode).toBe('test'); // sk_test_ prefix detected
    expect(institut.credentials).toHaveLength(3);
    for (const c of institut.credentials) {
      expect(c.isActive).toBe(true);
      expect(c.runtime).toBe('test');
    }

    const dev = await IntegratedApi.findOne({ slug: 'stripe-dev' });
    expect(dev).toBeTruthy();
    expect(dev.runtimeModel).toBe('dual_environment');
    expect(dev.credentials).toHaveLength(3);

    const brevo = await IntegratedApi.findOne({ slug: 'brevo' });
    expect(brevo).toBeTruthy();
    expect(brevo.runtimeModel).toBe('single');
    expect(brevo.credentials).toHaveLength(1);
    expect(brevo.credentials[0].runtime).toBeNull();
  });

  it('stores values encrypted (never clear) and a masked lastFour', async () => {
    await seedIntegratedApisFromEnv();
    const brevo = await IntegratedApi.findOne({ slug: 'brevo' });
    const cred = brevo.credentials[0];
    const rawEnv = process.env.BREVO_API_KEY;
    expect(cred.encryptedValue).not.toBe(rawEnv);
    expect(cred.encryptedValue).not.toContain(rawEnv);
    expect(decryptCredential(cred.encryptedValue)).toBe(rawEnv);
    expect(cred.lastFourChars.length).toBeLessThanOrEqual(4);
  });

  it('is idempotent (re-running does not duplicate credentials)', async () => {
    await seedIntegratedApisFromEnv();
    const second = await seedIntegratedApisFromEnv();
    expect(second.seeded).toHaveLength(0); // nothing new
    const institut = await IntegratedApi.findOne({ slug: 'stripe-institut' });
    expect(institut.credentials).toHaveLength(3); // not 6
  });

  it('feeds the credential service (vault now resolves)', async () => {
    await seedIntegratedApisFromEnv();
    expect(await getCredential('brevo', { role: 'api_key' })).toBe(process.env.BREVO_API_KEY);
    expect(await getCredential('stripe-institut', { role: 'secret_key', runtime: 'test' })).toBe(process.env.STRIPE_SECRET_KEY);
  });

  it('never logs a secret value during seeding', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await seedIntegratedApisFromEnv();
      const logged = logSpy.mock.calls.flat().join(' ');
      expect(logged).not.toContain(process.env.STRIPE_SECRET_KEY);
      expect(logged).not.toContain(process.env.BREVO_API_KEY);
    } finally {
      logSpy.mockRestore();
    }
  });
});
