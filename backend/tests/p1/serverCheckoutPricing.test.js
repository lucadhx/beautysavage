// tests/p1/serverCheckoutPricing.test.js
// Pré-React B2 — Le serveur recalcule le montant à payer depuis le catalogue, pour tous
// les types d'offre.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const { buildServerCheckoutPricing } = await import('../../services/checkoutPricingService.js');

describe('B2 — server checkout pricing (catalog source of truth)', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('produit : amountToPay = prix catalogue', async () => {
    const p = await buildServerCheckoutPricing({ item: { type: 'product', id: String(fx.product._id) } });
    expect(p.subtotal).toBe(40);
    expect(p.amountToPay).toBe(40);
    expect(p.taxSnapshot.vatAmount).toBe(0);
  });

  it('formation distancielle : amountToPay = prix catalogue', async () => {
    const p = await buildServerCheckoutPricing({ item: { type: 'formation', id: String(fx.formationDistanciel._id) } });
    expect(p.subtotal).toBe(200);
    expect(p.amountToPay).toBe(200);
  });

  it('prestation : amountToPay = prix prestation', async () => {
    const p = await buildServerCheckoutPricing({ service: { serviceId: String(fx.service._id) } });
    expect(p.subtotal).toBe(80);
    expect(p.amountToPay).toBe(80);
  });

  it('panier produit + formation : amountToPay = somme catalogue', async () => {
    const p = await buildServerCheckoutPricing({
      cart: true,
      items: [
        { type: 'product', id: String(fx.product._id) },
        { type: 'formation', id: String(fx.formationDistanciel._id) }
      ]
    });
    expect(p.subtotal).toBe(240); // 40 + 200
    expect(p.amountToPay).toBe(240);
  });

  it('achat carte cadeau : amountToPay = montant facial validé', async () => {
    const p = await buildServerCheckoutPricing({ item: { type: 'gift-card', id: 'gift-card', amount: 60 } });
    expect(p.subtotal).toBe(60);
    expect(p.amountToPay).toBe(60);
  });

  it('carte cadeau couvrant partiellement : amountToPay = reste serveur', async () => {
    // giftCard seedée : solde 100 → couvre la formation 200 à hauteur de 100, reste 100.
    const p = await buildServerCheckoutPricing({
      item: { type: 'formation', id: String(fx.formationDistanciel._id) },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
    });
    expect(p.giftCardCoverage).toBe(100);
    expect(p.amountToPay).toBe(100);
  });

  it('carte cadeau couvrant 100 % : amountToPay = 0 (paiement 0 €)', async () => {
    const p = await buildServerCheckoutPricing({
      item: { type: 'product', id: String(fx.product._id) }, // 40
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
    });
    expect(p.giftCardCoverage).toBe(40); // capé au dû
    expect(p.amountToPay).toBe(0);
    expect(p.isZeroPayment).toBe(true);
  });
});
