// tests/p1/integratedApiCredentials.test.js
// Credential service: vault priority, runtime resolution, env-fallback gating.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import IntegratedApi from '../../models/IntegratedApi.js';
import { encryptCredential } from '../../utils/credentialVault.js';
import {
  getCredential,
  getCredentials,
  setIntegratedApiMode,
  IntegratedApiNotFoundError
} from '../../services/integratedApiCredentialService.js';

async function seedStripeInstitut() {
  await IntegratedApi.create({
    slug: 'stripe-institut',
    name: 'Stripe Institut',
    provider: 'stripe',
    runtimeModel: 'dual_environment',
    mode: 'test',
    credentials: [
      { role: 'secret_key', type: 'secret_key', runtime: 'test', encryptedValue: encryptCredential('VAULT_TEST_SECRET'), lastFourChars: 'cret', isActive: true },
      { role: 'secret_key', type: 'secret_key', runtime: 'prod', encryptedValue: encryptCredential('VAULT_PROD_SECRET'), lastFourChars: 'cret', isActive: true }
    ]
  });
}

describe('integratedApiCredentialService', () => {
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

  it('vault takes priority over .env (coffre prioritaire)', async () => {
    await seedStripeInstitut();
    const prev = process.env.STRIPE_SECRET_KEY;
    try {
      process.env.STRIPE_SECRET_KEY = 'ENV_VALUE_SHOULD_NOT_WIN';
      const value = await getCredential('stripe-institut', { role: 'secret_key', runtime: 'test' });
      expect(value).toBe('VAULT_TEST_SECRET');
    } finally {
      process.env.STRIPE_SECRET_KEY = prev;
    }
  });

  it('respects runtime test/prod selection', async () => {
    await seedStripeInstitut();
    expect(await getCredential('stripe-institut', { role: 'secret_key', runtime: 'test' })).toBe('VAULT_TEST_SECRET');
    expect(await getCredential('stripe-institut', { role: 'secret_key', runtime: 'prod' })).toBe('VAULT_PROD_SECRET');
  });

  it('resolves runtime from integration.mode when none is passed', async () => {
    await seedStripeInstitut();
    await setIntegratedApiMode('stripe-institut', 'prod');
    expect(await getCredential('stripe-institut', { role: 'secret_key' })).toBe('VAULT_PROD_SECRET');
  });

  it('getCredentials returns all active roles for the resolved runtime', async () => {
    await IntegratedApi.create({
      slug: 'brevo', name: 'Brevo', provider: 'brevo', runtimeModel: 'single', mode: 'test',
      credentials: [{ role: 'api_key', type: 'api_key', runtime: null, encryptedValue: encryptCredential('VAULT_BREVO'), lastFourChars: 'revo', isActive: true }]
    });
    const creds = await getCredentials('brevo');
    expect(creds).toEqual({ api_key: 'VAULT_BREVO' });
  });

  it('env fallback is DISABLED by default (fail-loud)', async () => {
    const prev = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
    try {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'false';
      // No vault doc for brevo → must throw, never silently read .env
      await expect(getCredential('brevo', { role: 'api_key' })).rejects.toBeInstanceOf(IntegratedApiNotFoundError);
    } finally {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = prev;
    }
  });

  it('env fallback works ONLY when the flag is enabled', async () => {
    const prevFlag = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
    const prevKey = process.env.BREVO_API_KEY;
    try {
      process.env.BREVO_API_KEY = 'ENV_BREVO_FALLBACK';
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'true';
      // No vault doc → fallback returns the env value
      expect(await getCredential('brevo', { role: 'api_key' })).toBe('ENV_BREVO_FALLBACK');
    } finally {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = prevFlag;
      process.env.BREVO_API_KEY = prevKey;
    }
  });

  it('never logs a secret value (fallback path logs only slug/role/env name)', async () => {
    const prevFlag = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
    const prevKey = process.env.BREVO_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      process.env.BREVO_API_KEY = 'TOP_SECRET_VALUE_XYZ';
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'true';
      await getCredential('brevo', { role: 'api_key' });
      const loggedAll = warnSpy.mock.calls.flat().join(' ');
      expect(loggedAll).not.toContain('TOP_SECRET_VALUE_XYZ');
    } finally {
      warnSpy.mockRestore();
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = prevFlag;
      process.env.BREVO_API_KEY = prevKey;
    }
  });

  it('setIntegratedApiMode updates the mode', async () => {
    await seedStripeInstitut();
    const out = await setIntegratedApiMode('stripe-institut', 'prod');
    expect(out.mode).toBe('prod');
    const reloaded = await IntegratedApi.findOne({ slug: 'stripe-institut' });
    expect(reloaded.mode).toBe('prod');
    expect(reloaded.modeUpdatedAt).toBeInstanceOf(Date);
  });
});
