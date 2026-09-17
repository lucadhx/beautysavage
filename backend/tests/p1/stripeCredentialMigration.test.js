// tests/p1/stripeCredentialMigration.test.js
// Publishable keys (Stripe Institut + Dev) are now sourced from the vault, with
// .env fallback gated by ALLOW_ENV_CREDENTIAL_FALLBACK. Secret keys are never
// exposed by these endpoints.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import IntegratedApi from '../../models/IntegratedApi.js';
import { encryptCredential } from '../../utils/credentialVault.js';
import { getConfig } from '../../controllers/stripeController.js';
import { getStripeDevConfig } from '../../controllers/contractController.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; }
  };
}

async function seedPublishable(slug, value) {
  await IntegratedApi.create({
    slug, name: slug, provider: 'stripe', runtimeModel: 'dual_environment', mode: 'test',
    credentials: [{ role: 'publishable_key', type: 'publishable_key', runtime: 'test', encryptedValue: encryptCredential(value), lastFourChars: value.slice(-4), isActive: true }]
  });
}

describe('Stripe publishable key migration', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('GET /api/stripe/config returns the publishable key from the vault (vault wins over .env)', async () => {
    await seedPublishable('stripe-institut', 'pk_test_VAULT_INSTITUT');
    const prev = process.env.STRIPE_PUBLISHABLE_KEY;
    try {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_ENV_DIFFERENT';
      const res = mockRes();
      await getConfig({}, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.publishableKey).toBe('pk_test_VAULT_INSTITUT');
    } finally {
      process.env.STRIPE_PUBLISHABLE_KEY = prev;
    }
  });

  it('Stripe Dev config returns the publishable key from the vault', async () => {
    await seedPublishable('stripe-dev', 'pk_test_VAULT_DEV');
    const res = mockRes();
    await getStripeDevConfig({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.publishableKey).toBe('pk_test_VAULT_DEV');
  });

  it('falls back to .env ONLY when the flag is enabled', async () => {
    const prevFlag = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
    const prevKey = process.env.STRIPE_PUBLISHABLE_KEY;
    try {
      // Flag OFF + no vault doc → 500 (fail-loud, no silent .env read)
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'false';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_ENV_ONLY';
      const resOff = mockRes();
      await getConfig({}, resOff);
      expect(resOff.statusCode).toBe(500);

      // Flag ON + no vault doc → returns the .env value
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'true';
      const resOn = mockRes();
      await getConfig({}, resOn);
      expect(resOn.statusCode).toBe(200);
      expect(resOn.body.publishableKey).toBe('pk_test_ENV_ONLY');
    } finally {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = prevFlag;
      process.env.STRIPE_PUBLISHABLE_KEY = prevKey;
    }
  });

  it('never returns a secret key (only publishable)', async () => {
    await seedPublishable('stripe-institut', 'pk_test_PUB_ONLY');
    const res = mockRes();
    await getConfig({}, res);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('sk_test');
    expect(serialized).not.toContain('sk_live');
    expect(Object.keys(res.body)).toEqual(['publishableKey']);
  });
});
