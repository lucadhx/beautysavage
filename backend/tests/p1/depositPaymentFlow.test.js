// tests/p1/depositPaymentFlow.test.js
// D3 — Acompte prestation : autorisé si balanceSettlementMode='pay_on_site' (solde tracé,
// réglé sur place). Refusé sinon. Solde visible ; remboursement capé à l'acompte encaissé.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Service = (await import('../../models/Service.js')).default;
const Sale = (await import('../../models/Sale.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');
const { markBalancePaidOnSite } = await import('../../controllers/serviceBookingController.js');
const { assertServiceSlotBookable } = await import('../../services/serviceAvailabilityService.js');
const { evaluateServiceOfferReadiness, assertServiceOfferBookable, OFFER_READINESS_CODES } =
  await import('../../services/offerReadinessService.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function slot(iso, durationMin) {
  const startAt = new Date(iso);
  return { startAt, endAt: new Date(startAt.getTime() + durationMin * 60000) };
}
// Configure la prestation seedée en acompte 30 € fixe + circuit pay_on_site, prix 100 €.
async function makeDepositService(serviceId, { mode = 'pay_on_site' } = {}) {
  await Service.findByIdAndUpdate(serviceId, {
    price: 100, paymentType: 'deposit', depositType: 'fixed', depositValue: 30, balanceSettlementMode: mode
  });
  return Service.findById(serviceId).lean();
}

describe('D3 — flux acompte prestation', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('readiness : acompte + pay_on_site → réservable ; acompte sans circuit → bloqué', () => {
    const ok = evaluateServiceOfferReadiness({ paymentType: 'deposit', depositType: 'fixed', depositValue: 30, price: 100, balanceSettlementMode: 'pay_on_site' });
    expect(ok.ready).toBe(true);
    expect(ok.balanceDue).toBe(70);
    const ko = evaluateServiceOfferReadiness({ paymentType: 'deposit', depositType: 'fixed', depositValue: 30, price: 100, balanceSettlementMode: 'none' });
    expect(ko.ready).toBe(false);
    expect(ko.code).toBe(OFFER_READINESS_CODES.OFFER_BALANCE_UNSUPPORTED);
    expect(() => assertServiceOfferBookable({ paymentType: 'deposit', price: 100, depositValue: 30, depositType: 'fixed', balanceSettlementMode: 'none' })).toThrow();
  });

  it('prestation 100 €, acompte 30 €, solde 70 € → booking deposit_paid + solde tracé', async () => {
    const svc = await makeDepositService(fx.service._id);
    const { startAt, endAt } = slot(fx.bookingSlotISO, svc.duration);
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'service',
      checkoutState: {
        item: { type: 'service', id: String(svc._id) },
        service: { serviceId: String(svc._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString(), practitionerId: String(fx.practitioner._id) },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'pi_dep_1', stripePaymentIntentId: 'pi_dep_1'
    });
    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'pi_dep_1' }).lean();
    expect(booking.paymentType).toBe('deposit');
    expect(booking.paymentStatus).toBe('deposit_paid');
    expect(booking.depositAmount).toBe(30);
    expect(booking.totalSoldAmount).toBe(100);
    expect(booking.balanceDueAmount).toBe(70);
    expect(booking.balanceSettlementMode).toBe('pay_on_site');
    // Remboursement capé à l'acompte ENCAISSÉ : Sale.totalAmount = acompte (30), pas 100.
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_dep_1' }).lean();
    expect(sale.totalAmount).toBe(30);
  });

  it('double réservation même créneau → refusée (lock) malgré acompte', async () => {
    const svc = await makeDepositService(fx.service._id);
    const { startAt, endAt } = slot(fx.bookingSlotISO, svc.duration);
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'service',
      checkoutState: {
        item: { type: 'service', id: String(svc._id) },
        service: { serviceId: String(svc._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString(), practitionerId: String(fx.practitioner._id) },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'pi_dep_2', stripePaymentIntentId: 'pi_dep_2'
    });
    await expect(assertServiceSlotBookable({
      practitionerId: fx.practitioner._id, serviceId: svc._id, startAt, endAt, now: new Date()
    })).rejects.toMatchObject({ status: 409 });
  });

  it('markBalancePaidOnSite : solde réglé sur place → balanceDue 0, paymentStatus paid', async () => {
    const svc = await makeDepositService(fx.service._id);
    const { startAt, endAt } = slot(fx.bookingSlotISO, svc.duration);
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'service',
      checkoutState: {
        item: { type: 'service', id: String(svc._id) },
        service: { serviceId: String(svc._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString(), practitionerId: String(fx.practitioner._id) },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'pi_dep_3', stripePaymentIntentId: 'pi_dep_3'
    });
    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'pi_dep_3' }).lean();
    const res = mockRes();
    await markBalancePaidOnSite({ params: { bookingId: booking.bookingId }, headers: {}, cookies: {} }, res);
    expect(res.statusCode).toBe(200);
    const updated = await ServiceBooking.findById(booking._id).lean();
    expect(updated.balanceDueAmount).toBe(0);
    expect(updated.paymentStatus).toBe('paid');
    expect(updated.balancePaidAt).toBeTruthy();
  });
});
