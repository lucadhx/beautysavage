// tests/p1/adminBookingRescheduleGlobal.test.js
// M11B — Endpoint report ADMIN GLOBAL : POST /api/gestion/bookings/:id/reschedule. Déplacement
// EN PLACE (même booking/sale/paiement), validation + slot-lock globaux. Vérifie aussi le
// correctif de mount-order (M3A) : un ADMIN (non-dev) atteint la route (plus de 403 shadow).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({
  ...(await o()),
  sendSaleEmail: async () => true,
  sendBookingConfirmedEmail: async () => true
}));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const BookingSlotLock = (await import('../../models/BookingSlotLock.js')).default;
const { createGlobalServiceBooking } = await import('../../services/calendar/globalAvailabilityService.js');

let agent;
let fx;
function at(iso, h) {
  const d = new Date(iso); d.setHours(h, 0, 0, 0); return d;
}

describe('M11B — report admin global (HTTP)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  async function login(email) {
    const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'];
  }
  async function makeBooking(hour) {
    const startAt = at(fx.bookingSlotISO, hour);
    const endAt = new Date(startAt.getTime() + Number(fx.service.duration) * 60000);
    const { booking } = await createGlobalServiceBooking({ bookingData: {
      serviceId: fx.service._id, clientId: fx.client1._id, startAt, endAt,
      totalPrice: 80, totalSoldAmount: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    } });
    return booking;
  }

  it('ADMIN (non-dev) peut reporter → 200 (mount-order fixé) + booking déplacé EN PLACE', async () => {
    const booking = await makeBooking(10);
    const cookie = await login('admin@test.local');
    const newStart = at(fx.bookingSlotISO, 13);
    const newEnd = new Date(newStart.getTime() + Number(fx.service.duration) * 60000);

    const res = await agent.post(`/api/gestion/bookings/${booking.bookingId}/reschedule`)
      .set('Cookie', cookie)
      .send({ newStartAt: newStart.toISOString(), newEndAt: newEnd.toISOString(), reason: 'Convenance' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const moved = await ServiceBooking.findOne({ bookingId: booking.bookingId }).lean();
    expect(new Date(moved.startAt).getTime()).toBe(newStart.getTime());
    expect(moved.status).toBe('confirmed'); // statut/paiement inchangés
    expect(moved.paymentStatus).toBe('paid');

    // Slot-locks déplacés sur le nouveau créneau (entité institut).
    const locks = await BookingSlotLock.find({ bookingId: booking.bookingId }).lean();
    expect(locks.length).toBeGreaterThan(0);
    const lockMinutes = locks.map(l => new Date(l.slotStartAt).getHours());
    expect(lockMinutes).toContain(13);
    expect(lockMinutes).not.toContain(10);
  });

  it('report sur un créneau déjà occupé → 409 SLOT_UNAVAILABLE', async () => {
    const a = await makeBooking(10);
    await makeBooking(13); // occupe 13h
    const cookie = await login('admin@test.local');
    const newStart = at(fx.bookingSlotISO, 13);
    const newEnd = new Date(newStart.getTime() + Number(fx.service.duration) * 60000);
    const res = await agent.post(`/api/gestion/bookings/${a.bookingId}/reschedule`)
      .set('Cookie', cookie)
      .send({ newStartAt: newStart.toISOString(), newEndAt: newEnd.toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_UNAVAILABLE');
  });

  it('payload invalide (créneau manquant) → 400', async () => {
    const booking = await makeBooking(10);
    const cookie = await login('admin@test.local');
    const res = await agent.post(`/api/gestion/bookings/${booking.bookingId}/reschedule`)
      .set('Cookie', cookie).send({ reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('booking inexistant → 404', async () => {
    const cookie = await login('admin@test.local');
    const newStart = at(fx.bookingSlotISO, 13);
    const newEnd = new Date(newStart.getTime() + 60 * 60000);
    const res = await agent.post('/api/gestion/bookings/BKG-NOPE/reschedule')
      .set('Cookie', cookie)
      .send({ newStartAt: newStart.toISOString(), newEndAt: newEnd.toISOString() });
    expect(res.status).toBe(404);
  });
});
