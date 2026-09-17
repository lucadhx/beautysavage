// tests/p1/financeGiftCardRoutes.test.js
// RX2.6 — Endpoints Gift Card Finance (HTTP). Admin/dev only ; 404 carte inconnue ; code masqué.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const GiftCard = (await import('../../models/GiftCard.js')).default;
const mongoose = (await import('mongoose')).default;

let agent; let fx; let card;
const oid = () => new mongoose.Types.ObjectId();

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('RX2.6 — gift card finance routes', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    card = await GiftCard.create({ code: 'GC-ROUTE-1234', userId: fx.client1._id, amount: 100, balance: 70, status: 'active', purchasedAt: new Date(), creationMode: 'manual_institute', paymentMode: 'on_site', qrTokenHash: 'c'.repeat(64) });
  });

  it('ADMIN liste GET /finance/gift-cards → 200 (code masqué)', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get('/api/gestion/finance/gift-cards').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary.count).toBeGreaterThanOrEqual(1);
    expect(res.body.cards[0].maskedCode).toContain('••••');
    expect(JSON.stringify(res.body)).not.toContain('GC-ROUTE-1234');
  });

  it('ADMIN détail GET /finance/gift-cards/:id → 200 (QR masqué)', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get(`/api/gestion/finance/gift-cards/${card._id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.giftCard.maskedCode).toBe('••••1234');
    expect(res.body.qr.maskedToken).toBe('••••');
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('expir');
  });

  it('carte inconnue → 404', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get(`/api/gestion/finance/gift-cards/${oid()}`).set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('client refusé (403)', async () => {
    const cookie = await login('client1@test.local');
    const res = await agent.get('/api/gestion/finance/gift-cards').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});
