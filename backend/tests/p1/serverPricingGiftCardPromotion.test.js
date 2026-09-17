// tests/p1/serverPricingGiftCardPromotion.test.js
// Pré-React B2 — Promotions et cartes cadeaux entrent dans le calcul SERVEUR : une promo
// expirée n'est jamais appliquée ; la carte cadeau est débitée au montant serveur.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const { buildServerCheckoutPricing } = await import('../../services/checkoutPricingService.js');
const Promotion = (await import('../../models/Promotion.js')).default;
const GiftCard = (await import('../../models/GiftCard.js')).default;

const DAY = 24 * 3600 * 1000;

describe('B2 — server pricing with promotions & gift cards', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('promo active → prix réduit côté serveur', async () => {
    await Promotion.create({
      targetType: 'product', targetId: fx.product._id, discountType: 'percentage', discountValue: 25,
      createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - DAY), endAt: null
    });
    const p = await buildServerCheckoutPricing({ item: { type: 'product', id: String(fx.product._id) } });
    expect(p.subtotal).toBe(30); // 40 - 25%
    expect(p.amountToPay).toBe(30);
  });

  it('promo expirée → NON appliquée, prix plein côté serveur', async () => {
    await Promotion.create({
      targetType: 'product', targetId: fx.product._id, discountType: 'percentage', discountValue: 25,
      createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - 10 * DAY), endAt: new Date(Date.now() - DAY)
    });
    const p = await buildServerCheckoutPricing({ item: { type: 'product', id: String(fx.product._id) } });
    expect(p.subtotal).toBe(40); // plein tarif
    expect(p.amountToPay).toBe(40);
  });

  it('promo + carte cadeau : couverture appliquée sur le prix réduit', async () => {
    await Promotion.create({
      targetType: 'product', targetId: fx.product._id, discountType: 'fixed', discountValue: 10,
      createdBy: new mongoose.Types.ObjectId(), startAt: new Date(Date.now() - DAY), endAt: null
    });
    // produit 40 - 10 = 30 ; carte cadeau solde 100 → couvre 30 → amountToPay 0
    const p = await buildServerCheckoutPricing({
      item: { type: 'product', id: String(fx.product._id) },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
    });
    expect(p.subtotal).toBe(30);
    expect(p.giftCardCoverage).toBe(30);
    expect(p.amountToPay).toBe(0);
  });

  it('carte cadeau au solde insuffisant : débit serveur = solde, reste à payer', async () => {
    await GiftCard.findByIdAndUpdate(fx.giftCard._id, { balance: 30 });
    const p = await buildServerCheckoutPricing({
      item: { type: 'product', id: String(fx.product._id) }, // 40
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 40 }]
    });
    expect(p.giftCardCoverage).toBe(30); // capé au solde réel
    expect(p.amountToPay).toBe(10);
  });
});
