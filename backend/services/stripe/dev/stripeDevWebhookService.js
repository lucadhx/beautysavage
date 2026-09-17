// services/stripe/dev/stripeDevWebhookService.js
// Sprint F2B — Extraction PUREMENT STRUCTURELLE de l'orchestration du webhook Stripe Dev
// (plateforme) hors de devWebhookController. Aucune modification de comportement.
//
// `handleDevWebhookFromRequest(req)` : récupère le client Dev (shim mockable) + le webhook
// secret (coffre), vérifie la signature (`constructEvent` sur le raw body), route l'événement
// vers les handlers, et renvoie un résultat `{ status, json }` (mappé par stripeDevResponseMapper).
// Statuts préservés : 500 (secret/client manquant ou erreur de traitement), 400 (signature),
// 200 (received).

import { getStripeDevClient } from '../../../utils/stripeDevClient.js';
import { getStripeDevWebhookSecret } from './stripeDevConfigService.js';
import {
  handlePaymentIntentSucceeded,
  handleSetupIntentSucceeded,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleDevCheckoutSessionCompleted
} from './stripeDevWebhookHandlers.js';

export async function handleDevWebhookFromRequest(req) {
  const stripeDevClient = await getStripeDevClient();
  const sig = req.headers['stripe-signature'];

  const webhookSecret = await getStripeDevWebhookSecret();

  if (!webhookSecret) {
    console.error('[DevWebhook] webhook_secret indisponible (coffre/.env).');
    return { status: 500, json: { ok: false, error: 'Webhook secret manquant.' } };
  }

  if (!stripeDevClient) {
    console.error('[DevWebhook] stripeDevClient non disponible.');
    return { status: 500, json: { ok: false, error: 'Client Stripe Developer non configuré.' } };
  }

  let event;
  try {
    event = stripeDevClient.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (error) {
    console.error('[DevWebhook] Signature invalide', error.message);
    return { status: 400, json: { ok: false, error: `Webhook signature invalide: ${error.message}` } };
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;
      case 'setup_intent.succeeded':
        await handleSetupIntentSucceeded(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'checkout.session.completed':
        // Sprint U3 — réconciliation UnifiedCheckout (la finalisation passe par PI/SetupIntent).
        await handleDevCheckoutSessionCompleted(event.data.object);
        break;
      default:
        // Ignore unhandled events
        break;
    }
    return { status: 200, json: { received: true } };
  } catch (error) {
    console.error('[DevWebhook] Erreur traitement event', event?.type, error);
    return { status: 500, json: { ok: false, error: 'Erreur traitement webhook.' } };
  }
}
