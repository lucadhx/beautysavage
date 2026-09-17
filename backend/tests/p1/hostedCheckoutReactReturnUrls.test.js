// tests/p1/hostedCheckoutReactReturnUrls.test.js
// R2C — success_url/cancel_url du Checkout hébergé : fallback Vanilla par défaut, React si
// CHECKOUT_RETURN_BASE_URL (http(s) absolue) est défini. Aucune autre modif de comportement.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { updateSystemConfiguration, invalidateSystemConfigurationCache } from '../../services/system/systemConfigurationService.js';

const h = vi.hoisted(() => ({ stripe: null, sessionArgs: null }));
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

async function createSession(agent, cookie, fx) {
  const checkoutState = { item: { type: 'product', id: String(fx.product._id), name: 'Produit test' }, legal: { acceptedCgv: true }, appliedGiftCards: [], totals: { amountToPay: 40, remainingToPay: 40 } };
  return agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState });
}

describe('R2C — success/cancel URLs (Vanilla fallback / React)', () => {
  let agent, fx, prevFlag, prevReact, prevBase;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => {
    await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); await UnifiedCheckout.syncIndexes(); fx = await seedTestData();
    prevFlag = process.env.CHECKOUT_HOSTED; process.env.CHECKOUT_HOSTED = 'true';
    // RX-GO — buildHostedReturnUrls est désormais flag-aware : neutraliser REACT_OFFICIAL_FRONTEND pour que
    // ce test (branche Vanilla/env) soit déterministe quel que soit l'ordre des fichiers (pool forks partagé).
    prevReact = process.env.REACT_OFFICIAL_FRONTEND; delete process.env.REACT_OFFICIAL_FRONTEND;
    prevBase = process.env.CHECKOUT_RETURN_BASE_URL; delete process.env.CHECKOUT_RETURN_BASE_URL;
    h.sessionArgs = null;
    h.stripe = {
      paymentIntents: { create: async () => ({ id: 'pi_e', client_secret: 'cs' }), cancel: async () => ({}) },
      checkout: { sessions: { create: async args => { h.sessionArgs = args; return { id: 'cs_X', url: 'https://stripe/X', payment_intent: 'pi_X' }; }, expire: async () => ({}) } }
    };
  });
  afterEach(() => {
    process.env.CHECKOUT_HOSTED = prevFlag;
    if (prevBase === undefined) delete process.env.CHECKOUT_RETURN_BASE_URL; else process.env.CHECKOUT_RETURN_BASE_URL = prevBase;
    if (prevReact === undefined) delete process.env.REACT_OFFICIAL_FRONTEND; else process.env.REACT_OFFICIAL_FRONTEND = prevReact;
  });

  it('sans CHECKOUT_RETURN_BASE_URL → URLs Vanilla (inchangées)', async () => {
    const res = await createSession(agent, await login(agent), fx);
    expect(res.status).toBe(200);
    expect(h.sessionArgs.success_url).toBe('https://test.ngrok.app/vitrine.html?slug=payment&checkout_session_id={CHECKOUT_SESSION_ID}');
    expect(h.sessionArgs.cancel_url).toBe('https://test.ngrok.app/vitrine.html?slug=checkout');
  });

  it('avec CHECKOUT_RETURN_BASE_URL http(s) → URLs React + session_id placeholder + checkoutId', async () => {
    process.env.CHECKOUT_RETURN_BASE_URL = 'https://app.beautysavage.fr';
    const res = await createSession(agent, await login(agent), fx);
    expect(res.status).toBe(200);
    expect(h.sessionArgs.success_url).toContain('https://app.beautysavage.fr/paiement/succes?session_id={CHECKOUT_SESSION_ID}');
    expect(h.sessionArgs.success_url).toContain(`&checkoutId=${encodeURIComponent(res.body.checkoutId)}`);
    expect(h.sessionArgs.cancel_url).toBe('https://app.beautysavage.fr/paiement/annule');
  });

  it('base sans schéma http(s) → fallback Vanilla (anti open-redirect)', async () => {
    process.env.CHECKOUT_RETURN_BASE_URL = 'app.beautysavage.fr';
    const res = await createSession(agent, await login(agent), fx);
    expect(res.status).toBe(200);
    expect(h.sessionArgs.success_url).toContain('test.ngrok.app/vitrine.html');
  });
});
