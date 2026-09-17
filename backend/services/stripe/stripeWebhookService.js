// services/stripe/stripeWebhookService.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE de l'orchestration du webhook Stripe institut
// hors de stripeController. Aucune modification de comportement.
//
// `handleWebhookFromRequest(req)` : lit le secret (coffre), vérifie la signature
// (`constructEvent` sur le raw body), route l'événement, persiste une trace safe sur panne
// de config/signature. Renvoie un résultat `{ status, json|send }` (mappé par
// stripeResponseMapper). Les statuts (500 config, 400 signature, 200 received) sont préservés.

import { getStripeClient, getStripeWebhookSecret } from './stripeConfigService.js';
import { recordWebhookFailure } from '../webhookFailureService.js';
import { handleRefundUpdatedEvent } from './stripeRefundEventService.js';
import {
  handlePaymentFailedEvent,
  handlePaymentIntentSucceededEvent,
  handleCheckoutSessionCompletedEvent
} from './stripeWebhookEventHandlers.js';

export async function handleWebhookFromRequest(req) {
  const stripe = await getStripeClient();
  const sig = req.headers['stripe-signature'];
  const webhookSecret = await getStripeWebhookSecret();

  if (!webhookSecret) {
    console.error('[Stripe Webhook] webhook_secret indisponible (coffre/.env)');
    // A6 — panne de configuration : trace persistante safe (best-effort).
    await recordWebhookFailure({
      provider: 'stripe',
      webhookType: 'institut',
      failureStage: 'config',
      errorCode: 'WEBHOOK_SECRET_UNAVAILABLE',
      errorMessageSafe: 'webhook_secret indisponible (coffre/.env)',
      retryable: false
    });
    return { status: 500, send: 'Configuration webhook manquante.' };
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.warn('[Stripe Webhook] Signature invalide:', err.message);
    // A6 — signature invalide : trace minimale safe (non rejouable).
    await recordWebhookFailure({
      provider: 'stripe',
      webhookType: 'institut',
      failureStage: 'signature',
      errorCode: 'SIGNATURE_INVALID',
      errorMessageSafe: 'Signature webhook invalide',
      retryable: false
    });
    return { status: 400, send: `Webhook signature invalide: ${err.message}` };
  }

  if (event.type === 'charge.refund.updated') {
    await handleRefundUpdatedEvent(event).catch(err =>
      console.error('[Stripe Webhook] Erreur traitement charge.refund.updated', err)
    );
    return { status: 200, json: { received: true } };
  }

  if (event.type === 'payment_intent.payment_failed') {
    return handlePaymentFailedEvent(event);
  }

  // Sprint U2 — Stripe Checkout hébergé : réconciliation UnifiedCheckout (finalisation idempotente).
  if (event.type === 'checkout.session.completed') {
    return handleCheckoutSessionCompletedEvent(event);
  }

  if (event.type !== 'payment_intent.succeeded') {
    return { status: 200, json: { received: true } };
  }

  return handlePaymentIntentSucceededEvent(event);
}
