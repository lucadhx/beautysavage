// tests/p1/commissionStripeDevHostedPayment.test.js
// RX2.5 — Surface de paiement (HTTP) : les endpoints finance commission exposent l'action de paiement
// (commission_pay) qui pilotera le Checkout Stripe Dev hébergé (U3, déjà testé par
// platformCommissionHostedCheckout). Admin/dev only ; settled_zero → action désactivée.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const Contract = (await import('../../models/Contract.js')).default;
const mongoose = (await import('mongoose')).default;

let agent; let fx;
const oid = () => new mongoose.Types.ObjectId();

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('RX2.5 — commission finance routes', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    // seedTestData insère un contrat actif SANS activatedAt → on pose la date d'activation
    // (le contrat unique du test) pour que l'overview commission soit calculé.
    const now = new Date();
    await Contract.updateOne(
      { contractId: 'CTR-TEST-0001' },
      { $set: { activatedAt: new Date(now.getFullYear(), now.getMonth() - 1, 1) } },
    );
  });

  it('ADMIN GET /finance/commissions/current avec vente formation → commission_pay activé', async () => {
    const now = new Date();
    await Sale.create({ saleId: 'S-CF1', userId: fx.client1._id, totalAmount: 500, itemCount: 1, items: [{ type: 'formation', itemId: oid(), name: 'F', finalPrice: 500 }], commissionAmount: 50, createdAt: now });
    const cookie = await login('admin@test.local');
    const res = await agent.get('/api/gestion/finance/commissions/current').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.hasContract).toBe(true);
    expect(res.body.current.netAmountDue).toBe(50);
    const pay = res.body.current.actions.find((a) => a.kind === 'commission_pay');
    expect(pay.enabled).toBe(true);
    expect(pay.paymentId).toBeTruthy();
  });

  it('mois sans commission → settled_zero, commission_pay désactivé', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.get('/api/gestion/finance/commissions/current').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.current.status).toBe('settled_zero');
    const pay = res.body.current.actions.find((a) => a.kind === 'commission_pay');
    expect(pay.enabled).toBe(false);
  });

  it('history + detail accessibles admin', async () => {
    const cookie = await login('admin@test.local');
    const h = await agent.get('/api/gestion/finance/commissions/history').set('Cookie', cookie);
    expect(h.status).toBe(200);
    expect(Array.isArray(h.body.items)).toBe(true);
    const now = new Date();
    const d = await agent.get(`/api/gestion/finance/commissions/${now.getFullYear()}/${now.getMonth() + 1}`).set('Cookie', cookie);
    expect(d.status).toBe(200);
    expect(d.body.detail).toBeTruthy();
  });

  it('client (rôle client) refusé', async () => {
    const cookie = await login('client1@test.local');
    const res = await agent.get('/api/gestion/finance/commissions/current').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });
});
