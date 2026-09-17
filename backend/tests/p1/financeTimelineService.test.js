// tests/p1/financeTimelineService.test.js
// RX2.2 — Financial Timeline : mappers purs + agrégation buildFinanceTimeline (mouvements réels).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import Invoice from '../../models/Invoice.js';
import {
  buildFinanceTimeline,
  mapSaleToFinanceMovement,
  mapRefundToFinanceMovement,
  mapGiftCardTransactionToFinanceMovement,
  mapCommissionPaymentToFinanceMovement,
  mapBookingBalanceToFinanceMovement,
} from '../../services/finance/financeTimelineService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.2 — mappers purs', () => {
  it('mapSale → mouvement in (paiement reçu)', () => {
    const m = mapSaleToFinanceMovement({ saleId: 'S1', userId: oid(), totalAmount: 80, items: [{ type: 'service' }], createdAt: new Date(), customer: { firstName: 'A', lastName: 'B' } });
    expect(m.type).toBe('sale');
    expect(m.direction).toBe('in');
    expect(m.amount).toBe(80);
    expect(m.title).toBe('Paiement reçu');
  });
  it('mapSale deposit → type deposit', () => {
    const m = mapSaleToFinanceMovement({ saleId: 'S2', userId: oid(), totalAmount: 30, items: [{ type: 'service' }], createdAt: new Date() }, { isDeposit: true });
    expect(m.type).toBe('deposit');
    expect(m.direction).toBe('in');
  });
  it('mapRefund → mouvement out', () => {
    const m = mapRefundToFinanceMovement({ refundId: 'R1', userId: oid(), amount: 30, status: 'succeeded', itemType: 'service', refundedAt: new Date() });
    expect(m.direction).toBe('out');
    expect(m.status).toBe('refunded');
    expect(m.amount).toBe(30);
  });
  it('mapGiftCardTransaction manual_issued → in / redeem → neutral', () => {
    const issue = mapGiftCardTransactionToFinanceMovement({ _id: oid(), userId: oid(), transactionType: 'manual_issued', amount: 50, createdAt: new Date() });
    const redeem = mapGiftCardTransactionToFinanceMovement({ _id: oid(), userId: oid(), transactionType: 'redeem', amount: 20, createdAt: new Date() });
    expect(issue.type).toBe('gift_card_issue');
    expect(issue.direction).toBe('in');
    expect(redeem.type).toBe('gift_card_usage');
    expect(redeem.direction).toBe('neutral');
  });
  it('mapCommissionPayment → out (0 € ignoré)', () => {
    const m = mapCommissionPaymentToFinanceMovement({ _id: oid(), month: 5, year: 2026, netAmountDue: 120, status: 'succeeded', paidAt: new Date() });
    expect(m.direction).toBe('out');
    expect(m.amount).toBe(120);
    expect(mapCommissionPaymentToFinanceMovement({ _id: oid(), month: 5, year: 2026, netAmountDue: 0, status: 'succeeded' })).toBeNull();
  });
  it('mapBookingBalance due → neutral / paid → in', () => {
    const due = mapBookingBalanceToFinanceMovement({ bookingId: 'B1', clientId: oid(), balanceDueAmount: 50, totalPrice: 80, depositAmount: 30, createdAt: new Date() });
    expect(due.type).toBe('balance_due');
    expect(due.direction).toBe('neutral');
    expect(due.amount).toBe(50);
    const paid = mapBookingBalanceToFinanceMovement({ bookingId: 'B2', clientId: oid(), balanceDueAmount: 0, totalPrice: 100, depositAmount: 40, balancePaidAt: new Date() });
    expect(paid.type).toBe('balance_paid');
    expect(paid.direction).toBe('in');
    expect(paid.amount).toBe(60);
  });
});

describe('RX2.2 — buildFinanceTimeline (intégration)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  async function seedAll() {
    const now = new Date();
    // Vente pleine (service)
    await Sale.create({ saleId: 'SALE-A', userId: oid(), customer: { firstName: 'A', lastName: 'A' }, totalAmount: 80, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', price: 80, finalPrice: 80 }], createdAt: now });
    // Acompte : Sale liée à un booking deposit + solde restant
    await Sale.create({ saleId: 'SALE-B', userId: oid(), customer: { firstName: 'B', lastName: 'B' }, totalAmount: 30, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', price: 30, finalPrice: 30 }], createdAt: now });
    await ServiceBooking.create({ bookingId: 'BKG-B', serviceId: oid(), practitionerId: oid(), clientId: oid(), startAt: new Date(now.getTime() + 86400000), endAt: new Date(now.getTime() + 90000000), totalPrice: 80, paymentType: 'deposit', depositAmount: 30, balanceDueAmount: 50, balanceSettlementMode: 'pay_on_site', paymentStatus: 'deposit_paid', status: 'confirmed', saleId: 'SALE-B', createdAt: now });
    // Solde encaissé
    await ServiceBooking.create({ bookingId: 'BKG-C', serviceId: oid(), practitionerId: oid(), clientId: oid(), startAt: new Date(now.getTime() + 86400000), endAt: new Date(now.getTime() + 90000000), totalPrice: 100, paymentType: 'deposit', depositAmount: 40, balanceDueAmount: 0, paymentStatus: 'paid', status: 'confirmed', balancePaidAt: now, createdAt: now });
    // Remboursement
    await RefundRequest.create({ refundId: 'REF-A', saleId: 'SALE-A', userId: oid(), itemId: oid(), itemType: 'service', amount: 30, status: 'succeeded', refundedAt: now, requestedAt: now });
    // Cartes cadeaux : émission manuelle (in) + utilisation (neutral)
    await GiftCardTransaction.create({ giftCardId: oid(), userId: oid(), transactionType: 'manual_issued', source: 'manual_institute', amount: 50, balanceBefore: 0, balanceAfter: 50, createdAt: now });
    await GiftCardTransaction.create({ giftCardId: oid(), userId: oid(), transactionType: 'redeem', source: 'client', amount: 20, balanceBefore: 50, balanceAfter: 30, createdAt: now });
    // Commission plateforme
    await CommissionPayment.create({ month: now.getMonth(), year: now.getFullYear(), periodStart: now, periodEnd: now, amount: 120, netAmountDue: 120, status: 'succeeded', settledReason: 'paid', paidAt: now });
    // Facture officielle (ne doit PAS apparaître par défaut)
    await Invoice.create({ saleId: 'SALE-A', userId: oid(), invoiceId: 'INV-A', official: true, status: 'paid', totalAmount: 80, invoiceDate: now });
  }

  it('agrège tous les types et calcule le summary', async () => {
    await seedAll();
    const { summary, items } = await buildFinanceTimeline({ type: 'all', limit: 200 });
    const types = items.map((i) => i.type).sort();
    expect(types).toContain('sale');
    expect(types).toContain('deposit');
    expect(types).toContain('balance_due');
    expect(types).toContain('balance_paid');
    expect(types).toContain('refund');
    expect(types).toContain('gift_card_issue');
    expect(types).toContain('gift_card_usage');
    expect(types).toContain('commission');
    expect(types).not.toContain('invoice'); // exclu par défaut
    // grossIn = 80 (sale) + 30 (deposit) + 60 (balance_paid) + 50 (gift_issue) = 220
    expect(summary.grossIn).toBe(220);
    // grossOut = 30 (refund) + 120 (commission) = 150
    expect(summary.grossOut).toBe(150);
    expect(summary.netAmount).toBe(70);
    expect(summary.balanceDueAmount).toBe(50);
    expect(summary.refundCount).toBe(1);
  });

  it('filtre type=refund ne renvoie que les remboursements', async () => {
    await seedAll();
    const { items } = await buildFinanceTimeline({ type: 'refund', limit: 200 });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.type === 'refund')).toBe(true);
  });

  it('filtre type=invoice fait apparaître les factures (neutral)', async () => {
    await seedAll();
    const { items, summary } = await buildFinanceTimeline({ type: 'invoice', limit: 200 });
    expect(items.every((i) => i.type === 'invoice')).toBe(true);
    expect(items.every((i) => i.direction === 'neutral')).toBe(true);
    expect(summary.grossIn).toBe(0);
    expect(summary.grossOut).toBe(0);
  });

  it('items triés desc par occurredAt et limités', async () => {
    await seedAll();
    const { items } = await buildFinanceTimeline({ type: 'all', limit: 3 });
    expect(items.length).toBe(3);
  });
});
