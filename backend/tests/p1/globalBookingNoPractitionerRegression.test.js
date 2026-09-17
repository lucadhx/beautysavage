// tests/p1/globalBookingNoPractitionerRegression.test.js
// M11A — Régression : aucune dépendance au prestataire. (1) La route directe legacy
// POST /api/client/bookings fonctionne sans practitionerId et avec un practitionerId legacy ignoré.
// (2) L'assertion de réservabilité globale fonctionne sans practitionerId. (3) Les règles
// paiement/remboursement (acompte → solde, Sale = acompte encaissé) restent inchangées.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Service = (await import('../../models/Service.js')).default;
const Sale = (await import('../../models/Sale.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');
const { assertGlobalServiceSlotBookable } = await import('../../services/calendar/globalAvailabilityService.js');

let agent;
let fx;
function slot(iso, durationMin) {
  const startAt = new Date(iso);
  return { startAt, endAt: new Date(startAt.getTime() + durationMin * 60000) };
}

describe('M11A — régression sans prestataire', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  async function loginAs(email) {
    const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'];
  }

  it('POST /api/client/bookings SANS practitionerId → 201, booking rattaché à l\'institut', async () => {
    const cookie = await loginAs('client1@test.local');
    const res = await agent.post('/api/client/bookings').set('Cookie', cookie)
      .send({ serviceId: String(fx.service._id), startAt: fx.bookingSlotISO });
    expect(res.status).toBe(201);
    const booking = await ServiceBooking.findOne({ bookingId: res.body.booking.bookingId }).lean();
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
  });

  it('POST /api/client/bookings avec practitionerId legacy bidon → ignoré (institut)', async () => {
    const cookie = await loginAs('client1@test.local');
    const garbage = String(new mongoose.Types.ObjectId());
    const res = await agent.post('/api/client/bookings').set('Cookie', cookie)
      .send({ serviceId: String(fx.service._id), practitionerId: garbage, startAt: fx.bookingSlotISO });
    expect(res.status).toBe(201);
    const booking = await ServiceBooking.findOne({ bookingId: res.body.booking.bookingId }).lean();
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
    expect(String(booking.practitionerId)).not.toBe(garbage);
  });

  it('assertGlobalServiceSlotBookable valide un créneau SANS practitionerId', async () => {
    const { startAt, endAt } = slot(fx.bookingSlotISO, fx.service.duration);
    const result = await assertGlobalServiceSlotBookable({
      serviceId: fx.service._id, startAt, endAt, now: new Date()
    });
    expect(result.service).toBeTruthy();
    expect(String(result.practitioner._id)).toBe(String(fx.practitioner._id));
  });

  it('règle acompte/remboursement INCHANGÉE après bascule globale (Sale = acompte, solde tracé)', async () => {
    await Service.findByIdAndUpdate(fx.service._id, {
      price: 100, paymentType: 'deposit', depositType: 'fixed', depositValue: 30, balanceSettlementMode: 'pay_on_site'
    });
    const svc = await Service.findById(fx.service._id).lean();
    const { startAt, endAt } = slot(fx.bookingSlotISO, svc.duration);
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'service',
      checkoutState: {
        item: { type: 'service', id: String(svc._id) },
        service: { serviceId: String(svc._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString() },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'pi_reg_dep', stripePaymentIntentId: 'pi_reg_dep'
    });
    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'pi_reg_dep' }).lean();
    expect(booking.paymentType).toBe('deposit');
    expect(booking.paymentStatus).toBe('deposit_paid');
    expect(booking.depositAmount).toBe(30);
    expect(booking.balanceDueAmount).toBe(70);
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_reg_dep' }).lean();
    expect(sale.totalAmount).toBe(30); // remboursement capé à l'acompte encaissé — inchangé
  });
});
