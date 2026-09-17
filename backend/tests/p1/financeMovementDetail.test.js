// tests/p1/financeMovementDetail.test.js
// RX2.3 — buildFinanceMovementDetail : charge la source, renvoie movement + paymentBreakdown + lines.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import { buildFinanceMovementDetail } from '../../services/finance/financeMovementDetailService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.3 — buildFinanceMovementDetail', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('vente : movement + breakdown + ligne profit net', async () => {
    await Sale.create({ saleId: 'SALE-1', userId: oid(), customer: { firstName: 'A', lastName: 'B' }, totalAmount: 210, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', finalPrice: 210 }], stripePaymentIntentId: 'pi_1', stripeFee: 708, createdAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'SALE-1', type: 'sale' });
    expect(d.movement.type).toBe('sale');
    expect(d.paymentBreakdown.paidAmount).toBe(210);
    expect(d.paymentBreakdown.stripeFeesStatus).toBe('available');
    expect(d.paymentBreakdown.stripeFeesAmount).toBe(7.08);
    expect(d.lines.some((l) => l.kind === 'net')).toBe(true);
    expect(d.lines.find((l) => l.kind === 'net').amount).toBe(202.92);
  });

  it('source introuvable → null', async () => {
    expect(await buildFinanceMovementDetail({ sourceModel: 'Sale', sourceId: 'NOPE' })).toBeNull();
    expect(await buildFinanceMovementDetail({ sourceModel: 'Bogus', sourceId: 'x' })).toBeNull();
    expect(await buildFinanceMovementDetail({})).toBeNull();
  });

  it('solde à encaisser : breakdown not_applicable + ligne balance', async () => {
    await ServiceBooking.create({ bookingId: 'BKG-1', serviceId: oid(), practitionerId: oid(), clientId: oid(), startAt: new Date(), endAt: new Date(Date.now() + 3600000), totalPrice: 120, paymentType: 'deposit', depositAmount: 70, balanceDueAmount: 50, balanceSettlementMode: 'pay_on_site', paymentStatus: 'deposit_paid', status: 'confirmed' });
    const d = await buildFinanceMovementDetail({ sourceModel: 'ServiceBooking', sourceId: 'BKG-1' });
    expect(d.movement.type).toBe('balance_due');
    expect(d.paymentBreakdown.netProfitStatus).toBe('not_applicable');
    expect(d.lines.some((l) => l.kind === 'balance' && l.amount === 50)).toBe(true);
  });

  it('solde encaissé : profit net complete (sur place)', async () => {
    await ServiceBooking.create({ bookingId: 'BKG-2', serviceId: oid(), practitionerId: oid(), clientId: oid(), startAt: new Date(), endAt: new Date(Date.now() + 3600000), totalPrice: 100, paymentType: 'deposit', depositAmount: 40, balanceDueAmount: 0, paymentStatus: 'paid', status: 'confirmed', balancePaidAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'ServiceBooking', sourceId: 'BKG-2' });
    expect(d.movement.type).toBe('balance_paid');
    expect(d.paymentBreakdown.onSitePaidAmount).toBe(60);
    expect(d.paymentBreakdown.netProfitStatus).toBe('complete');
    expect(d.paymentBreakdown.netProfitAmount).toBe(60);
  });

  it('remboursement : breakdown refundAmount + ligne refund négative', async () => {
    await RefundRequest.create({ refundId: 'REF-1', saleId: 'SALE-1', userId: oid(), itemId: oid(), itemType: 'service', amount: 30, status: 'succeeded', refundedAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'RefundRequest', sourceId: 'REF-1' });
    expect(d.movement.type).toBe('refund');
    expect(d.paymentBreakdown.refundAmount).toBe(30);
    expect(d.lines.find((l) => l.kind === 'refund').amount).toBe(-30);
  });

  it('carte cadeau émise manuellement : on_site, ligne income', async () => {
    const tx = await GiftCardTransaction.create({ giftCardId: oid(), userId: oid(), transactionType: 'manual_issued', source: 'manual_institute', amount: 50, balanceBefore: 0, balanceAfter: 50, createdAt: new Date() });
    const d = await buildFinanceMovementDetail({ sourceModel: 'GiftCardTransaction', sourceId: String(tx._id) });
    expect(d.movement.type).toBe('gift_card_issue');
    expect(d.paymentBreakdown.onSitePaidAmount).toBe(50);
  });
});
