// Réexport des types de consentement (source : @bs/api-client) + définitions d'affichage.
export type { LegalConsentState, ConsentRequirements } from '@bs/api-client';
export { EMPTY_LEGAL_CONSENT, isLegalConsentComplete } from '@bs/api-client';

export interface ConsentItemDef {
  key: 'acceptedCgv' | 'acknowledgedRetractation' | 'acknowledgedDatedService';
  label: string;
  required: boolean;
}
