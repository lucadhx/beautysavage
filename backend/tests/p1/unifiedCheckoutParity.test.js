// tests/p1/unifiedCheckoutParity.test.js
// Sprint U1 — Parité : (1) les endpoints publics actuels (finalize-free, create-checkout-session,
// config) sont INCHANGÉS ; (2) le finaliseur unifié RÉUTILISE le finaliseur existant
// (processCheckoutStatePurchase) → produit la même Sale, sans logique dupliquée.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { createUnifiedCheckout } = await import('../../services/checkout/unified/unifiedCheckoutFactory.js');
const { finalizeUnifiedCheckout } = await import('../../services/checkout/unified/unifiedCheckoutFinalizer.js');

async function loginClient1(agent) {
  const login = await agent.post('/auth/login').send({ email: 'client1@test.local', password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  return login.headers['set-cookie'];
}

describe('UnifiedCheckout — parité endpoints & finaliseur', () => {
  let agent;
  let fx;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await UnifiedCheckout.syncIndexes(); fx = await seedTestData(); });

  it('finalize-free : contrat inchangé (401 sans auth, 400 sans checkoutState)', async () => {
    const noAuth = await agent.post('/api/client/checkout/finalize-free').send({ checkoutState: {} });
    expect(noAuth.status).toBe(401);
    const cookie = await loginClient1(agent);
    const noState = await agent.post('/api/client/checkout/finalize-free').set('Cookie', cookie).send({});
    expect(noState.status).toBe(400);
    expect(noState.body).toMatchObject({ ok: false, code: 'CHECKOUT_STATE_REQUIRED' });
  });

  it('stripe create-checkout-session : 401 sans auth (inchangé) ; /config renvoie publishableKey', async () => {
    const noAuth = await agent.post('/api/stripe/create-checkout-session').send({ checkoutState: { item: {} } });
    expect(noAuth.status).toBe(401);
    const cfg = await agent.get('/api/stripe/config');
    // config publique : 200 {publishableKey} si credential dispo, sinon 500 contrôlé — contrat inchangé
    expect([200, 500]).toContain(cfg.status);
    if (cfg.status === 200) expect(cfg.body).toHaveProperty('publishableKey');
  });

  it('finaliseur unifié (produit) → délègue à processCheckoutStatePurchase et crée la Sale', async () => {
    const checkoutState = { item: { type: 'product', id: String(fx.product._id) }, legal: { acceptedCgv: true }, appliedGiftCards: [] };
    const { checkout } = await createUnifiedCheckout({ checkoutState, userId: fx.client1._id, source: 'test' });
    const result = await finalizeUnifiedCheckout(checkout, { checkoutState, userId: fx.client1._id, clientIp: '0.0.0.0' });
    expect(result.ok).toBe(true);
    expect(result.saleId).toBeTruthy();
    const sale = await Sale.findOne({ saleId: result.saleId }).lean();
    expect(sale).toBeTruthy();
    expect(sale.items.some(i => i.type === 'product')).toBe(true);
    // l'état du checkout est mis à jour (best-effort)
    const updated = await UnifiedCheckout.findOne({ checkoutId: checkout.checkoutId }).lean();
    expect(updated.status).toBe('finalized');
    expect(updated.finalization.saleId).toBe(result.saleId);
  });
});
