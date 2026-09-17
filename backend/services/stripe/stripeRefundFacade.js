// services/stripe/stripeRefundFacade.js
// Pré-React E2 (refactor) — SEAM (couture) structurelle, sans modification de comportement.
// Façade unifiée pour le déclenchement des remboursements Stripe et l'évaluation
// d'éligibilité. L'orchestration métier (éligibilité, provisions de commission, etc.) reste
// dans refundService/refundExecutionService ; ce module matérialise la frontière
// `services/stripe/` (rapport 120) pour les orchestrateurs, sans déplacer la logique.

export { triggerRefundExecution } from '../refundExecutionService.js';
export {
  getPresentielRefundEligibility,
  getDistancielRefundEligibility,
  getServiceRefundEligibility
} from '../refundService.js';
