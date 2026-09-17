// tests/p1/customer360Service.test.js
// M12 — Agrégation Customer 360 : la fiche réunit identité + ventes + prestations + formations +
// produits + cartes cadeaux + remboursements + documents + financier + résumé.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import Purchase from '../../models/Purchase.js';
import RefundRequest from '../../models/RefundRequest.js';
import Invoice from '../../models/Invoice.js';
import { buildCustomer360 } from '../../services/customer360/customer360Service.js';

let fx;
async function seedRich() {
  const future = new Date(Date.now() + 3 * 86400000); future.setHours(10, 0, 0, 0);
  const end = new Date(future.getTime() + 60 * 60000);
  await Sale.create({
    saleId: 'SALE-C360-1', userId: fx.client1._id,
    customer: { firstName: 'C', lastName: 'One', email: fx.client1.email },
    items: [{ type: 'service', itemId: fx.service._id, name: 'Soin', price: 80, finalPrice: 80 }],
    totalAmount: 80, itemCount: 1, createdAt: new Date()
  });
  await ServiceBooking.create({
    bookingId: 'BKG-C360-1', serviceId: fx.service._id, practitionerId: fx.practitioner._id,
    clientId: fx.client1._id, startAt: future, endAt: end, totalPrice: 80, paymentType: 'deposit',
    depositAmount: 30, balanceDueAmount: 50, balanceSettlementMode: 'pay_on_site',
    paymentStatus: 'deposit_paid', status: 'confirmed', saleId: 'SALE-C360-1'
  });
  await Purchase.create({ userId: fx.client1._id, itemType: 'formation', itemId: fx.formationPresentiel._id, formationId: fx.formationPresentiel._id, paymentProvider: 'stripe', paymentStatus: 'paid', paymentRef: 'r1' });
  await Purchase.create({ userId: fx.client1._id, itemType: 'product', itemId: fx.product._id, paymentProvider: 'stripe', paymentStatus: 'paid', paymentRef: 'r2' });
  await RefundRequest.create({ refundId: 'REF-C360-1', saleId: 'SALE-C360-1', userId: fx.client1._id, itemId: fx.service._id, itemType: 'service', amount: 30, status: 'succeeded', refundedAt: new Date() });
  await Invoice.create({ saleId: 'SALE-C360-1', userId: fx.client1._id, invoiceId: 'INV-1', status: 'paid', official: true, totalAmount: 80, stripeInvoicePdfUrl: 'https://stripe/inv.pdf' });
}

describe('M12 — buildCustomer360 agrégation', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); await seedRich(); });

  it('réunit toutes les sections autour du client', async () => {
    const data = await buildCustomer360(fx.client1._id);
    expect(data.customer.id).toBe(String(fx.client1._id));
    expect(data.customer.email).toBe(fx.client1.email);
    expect(data.sales.length).toBe(1);
    expect(data.bookings.length).toBe(1);
    expect(data.formations.length).toBe(1);
    expect(data.products.length).toBe(1);
    expect(data.giftCards.length).toBe(1); // TESTGIFT100 seedé pour client1
    expect(data.refunds.length).toBe(1);
    expect(data.documents.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.timeline)).toBe(true);
    expect(data.timeline.length).toBeGreaterThan(0);
  });

  it('résumé / KPIs corrects', async () => {
    const { summary } = await buildCustomer360(fx.client1._id);
    expect(summary.kpis.salesCount).toBe(1);
    expect(summary.kpis.totalSpent).toBe(80);
    expect(summary.kpis.servicesCount).toBe(1);
    expect(summary.kpis.formationsCount).toBe(1);
    expect(summary.kpis.productsCount).toBe(1);
    expect(summary.kpis.giftCardsCount).toBe(1);
    expect(summary.kpis.refundsCount).toBe(1);
    expect(summary.kpis.upcomingBookingsCount).toBe(1);
    expect(summary.nextBooking?.bookingId).toBe('BKG-C360-1');
    expect(summary.status).toBe('active');
  });

  it('noms de formation/produit résolus', async () => {
    const { formations, products } = await buildCustomer360(fx.client1._id);
    expect(formations[0].name).toBe('Formation présentiel test');
    expect(products[0].name).toBe('Produit test');
  });

  it('404 pour un client inexistant, 400 pour un id invalide', async () => {
    await expect(buildCustomer360(new mongoose.Types.ObjectId())).rejects.toMatchObject({ status: 404 });
    await expect(buildCustomer360('not-an-id')).rejects.toMatchObject({ status: 400 });
  });
});
