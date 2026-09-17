// tests/p1/platformLaunchFeeHostedCheckout.test.js
// Sprint U3 — Frais de lancement hébergés : UnifiedCheckout kind=launch_fee + Session Dev +
// ContractCheckoutIntent(type:launch) avec le PaymentIntent → webhook Dev existant finalise.
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
const { createLaunchIntent } = await import('../../services/stripe/dev/stripeDevContractBillingService.js');

const ADMIN = new mongoose.Types.ObjectId();

describe('U3 — launch fee hosted checkout', () => {
  let prevFlag, prevNgrok;
  beforeAll(async () => { const uri = await startMemoryDb(); await mongoose.connect(uri, { dbName: 'beautysavage-database' }); });
  afterAll(async () => { await stopMemoryDb(); invalidateSystemConfigurationCache(); });
  beforeEach(async () => {
    await clearDatabase(); await updateSystemConfiguration({ domains: { vitrineUrl: 'https://test.ngrok.app' } }); await UnifiedCheckout.syncIndexes();
    h.sessionArgs = null;
    h.client = {
      paymentIntents: { create: async () => ({ id: 'pi_elem', client_secret: 'cs' }), retrieve: async id => ({ id, status: 'requires_payment_method' }) },
      checkout: { sessions: { create: async args => { h.sessionArgs = args; return { id: 'cs_launch', url: 'https://checkout.stripe.com/dev/launch', payment_intent: 'pi_launch_X' }; } } }
    };
    await Contract.create({ status: 'pending', file: '/uploads/contracts/x.pdf', launchFee: { amount: 500, taxRate: 0.2, paid: false }, monthlyFee: { amount: 100, taxRate: 0.2, active: false }, cancellationPolicy: { type: 'anytime' }, createdBy: ADMIN, updatedBy: ADMIN });
    prevFlag = process.env.PLATFORM_CHECKOUT_HOSTED; process.env.PLATFORM_CHECKOUT_HOSTED = 'true';
  });
  afterEach(() => { process.env.PLATFORM_CHECKOUT_HOSTED = prevFlag; });

  it('flag true → Session Dev mode payment + UnifiedCheckout launch_fee + ContractCheckoutIntent', async () => {
    const r = await createLaunchIntent({ adminId: ADMIN });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, mode: 'hosted' });
    expect(r.json.url).toBe('https://checkout.stripe.com/dev/launch');
    expect(h.sessionArgs.mode).toBe('payment');
    expect(h.sessionArgs.line_items[0].price_data.unit_amount).toBe(60000); // 500 * 1.2 = 600 €
    expect(h.sessionArgs.metadata.kind).toBe('launch_fee');
    const uc = await UnifiedCheckout.findOne({ checkoutId: r.json.checkoutId }).lean();
    expect(uc.kind).toBe('launch_fee');
    expect(uc.payment.provider).toBe('stripe_dev');
    // ContractCheckoutIntent cree avec le PI → le webhook Dev existant finalisera launchFee.paid
    const intent = await ContractCheckoutIntent.findOne({ type: 'launch' }).lean();
    expect(intent.stripePaymentIntentId).toBe('pi_launch_X');
  });
});
