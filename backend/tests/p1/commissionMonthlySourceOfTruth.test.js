// tests/p1/commissionMonthlySourceOfTruth.test.js
// Correction commissions — computeCommissionsForPeriod / getOrComputeCommissionPayment
// = source UNIQUE de la facture mensuelle. Base = prix payé (carte cadeau incluse,
// promo incluse). Remboursement du mois → ligne négative référençant refund + sale.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import RefundRequest from '../../models/RefundRequest.js';
import {
  computeCommissionsForPeriod,
  getOrComputeCommissionPayment
} from '../../services/commissionPaymentService.js';

const M0 = [new Date(2026, 0, 1), new Date(2026, 1, 1)];

async function saleFormation({ saleId, total, commission, giftCardTotal = 0 }) {
  return Sale.create({
    saleId, userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: total, finalPrice: total }],
    totalAmount: total, commissionAmount: commission, commissionRate: 10, itemCount: 1,
    giftCardUsage: giftCardTotal > 0 ? [{ giftCardId: new mongoose.Types.ObjectId(), code: 'GC', amountUsed: giftCardTotal }] : [],
    createdAt: new Date(2026, 0, 15)
  });
}

describe('Commission — source unique mensuelle', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('commission sur prix payé carte cadeau 100 % incluse', async () => {
    await saleFormation({ saleId: 'S1', total: 200, commission: 20, giftCardTotal: 200 });
    const r = await computeCommissionsForPeriod(...M0);
    expect(r.grossCommissionAmount).toBe(20);
    expect(r.total).toBe(20);
  });

  it('promotion incluse : la commission snapshotée (prix réduit) est sommée telle quelle', async () => {
    // vente promue : finalPrice 150 → commission 15 (snapshot). La source somme le snapshot.
    await saleFormation({ saleId: 'S2', total: 150, commission: 15 });
    const r = await computeCommissionsForPeriod(...M0);
    expect(r.grossCommissionAmount).toBe(15);
  });

  it('remboursement du mois → ligne négative avec refundId + saleId', async () => {
    const s = await saleFormation({ saleId: 'S3', total: 200, commission: 20 });
    const refund = await RefundRequest.create({
      refundId: 'R3', saleId: s.saleId, userId: new mongoose.Types.ObjectId(),
      itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 100, status: 'succeeded',
      stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: new Date(2026, 0, 20)
    });
    const r = await computeCommissionsForPeriod(...M0);
    expect(r.refundDeductionAmount).toBe(10); // 100/200 * 20
    expect(r.refundEntries).toHaveLength(1);
    expect(String(r.refundEntries[0].refundId)).toBe(String(refund._id));
    expect(String(r.refundEntries[0].saleId)).toBe(String(s._id));
  });

  it('getOrComputeCommissionPayment persiste gross/refundDeduction/netAmountDue', async () => {
    const s = await saleFormation({ saleId: 'S4', total: 200, commission: 20 });
    await RefundRequest.create({
      refundId: 'R4', saleId: s.saleId, userId: new mongoose.Types.ObjectId(),
      itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 100, status: 'succeeded',
      stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: new Date(2026, 0, 20)
    });
    const doc = await getOrComputeCommissionPayment(0, 2026);
    expect(doc.grossCommissionAmount).toBe(20);
    expect(doc.refundDeductionAmount).toBe(10);
    expect(doc.netAmountDue).toBe(10);
    expect(doc.amount).toBe(10); // compat
    expect(doc.status).toBe('pending');
    expect(doc.refunds).toHaveLength(1);
  });

  it('le ledger CommissionTransaction n\'est PAS la source de facturation (non lu)', async () => {
    // Une vente sans CommissionTransaction mais avec Sale.commissionAmount est facturée.
    await saleFormation({ saleId: 'S5', total: 200, commission: 20 });
    const doc = await getOrComputeCommissionPayment(0, 2026);
    expect(doc.netAmountDue).toBe(20);
  });
});
