// tests/p1/platformCheckoutWebhookFinalization.test.js
// Sprint U3 — Webhook Dev : checkout.session.completed réconcilie l'UnifiedCheckout ; la
// finalisation commission reste assurée par payment_intent.succeeded EXISTANT (finalizeCommissionPaymentById),
// idempotent au replay. Stripe Institut non impacté.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const h = vi.hoisted(() => {
  const client = {
    webhooks: { constructEvent: body => JSON.parse(body.toString()) },
    paymentIntents: { retrieve: vi.fn(async id => ({ id, status: 'succeeded', amount: 2000 })) },
    invoices: { create: vi.fn(async () => ({ id: 'in_1' })), finalizeInvoice: vi.fn(async () => ({ id: 'in_1', invoice_pdf: 'http://pdf' })), pay: vi.fn(async () => ({})) },
    invoiceItems: { create: vi.fn(async () => ({})) },
    customers: { create: vi.fn(async () => ({ id: 'cus_1' })) }
  };
  return { client };
});
vi.mock('../../utils/stripeDevClient.js', () => ({ getStripeDevClient: async () => h.client, default: async () => h.client }));
vi.mock('../../services/integratedApiCredentialService.js', () => ({ getCredential: async () => 'whsec_test_dev' }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const Sale = (await import('../../models/Sale.js')).default;
const CommissionPayment = (await import('../../models/CommissionPayment.js')).default;
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { getOrComputeCommissionPayment } = await import('../../services/commissionPaymentService.js');
const { createPlatformUnifiedCheckoutRecord } = await import('../../services/checkout/unified/unifiedCheckoutFactory.js');
const { handleDevWebhook } = await import('../../controllers/devWebhookController.js');

function mockRes() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }

describe('U3 — webhook Dev hosted finalization', () => {
  beforeAll(async () => { const uri = await startMemoryDb(); await mongoose.connect(uri, { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await UnifiedCheckout.syncIndexes(); vi.clearAllMocks(); });

  it('checkout.session.completed → réconcilie l\'UnifiedCheckout (finalized)', async () => {
    const { checkout } = await createPlatformUnifiedCheckoutRecord({ kind: 'commission', amountToPay: 20, source: 'platform_commission', inputSnapshot: { commissionPaymentId: 'x' } });
    const body = JSON.stringify({ id: 'evt', type: 'checkout.session.completed', data: { object: { metadata: { unifiedCheckoutId: checkout.checkoutId }, payment_intent: 'pi_dev_X' } } });
    const res = mockRes();
    await handleDevWebhook({ headers: { 'stripe-signature': 'sig' }, body: Buffer.from(body) }, res);
    expect(res.statusCode).toBe(200);
    const uc = await UnifiedCheckout.findOne({ checkoutId: checkout.checkoutId }).lean();
    expect(uc.status).toBe('finalized');
    expect(uc.payment.status).toBe('succeeded');
  });

  it('commission payment_intent.succeeded → finalise (existant) ; replay idempotent', async () => {
    await Sale.create({ saleId: 'S1', userId: new mongoose.Types.ObjectId(), items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: 200, finalPrice: 200 }], totalAmount: 200, commissionAmount: 20, commissionRate: 10, itemCount: 1, createdAt: new Date(2026, 0, 15) });
    const doc = await getOrComputeCommissionPayment(0, 2026);
    const body = JSON.stringify({ id: 'evt2', type: 'payment_intent.succeeded', data: { object: { id: 'pi_dev_commission', metadata: { type: 'commission', commissionPaymentId: String(doc._id) } } } });
    await handleDevWebhook({ headers: { 'stripe-signature': 'sig' }, body: Buffer.from(body) }, mockRes());
    let cp = await CommissionPayment.findById(doc._id).lean();
    expect(cp.status).toBe('succeeded');
    const paidAt = cp.paidAt;
    // replay → reste succeeded, paidAt inchangé (idempotent)
    await handleDevWebhook({ headers: { 'stripe-signature': 'sig' }, body: Buffer.from(body) }, mockRes());
    cp = await CommissionPayment.findById(doc._id).lean();
    expect(cp.status).toBe('succeeded');
    expect(String(cp.paidAt)).toBe(String(paidAt));
  });

  it('Stripe Institut non impacté : metadata inconnue → 200 received', async () => {
    const body = JSON.stringify({ id: 'evt3', type: 'checkout.session.completed', data: { object: { metadata: {}, payment_intent: 'pi_unknown' } } });
    const res = mockRes();
    await handleDevWebhook({ headers: { 'stripe-signature': 'sig' }, body: Buffer.from(body) }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
