// tests/p1/giftCardPaymentNotDiscount.test.js
// La carte cadeau est un MOYEN DE PAIEMENT : elle ne réduit ni le prix vendu, ni la base de
// commission. Elle réduit uniquement le montant Stripe à régler.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import { seedTestData } from '../setup/seedTestData.js';
import { buildServerCheckoutPricing } from '../../services/checkoutPricingService.js';
import { buildPricingSnapshot } from '../../constants/pricingConcepts.js';

describe('Carte cadeau = moyen de paiement (pas une remise)', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('buildPricingSnapshot : la carte cadeau ne réduit pas soldAmount ni commissionBase', () => {
    const s = buildPricingSnapshot({ catalogAmount: 100, soldAmount: 80, giftCardPaymentAmount: 20 });
    expect(s.soldAmount).toBe(80);
    expect(s.commissionBaseAmount).toBe(80); // = sold, pas 60
    expect(s.giftCardPaymentAmount).toBe(20);
    expect(s.stripePaymentAmount).toBe(60); // 80 - 20
    expect(s.promotionDiscountAmount).toBe(20); // 100 - 80
  });

  it('carte cadeau capée au prix vendu (jamais de sold négatif)', () => {
    const s = buildPricingSnapshot({ catalogAmount: 80, soldAmount: 80, giftCardPaymentAmount: 200 });
    expect(s.giftCardPaymentAmount).toBe(80); // capé à sold
    expect(s.stripePaymentAmount).toBe(0);
    expect(s.commissionBaseAmount).toBe(80);
  });

  it('pricing serveur : soldAmount inchangé par la carte cadeau, stripe = sold - giftCard', async () => {
    // formation distancielle 200, carte cadeau 100 (solde réel) → sold 200, stripe 100.
    const p = await buildServerCheckoutPricing({
      item: { type: 'formation', id: String(fx.formationDistanciel._id) },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
    });
    expect(p.soldAmount).toBe(200);
    expect(p.commissionBaseAmount).toBe(200); // base = sold, pas le montant Stripe
    expect(p.giftCardPaymentAmount).toBe(100);
    expect(p.stripePaymentAmount).toBe(100);
  });

  it('carte cadeau 100 % : sold et commissionBase inchangés, stripe = 0', async () => {
    const p = await buildServerCheckoutPricing({
      item: { type: 'product', id: String(fx.product._id) }, // 40
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
    });
    expect(p.soldAmount).toBe(40);
    expect(p.commissionBaseAmount).toBe(40);
    expect(p.stripePaymentAmount).toBe(0);
  });
});
