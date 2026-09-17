// tests/p1/unifiedCheckoutFactory.test.js
// Sprint U1 — Factory : crée un UnifiedCheckout depuis le checkoutState ACTUEL, snapshots
// serveur (pricing/tax/legal) présents, inputs sanitisés (aucun password carte cadeau).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const { createUnifiedCheckout, sanitizeCheckoutStateForSnapshot } = await import('../../services/checkout/unified/unifiedCheckoutFactory.js');

describe('UnifiedCheckout factory', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await UnifiedCheckout.syncIndexes(); fx = await seedTestData(); });

  it('produit : snapshots pricing/tax/legal présents, kind=product, status pricing_ready', async () => {
    const checkoutState = { item: { type: 'product', id: String(fx.product._id) }, legal: { acceptedCgv: true }, appliedGiftCards: [] };
    const { checkout, created } = await createUnifiedCheckout({ checkoutState, userId: fx.client1._id, source: 'test' });
    expect(created).toBe(true);
    expect(checkout.kind).toBe('product');
    expect(checkout.status).toBe('pricing_ready');
    expect(checkout.pricingSnapshot).toBeTruthy();
    expect(checkout.taxSnapshot).toBeTruthy();
    expect(checkout.legalConsentSnapshot).toBeTruthy();
    expect(checkout.payment.amountToPay).toBeGreaterThan(0);
    expect(checkout.payment.mode).toBe('stripe');
  });

  it('persiste en base et expose un checkoutId', async () => {
    const checkoutState = { item: { type: 'product', id: String(fx.product._id) }, legal: { acceptedCgv: true } };
    const { checkout } = await createUnifiedCheckout({ checkoutState, userId: fx.client1._id });
    const fromDb = await UnifiedCheckout.findOne({ checkoutId: checkout.checkoutId }).lean();
    expect(fromDb).toBeTruthy();
    expect(fromDb.kind).toBe('product');
  });

  it('sanitize : retire les mots de passe carte cadeau de inputSnapshot', () => {
    const snap = sanitizeCheckoutStateForSnapshot({
      item: { type: 'product', id: 'x' },
      appliedGiftCards: [{ giftCardId: 'g1', code: 'abc', amount: 10, password: 'SECRET-PWD' }],
      legal: { acceptedCgv: true }
    });
    const raw = JSON.stringify(snap);
    expect(raw).not.toContain('SECRET-PWD');
    expect(raw).not.toMatch(/password/i);
    expect(snap.appliedGiftCards[0]).toMatchObject({ giftCardId: 'g1', code: 'ABC', amount: 10 });
  });

  it('inputSnapshot persisté ne contient aucun password', async () => {
    const checkoutState = {
      item: { type: 'product', id: String(fx.product._id) },
      legal: { acceptedCgv: true },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 5, password: 'pw' }]
    };
    const { checkout } = await createUnifiedCheckout({ checkoutState, userId: fx.client1._id });
    const raw = JSON.stringify((await UnifiedCheckout.findOne({ checkoutId: checkout.checkoutId }).lean()));
    expect(raw).not.toMatch(/password/i);
    expect(raw).not.toContain('"pw"');
  });
});
