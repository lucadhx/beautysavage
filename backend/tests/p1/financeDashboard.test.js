// tests/p1/financeDashboard.test.js
// RX2.1 — Finance Dashboard : agrégation instantané (today = ventes de la fenêtre ;
// actions = backlog d'état courant : soldes à encaisser, remboursements à traiter, factures impayées).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import Invoice from '../../models/Invoice.js';
import { buildFinanceDashboard, resolveFinanceRange } from '../../services/financeService.js';

const oid = () => new mongoose.Types.ObjectId();

async function seedSaleToday(extra = {}) {
  return Sale.create({
    saleId: `SALE-${Math.random().toString(36).slice(2, 9)}`,
    userId: oid(),
    customer: { firstName: 'C', lastName: 'X', email: 'c@x.test' },
    totalAmount: extra.totalAmount ?? 100,
    itemCount: 1,
    items: extra.items ?? [{ type: 'service', itemId: oid(), name: 'Soin', price: 100, finalPrice: 100 }],
    giftCardUsage: extra.giftCardUsage ?? [],
    createdAt: extra.createdAt ?? new Date(),
  });
}

async function seedPendingBalance(amount) {
  const start = new Date(Date.now() + 86400000);
  return ServiceBooking.create({
    bookingId: `BKG-${Math.random().toString(36).slice(2, 9)}`,
    serviceId: oid(), practitionerId: oid(), clientId: oid(),
    startAt: start, endAt: new Date(start.getTime() + 3600000),
    totalPrice: 120, paymentType: 'deposit', depositAmount: 120 - amount,
    balanceDueAmount: amount, balanceSettlementMode: 'pay_on_site',
    paymentStatus: 'deposit_paid', status: 'confirmed',
  });
}

describe('RX2.1 — buildFinanceDashboard', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('agrège revenu + ventilation + conso carte cadeau de la fenêtre du jour', async () => {
    await seedSaleToday({ totalAmount: 80, items: [{ type: 'service', itemId: oid(), name: 'Soin', price: 80, finalPrice: 80 }] });
    await seedSaleToday({ totalAmount: 150, items: [{ type: 'formation', itemId: oid(), name: 'Form', price: 150, finalPrice: 150 }], giftCardUsage: [{ giftCardId: oid(), code: 'GC1', amountUsed: 20 }] });
    await seedSaleToday({ totalAmount: 50, items: [{ type: 'gift-card', itemId: oid(), name: 'Carte', price: 50, finalPrice: 50 }] });

    const dash = await buildFinanceDashboard({ range: 'today' });
    expect(dash.today.salesCount).toBe(3);
    expect(dash.today.revenue).toBe(280);
    expect(dash.today.breakdown).toEqual({ prestations: 1, formations: 1, giftCards: 1, products: 0 });
    expect(dash.today.giftCardConsumption).toBe(20);
  });

  it('exclut les ventes hors fenêtre (today)', async () => {
    await seedSaleToday({ totalAmount: 80 });
    await seedSaleToday({ totalAmount: 999, createdAt: new Date(Date.now() - 5 * 86400000) }); // il y a 5 jours
    const dash = await buildFinanceDashboard({ range: 'today' });
    expect(dash.today.salesCount).toBe(1);
    expect(dash.today.revenue).toBe(80);
  });

  it('range 7d inclut les ventes des jours précédents', async () => {
    await seedSaleToday({ totalAmount: 80 });
    await seedSaleToday({ totalAmount: 20, createdAt: new Date(Date.now() - 3 * 86400000) });
    const dash = await buildFinanceDashboard({ range: '7d' });
    expect(dash.today.salesCount).toBe(2);
    expect(dash.today.revenue).toBe(100);
  });

  it('compte les soldes à encaisser (backlog, indépendant de la fenêtre)', async () => {
    await seedPendingBalance(50);
    await seedPendingBalance(30);
    const dash = await buildFinanceDashboard({ range: 'today' });
    expect(dash.actions.balancesToCollect.count).toBe(2);
    expect(dash.actions.balancesToCollect.total).toBe(80);
  });

  it('compte les remboursements à traiter (requested/pending uniquement)', async () => {
    await RefundRequest.create({ refundId: 'R1', saleId: 'S1', userId: oid(), itemId: oid(), itemType: 'service', amount: 30, status: 'requested' });
    await RefundRequest.create({ refundId: 'R2', saleId: 'S2', userId: oid(), itemId: oid(), itemType: 'service', amount: 25, status: 'pending' });
    await RefundRequest.create({ refundId: 'R3', saleId: 'S3', userId: oid(), itemId: oid(), itemType: 'service', amount: 99, status: 'succeeded' }); // exclu
    const dash = await buildFinanceDashboard({ range: 'today' });
    expect(dash.actions.refundsToProcess.count).toBe(2);
    expect(dash.actions.refundsToProcess.total).toBe(55);
  });

  it('compte les factures officielles impayées uniquement', async () => {
    await Invoice.create({ saleId: 'S1', userId: oid(), invoiceId: 'INV-1', official: true, status: 'draft', totalAmount: 120 });
    await Invoice.create({ saleId: 'S2', userId: oid(), invoiceId: 'INV-2', official: true, status: 'paid', totalAmount: 200 }); // exclu (payée)
    await Invoice.create({ saleId: 'S3', userId: oid(), invoiceId: 'INV-3', official: false, status: 'draft', totalAmount: 50 }); // exclu (non officielle)
    const dash = await buildFinanceDashboard({ range: 'today' });
    expect(dash.actions.unpaidInvoices.count).toBe(1);
    expect(dash.actions.unpaidInvoices.total).toBe(120);
  });

  it('resolveFinanceRange : fenêtres cohérentes', () => {
    const ref = new Date(2026, 5, 30, 15, 0, 0); // 30 juin 2026 15h local
    const today = resolveFinanceRange('today', ref, ref);
    expect(today.start.getHours()).toBe(0);
    expect(today.end.getTime() - today.start.getTime()).toBe(86400000);
    const week = resolveFinanceRange('7d', ref, ref);
    expect(week.end.getTime() - week.start.getTime()).toBe(7 * 86400000);
    expect(resolveFinanceRange('bogus', ref, ref).range).toBe('today');
  });
});
