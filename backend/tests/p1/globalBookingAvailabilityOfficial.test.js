// tests/p1/globalBookingAvailabilityOfficial.test.js
// M11A — La disponibilité publique (GET /api/vitrine/availability/slots) est GLOBALE : aucun
// practitionerId requis ; un practitionerId legacy en query est sans effet ; un double-booking
// global devient impossible (le créneau réservé disparaît des disponibilités).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import { getAvailableSlots } from '../../controllers/availabilityController.js';
import { createGlobalServiceBooking } from '../../services/calendar/globalAvailabilityService.js';

let fx;
function dateStrOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}
async function fetchSlots(query) {
  const res = mockRes();
  await getAvailableSlots({ query }, res);
  return res;
}

describe('M11A — disponibilité officielle globale', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
    await ServiceBooking.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('renvoie des créneaux SANS practitionerId', async () => {
    const res = await fetchSlots({ serviceId: String(fx.service._id), date: dateStrOf(fx.bookingSlotISO) });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });

  it('un practitionerId legacy en query est sans effet (mêmes créneaux)', async () => {
    const date = dateStrOf(fx.bookingSlotISO);
    const without = await fetchSlots({ serviceId: String(fx.service._id), date });
    const withLegacy = await fetchSlots({ serviceId: String(fx.service._id), date, practitionerId: String(new mongoose.Types.ObjectId()) });
    expect(withLegacy.body.slots.length).toBe(without.body.slots.length);
    expect(withLegacy.body.slots.map(s => s.start)).toEqual(without.body.slots.map(s => s.start));
  });

  it('double-booking global impossible : le créneau réservé disparaît des disponibilités', async () => {
    const date = dateStrOf(fx.bookingSlotISO);
    const startAt = new Date(fx.bookingSlotISO);
    const endAt = new Date(startAt.getTime() + Number(fx.service.duration) * 60000);

    const before = await fetchSlots({ serviceId: String(fx.service._id), date });
    expect(before.body.slots.some(s => new Date(s.startAt).getTime() === startAt.getTime())).toBe(true);

    await createGlobalServiceBooking({ bookingData: {
      serviceId: fx.service._id, clientId: fx.client1._id, startAt, endAt,
      totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    } });

    const after = await fetchSlots({ serviceId: String(fx.service._id), date });
    expect(after.body.slots.some(s => new Date(s.startAt).getTime() === startAt.getTime())).toBe(false);

    // Réserver à nouveau le même créneau échoue globalement (entité unique).
    await expect(createGlobalServiceBooking({ bookingData: {
      serviceId: fx.service._id, clientId: fx.client2._id, startAt, endAt,
      totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    } })).rejects.toMatchObject({ status: 409 });
  });
});
