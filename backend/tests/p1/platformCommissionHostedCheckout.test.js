// tests/p1/platformCommissionHostedCheckout.test.js
// Sprint U3 — Commission hébergée : UnifiedCheckout kind=commission + Session Dev avec metadata
// (unifiedCheckoutId, commissionPaymentId) ; cas netAmountDue=0 → settled_zero (aucune Session).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { updateSystemConfiguration, invalidateSystemConfigurationCache } from '../../services/system/systemConfigurationService.js';
import mongoose from 'mongoose';

const h = vi.hoisted(() => ({ client: null, sessionArgs: null, sessionCalls: 0 }));
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

describe('U3 — commission hosted checkout', () => {
  let prevNgrok;
  beforeAll(async () => { const uri = await startMemoryDb(); await mongoose.connect(uri, { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => {
    await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); await UnifiedCheckout.syncIndexes();
    h.sessionArgs = null; h.sessionCalls = 0;
    h.client = {
      paymentIntents: { create: async () => ({ id: 'pi', client_secret: 'cs', amount: 2000 }), retrieve: async id => ({ id, status: 'requires_payment_method', amount: 2000 }), cancel: async () => ({}) },
      checkout: { sessions: { create: async args => { h.sessionCalls += 1; h.sessionArgs = args; return { id: 'cs_dev_X', url: 'https://checkout.stripe.com/dev/X', payment_intent: 'pi_dev_X' }; } } }
    };
    process.env.PLATFORM_CHECKOUT_HOSTED = 'true';
  });
  afterEach(() => { process.env.PLATFORM_CHECKOUT_HOSTED = 'false'; });

  it('netAmountDue>0 → Session Dev + UnifiedCheckout commission + metadata', async () => {
    await Sale.create({ saleId: 'S1', userId: new mongoose.Types.ObjectId(), items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: 200, finalPrice: 200 }], totalAmount: 200, commissionAmount: 20, commissionRate: 10, itemCount: 1, createdAt: new Date(2026, 0, 15) });
    const doc = await getOrComputeCommissionPayment(0, 2026);
    const res = mockRes();
    await createCommissionIntent({ params: { id: String(doc._id) }, sessionUser: { _id: ADMIN } }, res);
    expect(res.body.mode).toBe('hosted');
    expect(h.sessionCalls).toBe(1);
    expect(h.sessionArgs.mode).toBe('payment');
    expect(h.sessionArgs.line_items[0].price_data.unit_amount).toBe(2000);
    expect(h.sessionArgs.payment_intent_data.metadata.commissionPaymentId).toBe(String(doc._id));
    expect(h.sessionArgs.metadata.unifiedCheckoutId).toBe(res.body.checkoutId);
    expect(h.sessionArgs.metadata.kind).toBe('commission');
    const uc = await UnifiedCheckout.findOne({ checkoutId: res.body.checkoutId }).lean();
    expect(uc.kind).toBe('commission');
    expect(uc.payment.provider).toBe('stripe_dev');
    expect(uc.payment.stripePaymentIntentId).toBe('pi_dev_X');
    // CommissionPayment lié au PI (pour le polling check-status)
    const cp = await CommissionPayment.findById(doc._id).lean();
    expect(cp.stripePaymentIntentId).toBe('pi_dev_X');
  });

  it('netAmountDue=0 → settled_zero, aucune Session', async () => {
    const doc = await getOrComputeCommissionPayment(5, 2026); // mois sans vente → 0
    const res = mockRes();
    await createCommissionIntent({ params: { id: String(doc._id) }, sessionUser: { _id: ADMIN } }, res);
    expect(res.body).toMatchObject({ ok: true, settledZero: true });
    expect(h.sessionCalls).toBe(0);
  });
});
