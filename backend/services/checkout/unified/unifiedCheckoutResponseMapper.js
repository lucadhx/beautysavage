// services/checkout/unified/unifiedCheckoutResponseMapper.js
// Sprint U1 — Vue SAFE d'un UnifiedCheckout (aucun champ sensible). inputSnapshot/legal/pricing
// internes ne sont PAS exposés en clair dans la vue dev (résumé uniquement).

export function toSafeView(checkout) {
  if (!checkout) return null;
  const c = checkout.toObject ? checkout.toObject() : checkout;
  return {
    checkoutId: c.checkoutId,
    kind: c.kind,
    status: c.status,
    source: c.source || null,
    payment: {
      mode: c.payment?.mode || null,
      amountToPay: c.payment?.amountToPay ?? null,
      giftCardPaymentAmount: c.payment?.giftCardPaymentAmount ?? null,
      provider: c.payment?.provider || null,
      status: c.payment?.status || null
      // stripePaymentIntentId/SessionId NON exposés (identifiants techniques)
    },
    finalization: {
      saleId: c.finalization?.saleId || null,
      bookingId: c.finalization?.bookingId || null,
      finalizedAt: c.finalization?.finalizedAt || null
    },
    hasPricingSnapshot: Boolean(c.pricingSnapshot),
    hasTaxSnapshot: Boolean(c.taxSnapshot),
    hasLegalConsentSnapshot: Boolean(c.legalConsentSnapshot),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    expiresAt: c.expiresAt || null
  };
}

export function toSafeList(checkouts = []) {
  return (Array.isArray(checkouts) ? checkouts : []).map(toSafeView);
}
