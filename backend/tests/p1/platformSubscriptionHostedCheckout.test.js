// tests/p1/platformSubscriptionHostedCheckout.test.js
// Sprint U3 — Abonnement hébergé : Stripe Checkout mode='setup' (collecte du moyen de paiement) +
// UnifiedCheckout kind=subscription + ContractCheckoutIntent(type:monthly) avec le SetupIntent →
// le webhook Dev setup_intent.succeeded EXISTANT crée la Subscription (aucune refonte).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { updateSystemConfiguration, invalidateSystemConfigurationCache } from '../../services/system/systemConfigurationService.js';
import mongoose from 'mongoose';

const h = vi.hoisted(() => ({ client: null, sessionArgs: null }));
vi.mock('../../utils/stripeDevClient.js', () => ({ getStripeDevClient: async () => h.client, default: async () => h.client }));
vi.mock('../../services/integratedApiCredentialService.js', () => ({ getCredential: async () => 'whsec_test_dev' }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const Contract = (await import('../../models/Contract.js')).default;
const ContractCheckoutIntent = (await import('../../models/ContractCheckoutIntent.js')).default;
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { createMonthlySetup } = await import('../../services/stripe/dev/stripeDevContractBillingService.js');

const ADMIN = new mongoose.Types.ObjectId();

describe('U3 — subscription hosted checkout (mode setup)', () => {
  let prevFlag, prevNgrok;
  beforeAll(async () => { const uri = await startMemoryDb(); await mongoose.connect(uri, { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => {
    await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); await UnifiedCheckout.syncIndexes();
    h.sessionArgs = null;
    h.client = {
      customers: { create: async () => ({ id: 'cus_dev_1' }) },
      setupIntents: { create: async () => ({ id: 'si_elem', client_secret: 'cs' }), retrieve: async id => ({ id, status: 'requires_confirmation' }) },
      checkout: { sessions: { create: async args => { h.sessionArgs = args; return { id: 'cs_sub', url: 'https://checkout.stripe.com/dev/sub', setup_intent: 'si_monthly_X' }; } } }
    };
    // launchFee payé → la souscription mensuelle est autorisée.
    await Contract.create({ status: 'pending', file: '/uploads/contracts/x.pdf', launchFee: { amount: 0, taxRate: 0.2, paid: true }, monthlyFee: { amount: 100, taxRate: 0.2, active: false }, cancellationPolicy: { type: 'anytime' }, createdBy: ADMIN, updatedBy: ADMIN });
    prevFlag = process.env.PLATFORM_CHECKOUT_HOSTED; process.env.PLATFORM_CHECKOUT_HOSTED = 'true';
  });
  afterEach(() => { process.env.PLATFORM_CHECKOUT_HOSTED = prevFlag; });

  it('flag true → Session Dev mode setup + UnifiedCheckout subscription + ContractCheckoutIntent monthly', async () => {
    const r = await createMonthlySetup({ adminId: ADMIN });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, mode: 'hosted' });
    expect(r.json.url).toBe('https://checkout.stripe.com/dev/sub');
    expect(h.sessionArgs.mode).toBe('setup');
    expect(h.sessionArgs.customer).toBe('cus_dev_1');
    expect(h.sessionArgs.metadata.kind).toBe('subscription');
    const uc = await UnifiedCheckout.findOne({ checkoutId: r.json.checkoutId }).lean();
    expect(uc.kind).toBe('subscription');
    // ContractCheckoutIntent cree avec le SetupIntent → setup_intent.succeeded existant cree la Subscription
    const intent = await ContractCheckoutIntent.findOne({ type: 'monthly' }).lean();
    expect(intent.stripeSetupIntentId).toBe('si_monthly_X');
  });
});
