// tests/p1/hostedCheckoutWebhookFinalization.test.js
// Sprint U2 — Webhook checkout.session.completed : finalise via UnifiedCheckout (qui délègue au
// finaliseur existant processCheckoutStatePurchase). Idempotent au replay (aucune double vente).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const StripeCheckoutIntent = (await import('../../models/StripeCheckoutIntent.js')).default;
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { createCheckout } = await import('../../services/checkout/unified/unifiedCheckoutRepository.js');
const { handleCheckoutSessionCompletedEvent } = await import('../../services/stripe/stripeWebhookEventHandlers.js');

const PI = 'pi_hosted_W';
function event() {
  return { id: 'evt_w', type: 'checkout.session.completed', data: { object: { metadata: { unifiedCheckoutId: 'UC-W' }, payment_intent: PI } } };
}

describe('U2 — webhook hosted finalization', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase(); await UnifiedCheckout.syncIndexes(); fx = await seedTestData();
    await StripeCheckoutIntent.create({
      checkoutState: { item: { type: 'product', id: String(fx.product._id), name: 'Produit test' }, legal: { acceptedCgv: true }, appliedGiftCards: [] },
      userId: fx.client1._id,
      stripeSessionId: PI
    });
    await createCheckout({ checkoutId: 'UC-W', kind: 'product', status: 'payment_pending', userId: fx.client1._id, payment: { stripePaymentIntentId: PI, mode: 'stripe' } });
  });

  it('finalise la vente + marque UnifiedCheckout finalized', async () => {
    const r = await handleCheckoutSessionCompletedEvent(event());
    expect(r).toMatchObject({ status: 200, json: { received: true } });
    const sale = await Sale.findOne({ stripePaymentIntentId: PI }).lean();
    expect(sale).toBeTruthy();
    expect(sale.items.some(i => i.type === 'product')).toBe(true);
    const uc = await UnifiedCheckout.findOne({ checkoutId: 'UC-W' }).lean();
    expect(uc.status).toBe('finalized');
    expect(uc.finalization.saleId).toBe(sale.saleId);
  });

  it('replay → idempotent, une seule vente', async () => {
    await handleCheckoutSessionCompletedEvent(event());
    const r2 = await handleCheckoutSessionCompletedEvent(event());
    expect(r2.status).toBe(200);
    expect(await Sale.countDocuments({ stripePaymentIntentId: PI })).toBe(1);
  });

  it('metadata inconnue → 200 received (pas de crash, fallback PI existant)', async () => {
    const r = await handleCheckoutSessionCompletedEvent({ id: 'e', type: 'checkout.session.completed', data: { object: { metadata: {}, payment_intent: 'pi_unknown' } } });
    expect(r).toMatchObject({ status: 200, json: { received: true } });
  });
});
