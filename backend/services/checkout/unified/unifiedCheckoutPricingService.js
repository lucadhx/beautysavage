// services/checkout/unified/unifiedCheckoutPricingService.js
// Sprint U1 — Wrapper autour du pricing serveur EXISTANT. Ne recalcule AUCUNE logique
// parallèle : délègue à `buildServerCheckoutPricing` (source unique du montant, B2).

import { buildServerCheckoutPricing } from '../../checkoutPricingService.js';

/**
 * Calcule le pricing serveur d'un checkoutState. Renvoie l'objet pricing complet
 * ({ kind, amountToPay, giftCardPaymentAmount, isZeroPayment, currency, taxSnapshot,
 *   pricingSnapshot, ... }) tel que produit par le service existant.
 */
export async function computeUnifiedPricing(checkoutState, options = {}) {
  return buildServerCheckoutPricing(checkoutState, options);
}
