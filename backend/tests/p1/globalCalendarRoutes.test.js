// tests/p1/globalCalendarRoutes.test.js
// M10 — Endpoint manager GET /api/gestion/calendar/items : admin/dev OK, client interdit.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import ServiceBooking from '../../models/ServiceBooking.js';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

let agent;
let seed;
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}
const ADMIN_IP = '203.0.113.81';
const DEV_IP = '203.0.113.82';
const CLIENT_IP = '203.0.113.83';

function range() {
  return {
    startDate: new Date(Date.now() - 86400000).toISOString(),
    endDate: new Date(Date.now() + 60 * 86400000).toISOString()
  };
}

describe('calendar routes (M10)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    seed = await seedTestData();
    const startAt = new Date(seed.bookingSlotISO);
    await ServiceBooking.create({
      bookingId: `BKG-${Date.now()}-r`, serviceId: seed.service._id, practitionerId: seed.practitioner._id,
      clientId: seed.client1._id, startAt, endAt: new Date(startAt.getTime() + 3600000),
      totalPrice: 80, paymentType: 'full', paymentStatus: 'paid', status: 'confirmed'
    });
  });

  it('admin : 200 + items (booking + formation présentielle)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const { startDate, endDate } = range();
    const res = await agent.get('/api/gestion/calendar/items').query({ startDate, endDate })
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const types = res.body.items.map(i => i.type);
    expect(types).toContain('service_booking');
    expect(types).toContain('formation_session');
    // SAFE : aucun e-mail exposé
    expect(JSON.stringify(res.body)).not.toContain('@test.local');
  });

  it('dev : 200', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const { startDate, endDate } = range();
    const res = await agent.get('/api/gestion/calendar/items').query({ startDate, endDate })
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
  });

  it('filtre type=formation_session', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const { startDate, endDate } = range();
    const res = await agent.get('/api/gestion/calendar/items').query({ startDate, endDate, type: 'formation_session' })
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    expect(res.body.items.every(i => i.type === 'formation_session')).toBe(true);
  });

  it('client interdit', async () => {
    const cookie = await login('client1@test.local', CLIENT_IP);
    const { startDate, endDate } = range();
    const res = await agent.get('/api/gestion/calendar/items').query({ startDate, endDate })
      .set('Cookie', cookie).set('X-Forwarded-For', CLIENT_IP);
    expect([401, 403]).toContain(res.status);
  });

  it('non authentifié refusé', async () => {
    const { startDate, endDate } = range();
    const res = await agent.get('/api/gestion/calendar/items').query({ startDate, endDate });
    expect([401, 403]).toContain(res.status);
  });

  it('dates manquantes → 400', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/calendar/items').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(400);
  });
});
