// tests/p1/commissionCarryOver.test.js
// Correction commissions — carry-over négatif : si déductions > commissions du mois,
// facture 0 € + report (negativeCarryOverAmount) appliqué le mois suivant (plus de
// clamp à 0 qui perdait la déduction).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import RefundRequest from '../../models/RefundRequest.js';
import { getOrComputeCommissionPayment } from '../../services/commissionPaymentService.js';

async function sale({ saleId, total, commission, when }) {
  return Sale.create({
    saleId, userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: total, finalPrice: total }],
    totalAmount: total, commissionAmount: commission, commissionRate: 10, itemCount: 1, createdAt: when
  });
}
async function refundStripe({ refundId, saleId, amount, when }) {
  return RefundRequest.create({
    refundId, saleId, userId: new mongoose.Types.ObjectId(),
    itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount, status: 'succeeded',
    stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: when
  });
}

describe('Commission — carry-over négatif', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('juin : +80 commissions, -120 remboursements → facture 0 €, carry-over 40 €', async () => {
    // Ventes juin = 800€ (commission 10% = 80). Remboursements juin = 1200€ (déduction 120).
    await sale({ saleId: 'SJ', total: 800, commission: 80, when: new Date(2026, 5, 10) });
    await sale({ saleId: 'SJ2', total: 1200, commission: 120, when: new Date(2025, 11, 10) }); // vente déc (hors juin)
    await refundStripe({ refundId: 'RJ', saleId: 'SJ2', amount: 1200, when: new Date(2026, 5, 20) }); // remboursée en juin
    const june = await getOrComputeCommissionPayment(5, 2026);
    expect(june.grossCommissionAmount).toBe(80);
    expect(june.refundDeductionAmount).toBe(120);
    expect(june.netAmountDue).toBe(0);
    expect(june.negativeCarryOverAmount).toBe(40);
    expect(june.status).toBe('succeeded');
    expect(june.settledReason).toBe('settled_zero');
  });

  it('juillet : +100 commissions, carry-over 40 → facture 60 €', async () => {
    // Reproduire juin d'abord (carry-over 40), puis juillet.
    await sale({ saleId: 'SJ', total: 800, commission: 80, when: new Date(2026, 5, 10) });
    await sale({ saleId: 'SJ2', total: 1200, commission: 120, when: new Date(2025, 11, 10) });
    await refundStripe({ refundId: 'RJ', saleId: 'SJ2', amount: 1200, when: new Date(2026, 5, 20) });
    await getOrComputeCommissionPayment(5, 2026); // juin → carry-over 40 stocké

    await sale({ saleId: 'SJUL', total: 1000, commission: 100, when: new Date(2026, 6, 10) });
    const july = await getOrComputeCommissionPayment(6, 2026);
    expect(july.grossCommissionAmount).toBe(100);
    expect(july.carryOverAppliedAmount).toBe(40);
    expect(july.netAmountDue).toBe(60);
    expect(july.negativeCarryOverAmount).toBe(0);
    expect(july.status).toBe('pending');
  });

  it('carry-over partiel : reste reporté si le mois suivant ne l\'absorbe pas entièrement', async () => {
    // Juin carry-over 40 ; juillet +10 commissions → 10-40 = -30 → net 0, carry 30.
    await sale({ saleId: 'SJ', total: 800, commission: 80, when: new Date(2026, 5, 10) });
    await sale({ saleId: 'SJ2', total: 1200, commission: 120, when: new Date(2025, 11, 10) });
    await refundStripe({ refundId: 'RJ', saleId: 'SJ2', amount: 1200, when: new Date(2026, 5, 20) });
    await getOrComputeCommissionPayment(5, 2026);

    await sale({ saleId: 'SJUL', total: 100, commission: 10, when: new Date(2026, 6, 10) });
    const july = await getOrComputeCommissionPayment(6, 2026);
    expect(july.netAmountDue).toBe(0);
    expect(july.negativeCarryOverAmount).toBe(30); // 40 - 10
    expect(july.settledReason).toBe('settled_zero');
  });
});
