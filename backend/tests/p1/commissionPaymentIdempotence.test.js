// tests/p1/commissionPaymentIdempotence.test.js
// Correction commissions — verrou anti double-clic : deux appels concurrents ne créent
// qu'un seul PaymentIntent ; un mois déjà payé refuse un nouveau paiement.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const h = vi.hoisted(() => {
  let n = 0;
  const piCreate = vi.fn(async (params) => {
    n += 1;
    return { id: `pi_dev_${n}`, client_secret: `pi_dev_${n}_secret`, status: 'requires_payment_method', amount: params.amount, metadata: params.metadata };
  });
  const client = {
    paymentIntents: {
      create: piCreate,
      retrieve: vi.fn(async (id) => ({ id, status: 'requires_payment_method', amount: 2000 })),
      cancel: vi.fn(async () => ({}))
    },
    invoices: { create: vi.fn(async () => ({ id: 'in_1' })), finalizeInvoice: vi.fn(async () => ({ id: 'in_1', invoice_pdf: 'http://pdf' })), pay: vi.fn(async () => ({})) },
    invoiceItems: { create: vi.fn(async () => ({})) },
    customers: { create: vi.fn(async () => ({ id: 'cus_1' })) }
  };
  return { client, piCreate };
});
vi.mock('../../utils/stripeDevClient.js', () => ({ getStripeDevClient: async () => h.client, default: async () => h.client }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const Sale = (await import('../../models/Sale.js')).default;
const CommissionPayment = (await import('../../models/CommissionPayment.js')).default;
const { getOrComputeCommissionPayment } = await import('../../services/commissionPaymentService.js');
const { createCommissionIntent } = await import('../../controllers/commissionPaymentController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function pendingPayment() {
  await Sale.create({
    saleId: 'S1', userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: 200, finalPrice: 200 }],
    totalAmount: 200, commissionAmount: 20, commissionRate: 10, itemCount: 1, createdAt: new Date(2026, 0, 15)
  });
  return getOrComputeCommissionPayment(0, 2026);
}

describe('Commission — idempotence paiement', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await CommissionPayment.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); h.piCreate.mockClear(); });

  it('deux appels concurrents → un seul PaymentIntent créé', async () => {
    const doc = await pendingPayment();
    const [r1, r2] = await Promise.all([
      createCommissionIntent({ params: { id: String(doc._id) } }, mockRes()),
      createCommissionIntent({ params: { id: String(doc._id) } }, mockRes())
    ]);
    // Un seul PaymentIntent doit être créé (verrou atomique paymentInProgress).
    expect(h.piCreate).toHaveBeenCalledTimes(1);
    const fresh = await CommissionPayment.findById(doc._id).lean();
    expect(fresh.stripePaymentIntentId).toBe('pi_dev_1');
  });

  it('appels séquentiels → réutilise le même PaymentIntent (pas de second create)', async () => {
    const doc = await pendingPayment();
    await createCommissionIntent({ params: { id: String(doc._id) } }, mockRes());
    await createCommissionIntent({ params: { id: String(doc._id) } }, mockRes());
    expect(h.piCreate).toHaveBeenCalledTimes(1); // 2e appel réutilise le PI actif
  });

  it('mois déjà payé → 409', async () => {
    const doc = await pendingPayment();
    await CommissionPayment.findByIdAndUpdate(doc._id, { status: 'succeeded', settledReason: 'paid', paidAt: new Date() });
    const res = mockRes();
    await createCommissionIntent({ params: { id: String(doc._id) } }, res);
    expect(res.statusCode).toBe(409);
    expect(h.piCreate).not.toHaveBeenCalled();
  });
});
