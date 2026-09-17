// tests/p1/checkoutGlobalBookingLegacyPayload.test.js
// M11A — Le finaliseur prod accepte un payload checkout LEGACY : un `practitionerId` ancien
// (garbage) ou absent dans checkoutState.service est toléré mais IGNORÉ — la réservation est
// toujours rattachée à l'institut.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');

let fx;
function slot(iso, durationMin) {
  const startAt = new Date(iso);
  return { startAt, endAt: new Date(startAt.getTime() + durationMin * 60000) };
}
async function finalize(serviceField, ref) {
  return processCheckoutStatePurchase({
    userId: fx.client1._id, itemType: 'service',
    checkoutState: {
      item: { type: 'service', id: String(fx.service._id) },
      service: serviceField,
      legal: { acceptedCgv: true }
    },
    clientIp: '1.2.3.4', stripeSessionId: ref, stripePaymentIntentId: ref
  });
}

describe('M11A — payload legacy practitionerId accepté mais ignoré', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await ServiceBooking.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('practitionerId legacy bidon (garbage) → ignoré, booking rattaché à l\'institut', async () => {
    const garbage = new mongoose.Types.ObjectId();
    const { startAt, endAt } = slot(fx.bookingSlotISO, fx.service.duration);
    await finalize(
      { serviceId: String(fx.service._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString(), practitionerId: String(garbage) },
      'pi_legacy_garbage'
    );
    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'pi_legacy_garbage' }).lean();
    expect(booking).toBeTruthy();
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
    expect(String(booking.practitionerId)).not.toBe(String(garbage));
  });

  it('aucun practitionerId fourni → booking créé (institut résolu serveur)', async () => {
    const { startAt, endAt } = slot(fx.bookingSlotISO, fx.service.duration);
    await finalize(
      { serviceId: String(fx.service._id), slotStart: startAt.toISOString(), slotEnd: endAt.toISOString() },
      'pi_legacy_none'
    );
    const booking = await ServiceBooking.findOne({ stripePaymentIntentId: 'pi_legacy_none' }).lean();
    expect(booking).toBeTruthy();
    expect(booking.status).toBe('confirmed');
    expect(String(booking.practitionerId)).toBe(String(fx.practitioner._id));
  });
});
