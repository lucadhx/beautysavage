// tests/p1/commissionBaseIncludesGiftCard.test.js
// Base de commission = prix vendu (soldPrice), AVANT moyens de paiement. La carte cadeau
// ne réduit JAMAIS la base. Remboursement → déduction proportionnelle sur la base.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const CommissionConfig = (await import('../../models/CommissionConfig.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');
const { computeCommissionsForPeriod } = await import('../../services/commissionPaymentService.js');
const { DISTANT_LEARNING_WAIVER_TEXT } = await import('../../constants/consumerWaiver.js');

const M0 = [new Date(2026, 0, 1), new Date(2026, 1, 1)];

async function directSale({ saleId, sold, commission, giftCardTotal }) {
  return Sale.create({
    saleId, userId: new mongoose.Types.ObjectId(),
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: sold, finalPrice: sold }],
    totalAmount: sold, commissionAmount: commission, commissionRate: 10, itemCount: 1,
    giftCardUsage: giftCardTotal > 0 ? [{ giftCardId: new mongoose.Types.ObjectId(), code: 'GC', amountUsed: giftCardTotal }] : [],
    createdAt: new Date(2026, 0, 15)
  });
}

describe('Commission base = prix vendu (carte cadeau incluse)', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    fx = await seedTestData();
    await CommissionConfig.create({ type: 'percentage', value: 10, isActive: true, createdBy: new mongoose.Types.ObjectId() });
  });

  it('vente 80 € / 80 € carte cadeau / 0 € Stripe → base commission 80', async () => {
    await directSale({ saleId: 'S-A', sold: 80, commission: 8, giftCardTotal: 80 });
    const r = await computeCommissionsForPeriod(...M0);
    expect(r.grossCommissionAmount).toBe(8); // 10% de 80, pas de 0
  });

  it('vente 80 € / 20 € carte cadeau / 60 € Stripe → base commission 80 (identique)', async () => {
    await directSale({ saleId: 'S-B', sold: 80, commission: 8, giftCardTotal: 20 });
    const r = await computeCommissionsForPeriod(...M0);
    expect(r.grossCommissionAmount).toBe(8);
  });

  it('flux réel : formation distancielle + carte cadeau partielle → commissionBase = sold', async () => {
    // formation distancielle (200), carte cadeau 100 → sold 200, stripe 100.
    await processCheckoutStatePurchase({
      userId: fx.client1._id, itemType: 'formation', itemId: String(fx.formationDistanciel._id),
      checkoutState: {
        item: { type: 'formation', id: String(fx.formationDistanciel._id) },
        legal: { acceptedCgv: true, waiverAccepted: true, waiverText: DISTANT_LEARNING_WAIVER_TEXT },
        appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }]
      },
      appliedGiftCards: [{ giftCardId: String(fx.giftCard._id), code: fx.giftCard.code, amount: 100 }],
      clientIp: '1.2.3.4', stripeSessionId: 'pi_cb_1', stripePaymentIntentId: 'pi_cb_1'
    });
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_cb_1' }).lean();
    // Commission 10% sur le prix vendu (200), indépendante de la carte cadeau.
    expect(sale.commissionAmount).toBe(20);
    expect(sale.pricingSnapshot.commissionBaseAmount).toBe(200);
    expect(sale.pricingSnapshot.soldAmount).toBe(200);
    expect(sale.pricingSnapshot.giftCardPaymentAmount).toBe(100);
    expect(sale.pricingSnapshot.stripePaymentAmount).toBe(100);
  });

  it('remboursement partiel 40 € sur base 80 → déduction commission proportionnelle (4)', async () => {
    const s = await directSale({ saleId: 'S-R', sold: 80, commission: 8, giftCardTotal: 0 });
    await RefundRequest.create({
      refundId: 'R-CB', saleId: s.saleId, userId: new mongoose.Types.ObjectId(),
      itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: 40, status: 'succeeded',
      stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: new Date(2026, 0, 20)
    });
    const r = await computeCommissionsForPeriod(...M0);
    expect(r.refundDeductionAmount).toBe(4); // 40/80 * 8
    expect(r.total).toBe(4); // 8 - 4
  });
});
