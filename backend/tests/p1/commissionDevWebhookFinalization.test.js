// tests/p1/commissionDevWebhookFinalization.test.js
// Correction commissions — le webhook Stripe Dev finalise les PaymentIntents de
// commission (source serveur de vérité). Idempotent au replay. Le polling reste un
// fallback (même finaliseur partagé).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const h = vi.hoisted(() => {
  const client = {
    webhooks: { constructEvent: (body) => JSON.parse(body.toString()) },
    paymentIntents: { retrieve: vi.fn(async (id) => ({ id, status: 'succeeded', amount: 2000 })) },
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
const EventLog = (await import('../../models/EventLog.js')).default;
const { getOrComputeCommissionPayment } = await import('../../services/commissionPaymentService.js');
const { finalizeCommissionPaymentById } = await import('../../controllers/commissionPaymentController.js');
const { handleDevWebhook } = await import('../../controllers/devWebhookController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function pendingPayment() {
  await Sale.create({
    saleId: 'S1', userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: 200, finalPrice: 200 }],
    totalAmount: 200, commissionAmount: 20, commissionRate: 10, itemCount: 1, createdAt: new Date(2026, 0, 15)
  });
  const doc = await getOrComputeCommissionPayment(0, 2026);
  await CommissionPayment.findByIdAndUpdate(doc._id, { stripePaymentIntentId: 'pi_dev_commission_1', paymentInProgress: true });
  return CommissionPayment.findById(doc._id).lean();
}
function commissionEvent(commissionPaymentId) {
  return JSON.stringify({
    id: 'evt_1', type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_dev_commission_1', metadata: { type: 'commission', commissionPaymentId: String(commissionPaymentId) } } }
  });
}

describe('Commission — finalisation par webhook Dev', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); vi.clearAllMocks(); });

  it('finalizeCommissionPaymentById marque payé + commission.paid (idempotent)', async () => {
    const doc = await pendingPayment();
    const r1 = await finalizeCommissionPaymentById(doc._id);
    expect(r1.ok).toBe(true);
    const after = await CommissionPayment.findById(doc._id).lean();
    expect(after.status).toBe('succeeded');
    expect(after.settledReason).toBe('paid');
    expect(after.paymentInProgress).toBe(false);
    expect(await EventLog.countDocuments({ eventName: 'commission.paid' })).toBe(1);

    // Replay → idempotent (pas de second event).
    const r2 = await finalizeCommissionPaymentById(doc._id);
    expect(r2.idempotent).toBe(true);
    expect(await EventLog.countDocuments({ eventName: 'commission.paid' })).toBe(1);
  });

  it('webhook Dev payment_intent.succeeded (commission) → CommissionPayment payé', async () => {
    const doc = await pendingPayment();
    const res = mockRes();
    await handleDevWebhook({ headers: { 'stripe-signature': 'sig' }, body: commissionEvent(doc._id) }, res);
    expect(res.statusCode).toBe(200);
    const after = await CommissionPayment.findById(doc._id).lean();
    expect(after.status).toBe('succeeded');
    expect(after.settledReason).toBe('paid');
  });

  it('replay du même webhook → idempotent (pas de double finalisation)', async () => {
    const doc = await pendingPayment();
    await handleDevWebhook({ headers: { 'stripe-signature': 'sig' }, body: commissionEvent(doc._id) }, mockRes());
    await handleDevWebhook({ headers: { 'stripe-signature': 'sig' }, body: commissionEvent(doc._id) }, mockRes());
    expect(await EventLog.countDocuments({ eventName: 'commission.paid' })).toBe(1);
    const after = await CommissionPayment.findById(doc._id).lean();
    expect(after.status).toBe('succeeded');
  });
});
