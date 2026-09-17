// tests/p1/stripeDevExtractionParity.test.js
// Sprint F2B — Prouve que l'extraction du domaine Stripe Dev / plateforme est PUREMENT
// STRUCTURELLE : (1) le shim utils/stripeDevClient re-exporte le client du config service
// (identité référentielle), le contrôleur webhook est un délégateur, la logique vit dans
// services/stripe/dev/* ; (2) la publishable key Dev est inchangée ; (3) accountPurpose =
// platform_billing pour stripe-dev (institut=customer_payments, brevo=messaging).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn()
}));

const { getCredential } = await import('../../services/integratedApiCredentialService.js');
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const IntegratedApi = (await import('../../models/IntegratedApi.js')).default;

const shim = await import('../../utils/stripeDevClient.js');
const config = await import('../../services/stripe/dev/stripeDevConfigService.js');
const invoiceSvc = await import('../../services/stripe/dev/stripeDevInvoiceService.js');
const paymentSvc = await import('../../services/stripe/dev/stripeDevPaymentService.js');
const webhookSvc = await import('../../services/stripe/dev/stripeDevWebhookService.js');
const webhookHandlers = await import('../../services/stripe/dev/stripeDevWebhookHandlers.js');
const devController = await import('../../controllers/devWebhookController.js');

describe('F2B — stripe dev extraction parity (structurel)', () => {
  it('le shim utils/stripeDevClient re-exporte le client du config service (identité)', () => {
    expect(shim.getStripeDevClient).toBe(config.getStripeDevClient);
    expect(shim.default).toBe(config.getStripeDevClient);
  });

  it('le contrôleur webhook délègue ; la logique Dev vit dans les services', () => {
    expect(typeof devController.handleDevWebhook).toBe('function');
    expect(typeof webhookSvc.handleDevWebhookFromRequest).toBe('function');
    expect(typeof webhookHandlers.handlePaymentIntentSucceeded).toBe('function');
    expect(typeof webhookHandlers.handleSetupIntentSucceeded).toBe('function');
    expect(typeof invoiceSvc.generateCommissionInvoice).toBe('function');
    expect(typeof paymentSvc.createCommissionPaymentIntent).toBe('function');
    expect(typeof config.getStripeDevPublishableKey).toBe('function');
    expect(typeof config.getStripeDevWebhookSecret).toBe('function');
    expect(typeof config.getStripeDevAccountPurpose).toBe('function');
  });

  it('getStripeDevPublishableKey renvoie la clé du coffre (inchangé) ; \'\' si indisponible', async () => {
    getCredential.mockResolvedValueOnce('pk_test_dev_parity');
    expect(await config.getStripeDevPublishableKey()).toBe('pk_test_dev_parity');
    getCredential.mockRejectedValueOnce(new Error('vault down'));
    expect(await config.getStripeDevPublishableKey()).toBe('');
  });
});

describe('F2B — accountPurpose (platform_billing)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('stripe-dev résout accountPurpose=platform_billing ; institut=customer_payments ; brevo=messaging', async () => {
    await IntegratedApi.create([
      { slug: 'stripe-institut', name: 'Inst', provider: 'stripe', runtimeModel: 'dual_environment', accountPurpose: 'customer_payments', credentials: [] },
      { slug: 'stripe-dev', name: 'Dev', provider: 'stripe', runtimeModel: 'dual_environment', accountPurpose: 'platform_billing', credentials: [] },
      { slug: 'brevo', name: 'Brevo', provider: 'brevo', runtimeModel: 'single', accountPurpose: 'messaging', credentials: [] }
    ]);
    expect(await config.getStripeDevAccountPurpose()).toBe('platform_billing');
    const institut = await IntegratedApi.findOne({ slug: 'stripe-institut' }).lean();
    const brevo = await IntegratedApi.findOne({ slug: 'brevo' }).lean();
    expect(institut.accountPurpose).toBe('customer_payments');
    expect(brevo.accountPurpose).toBe('messaging');
  });

  it('stripe-dev sans accountPurpose (legacy non backfillé) → null (aucun blocage de flux)', async () => {
    await IntegratedApi.create({ slug: 'stripe-dev', name: 'Dev', provider: 'stripe', runtimeModel: 'dual_environment', credentials: [] });
    expect(await config.getStripeDevAccountPurpose()).toBeNull();
  });
});
