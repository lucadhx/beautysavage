// tests/p1/financeNetProfit.test.js
// RX2.3 — Profit net = montant payé − frais Stripe − commission Dev (formation) − remboursements.
// Statut partial si frais Stripe en attente (jamais d'estimation).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import RefundRequest from '../../models/RefundRequest.js';
import CommissionTransaction from '../../models/CommissionTransaction.js';
import { buildFinanceMovementDetail } from '../../services/finance/financeMovementDetailService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.3 — profit net', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('formation 100 € − frais 3 € − commission 10 € − remboursement 20 € = 67 € (complete)', async () => {
    await Sale.create({ saleId: 'S-NET', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'formation', itemId: oid(), name: 'F', finalPrice: 100 }], stripePaymentIntentId: 'pi_n', stripeFee: 300, createdAt: new Date() });
    await CommissionTransaction.create({ saleId: 'S-NET', formationId: oid(), formationName: 'F', sourceType: 'sale', commissionType: 'percentage', commissionValue: 10, commissionAmount: 10 });
    await RefundRequest.create({ refundId: 'R-NET', saleId: 'S-NET', userId: oid(), itemId: oid(), itemType: 'formation', amount: 20, status: 'succeeded', refundedAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-NET' });
    expect(d.paymentBreakdown.netProfitAmount).toBe(67);
    expect(d.paymentBreakdown.netProfitStatus).toBe('complete');
  });

  it('prestation 100 € sur place → profit net = 100 (pas de frais ni commission)', async () => {
    await Sale.create({ saleId: 'S-NET2', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'S', finalPrice: 100 }], stripePaymentIntentId: null, createdAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-NET2' });
    expect(d.paymentBreakdown.netProfitAmount).toBe(100);
    expect(d.paymentBreakdown.netProfitStatus).toBe('complete');
  });

  it('frais Stripe en attente → partial, frais NON soustraits (pas d\'estimation)', async () => {
    await Sale.create({ saleId: 'S-NET3', userId: oid(), totalAmount: 100, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'S', finalPrice: 100 }], stripePaymentIntentId: 'pi_p', stripeFee: null, createdAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-NET3' });
    expect(d.paymentBreakdown.netProfitStatus).toBe('partial');
    expect(d.paymentBreakdown.netProfitAmount).toBe(100); // frais inconnus → non déduits
  });

  it('remboursement partiel formation soustrait du net', async () => {
    await Sale.create({ saleId: 'S-NET4', userId: oid(), totalAmount: 200, itemCount: 1, items: [{ type: 'formation', itemId: oid(), name: 'F', finalPrice: 200 }], stripePaymentIntentId: 'pi_q', stripeFee: 0, createdAt: new Date() });
    await CommissionTransaction.create({ saleId: 'S-NET4', formationId: oid(), formationName: 'F', sourceType: 'sale', commissionType: 'percentage', commissionValue: 10, commissionAmount: 20 });
    await RefundRequest.create({ refundId: 'R-NET4', saleId: 'S-NET4', userId: oid(), itemId: oid(), itemType: 'formation', amount: 50, status: 'succeeded', refundedAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'S-NET4' });
    // 200 - 0 - 20 - 50 = 130
    expect(d.paymentBreakdown.netProfitAmount).toBe(130);
  });
});
