// tests/p1/globalAvailabilityNoPractitioner.test.js
// M10 — Disponibilité GLOBALE calculée sans practitionerId (entité institut).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import { getGlobalAvailableSlots, createGlobalServiceBooking } from '../../services/calendar/globalAvailabilityService.js';

let seed;
function dateStrOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('disponibilité globale sans prestataire (M10)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
    await ServiceBooking.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); seed = await seedTestData(); });

  it('retourne des créneaux sans practitionerId', async () => {
    const slots = await getGlobalAvailableSlots({ serviceId: seed.service._id, dateStr: dateStrOf(seed.bookingSlotISO) });
    expect(Array.isArray(slots)).toBe(true);
    expect(slots.length).toBeGreaterThan(0);
    // le créneau réservé doit exister parmi les disponibilités
    const target = new Date(seed.bookingSlotISO);
    expect(slots.some(s => new Date(s.startAt).getTime() === target.getTime())).toBe(true);
  });

  it('le créneau réservé disparaît des disponibilités (conflit global)', async () => {
    const startAt = new Date(seed.bookingSlotISO);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    await createGlobalServiceBooking({ bookingData: {
      serviceId: seed.service._id, clientId: seed.client1._id, startAt, endAt,
      totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    } });
    const slots = await getGlobalAvailableSlots({ serviceId: seed.service._id, dateStr: dateStrOf(seed.bookingSlotISO) });
    expect(slots.some(s => new Date(s.startAt).getTime() === startAt.getTime())).toBe(false);
  });
});
