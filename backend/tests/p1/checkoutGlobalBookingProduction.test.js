// tests/p1/checkoutGlobalBookingProduction.test.js
// M11A — Le checkout PROD (finaliseur webhook Stripe + finalize-free 0 €) crée toute nouvelle
// ServiceBooking via le chemin GLOBAL institut (createGlobalServiceBooking). La réservation porte
// practitionerId = institut et les BookingSlotLock utilisent le calendrier institut.
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
const BookingSlotLock = (await import('../../models/BookingSlotLock.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');

let fx;
function slot(iso, durationMin) {
  const startAt = new Date(iso);
  return { startAt, endAt: new Date(startAt.getTime() + durationMin * 60000) };
}

describe('M11A — checkout prod → booking global institut', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await ServiceBooking.syncIndexes();
    await BookingSlotLock.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('webhook Stripe (prestation payante) → booking global (practitionerId = institut) + slot locks institut', async () => {
    const { startAt, endAt } = slot(fx.bookingSlotISO, fx.service.duration);
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'service',
      checkoutState: {
        item: { type: 'service', id: String(fx.service._id) },
        service: { serviceId: String(fx.service._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString(), practitionerId: String(fx.practitioner._id) },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'pi_glob_1', stripePaymentIntentId: 'pi_glob_1'
    });

    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'pi_glob_1' }).lean();
    expect(booking).toBeTruthy();
    expect(booking.status).toBe('confirmed');
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id)); // institut

    // BookingSlotLock posés sur le calendrier institut.
    const locks = await BookingSlotLock.find({ bookingId: booking.bookingId }).lean();
    expect(locks.length).toBeGreaterThan(0);
    for (const lock of locks) {
      expect(String(lock.practitionerId)).toBe(String(fx.practitioner._id));
    }

    // Sale liée, montant catalogue (pas de modif règle paiement).
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_glob_1' }).lean();
    expect(sale.totalAmount).toBe(80);
  });

  it('finalize-free 0 € (prestation gratuite) → booking global confirmé', async () => {
    await Service.findByIdAndUpdate(fx.service._id, { price: 0, paymentType: 'full' });
    const { startAt, endAt } = slot(fx.bookingSlotISO, fx.service.duration);
    const res = await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'service',
      checkoutState: {
        item: { type: 'service', id: String(fx.service._id) },
        service: { serviceId: String(fx.service._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString(), practitionerId: String(fx.practitioner._id) },
        legal: { acceptedCgv: true }
      },
      clientIp: '1.2.3.4', stripeSessionId: 'free_glob_1', stripePaymentIntentId: 'free_glob_1',
      requireZeroRemaining: true
    });
    expect(res).toBeTruthy(); // le finaliseur prestation renvoie la Sale créée
    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'free_glob_1' }).lean();
    expect(booking).toBeTruthy();
    expect(booking.status).toBe('confirmed');
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
  });
});
