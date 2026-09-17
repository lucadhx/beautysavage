// tests/p1/commissionRefundConsistency.test.js
// Sprint pré-React A5 — Cohérence des commissions après remboursement, quel que soit
// le moyen de paiement.
//   - remboursement 100 % carte cadeau → la commission EST déduite (correction du trou)
//   - remboursement Stripe → déduit (régression)
//   - provision de remboursement → commission.adjusted + transaction négative
//   - vente déjà payée puis remboursée → commission.reversal_required
//   - remboursement échoué/annulé → commission.cancelled (provision annulée)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import RefundRequest from '../../models/RefundRequest.js';
import CommissionTransaction from '../../models/CommissionTransaction.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import EventLog from '../../models/EventLog.js';
import { computeCommissionsForPeriod } from '../../services/commissionPaymentService.js';
import {
  ensureRefundCommissionProvision,
  ensureRefundCommissionReversal
} from '../../services/refundService.js';

const PERIOD_START = new Date(2026, 0, 1);
const PERIOD_END = new Date(2026, 1, 1);

async function seedSaleWithCommission({ saleId = 'S-COMM-1', commissionAmount = 20, totalAmount = 100 } = {}) {
  return Sale.create({
    saleId,
    userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: totalAmount, finalPrice: totalAmount }],
    totalAmount,
    commissionAmount,
    itemCount: 1,
    createdAt: new Date(2026, 0, 15)
  });
}

describe('A5 — commission consistency after refund', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('deducts commission for a 100% gift-card refund (fixes the gift-card hole)', async () => {
    const sale = await seedSaleWithCommission();
    await RefundRequest.create({
      refundId: 'REF-GC-1',
      saleId: sale.saleId,
      userId: sale.userId,
      itemId: new mongoose.Types.ObjectId(),
      itemType: 'formation',
      amount: 100,
      status: 'succeeded',
      stripeRefundStatus: 'not_applicable',
      giftCardRefundStatus: 'succeeded',
      giftCardRecredited: true,
      refundedAt: new Date(2026, 0, 20)
    });

    const { refundEntries, total } = await computeCommissionsForPeriod(PERIOD_START, PERIOD_END);
    expect(refundEntries).toHaveLength(1);
    expect(refundEntries[0].commissionAmount).toBe(20); // full refund → full deduction
    expect(total).toBe(0); // 20 sales - 20 refund
  });

  it('still deducts commission for a Stripe refund', async () => {
    const sale = await seedSaleWithCommission({ saleId: 'S-COMM-2' });
    await RefundRequest.create({
      refundId: 'REF-ST-1',
      saleId: sale.saleId,
      userId: sale.userId,
      itemId: new mongoose.Types.ObjectId(),
      itemType: 'formation',
      amount: 50, // half refund
      status: 'succeeded',
      stripeRefundStatus: 'succeeded',
      stripeRefundConfirmedAt: new Date(2026, 0, 18)
    });

    const { refundEntries } = await computeCommissionsForPeriod(PERIOD_START, PERIOD_END);
    expect(refundEntries).toHaveLength(1);
    expect(refundEntries[0].commissionAmount).toBe(10); // 50/100 * 20
  });

  it('emits commission.adjusted and writes a negative transaction on provision', async () => {
    const formationId = new mongoose.Types.ObjectId();
    await seedSaleWithCommission({ saleId: 'S-COMM-3' });
    await CommissionTransaction.create({
      saleId: 'S-COMM-3', formationId, formationName: 'F', sourceType: 'sale',
      commissionType: 'fixed', commissionValue: 20, commissionAmount: 20
    });
    const refund = await RefundRequest.create({
      refundId: 'REF-ADJ-1', saleId: 'S-COMM-3', userId: new mongoose.Types.ObjectId(),
      itemId: formationId, itemType: 'formation', formationId, amount: 100, status: 'requested'
    });

    const row = await ensureRefundCommissionProvision(refund);
    expect(row.commissionAmount).toBe(-20);
    const adjusted = await EventLog.find({ eventName: 'commission.adjusted' }).lean();
    expect(adjusted).toHaveLength(1);
    // No reversal_required when the sale's commission month is not yet paid.
    expect(await EventLog.countDocuments({ eventName: 'commission.reversal_required' })).toBe(0);
  });

  it('emits commission.reversal_required when the sale commission was already paid', async () => {
    const formationId = new mongoose.Types.ObjectId();
    const sale = await seedSaleWithCommission({ saleId: 'S-COMM-4' });
    await CommissionTransaction.create({
      saleId: 'S-COMM-4', formationId, formationName: 'F', sourceType: 'sale',
      commissionType: 'fixed', commissionValue: 20, commissionAmount: 20
    });
    // The commission of the sale's month is already paid → can't reduce a settled invoice.
    const saleDate = new Date(sale.createdAt);
    await CommissionPayment.create({
      month: saleDate.getMonth(), year: saleDate.getFullYear(),
      periodStart: PERIOD_START, periodEnd: PERIOD_END, amount: 20, status: 'succeeded'
    });
    const refund = await RefundRequest.create({
      refundId: 'REF-REV-1', saleId: 'S-COMM-4', userId: new mongoose.Types.ObjectId(),
      itemId: formationId, itemType: 'formation', formationId, amount: 100, status: 'requested'
    });

    await ensureRefundCommissionProvision(refund);
    expect(await EventLog.countDocuments({ eventName: 'commission.reversal_required' })).toBe(1);
  });

  it('emits commission.cancelled when a provision is reversed (refund failed)', async () => {
    const formationId = new mongoose.Types.ObjectId();
    await seedSaleWithCommission({ saleId: 'S-COMM-5' });
    await CommissionTransaction.create({
      saleId: 'S-COMM-5', formationId, formationName: 'F', sourceType: 'sale',
      commissionType: 'fixed', commissionValue: 20, commissionAmount: 20
    });
    const refund = await RefundRequest.create({
      refundId: 'REF-CXL-1', saleId: 'S-COMM-5', userId: new mongoose.Types.ObjectId(),
      itemId: formationId, itemType: 'formation', formationId, amount: 100, status: 'requested'
    });
    await ensureRefundCommissionProvision(refund); // negative provision exists
    await ensureRefundCommissionReversal(refund); // refund failed → restore commission
    expect(await EventLog.countDocuments({ eventName: 'commission.cancelled' })).toBe(1);
    const reversal = await CommissionTransaction.findOne({ refundId: 'REF-CXL-1', sourceType: 'refund_reversal' }).lean();
    expect(reversal.commissionAmount).toBe(20); // positive, cancels the -20 provision
  });
});
