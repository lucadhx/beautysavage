// tests/p1/stripeWebhookCredentialVault.test.js
// Stripe webhook signature verification now sources the webhook_secret from the
// vault (stripe-institut / stripe-dev). Raw body and signature scheme unchanged.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

// MockStripe whose webhooks.constructEvent records the secret it received then
// throws (invalid signature). This lets us assert WHICH secret was used without
// running any business logic, and exercises the "invalid signature -> 400" path.
const constructEventMock = vi.fn(() => {
  throw new Error('mock invalid signature');
});
vi.mock('stripe', () => {
  class MockStripe {
    constructor() {
      this.webhooks = { constructEvent: constructEventMock };
    }
  }
  return { default: MockStripe };
});

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const IntegratedApi = (await import('../../models/IntegratedApi.js')).default;
const { encryptCredential } = await import('../../utils/credentialVault.js');
const { handleWebhook } = await import('../../controllers/stripeController.js');
const { handleDevWebhook } = await import('../../controllers/devWebhookController.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; }
  };
}
function mockReq() {
  return { headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: Buffer.from('{"id":"evt_test"}') };
}

async function seedStripe(slug, { withWebhook = true } = {}) {
  const creds = [
    { role: 'secret_key', type: 'secret_key', runtime: 'test', encryptedValue: encryptCredential(`sk_test_${slug}_vault`), lastFourChars: 'ault', isActive: true }
  ];
  if (withWebhook) {
    creds.push({ role: 'webhook_secret', type: 'webhook_secret', runtime: 'test', encryptedValue: encryptCredential(`whsec_${slug}_VAULT`), lastFourChars: 'AULT', isActive: true });
  }
  await IntegratedApi.create({ slug, name: slug, provider: 'stripe', runtimeModel: 'dual_environment', mode: 'test', credentials: creds });
}

describe('Stripe webhook secret from vault', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    constructEventMock.mockClear();
  });

  it('Institut webhook verifies with the VAULT secret (wins over .env) and refuses bad signatures', async () => {
    await seedStripe('stripe-institut');
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_ENV_DIFFERENT';
      const res = mockRes();
      await handleWebhook(mockReq(), res);
      // constructEvent received the vault secret, not the env one
      expect(constructEventMock).toHaveBeenCalledTimes(1);
      expect(constructEventMock.mock.calls[0][2]).toBe('whsec_stripe-institut_VAULT');
      // mock throws -> invalid signature path -> 400
      expect(res.statusCode).toBe(400);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = prev;
    }
  });

  it('Dev webhook verifies with the VAULT secret (wins over .env)', async () => {
    await seedStripe('stripe-dev');
    const prev = process.env.STRIPE_DEV_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_DEV_WEBHOOK_SECRET = 'whsec_DEV_ENV_DIFFERENT';
      const res = mockRes();
      await handleDevWebhook(mockReq(), res);
      expect(constructEventMock).toHaveBeenCalledTimes(1);
      expect(constructEventMock.mock.calls[0][2]).toBe('whsec_stripe-dev_VAULT');
      expect(res.statusCode).toBe(400);
    } finally {
      process.env.STRIPE_DEV_WEBHOOK_SECRET = prev;
    }
  });

  it('Institut webhook returns a controlled 500 when the secret is missing (flag off, no vault webhook_secret)', async () => {
    await seedStripe('stripe-institut', { withWebhook: false }); // secret_key present so getStripe() works
    const prevFlag = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
    try {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'false';
      const res = mockRes();
      await handleWebhook(mockReq(), res);
      expect(res.statusCode).toBe(500);
      expect(constructEventMock).not.toHaveBeenCalled();
    } finally {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = prevFlag;
    }
  });

  it('Dev webhook returns a controlled 500 when the secret is missing (flag off)', async () => {
    await seedStripe('stripe-dev', { withWebhook: false });
    const prevFlag = process.env.ALLOW_ENV_CREDENTIAL_FALLBACK;
    try {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = 'false';
      const res = mockRes();
      await handleDevWebhook(mockReq(), res);
      expect(res.statusCode).toBe(500);
      expect(constructEventMock).not.toHaveBeenCalled();
    } finally {
      process.env.ALLOW_ENV_CREDENTIAL_FALLBACK = prevFlag;
    }
  });

  it('never logs a secret value', async () => {
    await seedStripe('stripe-institut');
    const spies = [
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {})
    ];
    try {
      await handleWebhook(mockReq(), mockRes());
      const logged = spies.flatMap(s => s.mock.calls.flat()).join(' ');
      expect(logged).not.toContain('whsec_stripe-institut_VAULT');
    } finally {
      spies.forEach(s => s.mockRestore());
    }
  });
});
