// tests/p1/noPractitionerBooking.test.js
// M10 — Réservation GLOBALE sans practitionerId ; practitionerId legacy accepté mais IGNORÉ ;
// double-booking global impossible (entité institut unique).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import { createGlobalServiceBooking } from '../../services/calendar/globalAvailabilityService.js';

let seed;
function slot() {
  const startAt = new Date(seed.bookingSlotISO);
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  return { startAt, endAt };
}
function baseData(extra = {}) {
  const { startAt, endAt } = slot();
  return {
    serviceId: seed.service._id,
    clientId: seed.client1._id,
    startAt, endAt,
    totalPrice: 80, totalSoldAmount: 80,
    paymentType: 'full', paymentStatus: 'paid', status: 'confirmed',
    ...extra
  };
}

describe('booking global sans prestataire (M10)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
    await ServiceBooking.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); seed = await seedTestData(); });

  it('crée une réservation SANS practitionerId (résolu = institut)', async () => {
    const { booking } = await createGlobalServiceBooking({ bookingData: baseData() });
    expect(booking).toBeTruthy();
    expect(String(booking.practitionerId)).toBe(String(seed.practitioner._id));
    expect(booking.status).toBe('confirmed');
  });

  it('ignore un practitionerId legacy fourni (toujours institut)', async () => {
    const garbage = new mongoose.Types.ObjectId();
    const { booking } = await createGlobalServiceBooking({ bookingData: baseData({ practitionerId: garbage }) });
    expect(String(booking.practitionerId)).toBe(String(seed.practitioner._id));
    expect(String(booking.practitionerId)).not.toBe(String(garbage));
  });

  it('double-booking global impossible (même créneau)', async () => {
    await createGlobalServiceBooking({ bookingData: baseData() });
    await expect(createGlobalServiceBooking({ bookingData: baseData() }))
      .rejects.toMatchObject({ status: 409 });
  });
});
