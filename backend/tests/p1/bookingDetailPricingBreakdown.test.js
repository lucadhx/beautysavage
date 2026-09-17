// tests/p1/bookingDetailPricingBreakdown.test.js
// Le détail d'une réservation prestation (GET /api/gestion/bookings/:id/detail) expose la
// ventilation du prix RÉELLEMENT vendu (catalogue → remise promotion → prix réel) et du
// règlement (carte cadeau / en ligne / sur place / reste). Fonction pure = testée sans DB.
import { describe, it, expect } from 'vitest';

const { buildBookingPricingBreakdown } = await import('../../controllers/serviceBookingController.js');

describe('buildBookingPricingBreakdown', () => {
  it('utilise le snapshot pricing de la vente (promotion + carte cadeau)', () => {
    const booking = {
      paymentType: 'deposit',
      depositAmount: 30,
      totalPrice: 120,
      totalSoldAmount: 100,
      balanceDueAmount: 30,
      balancePaidAt: null
    };
    const sale = {
      items: [{
        type: 'service',
        pricingSnapshot: {
          catalogAmount: 120,
          promotionDiscountAmount: 20,
          soldAmount: 100,
          giftCardPaymentAmount: 40,
          stripePaymentAmount: 30
        }
      }],
      giftCardUsage: [{ code: 'GC', amountUsed: 40 }]
    };

    const pricing = buildBookingPricingBreakdown({ booking, sale });
    expect(pricing.catalogAmount).toBe(120);
    expect(pricing.promotionApplied).toBe(true);
    expect(pricing.promotionDiscountAmount).toBe(20);
    expect(pricing.soldAmount).toBe(100);
    expect(pricing.giftCardAmount).toBe(40);
    expect(pricing.paidOnlineAmount).toBe(30);
    expect(pricing.balanceDueAmount).toBe(30);
    // gift card (40) + en ligne (30) = 70 réglés ; reste 30 sur place
    expect(pricing.totalPaidAmount).toBe(70);
  });

  it('déduit la remise du catalogue quand le snapshot ne la fournit pas', () => {
    const booking = { paymentType: 'full', totalPrice: 80, totalSoldAmount: 60, balanceDueAmount: 0 };
    const sale = { items: [{ type: 'service', pricingSnapshot: { catalogAmount: 80, soldAmount: 60 } }] };
    const pricing = buildBookingPricingBreakdown({ booking, sale });
    expect(pricing.promotionApplied).toBe(true);
    expect(pricing.promotionDiscountAmount).toBe(20);
    expect(pricing.soldAmount).toBe(60);
  });

  it('retombe sur les champs de la réservation sans vente (paiement sur place)', () => {
    const booking = {
      paymentType: 'full',
      totalPrice: 50,
      totalSoldAmount: 0,
      balanceDueAmount: 50,
      balancePaidAt: null
    };
    const pricing = buildBookingPricingBreakdown({ booking, sale: null });
    expect(pricing.catalogAmount).toBe(50);
    expect(pricing.soldAmount).toBe(50);
    expect(pricing.promotionApplied).toBe(false);
    expect(pricing.giftCardAmount).toBe(0);
    expect(pricing.balanceDueAmount).toBe(50);
    expect(pricing.totalPaidAmount).toBe(0);
  });

  it('reflète un solde encaissé sur place après coup', () => {
    const booking = {
      paymentType: 'deposit',
      depositAmount: 30,
      totalPrice: 100,
      totalSoldAmount: 100,
      balanceDueAmount: 0,
      balancePaidAt: new Date()
    };
    const sale = {
      items: [{ type: 'service', pricingSnapshot: { catalogAmount: 100, soldAmount: 100, stripePaymentAmount: 30, giftCardPaymentAmount: 0 } }]
    };
    const pricing = buildBookingPricingBreakdown({ booking, sale });
    expect(pricing.paidOnlineAmount).toBe(30);
    expect(pricing.paidOnSiteAmount).toBe(70);
    expect(pricing.totalPaidAmount).toBe(100);
  });
});
