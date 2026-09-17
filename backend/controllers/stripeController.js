// controllers/stripeController.js
// Sprint F2 — Orchestrateur HTTP mince du domaine Stripe. Toute la logique métier
// (config, checkout/PaymentIntent, webhook + handlers, refund event, frais, lectures de
// statut) vit dans services/stripe/*. Le contrôleur ne fait que : lire la requête → appeler
// le service → mapper le résultat en réponse HTTP (stripeResponseMapper). Aucun changement
// de contrat API / statut / payload (cf. rapport 126).

import { getSessionUserId } from '../utils/session.js';
import { send as sendStripeResponse } from '../services/stripe/stripeResponseMapper.js';
import { getStripePublishableKey } from '../services/stripe/stripeConfigService.js';
import { createCheckoutSessionFromRequest } from '../services/stripe/stripeCheckoutService.js';
import { handleWebhookFromRequest } from '../services/stripe/stripeWebhookService.js';
import {
  getSessionStatusFromRequest,
  getPaymentResultFromRequest
} from '../services/stripe/stripePaymentQueryService.js';
import {
  recoverStripeFeesAndUpdateSale,
  countPendingStripeFeesSales
} from '../services/stripe/stripeFeeService.js';

/**
 * POST /api/stripe/create-checkout-session
 */
export async function createCheckoutSession(req, res) {
  return sendStripeResponse(res, await createCheckoutSessionFromRequest(req));
}

/**
 * POST /api/stripe/webhook  (raw body)
 * Signature `(req, res)` conservée — appelé directement en test.
 */
export async function handleWebhook(req, res) {
  return sendStripeResponse(res, await handleWebhookFromRequest(req));
}

/**
 * GET /api/stripe/session-status?payment_intent_id=pi_xxx
 */
export async function getSessionStatus(req, res) {
  return sendStripeResponse(res, await getSessionStatusFromRequest(req));
}

/**
 * GET /api/stripe/payment-result?payment_intent_id=pi_xxx
 */
export async function getPaymentResult(req, res) {
  return sendStripeResponse(res, await getPaymentResultFromRequest(req));
}

/**
 * GET /api/stripe/transaction-fees?paymentIntentId=pi_xxx
 * Admin/dev only: reads Stripe fee/net in real time from BalanceTransaction.
 */
export async function getTransactionFees(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const role = String(req?.sessionUser?.role || '').trim().toLowerCase();
  if (!['admin', 'dev'].includes(role)) {
    return res.status(403).json({ ok: false, error: 'Acces refuse.' });
  }

  const paymentIntentId = String(req.query.paymentIntentId || '').trim();
  if (!paymentIntentId) {
    return res.status(400).json({ ok: false, error: 'paymentIntentId manquant.' });
  }

  try {
    const stripeFees = await recoverStripeFeesAndUpdateSale({
      paymentIntentId,
      attempts: 1,
      retryDelayMs: 0
    });

    return res.json({
      ok: true,
      fee: stripeFees.fee,
      net: stripeFees.net,
      amount: stripeFees.amount,
      currency: stripeFees.currency,
      updated: Boolean(stripeFees.updated)
    });
  } catch (error) {
    if (error?.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ ok: false, error: 'PaymentIntent introuvable.' });
    }
    console.error('[Stripe] Erreur lecture transaction fees', error);
    return res.status(500).json({ ok: false, error: 'Impossible de recuperer les frais Stripe.' });
  }
}

/**
 * GET /api/stripe/pending-fees-count
 * Admin/dev only: count sales waiting for Stripe fee/net persistence.
 */
export async function getPendingFeesCount(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const role = String(req?.sessionUser?.role || '').trim().toLowerCase();
  if (!['admin', 'dev'].includes(role)) {
    return res.status(403).json({ ok: false, error: 'Acces refuse.' });
  }

  try {
    const count = await countPendingStripeFeesSales();
    return res.json({ ok: true, count });
  } catch (error) {
    console.error('[Stripe] Erreur calcul pending-fees-count', error);
    return res.status(500).json({ ok: false, error: 'Impossible de recuperer le compteur Stripe.' });
  }
}

/**
 * GET /api/stripe/config  (public)
 * Returns publishable key only. Never exposes STRIPE_SECRET_KEY.
 * Signature `(req, res)` conservée — appelé directement en test.
 */
export async function getConfig(req, res) {
  const publishableKey = await getStripePublishableKey();
  if (!publishableKey) {
    return res.status(500).json({ ok: false, error: 'Clé Stripe publishable indisponible (coffre/.env).' });
  }
  return res.json({ publishableKey });
}
