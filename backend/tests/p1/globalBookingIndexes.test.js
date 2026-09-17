// tests/p1/globalBookingIndexes.test.js
// M11B — Index globaux : (1) ServiceBooking déclare l'index global {startAt,status} + conserve
// l'unique {practitionerId,startAt} (global de facto, entité unique). (2) Le double-booking global
// est bloqué. (3) Le script peut créer l'index GLOBAL UNIQUE {slotStartAt} qui interdit deux
// verrous au même instant INDÉPENDAMMENT du practitionerId.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import BookingSlotLock from '../../models/BookingSlotLock.js';
import { createGlobalServiceBooking } from '../../services/calendar/globalAvailabilityService.js';
import { cleanupPractitionerLegacy, GLOBAL_SLOT_INDEX_NAME } from '../../scripts/cleanupPractitionerLegacy.js';

let fx;
function hasKey(indexes, key) {
  return indexes.some(i => JSON.stringify(i.key) === JSON.stringify(key));
}

describe('M11B — index globaux', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await ServiceBooking.syncIndexes();
    await BookingSlotLock.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('ServiceBooking : index global {startAt,status} + unique {practitionerId,startAt}', async () => {
    const indexes = await ServiceBooking.collection.indexes();
    expect(hasKey(indexes, { startAt: 1, status: 1 })).toBe(true);
    const uniq = indexes.find(i => JSON.stringify(i.key) === JSON.stringify({ practitionerId: 1, startAt: 1 }));
    expect(uniq?.unique).toBe(true);
  });

  it('double-booking global bloqué (même créneau)', async () => {
    const startAt = new Date(fx.bookingSlotISO);
    const endAt = new Date(startAt.getTime() + Number(fx.service.duration) * 60000);
    const data = (clientId) => ({ serviceId: fx.service._id, clientId, startAt, endAt, totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed' });
    await createGlobalServiceBooking({ bookingData: data(fx.client1._id) });
    await expect(createGlobalServiceBooking({ bookingData: data(fx.client2._id) })).rejects.toMatchObject({ status: 409 });
  });

  it('index GLOBAL UNIQUE slotStartAt : interdit 2 verrous au même instant quel que soit le practitionerId', async () => {
    const report = await cleanupPractitionerLegacy({ apply: true, createGlobalIndex: true });
    expect(report.globalIndex.created).toBe(true);
    const indexes = await BookingSlotLock.collection.indexes();
    expect(indexes.some(i => i.name === GLOBAL_SLOT_INDEX_NAME)).toBe(true);

    const slotStartAt = new Date(fx.bookingSlotISO);
    await BookingSlotLock.create({ practitionerId: new mongoose.Types.ObjectId(), bookingId: 'BKG-A', slotStartAt });
    // Même instant, practitionerId DIFFÉRENT → rejeté par l'index global unique.
    await expect(
      BookingSlotLock.create({ practitionerId: new mongoose.Types.ObjectId(), bookingId: 'BKG-B', slotStartAt })
    ).rejects.toMatchObject({ code: 11000 });
  });
});
