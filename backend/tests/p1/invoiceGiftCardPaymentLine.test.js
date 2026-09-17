// tests/p1/invoiceGiftCardPaymentLine.test.js
// La carte cadeau apparaît comme LIGNE DE RÈGLEMENT (paiement), pas comme remise : le prix
// vendu (ligne facturée) reste le soldPrice ; la carte cadeau est un montant de paiement à
// part. Facture officielle = Stripe (cf. C2).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const Invoice = (await import('../../models/Invoice.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');
const { resolveOfficialInvoiceRef } = await import('../../services/invoiceService.js');

describe('Facture — carte cadeau = ligne de règlement', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('vente produit + carte cadeau : ligne facturée = prix vendu ; carte cadeau = paiement', async () => {
    // produit 40, carte cadeau 100 (solde) → sold 40, giftCard payé 40, stripe 0.
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'product', itemId: String(fx.product._id),
      checkoutState: {
        item: { type: 'product', id: String(fx.product._id) },
        legal: { acceptedCgv: true },
        appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
      },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }],
      clientIp: '1.2.3.4', stripeSessionId: 'pi_inv_1', stripePaymentIntentId: 'pi_inv_1'
    });
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_inv_1' }).lean();
    // Ligne facturée (prix vendu) inchangée par la carte cadeau.
    expect(sale.totalAmount).toBe(40);
    expect(sale.pricingSnapshot.soldAmount).toBe(40);
    // Carte cadeau = montant de règlement séparé (pas une remise sur le prix).
    expect(sale.pricingSnapshot.giftCardPaymentAmount).toBe(40);
    expect(sale.pricingSnapshot.stripePaymentAmount).toBe(0);
    expect(sale.pricingSnapshot.promotionDiscountAmount).toBe(0); // pas de promo → pas de remise
    // La carte cadeau utilisée est tracée comme paiement (giftCardUsage), pas comme discount.
    expect(sale.giftCardUsage[0].amountUsed).toBe(40);
  });

  it('facture officielle = Stripe si stripeInvoiceId ; sinon non officielle', async () => {
    const official = await Invoice.create({
      saleId: 'S-OFF', userId: new mongoose.Types.ObjectId(), totalAmount: 40,
      documentKind: 'stripe_official', official: true, stripeInvoiceId: 'in_1', stripeHostedUrl: 'https://stripe/in_1'
    });
    const internal = await Invoice.create({
      saleId: 'S-INT', userId: new mongoose.Types.ObjectId(), totalAmount: 40,
      documentKind: 'internal_snapshot', official: false
    });
    expect(resolveOfficialInvoiceRef(official.toObject()).official).toBe(true);
    expect(resolveOfficialInvoiceRef(official.toObject()).source).toBe('stripe');
    expect(resolveOfficialInvoiceRef(internal.toObject()).official).toBe(false);
  });
});
