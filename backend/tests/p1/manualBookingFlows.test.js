// tests/p1/manualBookingFlows.test.js
// M13 — Réservation manuelle (institut, paiement sur place) + holds temporaires de créneau.
// Vérifie : booking on_site confirmé sans Stripe, anti-double-booking, hold temporaire + release.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({
  ...(await o()),
  sendBookingConfirmedEmail: async () => true
}));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const BookingSlotLock = (await import('../../models/BookingSlotLock.js')).default;
const Sale = (await import('../../models/Sale.js')).default;

let agent;
let fx;

function at(iso, h) { const d = new Date(iso); d.setHours(h, 0, 0, 0); return d; }

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

async function bookManual(cookie, hour, extra = {}) {
  return agent.post('/api/gestion/bookings/manual').set('Cookie', cookie).send({
    clientId: String(fx.client1._id),
    serviceId: String(fx.service._id),
    startAt: at(fx.bookingSlotISO, hour).toISOString(),
    note: 'RDV pris au comptoir',
    ...extra
  });
}

describe('M13 — réservation manuelle + holds', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('réservation manuelle → 201, source manual_institute, paymentMode on_site, confirmé, aucune Sale', async () => {
    const cookie = await login('admin@test.local');
    const res = await bookManual(cookie, 10);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.paymentMode).toBe('on_site');

    const booking = await ServiceBooking.findOne({ bookingId: res.body.booking.bookingId }).lean();
    expect(booking.source).toBe('manual_institute');
    expect(booking.paymentMode).toBe('on_site');
    expect(booking.status).toBe('confirmed');
    expect(booking.balanceSettlementMode).toBe('pay_on_site');
    expect(booking.paymentStatus).toBe('pending');
    // Pas de Stripe / pas de Sale auto.
    expect(await Sale.countDocuments()).toBe(0);
    // Verrous permanents posés.
    const locks = await BookingSlotLock.find({ bookingId: booking.bookingId, lockType: 'booking' }).lean();
    expect(locks.length).toBeGreaterThan(0);
  });

  it('anti-double-booking : 2e réservation manuelle sur le même créneau → 409', async () => {
    const cookie = await login('admin@test.local');
    expect((await bookManual(cookie, 10)).status).toBe(201);
    const second = await bookManual(cookie, 10);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SLOT_UNAVAILABLE');
  });

  it('hold temporaire : pose un verrou hold avec expiresAt, bloque un 2e hold, puis release', async () => {
    const cookie = await login('admin@test.local');
    const hold = await agent.post('/api/gestion/bookings/hold').set('Cookie', cookie)
      .send({ serviceId: String(fx.service._id), startAt: at(fx.bookingSlotISO, 11).toISOString() });
    expect(hold.status).toBe(201);
    expect(hold.body.hold.holdToken).toBeTruthy();
    expect(hold.body.hold.expiresAt).toBeTruthy();

    const holdLocks = await BookingSlotLock.find({ lockType: 'hold' }).lean();
    expect(holdLocks.length).toBeGreaterThan(0);
    expect(holdLocks[0].expiresAt).toBeTruthy();

    // Un 2e hold sur le même créneau est refusé.
    const hold2 = await agent.post('/api/gestion/bookings/hold').set('Cookie', cookie)
      .send({ serviceId: String(fx.service._id), startAt: at(fx.bookingSlotISO, 11).toISOString() });
    expect(hold2.status).toBe(409);
    expect(hold2.body.code).toBe('SLOT_UNAVAILABLE');

    // Release libère le créneau.
    const release = await agent.post('/api/gestion/bookings/hold/release').set('Cookie', cookie)
      .send({ holdToken: hold.body.hold.holdToken });
    expect(release.status).toBe(200);
    expect(await BookingSlotLock.countDocuments({ lockType: 'hold' })).toBe(0);
  });

  it('confirmation avec holdToken : le hold est consommé puis le créneau est réservé', async () => {
    const cookie = await login('admin@test.local');
    const hold = await agent.post('/api/gestion/bookings/hold').set('Cookie', cookie)
      .send({ serviceId: String(fx.service._id), startAt: at(fx.bookingSlotISO, 14).toISOString() });
    expect(hold.status).toBe(201);

    const res = await bookManual(cookie, 14, { holdToken: hold.body.hold.holdToken });
    expect(res.status).toBe(201);
    // Plus de hold résiduel, et des verrous permanents existent.
    expect(await BookingSlotLock.countDocuments({ lockType: 'hold' })).toBe(0);
    expect(await BookingSlotLock.countDocuments({ bookingId: res.body.booking.bookingId, lockType: 'booking' })).toBeGreaterThan(0);
  });
});
