// tests/p1/unifiedCheckoutLiveWiring.test.js
// Sprint U2 — Câblage live : flag off ⇒ Elements (fallback) intact ; flag on ⇒ UnifiedCheckout
// créé + hosted ; finalize-free reste fonctionnel (0 €). Aucun secret exposé.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { updateSystemConfiguration, invalidateSystemConfigurationCache } from '../../services/system/systemConfigurationService.js';

const h = vi.hoisted(() => ({ stripe: null }));
vi.mock('../../services/stripe/stripeConfigService.js', async orig => {
  const actual = await orig();
  return { ...actual, getStripeClient: async () => h.stripe };
});
vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;

async function login(agent) {
  const r = await agent.post('/auth/login').send({ email: 'client1@test.local', password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}

describe('U2 — câblage live UnifiedCheckout', () => {
  let agent, fx, prevFlag, prevNgrok;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => {
    await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); await UnifiedCheckout.syncIndexes(); fx = await seedTestData();
    prevFlag = process.env.CHECKOUT_HOSTED;
    h.stripe = {
      paymentIntents: { create: async () => ({ id: 'pi_elem', client_secret: 'cs_elem' }), cancel: async () => ({}) },
      checkout: { sessions: { create: async () => ({ id: 'cs_X', url: 'https://checkout.stripe.com/c/pay/X', payment_intent: 'pi_X' }), expire: async () => ({}) } }
    };
  });
  afterEach(() => { process.env.CHECKOUT_HOSTED = prevFlag; });

  function state() {
    return { item: { type: 'product', id: String(fx.product._id), name: 'Produit test' }, legal: { acceptedCgv: true }, appliedGiftCards: [], totals: { amountToPay: 40, remainingToPay: 40 } };
  }

  it('flag off → aucun UnifiedCheckout créé, clientSecret Elements', async () => {
    process.env.CHECKOUT_HOSTED = 'false';
    const cookie = await login(agent);
    const res = await agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState: state() });
    expect(res.body.clientSecret).toBe('cs_elem');
    expect(await UnifiedCheckout.countDocuments({})).toBe(0);
  });

  it('flag on → UnifiedCheckout créé + hosted url, aucun secret exposé', async () => {
    process.env.CHECKOUT_HOSTED = 'true';
    const cookie = await login(agent);
    const res = await agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState: state() });
    expect(res.body.mode).toBe('hosted');
    expect(await UnifiedCheckout.countDocuments({})).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/sk_|whsec_|xkeysib-/);
  });

  it('finalize-free reste fonctionnel : 401 sans auth (contrat inchangé)', async () => {
    const res = await agent.post('/api/client/checkout/finalize-free').send({ checkoutState: {} });
    expect(res.status).toBe(401);
  });
});
