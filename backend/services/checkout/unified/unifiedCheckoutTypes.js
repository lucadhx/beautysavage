// services/checkout/unified/unifiedCheckoutTypes.js
// Sprint U1 — Types & constantes du moteur UnifiedCheckout (achats institut). Aucune logique
// métier dupliquée ; le "kind" est dérivé du pricing serveur existant.

// Kinds institut (U1/U2) + kinds plateforme Stripe Dev (U3 : commission, launch_fee, subscription).
export const UNIFIED_CHECKOUT_KINDS = [
  'service', 'formation', 'product', 'gift_card', 'cart',
  'commission', 'launch_fee', 'subscription'
];

export const UNIFIED_CHECKOUT_STATUSES = [
  'draft',
  'pricing_ready',
  'payment_pending',
  'free_ready',
  'finalized',
  'cancelled',
  'failed',
  'expired'
];

export const UNIFIED_PAYMENT_MODES = ['stripe', 'free', 'mixed', 'gift_card_only'];

export const UNIFIED_CHECKOUT_ERROR_CODES = {
  UNSUPPORTED_KIND: 'UNIFIED_CHECKOUT_UNSUPPORTED_KIND',
  CONTEXT_INVALID: 'UNIFIED_CHECKOUT_CONTEXT_INVALID',
  NOT_FOUND: 'UNIFIED_CHECKOUT_NOT_FOUND'
};

// Le pricing serveur (`buildServerCheckoutPricing`) renvoie kind ∈ {service, cart, gift-card,
// single}. ATTENTION : 'single' couvre À LA FOIS produit ET formation (le pricing ne distingue
// pas). On lève l'ambiguïté via le type d'item du checkoutState.
export function mapPricingKindToUnifiedKind(pricingKind) {
  const k = String(pricingKind || '').trim().toLowerCase();
  if (k === 'service') return 'service';
  if (k === 'cart') return 'cart';
  if (k === 'gift-card') return 'gift_card';
  if (UNIFIED_CHECKOUT_KINDS.includes(k)) return k;
  return 'formation';
}

// Classifie le kind U1 à partir du checkoutState + du kind pricing (désambiguïse single).
export function classifyUnifiedKind(checkoutState = {}, pricingKind = '') {
  const k = String(pricingKind || '').trim().toLowerCase();
  if (k === 'service' || checkoutState?.service?.serviceId) return 'service';
  if (k === 'cart' || checkoutState?.cart === true) return 'cart';
  const itemType = String(checkoutState?.item?.type || '').trim().toLowerCase();
  if (k === 'gift-card' || itemType === 'gift-card') return 'gift_card';
  if (itemType === 'product') return 'product';
  return 'formation';
}

// Mode de paiement déduit du pricing serveur (carte cadeau = moyen de paiement).
export function resolvePaymentMode({ amountToPay = 0, giftCardPaymentAmount = 0 } = {}) {
  const pay = Number(amountToPay || 0);
  const gift = Number(giftCardPaymentAmount || 0);
  if (pay <= 0) return gift > 0 ? 'gift_card_only' : 'free';
  return gift > 0 ? 'mixed' : 'stripe';
}
