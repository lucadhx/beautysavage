// controllers/devWebhookController.js
// Sprint F2B — Orchestrateur HTTP mince du webhook Stripe Dev (plateforme). La logique
// (signature, routing, handlers d'événements contrat/abonnement/commission) vit dans
// services/stripe/dev/*. Le contrôleur ne fait que : requête → service → réponse HTTP.
// Signature `(req, res)` conservée (monté raw-body dans app.js avant express.json, et appelé
// directement en test). Aucun changement de contrat API / statut / payload.

import { handleDevWebhookFromRequest } from '../services/stripe/dev/stripeDevWebhookService.js';
import { send as sendDevResponse } from '../services/stripe/dev/stripeDevResponseMapper.js';

export async function handleDevWebhook(req, res) {
  return sendDevResponse(res, await handleDevWebhookFromRequest(req));
}
