// Consentements légaux (R2A) : état + complétude. UX seulement ; backend = autorité.
import type { LegalConsentState } from './types';

export const EMPTY_LEGAL_CONSENT: LegalConsentState = {
  acceptedCgv: false,
  acknowledgedRetractation: false,
  acknowledgedDatedService: false,
  waiverAccepted: false,
  waiverType: 'none',
  acceptedAt: null,
};

export interface ConsentRequirements {
  /** La prestation est datée → l'utilisateur doit reconnaître l'exécution à la date choisie. */
  datedService?: boolean;
  /** Information droit de rétractation à reconnaître. */
  retractation?: boolean;
}

/** Vrai si tous les consentements requis sont cochés (CGV toujours requise). */
export function isLegalConsentComplete(
  state: LegalConsentState,
  req: ConsentRequirements = {},
): boolean {
  if (!state.acceptedCgv) return false;
  if (req.retractation && !state.acknowledgedRetractation) return false;
  if (req.datedService && !state.acknowledgedDatedService) return false;
  return true;
}
