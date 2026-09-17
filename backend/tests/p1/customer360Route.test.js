// tests/p1/customer360Route.test.js
// M12 — Endpoints Customer 360 (HTTP). Admin/dev only. Vérifie aussi le mount-order (admin atteint
// la route, pas de shadow 403, cf. M3A/M11B).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;

let agent;
let fx;

describe('M12 — Customer 360 routes', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    await Sale.create({ saleId: 'S-ROUTE-1', userId: fx.client1._id, totalAmount: 80, itemCount: 1, createdAt: new Date() });
  });

  async function login(email) {
    const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'];
  }

  it('ADMIN (non-dev) atteint GET /api/gestion/customers/:id/360 → 200 (mount-order OK)', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get(`/api/gestion/customers/${fx.client1._id}/360`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.customer.id).toBe(String(fx.client1._id));
    expect(res.body.sales.length).toBe(1);
    expect(res.body.summary).toBeTruthy();
    expect(res.body.financial).toBeTruthy();
  });

  it('recherche clients GET /api/gestion/customers?search=', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get('/api/gestion/customers').query({ search: 'client1' }).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.customers.some(c => c.email === 'client1@test.local')).toBe(true);
    const card = res.body.customers.find(c => c.email === 'client1@test.local');
    expect(card.salesCount).toBe(1);
    expect(card.totalSpent).toBe(80);
  });

  it('404 client inexistant, 400 id invalide', async () => {
    const cookie = await login('admin@test.local');
    const r404 = await agent.get('/api/gestion/customers/000000000000000000000000/360').set('Cookie', cookie);
    expect(r404.status).toBe(404);
    const r400 = await agent.get('/api/gestion/customers/not-an-id/360').set('Cookie', cookie);
    expect(r400.status).toBe(400);
  });

  it('client (rôle client) refusé', async () => {
    const cookie = await login('client1@test.local');
    const res = await agent.get(`/api/gestion/customers/${fx.client1._id}/360`).set('Cookie', cookie);
    expect([401, 403]).toContain(res.status);
  });
});
