// tests/p1/unifiedCheckoutInstituteKinds.test.js
// Sprint U1 — Les 5 kinds institut (service, formation, product, gift_card, cart) créent un
// UnifiedCheckout avec le bon kind + pricingSnapshot. La logique pricing/validation est déléguée
// aux services existants.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { createUnifiedCheckout } = await import('../../services/checkout/unified/unifiedCheckoutFactory.js');

describe('UnifiedCheckout — kinds institut', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await UnifiedCheckout.syncIndexes(); fx = await seedTestData(); });

  it('product → kind=product', async () => {
    const { checkout } = await createUnifiedCheckout({
      checkoutState: { item: { type: 'product', id: String(fx.product._id) }, legal: { acceptedCgv: true } },
      userId: fx.client1._id
    });
    expect(checkout.kind).toBe('product');
    expect(checkout.pricingSnapshot).toBeTruthy();
  });

  it('formation (présentiel) → kind=formation', async () => {
    const { checkout } = await createUnifiedCheckout({
      checkoutState: {
        item: { type: 'formation', id: String(fx.formationPresentiel._id), sessionId: String(fx.formationSession._id) },
        legal: { acceptedCgv: true }
      },
      userId: fx.client1._id
    });
    expect(checkout.kind).toBe('formation');
    expect(checkout.pricingSnapshot).toBeTruthy();
  });

  it('gift_card → kind=gift_card', async () => {
    const { checkout } = await createUnifiedCheckout({
      checkoutState: { item: { type: 'gift-card', id: 'gift-card', name: 'Carte', amount: 60 }, legal: { acceptedCgv: true } },
      userId: fx.client1._id
    });
    expect(checkout.kind).toBe('gift_card');
    expect(checkout.pricingSnapshot).toBeTruthy();
    expect(checkout.payment.amountToPay).toBe(60);
  });

  it('cart (produit) → kind=cart', async () => {
    const { checkout } = await createUnifiedCheckout({
      checkoutState: { cart: true, items: [{ type: 'product', id: String(fx.product._id) }], legal: { acceptedCgv: true }, consumerWaivers: [] },
      userId: fx.client1._id
    });
    expect(checkout.kind).toBe('cart');
    expect(checkout.pricingSnapshot).toBeTruthy();
  });

  it('service → kind=service (validation créneau hors périmètre de ce test)', async () => {
    const { checkout } = await createUnifiedCheckout({
      checkoutState: {
        item: { type: 'service' },
        service: { serviceId: String(fx.service._id), slotStart: new Date().toISOString(), slotEnd: new Date().toISOString(), practitionerId: String(fx.practitioner._id) },
        legal: { acceptedCgv: true }
      },
      userId: fx.client1._id,
      validate: false // le slot réel est validé par les tests booking ; ici on cible pricing+kind
    });
    expect(checkout.kind).toBe('service');
    expect(checkout.pricingSnapshot).toBeTruthy();
  });
});
