// services/checkout/unified/unifiedCheckoutValidationService.js
// Sprint U1 — Validation d'un checkout via les services EXISTANTS (aucune règle dupliquée) :
// consentements légaux (A1), offre prête (A7), disponibilité créneau prestation. Construit le
// legalConsentSnapshot. Lève les mêmes erreurs/codes que les flux actuels.

import {
  deriveLegalRequirements,
  validateCheckoutLegalConsents,
  buildLegalConsentSnapshot
} from '../../legalConsentService.js';
import { assertCheckoutFormationsPurchasable } from '../../offerReadinessService.js';
import { assertGlobalServiceSlotBookable } from '../../calendar/globalAvailabilityService.js';

/**
 * Valide un checkoutState (legal + offre + créneau si prestation) et renvoie le snapshot légal.
 * @returns {Promise<{ legalConsentSnapshot: object|null }>}
 * @throws erreurs normalisées (LEGAL_CONSENT_REQUIRED, OFFER_*, SLOT_*) — identiques aux flux actuels.
 */
export async function validateUnifiedCheckout({ checkoutState, kind, source = null, now = new Date() }) {
  // A1 — consentements légaux dérivés du catalogue (jamais des booléens client).
  const legalRequirements = await deriveLegalRequirements(checkoutState, { now });
  validateCheckoutLegalConsents(checkoutState, legalRequirements);

  // A7 — offres formation non finies (distanciel immédiat sans accès) bloquées.
  await assertCheckoutFormationsPurchasable(checkoutState);

  // Prestation : créneau réservable GLOBALEMENT (institut unique ; practitionerId legacy ignoré).
  if (kind === 'service') {
    const svc = checkoutState?.service || {};
    if (svc?.serviceId && svc?.slotStart && svc?.slotEnd) {
      await assertGlobalServiceSlotBookable({
        serviceId: svc.serviceId,
        startAt: svc.slotStart,
        endAt: svc.slotEnd,
        now
      });
    }
  }

  const legalConsentSnapshot = buildLegalConsentSnapshot({
    checkoutState,
    acceptedAt: now,
    source: source || 'unified_checkout'
  });

  return { legalConsentSnapshot };
}
