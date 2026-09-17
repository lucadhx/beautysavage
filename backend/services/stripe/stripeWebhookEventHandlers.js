// services/stripe/stripeWebhookEventHandlers.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE des handlers d'événements Stripe webhook
// (`payment_intent.succeeded`, `payment_intent.payment_failed`) hors de stripeController.
// Aucune modification de comportement : logique déplacée verbatim, les `res.status().json()/
// .send()` deviennent des résultats `{ status, json|send }` (mappés par stripeResponseMapper).
//
// `payment_intent.succeeded` est l'UNIQUE déclencheur de création de vente : idempotence
// (E11000 sur l'index PI unique), fallback metadata, retry local borné, récupération des
// frais Stripe différée. Les échecs persistent une trace safe (WebhookFailureLog) AVANT de
// renvoyer 500 (Stripe retente).

import Sale from '../../models/Sale.js';
import StripeCheckoutIntent from '../../models/StripeCheckoutIntent.js';
import User from '../../models/user.js';
import { sendPaymentFailedEmail } from '../mailService.js';
import { resolvePublicBaseUrl } from '../system/domainResolver.js';
import { processCheckoutStatePurchase } from '../checkout/checkoutFacade.js';
import { recordWebhookFailure } from '../webhookFailureService.js';
import { releaseGiftCardReservationsForPaymentIntent } from '../giftCardReservationService.js';
import { buildWebhookFallbackPayload, normalizeStripeId } from './stripeMetadataService.js';
import { recoverStripeFeesAndUpdateSale, notifyPendingStripeFeeCreated } from './stripeFeeService.js';
// Sprint U2 — réconciliation UnifiedCheckout sur checkout.session.completed (Stripe hébergé).
import { findByCheckoutId, updateCheckout } from '../checkout/unified/unifiedCheckoutRepository.js';
import { finalizeUnifiedCheckout } from '../checkout/unified/unifiedCheckoutFinalizer.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Phase 1B-1: a concurrent/duplicate webhook racing to create the same sale hits
// the unique partial index on Sale.stripePaymentIntentId → MongoDB E11000. We treat
// that as "already processed" (idempotent), not a critical failure.
function isDuplicateStripePaymentSaleError(error) {
  if (!error || Number(error.code) !== 11000) return false;
  if (error.keyPattern && error.keyPattern.stripePaymentIntentId) return true;
  return String(error.message || '').includes('stripePaymentIntentId');
}

function isRetryablePurchaseProcessingError(error) {
  if (!error || typeof error !== 'object') return false;
  const status = Number(error?.status || 0);
  if (status >= 500) return true;
  if (status > 0 && status < 500) return false;
  const name = String(error?.name || '').trim();
  if (
    [
      'MongoNetworkError',
      'MongoServerSelectionError',
      'MongooseServerSelectionError',
      'MongoWriteConcernError',
      'MongoCursorExhaustedError'
    ].includes(name)
  ) {
    return true;
  }
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('connection') ||
    message.includes('topology was destroyed')
  );
}

export async function handlePaymentFailedEvent(event) {
  const failedPaymentIntent = event?.data?.object;
  const failedPaymentIntentId = normalizeStripeId(failedPaymentIntent?.id);
  if (!failedPaymentIntentId) {
    return { status: 200, json: { received: true } };
  }
  try {
    const releaseResult = await releaseGiftCardReservationsForPaymentIntent(failedPaymentIntentId, {
      reason: 'payment_failed'
    });
    console.log('[Stripe Webhook] Reservation carte cadeau liberee (payment_failed)', {
      paymentIntentId: failedPaymentIntentId,
      matchedCards: releaseResult.matchedCards,
      modifiedCards: releaseResult.modifiedCards
    });
    // LOT2 P1-12 — e-mail client « paiement non abouti » (best-effort, ne bloque jamais le webhook).
    try {
      let toEmail = String(failedPaymentIntent?.receipt_email || '').trim();
      let firstName = '';
      let itemDetail = '';
      const amountEur = Number(failedPaymentIntent?.amount || 0) / 100;
      const intent = await StripeCheckoutIntent
        .findOne({ $or: [{ stripeSessionId: failedPaymentIntentId }, { stripePaymentIntentId: failedPaymentIntentId }, { paymentIntentId: failedPaymentIntentId }] })
        .lean()
        .catch(() => null);
      const item = intent?.checkoutState?.item || null;
      if (item?.name) itemDetail = String(item.name);
      if (intent?.userId) {
        const u = await User.findById(intent.userId).select('firstName lastName email').lean().catch(() => null);
        if (u) {
          if (!toEmail) toEmail = String(u.email || '').trim();
          firstName = String(u.firstName || '').trim();
        }
      }
      if (toEmail) {
        await sendPaymentFailedEmail({
          toEmail,
          firstName,
          itemDetail: itemDetail || 'votre commande',
          amount: amountEur ? amountEur.toFixed(2) : '',
          actionUrl: resolvePublicBaseUrl()
        });
      }
    } catch (mailErr) {
      console.error('[Stripe Webhook] Erreur envoi email payment_failed', mailErr?.message || mailErr);
    }
    return { status: 200, json: { received: true } };
  } catch (error) {
    console.error('[Stripe Webhook] Erreur liberation reservation carte cadeau (payment_failed)', {
      paymentIntentId: failedPaymentIntentId
    });
    console.error('[Stripe Webhook] Erreur complete:', error);
    console.error('[Stripe Webhook] Stack:', error?.stack || '(stack indisponible)');
    return { status: 500, send: 'Erreur liberation reservation carte cadeau.' };
  }
}

// Sprint U2 — Stripe Checkout HÉBERGÉ : finalise via le moteur UnifiedCheckout (qui délègue au
// finaliseur EXISTANT processCheckoutStatePurchase). Idempotent : le webhook payment_intent.
// succeeded peut aussi finaliser la même vente ; l'index PI unique garantit une seule Sale.
export async function handleCheckoutSessionCompletedEvent(event) {
  const session = event?.data?.object || {};
  const unifiedCheckoutId = String(session?.metadata?.unifiedCheckoutId || session?.metadata?.checkoutId || '').trim();
  const paymentIntentId = normalizeStripeId(
    typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id
  );

  // Session non issue d'UnifiedCheckout → ignorer (compat : le PI webhook gère le reste).
  if (!unifiedCheckoutId) {
    return { status: 200, json: { received: true } };
  }

  const checkout = await findByCheckoutId(unifiedCheckoutId);
  if (!checkout) {
    return { status: 200, json: { received: true, idempotent: true } };
  }

  // Idempotence : vente déjà créée (replay, ou webhook payment_intent.succeeded déjà passé) →
  // réconcilier l'UnifiedCheckout et répondre idempotent SANS re-finaliser.
  if (paymentIntentId) {
    const existingSale = await Sale.findOne({
      $or: [{ stripeSessionId: paymentIntentId }, { stripePaymentIntentId: paymentIntentId }]
    }).select('saleId').lean();
    if (existingSale) {
      await updateCheckout(checkout.checkoutId, {
        status: 'finalized',
        'finalization.saleId': existingSale.saleId,
        'finalization.finalizedAt': new Date(),
        'payment.status': 'succeeded',
        'payment.stripePaymentIntentId': paymentIntentId
      }).catch(() => {});
      return { status: 200, json: { received: true, idempotent: true } };
    }
  }

  // checkoutState complet récupéré depuis le StripeCheckoutIntent (clé = PI id, comme le flux PI).
  let checkoutState = null;
  let intentUserId = checkout.userId;
  let clientIp = '0.0.0.0';
  if (paymentIntentId) {
    const intent = await StripeCheckoutIntent.findOne({ stripeSessionId: paymentIntentId }).lean();
    if (intent?.checkoutState) {
      checkoutState = intent.checkoutState;
      intentUserId = intent.userId || intentUserId;
      clientIp = intent.clientIp || clientIp;
    }
  }
  if (!checkoutState) {
    // Pas de contexte → laisser le webhook PI existant faire foi (idempotent).
    return { status: 200, json: { received: true } };
  }

  try {
    await finalizeUnifiedCheckout(checkout, {
      checkoutState,
      userId: intentUserId,
      clientIp,
      stripeSessionId: paymentIntentId,
      stripePaymentIntentId: paymentIntentId
    });
  } catch (error) {
    // Vente déjà créée (race avec payment_intent.succeeded) → idempotent.
    if (isDuplicateStripePaymentSaleError(error)) {
      return { status: 200, json: { received: true, idempotent: true } };
    }
    console.error('[Stripe Webhook] Erreur finalisation checkout.session.completed', error);
    await recordWebhookFailure({
      provider: 'stripe',
      webhookType: 'institut',
      eventType: event.type,
      failureStage: 'processing',
      errorCode: error?.code ? String(error.code) : 'HOSTED_CHECKOUT_PROCESSING_ERROR',
      errorMessageSafe: 'Echec finalisation hosted checkout',
      stripeEventId: event.id,
      paymentIntentId,
      retryable: true
    });
    return { status: 500, send: 'Erreur interne lors de la finalisation hosted checkout.' };
  }

  return { status: 200, json: { received: true } };
}

export async function handlePaymentIntentSucceededEvent(event) {
  const paymentIntent = event.data.object;
  const stripeSessionId = paymentIntent.id; // PI ID used as idempotence key
  const intentId = paymentIntent.metadata?.intentId;

  // Idempotence: sale already exists for this PaymentIntent ID?
  const existingSale = await Sale.findOne({
    $or: [{ stripeSessionId }, { stripePaymentIntentId: stripeSessionId }]
  }).lean();
  if (existingSale) {
    console.log('[Stripe Webhook] Vente deja traitee pour PI', stripeSessionId);
    return { status: 200, json: { received: true, idempotent: true } };
  }

  // Primary source: StripeCheckoutIntent in DB. Fallback: PaymentIntent metadata.
  let intent = null;
  if (intentId) {
    intent = await StripeCheckoutIntent.findById(intentId).lean();
  }
  if (!intent) {
    intent = await StripeCheckoutIntent.findOne({ stripeSessionId }).lean();
  }

  let userId = null;
  let itemType = '';
  let itemId = '';
  let sessionId = null;
  let selectedOptions = [];
  let appliedGiftCards = [];
  let clientIp = '';
  let waiverText = null;
  let checkoutState = null;

  if (intent?.checkoutState && intent?.userId) {
    checkoutState = intent.checkoutState;
    const item = checkoutState?.item || {};
    userId = intent.userId;
    itemType = item.type;
    itemId = item.id;
    sessionId = item.sessionId || null;
    selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
    appliedGiftCards = Array.isArray(checkoutState.appliedGiftCards) ? checkoutState.appliedGiftCards : [];
    clientIp = intent.clientIp || '0.0.0.0';
    waiverText = checkoutState?.legal?.waiverText || null;
  } else {
    const fallbackPayload = buildWebhookFallbackPayload(paymentIntent);
    if (!fallbackPayload) {
      console.error('[Stripe Webhook] Contexte achat introuvable (DB + metadata) pour PI', stripeSessionId, {
        hasIntentId: Boolean(intentId)
      });
      await recordWebhookFailure({
        provider: 'stripe',
        webhookType: 'institut',
        eventType: event.type,
        failureStage: 'processing',
        errorCode: 'CHECKOUT_CONTEXT_NOT_FOUND',
        errorMessageSafe: 'Contexte achat introuvable (DB + metadata)',
        stripeEventId: event.id,
        paymentIntentId: stripeSessionId,
        retryable: true
      });
      return { status: 500, send: 'Contexte achat introuvable pour ce paiement.' };
    }
    userId = fallbackPayload.userId;
    itemType = fallbackPayload.itemType;
    itemId = fallbackPayload.itemId;
    sessionId = fallbackPayload.sessionId;
    selectedOptions = fallbackPayload.selectedOptions;
    appliedGiftCards = fallbackPayload.appliedGiftCards;
    checkoutState = fallbackPayload.checkoutState || null;
    clientIp = '0.0.0.0';
    waiverText = checkoutState?.legal?.waiverText || null;
    console.warn('[Stripe Webhook] Fallback metadata utilise pour finaliser la vente', {
      stripeSessionId,
      itemType
    });
  }

  const paymentIntentId = String(paymentIntent?.id || '').trim() || null;

  try {
    let purchaseResult = null;
    let processingError = null;
    const maxLocalAttempts = 3;
    for (let attempt = 1; attempt <= maxLocalAttempts; attempt += 1) {
      try {
        purchaseResult = await processCheckoutStatePurchase({
          userId,
          itemType,
          itemId,
          sessionId,
          selectedOptions,
          appliedGiftCards,
          waiverText: waiverText || null,
          clientIp: clientIp || '0.0.0.0',
          stripeSessionId,
          stripePaymentIntentId: paymentIntentId,
          checkoutState
        });
        processingError = null;
        break;
      } catch (error) {
        // Concurrent/duplicate webhook lost the race to insert the sale → idempotent.
        if (isDuplicateStripePaymentSaleError(error)) {
          console.log(
            '[Stripe Webhook] Vente deja creee par un webhook concurrent (E11000), idempotent',
            stripeSessionId
          );
          return { status: 200, json: { received: true, idempotent: true } };
        }
        processingError = error;
        const retryable = isRetryablePurchaseProcessingError(error);
        console.error(
          '[Stripe Webhook] Echec traitement vente (tentative locale)',
          {
            stripeSessionId,
            attempt,
            maxLocalAttempts,
            retryable,
            status: error?.status || null,
            code: error?.code || null,
            message: error?.message || null
          },
          error
        );
        if (!retryable || attempt >= maxLocalAttempts) break;
        await sleep(1200 * attempt);
      }
    }
    if (processingError) {
      throw processingError;
    }

    if (paymentIntentId) {
      try {
        const stripeFees = await recoverStripeFeesAndUpdateSale({
          paymentIntentId,
          saleId: purchaseResult?.saleId,
          attempts: 3,
          retryDelayMs: 3000
        });
        if (stripeFees.updated) {
          console.log('[Stripe Webhook] Frais Stripe stockes pour PI', paymentIntentId);
        } else {
          console.log(
            '[Stripe Webhook] Frais Stripe indisponibles apres 3 tentatives, recuperation differree pour PI',
            paymentIntentId
          );
          notifyPendingStripeFeeCreated(purchaseResult?.saleId);
        }
      } catch (feesError) {
        console.error('[Stripe Webhook] Echec recuperation frais Stripe post-vente', feesError);
        notifyPendingStripeFeeCreated(purchaseResult?.saleId);
      }
    }

    console.log('[Stripe Webhook] Vente creee avec succes pour PI', stripeSessionId);
    return { status: 200, json: { received: true } };
  } catch (error) {
    console.error('[Stripe Webhook] Erreur traitement vente pour PI', stripeSessionId, error);
    console.error('[Stripe Webhook] Contexte erreur:', {
      stripeSessionId,
      status: error?.status || null,
      code: error?.code || null,
      message: error?.message || null
    });
    console.error('[Stripe Webhook] Erreur complete:', error);
    console.error('[Stripe Webhook] Stack:', error?.stack || '(stack indisponible)');
    // A6 — échec de traitement : trace persistante safe. Rejouable (Stripe retente),
    // donc retryable=true. On ne logge que des identifiants techniques + un code/message
    // neutre — jamais le payload Stripe ni de donnée sensible.
    await recordWebhookFailure({
      provider: 'stripe',
      webhookType: 'institut',
      eventType: event.type,
      failureStage: 'processing',
      errorCode: error?.code ? String(error.code) : 'PROCESSING_ERROR',
      errorMessageSafe: 'Echec traitement vente webhook',
      stripeEventId: event.id,
      paymentIntentId: stripeSessionId,
      retryable: true
    });
    // Return 500 so Stripe retries
    return { status: 500, send: 'Erreur interne lors du traitement de la vente.' };
  }
}
