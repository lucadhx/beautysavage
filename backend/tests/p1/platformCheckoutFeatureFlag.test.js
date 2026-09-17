// tests/p1/platformCheckoutFeatureFlag.test.js
// Sprint U3 — Feature flag PLATFORM_CHECKOUT_HOSTED : false ⇒ ancien flow Dev (clientSecret) ;
// true ⇒ Stripe Checkout hébergé (url). Cas commission.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { updateSystemConfiguration, invalidateSystemConfigurationCache } from '../../services/system/systemConfigurationService.js';
import mongoose from 'mongoose';

const h = vi.hoisted(() => ({ client: null }));
vi.mock('../../utils/stripeDevClient.js', () => ({ getStripeDevClient: async () => h.client, default: async () => h.client }));
vi.mock('../../services/integratedApiCredentialService.js', () => ({ getCredential: async () => 'whsec_test_dev' }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const Sale = (await import('../../models/Sale.js')).default;
const CommissionPayment = (await import('../../models/CommissionPayment.js')).default;
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { getOrComputeCommissionPayment } = await import('../../services/commissionPaymentService.js');
const { createCommissionIntent } = await import('../../controllers/commissionPaymentController.js');

const ADMIN = new mongoose.Types.ObjectId();
function mockRes() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }
function fakeClient() {
  return {
    paymentIntents: { create: async () => ({ id: 'pi_dev', client_secret: 'cs_dev_secret', amount: 2000 }), retrieve: async id => ({ id, status: 'requires_payment_method', amount: 2000 }), cancel: async () => ({}) },
    checkout: { sessions: { create: async () => ({ id: 'cs_dev_1', url: 'https://checkout.stripe.com/dev/1', payment_intent: 'pi_dev_hosted' }) } }
  };
}
async function pendingPayment() {
  await Sale.create({ saleId: 'S1', userId: new mongoose.Types.ObjectId(), items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: 200, finalPrice: 200 }], totalAmount: 200, commissionAmount: 20, commissionRate: 10, itemCount: 1, createdAt: new Date(2026, 0, 15) });
  return getOrComputeCommissionPayment(0, 2026);
}

describe('U3 — flag PLATFORM_CHECKOUT_HOSTED (commission)', () => {
  let prev, prevNgrok;
  beforeAll(async () => { const uri = await startMemoryDb(); await mongoose.connect(uri, { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => { await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); await UnifiedCheckout.syncIndexes(); h.client = fakeClient(); prev = process.env.PLATFORM_CHECKOUT_HOSTED; });
  afterEach(() => { process.env.PLATFORM_CHECKOUT_HOSTED = prev; });

  it('flag false → clientSecret (ancien flow Dev inchangé)', async () => {
    process.env.PLATFORM_CHECKOUT_HOSTED = 'false';
    const doc = await pendingPayment();
    const res = mockRes();
    await createCommissionIntent({ params: { id: String(doc._id) }, sessionUser: { _id: ADMIN } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.clientSecret).toBe('cs_dev_secret');
    expect(res.body.mode).toBeUndefined();
    expect(await UnifiedCheckout.countDocuments({})).toBe(0);
  });

  it('flag true → mode hosted + url (pas de clientSecret)', async () => {
    process.env.PLATFORM_CHECKOUT_HOSTED = 'true';
    const doc = await pendingPayment();
    const res = mockRes();
    await createCommissionIntent({ params: { id: String(doc._id) }, sessionUser: { _id: ADMIN } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: 'hosted' });
    expect(res.body.url).toBe('https://checkout.stripe.com/dev/1');
    expect(res.body.checkoutId).toBeTruthy();
    expect(res.body.clientSecret).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/sk_|cs_dev_secret|whsec_/);
  });
});
