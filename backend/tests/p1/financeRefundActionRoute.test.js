// tests/p1/financeRefundActionRoute.test.js
// RX2.3 — Remboursement 1-clic via la route B1 POST /api/gestion/refunds/:refundId/status.
// Admin/dev only ; refuser (canceled) sans Stripe ; accepter sans vente → 409 ; statut invalide → 400.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const RefundRequest = (await import('../../models/RefundRequest.js')).default;

let agent; let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('RX2.3 — refund action route', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    await RefundRequest.create({ refundId: 'REF-ACT-1', saleId: 'S-NONE', userId: fx.client1._id, itemId: fx.service._id, itemType: 'service', amount: 30, status: 'requested', requestedAt: new Date() });
  });

  it('ADMIN refuse → 200, statut canceled', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.post('/api/gestion/refunds/REF-ACT-1/status').set('Cookie', cookie).send({ status: 'canceled', reason: 'Hors délai' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const refund = await RefundRequest.findOne({ refundId: 'REF-ACT-1' }).lean();
    expect(refund.status).toBe('canceled');
  });

  it('accepter sans vente associée → 409', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.post('/api/gestion/refunds/REF-ACT-1/status').set('Cookie', cookie).send({ status: 'succeeded' });
    expect(res.status).toBe(409);
  });

  it('statut invalide → 400', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.post('/api/gestion/refunds/REF-ACT-1/status').set('Cookie', cookie).send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('client refusé (403)', async () => {
    const cookie = await login('client1@test.local');
    const res = await agent.post('/api/gestion/refunds/REF-ACT-1/status').set('Cookie', cookie).send({ status: 'canceled' });
    expect(res.status).toBe(403);
  });
});
