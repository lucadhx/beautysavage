// tests/p1/hostedCheckoutSessionCreation.test.js
// Sprint U2 — Création de la Stripe Checkout Session hébergée : line_items basés sur amountToPay
// serveur (carte cadeau JAMAIS un discount), metadata unifiedCheckoutId/checkoutId/kind,
// success/cancel url, et persistance d'un UnifiedCheckout payment_pending.
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

describe('U2 — création Stripe Checkout Session hébergée', () => {
  let agent, fx, prevFlag, prevNgrok;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => {
    await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); await UnifiedCheckout.syncIndexes(); fx = await seedTestData();
    prevFlag = process.env.CHECKOUT_HOSTED; process.env.CHECKOUT_HOSTED = 'true';
    h.sessionArgs = null;
    h.stripe = {
      paymentIntents: { create: async () => ({ id: 'pi_elem', client_secret: 'cs' }), cancel: async () => ({}) },
      checkout: { sessions: {
        create: async args => { h.sessionArgs = args; return { id: 'cs_sess_X', url: 'https://checkout.stripe.com/c/pay/X', payment_intent: 'pi_hosted_X' }; },
        expire: async () => ({})
      } }
    };
  });
  afterEach(() => { process.env.CHECKOUT_HOSTED = prevFlag; });

  it('crée la Session avec line_items=amountToPay, metadata checkoutId, et persiste un UnifiedCheckout', async () => {
    const cookie = await login(agent);
    const checkoutState = { item: { type: 'product', id: String(fx.product._id), name: 'Produit test' }, legal: { acceptedCgv: true }, appliedGiftCards: [], totals: { amountToPay: 40, remainingToPay: 40 } };
    const res = await agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hosted');

    // Session Stripe : mode payment, montant = 4000 cents (40 €), pas de discount carte cadeau.
    expect(h.sessionArgs).toBeTruthy();
    expect(h.sessionArgs.mode).toBe('payment');
    expect(h.sessionArgs.line_items[0].price_data.unit_amount).toBe(4000);
    expect(h.sessionArgs.line_items[0].price_data.currency).toBe('eur');
    expect(h.sessionArgs.discounts).toBeUndefined();
    expect(h.sessionArgs.metadata.unifiedCheckoutId).toBe(res.body.checkoutId);
    expect(h.sessionArgs.metadata.checkoutId).toBe(res.body.checkoutId);
    expect(h.sessionArgs.metadata.kind).toBe('product');
    expect(String(h.sessionArgs.success_url)).toContain('test.ngrok.app');
    expect(String(h.sessionArgs.cancel_url)).toContain('test.ngrok.app');
    // payment_intent_data.metadata.intentId présent (→ finalisation par le webhook PI existant)
    expect(h.sessionArgs.payment_intent_data.metadata.intentId).toBeTruthy();

    const uc = await UnifiedCheckout.findOne({ checkoutId: res.body.checkoutId }).lean();
    expect(uc).toBeTruthy();
    expect(uc.kind).toBe('product');
    expect(uc.status).toBe('payment_pending');
    expect(uc.payment.stripeCheckoutSessionId).toBe('cs_sess_X');
    expect(uc.payment.stripePaymentIntentId).toBe('pi_hosted_X');
  });
});
