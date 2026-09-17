import type { LegalConsentState } from '@bs/api-client';

// Construit la partie `legal` du payload checkout depuis l'état UI. `acceptedAt` injecté par l'appelant.
export function buildLegalConsentPayload(state: LegalConsentState, acceptedAt: string) {
  return {
    acceptedCgv: Boolean(state.acceptedCgv),
    waiverAccepted: Boolean(state.acknowledgedRetractation || state.acknowledgedDatedService || state.waiverAccepted),
    waiverType: state.waiverType || (state.acknowledgedDatedService ? 'service-dated' : 'none'),
    waiverAcceptedAt: state.acceptedCgv ? acceptedAt : null,
  };
}
