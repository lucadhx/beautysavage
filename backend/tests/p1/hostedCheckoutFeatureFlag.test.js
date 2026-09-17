// tests/p1/hostedCheckoutFeatureFlag.test.js
// Sprint U2 — Feature flag CHECKOUT_HOSTED : false ⇒ Stripe Elements (clientSecret) inchangé ;
// true ⇒ Stripe Checkout hébergé (url). Le client Stripe est mocké via le config service.
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

function fakeStripe() {
  return {
    paymentIntents: { create: async () => ({ id: 'pi_elem', client_secret: 'cs_elem_secret' }), cancel: async () => ({}) },
    checkout: {
      sessions: {
        create: async () => ({ id: 'cs_sess_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', payment_intent: 'pi_hosted_1' }),
        expire: async () => ({})
      }
    }
  };
}
async function login(agent) {
  const r = await agent.post('/auth/login').send({ email: 'client1@test.local', password: TEST_PASSWORD });
  expect(r.status).toBe(200);
  return r.headers['set-cookie'];
}

describe('U2 — feature flag CHECKOUT_HOSTED', () => {
  let agent, fx, prevFlag, prevNgrok;
  beforeAll(async () => {
    agent = await getAgent();
  });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => { await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); fx = await seedTestData(); h.stripe = fakeStripe(); prevFlag = process.env.CHECKOUT_HOSTED; });
  afterEach(() => { process.env.CHECKOUT_HOSTED = prevFlag; });

  function productState() {
    return { item: { type: 'product', id: String(fx.product._id), name: 'Produit test' }, legal: { acceptedCgv: true }, appliedGiftCards: [], totals: { amountToPay: 40, remainingToPay: 40 } };
  }

  it('flag false → clientSecret Elements (fallback inchangé)', async () => {
    process.env.CHECKOUT_HOSTED = 'false';
    const cookie = await login(agent);
    const res = await agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState: productState() });
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('cs_elem_secret');
    expect(res.body.mode).toBeUndefined();
    expect(res.body.url).toBeUndefined();
  });

  it('flag true → mode hosted + url (pas de clientSecret)', async () => {
    process.env.CHECKOUT_HOSTED = 'true';
    const cookie = await login(agent);
    const res = await agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState: productState() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: 'hosted' });
    expect(res.body.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(res.body.checkoutId).toBeTruthy();
    expect(res.body.clientSecret).toBeUndefined();
    // aucun secret exposé
    expect(JSON.stringify(res.body)).not.toMatch(/sk_|cs_elem_secret|whsec_/);
  });
});
