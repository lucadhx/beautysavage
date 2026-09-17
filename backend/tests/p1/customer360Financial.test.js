// tests/p1/customer360Financial.test.js
// M12 — Carte financière : total dépensé, acomptes, soldes restants, cartes cadeaux, remboursements,
// dernière facture, factures impayées.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import Invoice from '../../models/Invoice.js';
import { buildCustomer360 } from '../../services/customer360/customer360Service.js';

let fx;
describe('M12 — financial card', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    const future = new Date(Date.now() + 2 * 86400000); future.setHours(11, 0, 0, 0);
    await Sale.create({ saleId: 'S-FIN-1', userId: fx.client1._id, totalAmount: 120, itemCount: 1, createdAt: new Date() });
    await Sale.create({ saleId: 'S-FIN-2', userId: fx.client1._id, totalAmount: 80, itemCount: 1, createdAt: new Date() });
    await ServiceBooking.create({
      bookingId: 'BKG-FIN-1', serviceId: fx.service._id, practitionerId: fx.practitioner._id, clientId: fx.client1._id,
      startAt: future, endAt: new Date(future.getTime() + 3600000), totalPrice: 100, paymentType: 'deposit',
      depositAmount: 30, balanceDueAmount: 70, balanceSettlementMode: 'pay_on_site', paymentStatus: 'deposit_paid', status: 'confirmed'
    });
    await RefundRequest.create({ refundId: 'R-FIN-1', saleId: 'S-FIN-1', userId: fx.client1._id, itemId: fx.service._id, itemType: 'service', amount: 40, status: 'succeeded', refundedAt: new Date() });
    await Invoice.create({ saleId: 'S-FIN-1', userId: fx.client1._id, invoiceId: 'INV-PAID', status: 'paid', official: true, totalAmount: 120, invoiceDate: new Date(Date.now() - 86400000), stripeInvoicePdfUrl: 'https://x/1.pdf' });
    await Invoice.create({ saleId: 'S-FIN-2', userId: fx.client1._id, invoiceId: 'INV-OPEN', status: 'open', official: true, totalAmount: 80, invoiceDate: new Date(), stripeInvoicePdfUrl: 'https://x/2.pdf' });
  });

  it('agrège correctement le financier', async () => {
    const { financial } = await buildCustomer360(fx.client1._id);
    expect(financial.totalSpent).toBe(200); // 120 + 80
    expect(financial.depositsPaid).toBe(30);
    expect(financial.balanceDue).toBe(70);
    expect(financial.pendingBalances.length).toBe(1);
    expect(financial.pendingBalances[0].balanceDueAmount).toBe(70);
    expect(financial.giftCardsBalance).toBe(100); // TESTGIFT100
    expect(financial.refundsTotal).toBe(40);
    expect(financial.lastInvoice).toBeTruthy();
    expect(financial.unpaidInvoicesCount).toBe(1); // INV-OPEN officielle non payée
    expect(financial.unpaidInvoices[0].invoiceId).toBe('INV-OPEN');
  });
});
