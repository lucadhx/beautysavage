// tests/p1/financeBalanceCollectRoute.test.js
// RX2.3 — Encaissement solde sur place : POST /api/gestion/bookings/:bookingId/balance-paid (M11)
// + moyen de paiement (additif). Admin/dev only ; idempotent ; aucun Stripe.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;

let agent; let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

async function seedDepositBooking() {
  return ServiceBooking.create({
    bookingId: 'BKG-COL-1', serviceId: fx.service._id, practitionerId: fx.practitioner._id, clientId: fx.client1._id,
    startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000),
    totalPrice: 120, paymentType: 'deposit', depositAmount: 70, balanceDueAmount: 50,
    balanceSettlementMode: 'pay_on_site', paymentStatus: 'deposit_paid', status: 'confirmed',
  });
}

describe('RX2.3 — balance collect route', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); await seedDepositBooking(); });

  it('ADMIN encaisse le solde avec moyen de paiement → 200 + booking mis à jour', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.post('/api/gestion/bookings/BKG-COL-1/balance-paid').set('Cookie', cookie).send({ paymentMethod: 'cash' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.balanceDueAmount).toBe(0);
    expect(res.body.paymentStatus).toBe('paid');
    const booking = await ServiceBooking.findOne({ bookingId: 'BKG-COL-1' }).lean();
    expect(booking.balanceDueAmount).toBe(0);
    expect(booking.balancePaidAt).toBeTruthy();
    expect(booking.balancePaymentMethod).toBe('cash');
  });

  it('idempotent : second appel → ok idempotent', async () => {
    const cookie = await login('admin@test.local');
    await agent.post('/api/gestion/bookings/BKG-COL-1/balance-paid').set('Cookie', cookie).send({ paymentMethod: 'card' });
    const res = await agent.post('/api/gestion/bookings/BKG-COL-1/balance-paid').set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('client refusé (403)', async () => {
    const cookie = await login('client1@test.local');
    const res = await agent.post('/api/gestion/bookings/BKG-COL-1/balance-paid').set('Cookie', cookie).send({ paymentMethod: 'cash' });
    expect(res.status).toBe(403);
  });

  it('RX2.4 — prestation manuelle payée 100 % sur place (paymentType full) est encaissable', async () => {
    await ServiceBooking.create({
      bookingId: 'BKG-FULL-1', serviceId: fx.service._id, practitionerId: fx.practitioner._id, clientId: fx.client1._id,
      startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000),
      totalPrice: 90, depositAmount: 0, balanceDueAmount: 90, balanceSettlementMode: 'pay_on_site',
      paymentType: 'full', paymentStatus: 'pending', status: 'confirmed', source: 'manual_institute', paymentMode: 'on_site',
    });
    const cookie = await login('admin@test.local');
    const res = await agent.post('/api/gestion/bookings/BKG-FULL-1/balance-paid').set('Cookie', cookie).send({ paymentMethod: 'card' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const booking = await ServiceBooking.findOne({ bookingId: 'BKG-FULL-1' }).lean();
    expect(booking.paymentStatus).toBe('paid');
    expect(booking.balanceDueAmount).toBe(0);
    expect(booking.balancePaidAt).toBeTruthy();
    expect(booking.balancePaymentMethod).toBe('card');
  });
});
