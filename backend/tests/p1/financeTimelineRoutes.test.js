// tests/p1/financeTimelineRoutes.test.js
// RX2.2 — Endpoint GET /api/gestion/finance/timeline (HTTP). Admin/dev only ; mount-order OK
// (admin atteint la route, pas de shadow 403, cf. M3A/M11B/M12). Filtres period/type/status.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;

let agent;
let fx;

describe('RX2.2 — finance timeline routes', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    await Sale.create({ saleId: 'S-TL-1', userId: fx.client1._id, customer: { firstName: 'C', lastName: 'One' }, totalAmount: 80, itemCount: 1, items: [{ type: 'service', itemId: fx.service._id, name: 'Soin', finalPrice: 80 }], createdAt: new Date() });
    await RefundRequest.create({ refundId: 'R-TL-1', saleId: 'S-TL-1', userId: fx.client1._id, itemId: fx.service._id, itemType: 'service', amount: 30, status: 'requested', requestedAt: new Date() });
  });

  async function login(email) {
    const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'];
  }

  it('ADMIN atteint GET /api/gestion/finance/timeline → 200 (mount-order OK)', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get('/api/gestion/finance/timeline').query({ period: 'all', type: 'all' }).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.summary).toBeTruthy();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.some((i) => i.type === 'sale')).toBe(true);
    expect(res.body.summary.grossIn).toBe(80);
  });

  it('filtre type=refund', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get('/api/gestion/finance/timeline').query({ type: 'refund' }).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.every((i) => i.type === 'refund')).toBe(true);
    expect(res.body.summary.refundCount).toBe(1);
  });

  it('filtre period=today inclut la vente du jour', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get('/api/gestion/finance/timeline').query({ period: 'today' }).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.some((i) => i.type === 'sale')).toBe(true);
  });

  it('client (rôle client) refusé', async () => {
    const cookie = await login('client1@test.local');
    const res = await agent.get('/api/gestion/finance/timeline').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('non authentifié refusé', async () => {
    const res = await agent.get('/api/gestion/finance/timeline');
    expect([401, 403]).toContain(res.status);
  });
});
