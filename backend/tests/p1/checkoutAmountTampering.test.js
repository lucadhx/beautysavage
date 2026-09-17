// tests/p1/checkoutAmountTampering.test.js
// Pré-React B2 — Le client ne peut jamais imposer le montant. Toute divergence avec le
// montant serveur est refusée (CHECKOUT_AMOUNT_MISMATCH) ; la carte cadeau est capée au
// solde réel.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const { buildServerCheckoutPricing, assertClientPricingMatchesServer } = await import('../../services/checkoutPricingService.js');

describe('B2 — checkout amount tampering', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('client baisse amountToPay → CHECKOUT_AMOUNT_MISMATCH', async () => {
    const checkoutState = {
      item: { type: 'product', id: String(fx.product._id) },
      totals: { amountToPay: 1 } // catalogue = 40
    };
    const server = await buildServerCheckoutPricing(checkoutState);
    expect(() => assertClientPricingMatchesServer(checkoutState, server))
      .toThrowError(expect.objectContaining({ code: 'CHECKOUT_AMOUNT_MISMATCH', status: 400 }));
  });

  it('client conforme → accepté', async () => {
    const checkoutState = {
      item: { type: 'product', id: String(fx.product._id) },
      totals: { amountToPay: 40 }
    };
    const server = await buildServerCheckoutPricing(checkoutState);
    expect(assertClientPricingMatchesServer(checkoutState, server)).toBe(true);
  });

  it('client n\'impose rien → serveur fait foi (pas de mismatch)', async () => {
    const checkoutState = { item: { type: 'product', id: String(fx.product._id) } };
    const server = await buildServerCheckoutPricing(checkoutState);
    expect(assertClientPricingMatchesServer(checkoutState, server)).toBe(true);
    expect(server.amountToPay).toBe(40);
  });

  it('client gonfle le montant carte cadeau au-delà du solde → serveur cape, amountToPay corrigé', async () => {
    // Le client prétend utiliser 9999 € de carte cadeau (solde réel 100) sur une formation 200.
    const checkoutState = {
      item: { type: 'formation', id: String(fx.formationDistanciel._id) },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 9999 }],
      totals: { amountToPay: 0 } // le client espère payer 0
    };
    const server = await buildServerCheckoutPricing(checkoutState);
    expect(server.giftCardCoverage).toBe(100); // capé au solde réel
    expect(server.amountToPay).toBe(100); // 200 - 100
    expect(() => assertClientPricingMatchesServer(checkoutState, server))
      .toThrowError(expect.objectContaining({ code: 'CHECKOUT_AMOUNT_MISMATCH' }));
  });

  it('carte cadeau inactive ignorée par le serveur', async () => {
    const GiftCard = (await import('../../models/GiftCard.js')).default;
    await GiftCard.findByIdAndUpdate(fx.giftCard._id, { status: 'disabled' });
    const checkoutState = {
      item: { type: 'product', id: String(fx.product._id) },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
    };
    const server = await buildServerCheckoutPricing(checkoutState);
    expect(server.giftCardCoverage).toBe(0); // carte inactive non comptée
    expect(server.amountToPay).toBe(40);
  });
});
