// tests/p1/noRuntimePractitionerDependency.test.js
// M11B — Aucune dépendance runtime au prestataire : tous les chemins de création/validation/
// disponibilité fonctionnent SANS practitionerId (entité institut unique). Un practitionerId legacy
// éventuel est toléré mais ignoré.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const {
  createGlobalServiceBooking,
  assertGlobalServiceSlotBookable,
  rescheduleGlobalServiceBooking,
  getGlobalAvailableSlots
} = await import('../../services/calendar/globalAvailabilityService.js');
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');

let fx;
function slot(h) {
  const s = new Date(fx.bookingSlotISO); s.setHours(h, 0, 0, 0);
  return { startAt: s, endAt: new Date(s.getTime() + Number(fx.service.duration) * 60000) };
}
function dateStrOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('M11B — aucune dépendance runtime au prestataire', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await ServiceBooking.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('disponibilité globale sans practitionerId', async () => {
    const slots = await getGlobalAvailableSlots({ serviceId: fx.service._id, dateStr: dateStrOf(fx.bookingSlotISO) });
    expect(slots.length).toBeGreaterThan(0);
  });

  it('assertGlobalServiceSlotBookable sans practitionerId', async () => {
    const { startAt, endAt } = slot(10);
    const r = await assertGlobalServiceSlotBookable({ serviceId: fx.service._id, startAt, endAt, now: new Date() });
    expect(String(r.practitioner._id)).toBe(String(fx.practitioner._id));
  });

  it('createGlobalServiceBooking sans practitionerId → institut', async () => {
    const { startAt, endAt } = slot(10);
    const { booking } = await createGlobalServiceBooking({ bookingData: {
      serviceId: fx.service._id, clientId: fx.client1._id, startAt, endAt,
      totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    } });
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
  });

  it('checkout finalizer sans practitionerId dans checkoutState.service', async () => {
    const { startAt, endAt } = slot(11);
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'service',
      checkoutState: {
        item: { type: 'service', id: String(fx.service._id) },
        service: { serviceId: String(fx.service._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString() },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'pi_nort_1', stripePaymentIntentId: 'pi_nort_1'
    });
    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'pi_nort_1' }).lean();
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
  });

  it('rescheduleGlobalServiceBooking déplace sans practitionerId', async () => {
    const { startAt, endAt } = slot(10);
    const { booking } = await createGlobalServiceBooking({ bookingData: {
      serviceId: fx.service._id, clientId: fx.client1._id, startAt, endAt,
      totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    } });
    const moved = slot(14);
    const res = await rescheduleGlobalServiceBooking({
      bookingId: booking.bookingId, newStartAt: moved.startAt, newEndAt: moved.endAt
    });
    expect(new Date(res.booking.startAt).getTime()).toBe(moved.startAt.getTime());
  });
});
