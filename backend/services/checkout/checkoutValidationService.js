// services/checkout/checkoutValidationService.js
// Sprint F1 — Extraction des préconditions du checkout 0 € (finalize-free) hors du handler
// HTTP. Sémantique IDENTIQUE à l'ancien `finalizeFreeCheckout` : mêmes règles serveur,
// mêmes statuts/codes d'erreur. Les booléens client ne sont jamais utilisés : consentements
// dérivés du CATALOGUE serveur (A1), offres formation bloquées si non finies (A7), pricing
// serveur attaché best-effort (B2 — l'anti-bypass paiement reste `assertZeroRemainingForFreeOrder`
// dans le finaliseur).

import {
  deriveLegalRequirements,
  validateCheckoutLegalConsents
} from '../legalConsentService.js';
import { assertCheckoutFormationsPurchasable } from '../offerReadinessService.js';
import { buildServerCheckoutPricing } from '../checkoutPricingService.js';

// Normalise une erreur d'étape en conservant status/code/message d'origine s'ils existent,
// sinon applique les défauts EXACTS de l'ancien handler (status via `Number(x) || default`).
function normalizeStepError(error, defaultStatus, defaultCode, defaultMessage) {
  const normalized = new Error(error?.message || defaultMessage);
  normalized.status = Number(error?.status) || defaultStatus;
  normalized.code = error?.code || defaultCode;
  return normalized;
}

/**
 * Revalide serveur les préconditions d'une finalisation 0 € et attache le pricing serveur.
 * Lève une erreur normalisée (status/code) en cas d'échec légal (400/LEGAL_CONSENT_REQUIRED)
 * ou d'offre indisponible (409/OFFER_NOT_AVAILABLE). Le pricing est best-effort (ne bloque pas).
 * Mute `checkoutState.serverPricing` exactement comme l'ancien handler.
 */
export async function validateFreeCheckoutPreconditions(checkoutState) {
  // Sprint pré-React A1 — revalidation serveur des consentements légaux (dérivés du catalogue).
  try {
    const legalRequirements = await deriveLegalRequirements(checkoutState);
    validateCheckoutLegalConsents(checkoutState, legalRequirements);
  } catch (legalError) {
    throw normalizeStepError(legalError, 400, 'LEGAL_CONSENT_REQUIRED', 'Consentement légal requis.');
  }

  // Sprint pré-React A7 — bloque les offres formation non finies (mêmes règles que Stripe).
  try {
    await assertCheckoutFormationsPurchasable(checkoutState);
  } catch (offerError) {
    throw normalizeStepError(offerError, 409, 'OFFER_NOT_AVAILABLE', 'Offre indisponible.');
  }

  // Pré-React B2 — pricing serveur faisant foi (best-effort, observabilité/snapshot).
  try {
    checkoutState.serverPricing = await buildServerCheckoutPricing(checkoutState);
  } catch (_pricingErr) {
    // best-effort : ne bloque pas le 0 € (le finaliseur fait foi).
  }
}
