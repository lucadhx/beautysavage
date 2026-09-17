// services/webhookFailureService.js
// Sprint pré-React A6 — Enregistrement SAFE des pannes webhook.
//
// `recordWebhookFailure` est best-effort : il ne throw JAMAIS vers le flux webhook
// (une panne d'observabilité ne doit pas masquer la vraie réponse au provider) et ne
// persiste aucune donnée sensible. Un duplicate idempotent N'EST PAS une panne et ne
// doit pas être enregistré ici (l'appelant filtre ce cas).

import WebhookFailureLog from '../models/WebhookFailureLog.js';
import { notifyDevAlert } from './devAlertService.js';

const MAX_SAFE_MESSAGE = 300;

// Réduit un message d'erreur à une forme courte et neutre. On ne garde que le texte
// fourni par l'appelant (déjà choisi safe) tronqué — on ne sérialise jamais l'objet
// erreur complet (qui pourrait contenir un payload).
function sanitizeMessage(message) {
  const raw = String(message || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.slice(0, MAX_SAFE_MESSAGE);
}

function sanitizeId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // Identifiants techniques attendus (pi_..., evt_...) : caractères alphanum/_/-.
  return /^[A-Za-z0-9_\-]+$/.test(raw) ? raw.slice(0, 120) : null;
}

/**
 * Enregistre une panne webhook. Ne throw jamais.
 * @param {object} input
 * @param {string} [input.provider='stripe']
 * @param {string} [input.webhookType]
 * @param {string} [input.eventType]
 * @param {string} [input.failureStage] 'signature' | 'processing' | ...
 * @param {string} [input.errorCode]
 * @param {string} [input.errorMessageSafe] message court, déjà safe
 * @param {string} [input.stripeEventId]
 * @param {string} [input.paymentIntentId]
 * @param {boolean} [input.retryable=false]
 * @returns {Promise<object|null>}
 */
export async function recordWebhookFailure({
  provider = 'stripe',
  webhookType = null,
  eventType = null,
  failureStage = null,
  errorCode = null,
  errorMessageSafe = '',
  stripeEventId = null,
  paymentIntentId = null,
  retryable = false
} = {}) {
  try {
    const doc = await WebhookFailureLog.create({
      provider: String(provider || 'stripe'),
      webhookType: webhookType ? String(webhookType).slice(0, 60) : null,
      eventType: eventType ? String(eventType).slice(0, 80) : null,
      failureStage: failureStage ? String(failureStage).slice(0, 40) : null,
      errorCode: errorCode ? String(errorCode).slice(0, 80) : null,
      errorMessageSafe: sanitizeMessage(errorMessageSafe),
      stripeEventId: sanitizeId(stripeEventId),
      paymentIntentId: sanitizeId(paymentIntentId),
      status: 'failed',
      retryable: Boolean(retryable)
    });
    // P1-6 — alerte Dev uniquement sur panne DÉFINITIVE (retryable=false) pour ne pas spammer
    // à chaque nouvelle tentative Stripe. Best-effort, ne throw jamais.
    if (!retryable) {
      notifyDevAlert('webhook_failure', {
        provider: String(provider || 'stripe'),
        eventType: eventType || '—',
        failureStage: failureStage || '—',
        errorMessage: errorMessageSafe || errorCode || 'Panne webhook'
      });
    }
    return doc.toObject();
  } catch (err) {
    // L'observabilité ne doit jamais casser le webhook.
    console.error('[webhookFailure] enregistrement impossible:', err?.message || err);
    return null;
  }
}

export default recordWebhookFailure;
