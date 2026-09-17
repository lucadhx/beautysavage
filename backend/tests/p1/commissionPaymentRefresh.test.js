// tests/p1/commissionPaymentRefresh.test.js
// Correction commissions — le montant est RECALCULÉ avant la création du PaymentIntent
// (plus de montant figé). netAmountDue === 0 → settled_zero, aucun PaymentIntent.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const h = vi.hoisted(() => {
  const piCreate = vi.fn(async (params) => ({
    id: 'pi_dev_1', client_secret: 'pi_dev_1_secret', status: 'requires_payment_method',
    amount: params.amount, metadata: params.metadata
  }));
  const client = {
    paymentIntents: { create: piCreate, retrieve: vi.fn(async () => ({ id: 'x', status: 'canceled', amount: 0 })), cancel: vi.fn(async () => ({})) },
    invoices: { create: vi.fn(async () => ({ id: 'in_1' })), finalizeInvoice: vi.fn(async () => ({ id: 'in_1', invoice_pdf: 'http://pdf' })), pay: vi.fn(async () => ({})) },
    invoiceItems: { create: vi.fn(async () => ({})) },
    customers: { create: vi.fn(async () => ({ id: 'cus_1' })) }
  };
  return { client, piCreate };
});
vi.mock('../../utils/stripeDevClient.js', () => ({ getStripeDevClient: async () => h.client, default: async () => h.client }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const Sale = (await import('../../models/Sale.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const CommissionPayment = (await import('../../models/CommissionPayment.js')).default;
const { getOrComputeCommissionPayment } = await import('../../services/commissionPaymentService.js');
const { createCommissionIntent } = await import('../../controllers/commissionPaymentController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function sale({ saleId, total, commission }) {
  return Sale.create({
    saleId, userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: total, finalPrice: total }],
    totalAmount: total, commissionAmount: commission, commissionRate: 10, itemCount: 1, createdAt: new Date(2026, 0, 15)
  });
}

describe('Commission — refresh avant paiement', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); h.piCreate.mockClear(); });

  it('recalcule le montant avant le PaymentIntent (montant figé corrigé)', async () => {
    const s = await sale({ saleId: 'S1', total: 200, commission: 20 });
    const doc = await getOrComputeCommissionPayment(0, 2026); // net 20, pending
    expect(doc.netAmountDue).toBe(20);

    // Remboursement réglé APRÈS création du doc → sans refresh le montant resterait 20.
    await RefundRequest.create({
      refundId: 'R1', saleId: s.saleId, userId: new mongoose.Types.ObjectId(),
      itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 100, status: 'succeeded',
      stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: new Date(2026, 0, 20)
    });

    const res = mockRes();
    await createCommissionIntent({ params: { id: String(doc._id) } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    // PaymentIntent créé avec le montant RECALCULÉ (10 € = 1000 cents), pas 2000.
    expect(h.piCreate).toHaveBeenCalledTimes(1);
    expect(h.piCreate.mock.calls[0][0].amount).toBe(1000);
    const fresh = await CommissionPayment.findById(doc._id).lean();
    expect(fresh.netAmountDue).toBe(10);
  });

  it('netAmountDue === 0 → settled_zero, aucun PaymentIntent', async () => {
    const s = await sale({ saleId: 'S2', total: 200, commission: 20 });
    const doc = await getOrComputeCommissionPayment(0, 2026);
    // Remboursement total → net 0 après refresh.
    await RefundRequest.create({
      refundId: 'R2', saleId: s.saleId, userId: new mongoose.Types.ObjectId(),
      itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 200, status: 'succeeded',
      stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: new Date(2026, 0, 20)
    });
    const res = mockRes();
    await createCommissionIntent({ params: { id: String(doc._id) } }, res);
    expect(res.body.settledZero).toBe(true);
    expect(h.piCreate).not.toHaveBeenCalled();
    const fresh = await CommissionPayment.findById(doc._id).lean();
    expect(fresh.status).toBe('succeeded');
    expect(fresh.settledReason).toBe('settled_zero');
  });
});
