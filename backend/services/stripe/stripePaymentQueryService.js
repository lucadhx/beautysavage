// services/stripe/stripePaymentQueryService.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE des lectures de statut/résultat de paiement
// (post-redirect) hors de stripeController. Aucune modification de comportement.
//
// `getSessionStatusFromRequest` / `getPaymentResultFromRequest` vérifient TOUJOURS Stripe + la
// propriété DB (jamais le redirect_status d'URL) et renvoient un résultat `{ status, json }`
// (mappé par stripeResponseMapper). Statuts/payloads préservés à l'identique.

import { getSessionUserId } from '../../utils/session.js';
import Sale from '../../models/Sale.js';
import StripeCheckoutIntent from '../../models/StripeCheckoutIntent.js';
import { getStripeClient } from './stripeConfigService.js';

function buildPaymentFailureMessage(paymentIntent) {
  const message = String(paymentIntent?.last_payment_error?.message || '').trim();
  if (message) return message;
  const status = String(paymentIntent?.status || '').trim().toLowerCase();
  if (status === 'canceled') return 'Le paiement a ete annule.';
  return 'Le paiement a ete refuse. Veuillez reessayer avec une autre carte.';
}

function buildPurchasePayload({ sale, fallbackCheckoutState, paymentIntentId }) {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const formationItem = items.find(item => String(item?.type || '').trim().toLowerCase() === 'formation');
  const firstItem = items[0] || null;
  const fallbackItem = fallbackCheckoutState?.item || {};
  const itemType = String(formationItem?.type || firstItem?.type || fallbackItem?.type || '')
    .trim()
    .toLowerCase();
  const itemName = String(formationItem?.name || firstItem?.name || fallbackItem?.name || '')
    .trim();
  const sessionDate =
    sale?.date_session ||
    sale?.date_formation ||
    fallbackCheckoutState?.legal?.dateFormation ||
    null;
  return {
    saleId: sale?.saleId || '',
    paymentIntentId,
    formationTitle: itemType === 'formation' ? itemName : '',
    itemTitle: itemName,
    type: itemType || 'purchase',
    sessionDate,
    totalAmount: Number(sale?.totalAmount || 0),
    purchasedAt: sale?.createdAt || sale?.date_achat || null
  };
}

function getRetryOrigin(intentDoc = null) {
  const origin = intentDoc?.checkoutState?.origin;
  if (!origin || typeof origin !== 'object') return null;
  const slug = String(origin.slug || '').trim().toLowerCase();
  const query = origin.query && typeof origin.query === 'object' ? origin.query : {};
  if (!slug) return null;
  return { slug, query };
}

/**
 * GET /api/stripe/session-status?payment_intent_id=pi_xxx
 * Returns payment status + origin/item for post-redirect frontend flow.
 */
export async function getSessionStatusFromRequest(req) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return { status: 401, json: { ok: false, error: 'Authentification requise.' } };
  }

  const requestedId = String(req.query.payment_intent_id || req.query.session_id || '').trim();
  if (!requestedId) {
    return { status: 400, json: { ok: false, error: 'payment_intent_id manquant.' } };
  }

  try {
    const stripe = await getStripeClient();

    // R2C — le retour Stripe hébergé transporte un id de Checkout Session (`cs_…`) : on le résout
    // d'abord en PaymentIntent. Le chemin `pi_…` reste inchangé.
    let paymentIntentId = requestedId;
    if (requestedId.startsWith('cs_')) {
      const checkoutSession = await stripe.checkout.sessions.retrieve(requestedId);
      paymentIntentId = String(checkoutSession?.payment_intent || '').trim();
      if (!paymentIntentId) {
        return {
          status: 200,
          json: { ok: true, status: 'open', payment_status: 'unpaid', origin: null, item: null }
        };
      }
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Look up our intent for origin + item
    const intent = await StripeCheckoutIntent.findOne({ stripeSessionId: paymentIntentId }).lean();

    // Security: verify this PI belongs to the requesting user
    if (intent && intent.userId.toString() !== String(userId)) {
      return { status: 403, json: { ok: false, error: 'Acces refuse.' } };
    }

    // Map PaymentIntent status → 'complete' | 'open'
    const status = pi.status === 'succeeded' ? 'complete' : 'open';

    return {
      status: 200,
      json: {
        ok: true,
        status,
        payment_status: pi.status,
        origin: intent?.checkoutState?.origin || null,
        item: intent?.checkoutState?.item
          ? {
              type: intent.checkoutState.item.type,
              id: intent.checkoutState.item.id,
              name: intent.checkoutState.item.name
            }
          : null
      }
    };
  } catch (error) {
    console.error('[Stripe] Erreur lecture statut PaymentIntent', error);
    return { status: 500, json: { ok: false, error: 'Impossible de recuperer le statut du paiement.' } };
  }
}

/**
 * GET /api/stripe/payment-result?payment_intent_id=pi_xxx
 * Secure payment result: never trust URL redirect_status, always verify Stripe + DB ownership.
 */
export async function getPaymentResultFromRequest(req) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return { status: 401, json: { ok: false, error: 'Authentification requise.' } };
  }

  const paymentIntentId = String(req.query.payment_intent_id || '').trim();
  if (!paymentIntentId) {
    return { status: 400, json: { ok: false, error: 'payment_intent_id manquant.' } };
  }

  try {
    const stripe = await getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    const sale = await Sale.findOne({
      $or: [{ stripePaymentIntentId: paymentIntentId }, { stripeSessionId: paymentIntentId }]
    }).lean();
    if (sale) {
      if (String(sale.userId || '') !== String(userId)) {
        return { status: 403, json: { ok: false, error: 'Acces refuse.' } };
      }
      const fallbackIntent = await StripeCheckoutIntent.findOne({ stripeSessionId: paymentIntentId }).lean();
      return {
        status: 200,
        json: {
          ok: true,
          status: 'succeeded',
          purchase: buildPurchasePayload({
            sale,
            fallbackCheckoutState: fallbackIntent?.checkoutState || null,
            paymentIntentId
          }),
          origin: getRetryOrigin(fallbackIntent)
        }
      };
    }

    const metadataIntentId = String(paymentIntent?.metadata?.intentId || '').trim();
    let fallbackIntent = null;
    if (metadataIntentId) {
      fallbackIntent = await StripeCheckoutIntent.findById(metadataIntentId).lean();
    }
    if (!fallbackIntent) {
      fallbackIntent = await StripeCheckoutIntent.findOne({ stripeSessionId: paymentIntentId }).lean();
    }
    if (fallbackIntent && String(fallbackIntent.userId || '') !== String(userId)) {
      return { status: 403, json: { ok: false, error: 'Acces refuse.' } };
    }

    const piStatus = String(paymentIntent?.status || '').trim().toLowerCase();
    if (piStatus === 'succeeded') {
      return {
        status: 200,
        json: {
          ok: true,
          status: 'pending',
          origin: getRetryOrigin(fallbackIntent)
        }
      };
    }
    if (piStatus === 'requires_payment_method' || piStatus === 'canceled') {
      return {
        status: 200,
        json: {
          ok: true,
          status: 'failed',
          errorMessage: buildPaymentFailureMessage(paymentIntent),
          origin: getRetryOrigin(fallbackIntent)
        }
      };
    }
    return {
      status: 200,
      json: {
        ok: true,
        status: 'pending',
        origin: getRetryOrigin(fallbackIntent)
      }
    };
  } catch (error) {
    if (error?.type === 'StripeInvalidRequestError') {
      return { status: 400, json: { ok: false, error: 'PaymentIntent introuvable.' } };
    }
    console.error('[Stripe] Erreur lecture resultat paiement', error);
    return { status: 500, json: { ok: false, error: 'Impossible de verifier le resultat du paiement.' } };
  }
}
