// services/checkout/unified/unifiedCheckoutFinalizer.js
// Sprint U1 — Finalisation d'un UnifiedCheckout en DÉLÉGUANT au finaliseur EXISTANT
// (`checkoutFacade.processCheckoutStatePurchase`, qui dispatche lui-même vers panier/prestation/
// formation/produit/carte cadeau). AUCUNE logique de finalisation dupliquée. Met à jour le
// snapshot de finalisation du checkout (saleId, status). En U1, non câblé aux endpoints live.

import { processCheckoutStatePurchase } from '../checkoutFacade.js';
import { updateCheckout } from './unifiedCheckoutRepository.js';

/**
 * Finalise un checkout via le finaliseur existant. Le `checkoutState` (format actuel) est requis
 * (fourni par l'appelant — ex. StripeCheckoutIntent en U2, ou le test en U1).
 * @returns {Promise<{ ok: boolean, saleId?: string }>}
 */
export async function finalizeUnifiedCheckout(
  checkout,
  {
    checkoutState,
    userId = null,
    clientIp = '0.0.0.0',
    stripeSessionId = null,
    stripePaymentIntentId = null,
    requireZeroRemaining = false
  } = {}
) {
  if (!checkout || !checkoutState) {
    const err = new Error('UnifiedCheckout ou checkoutState manquant pour la finalisation.');
    err.status = 400;
    throw err;
  }

  const isCart = checkoutState?.cart === true;
  const item = checkoutState?.item && typeof checkoutState.item === 'object' ? checkoutState.item : {};
  const resolvedUserId = userId || checkout.userId;

  const result = await processCheckoutStatePurchase({
    userId: resolvedUserId,
    itemType: isCart ? null : item?.type,
    itemId: isCart ? null : item?.id,
    sessionId: isCart ? null : item?.sessionId || null,
    selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : [],
    appliedGiftCards: Array.isArray(checkoutState?.appliedGiftCards) ? checkoutState.appliedGiftCards : [],
    checkoutState,
    waiverText: checkoutState?.legal?.waiverText || null,
    clientIp,
    stripeSessionId,
    stripePaymentIntentId,
    requireZeroRemaining
  });

  // Met à jour l'état du checkout (best-effort, ne casse pas la finalisation métier).
  try {
    await updateCheckout(checkout.checkoutId, {
      status: 'finalized',
      'finalization.saleId': result?.saleId || null,
      'finalization.finalizedAt': new Date(),
      'payment.status': 'succeeded',
      'payment.stripePaymentIntentId': stripePaymentIntentId || checkout.payment?.stripePaymentIntentId || null
    });
  } catch (_err) {
    // l'état du checkout est secondaire : ne jamais faire échouer la vente pour ça.
  }

  return result;
}
