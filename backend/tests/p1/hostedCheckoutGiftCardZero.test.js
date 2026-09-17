// tests/p1/hostedCheckoutGiftCardZero.test.js
// Sprint U2 — Carte cadeau (flag hosted) : 100 % → mode "free" (aucune Session Stripe) ;
// partielle → Session Stripe pour le RESTE à payer (carte cadeau jamais un discount Stripe).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { updateSystemConfiguration, invalidateSystemConfigurationCache } from '../../services/system/systemConfigurationService.js';

const h = vi.hoisted(() => ({ stripe: null, sessionArgs: null, sessionCreateCalls: 0 }));
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

async function login(agent) {
  const r = await agent.post('/auth/login').send({ email: 'client1@test.local', password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}

describe('U2 — carte cadeau hosted (0 € vs partiel)', () => {
  let agent, fx, prevFlag, prevNgrok;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => {
    await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); fx = await seedTestData();
    prevFlag = process.env.CHECKOUT_HOSTED; process.env.CHECKOUT_HOSTED = 'true';
    h.sessionArgs = null; h.sessionCreateCalls = 0;
    h.stripe = {
      paymentIntents: { create: async () => ({ id: 'pi', client_secret: 'cs' }), cancel: async () => ({}) },
      checkout: { sessions: {
        create: async args => { h.sessionCreateCalls += 1; h.sessionArgs = args; return { id: 'cs_X', url: 'https://checkout.stripe.com/c/pay/X', payment_intent: 'pi_hosted_X' }; },
        expire: async () => ({})
      } }
    };
  });
  afterEach(() => { process.env.CHECKOUT_HOSTED = prevFlag; });

  it('carte cadeau 100 % (couvre tout) → mode free, aucune Session Stripe', async () => {
    const cookie = await login(agent);
    const checkoutState = {
      item: { type: 'product', id: String(fx.product._id), name: 'Produit test' },
      legal: { acceptedCgv: true },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 40 }],
      totals: { amountToPay: 0, remainingToPay: 0 }
    };
    const res = await agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: 'free', requiresPayment: false });
    expect(res.body.checkoutId).toBeTruthy();
    expect(h.sessionCreateCalls).toBe(0); // aucun Stripe pour 0 €
  });

  it('carte cadeau partielle → Session Stripe pour le reste (30 €)', async () => {
    const cookie = await login(agent);
    const checkoutState = {
      item: { type: 'product', id: String(fx.product._id), name: 'Produit test' },
      legal: { acceptedCgv: true },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 10 }],
      totals: { amountToPay: 30, remainingToPay: 30 }
    };
    const res = await agent.post('/api/stripe/create-checkout-session').set('Cookie', cookie).send({ checkoutState });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hosted');
    expect(h.sessionCreateCalls).toBe(1);
    expect(h.sessionArgs.line_items[0].price_data.unit_amount).toBe(3000); // 30 € (reste à payer)
    expect(h.sessionArgs.discounts).toBeUndefined(); // carte cadeau jamais un discount Stripe
  });
});
