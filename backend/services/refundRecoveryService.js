import RefundRequest from '../models/RefundRequest.js';
import { triggerRefundExecution } from './refundExecutionService.js';
import { getCredential } from './integratedApiCredentialService.js';

const RECOVERABLE_REFUND_STATUSES = ['requested', 'pending'];

// LOT2 — Cycle de reprise borné : classification d'erreurs, backoff, état terminal.
const MAX_STRIPE_REFUND_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 60 * 60 * 1000; // 1 h
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 h
const CONFIG_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6 h (credential manquant → différé, jamais final)

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isRecoverableRefundRequest(refundRequest) {
  return RECOVERABLE_REFUND_STATUSES.includes(normalizeStatus(refundRequest?.status));
}

/**
 * Classe une erreur d'exécution de remboursement en un code métier + retryable.
 * @returns {{code:string, retryable:boolean, terminal:boolean}}
 */
export function classifyRefundError(error) {
  const name = String(error?.name || '');
  const msg = String(error?.message || '');
  const status = error?.status ?? error?.statusCode;

  if (
    name === 'CredentialNotFoundError' ||
    name === 'IntegratedApiNotFoundError' ||
    name === 'CredentialUnfilledError' ||
    /no active credential|integration not found|credential is an unfilled/i.test(msg)
  ) {
    return { code: 'MISSING_CREDENTIAL', retryable: false, terminal: false }; // différé jusqu'à config
  }
  if (/transaction introuvable|vente introuvable/i.test(msg)) {
    return { code: 'TRANSACTION_NOT_FOUND', retryable: false, terminal: true };
  }
  if (status === 429 || error?.type === 'StripeRateLimitError' || /rate limit/i.test(msg)) {
    return { code: 'RATE_LIMITED', retryable: true, terminal: false };
  }
  if (
    error?.type === 'StripeConnectionError' ||
    /network|timeout|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|EAI_AGAIN/i.test(msg)
  ) {
    return { code: 'PROVIDER_UNAVAILABLE', retryable: true, terminal: false };
  }
  if (status === 409 || /conflit|invalid state|already/i.test(msg)) {
    return { code: 'INVALID_STATE', retryable: false, terminal: true };
  }
  return { code: 'UNKNOWN', retryable: true, terminal: false };
}

function computeBackoffMs(attempts) {
  const factor = Math.min(Math.max(attempts, 1), 6);
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, factor - 1), MAX_BACKOFF_MS);
}

/**
 * Applique l'état d'échec (attempts/backoff/terminal) sur un RefundRequest et le persiste.
 * @returns {{code:string, deferred:boolean, finalFailed:boolean, configurationBlocked:boolean}}
 */
export async function applyRefundFailureState(refundRequestId, classification, now = new Date()) {
  const doc = await RefundRequest.findById(refundRequestId);
  if (!doc) return { code: classification.code, deferred: false, finalFailed: false, configurationBlocked: false };

  doc.stripeRefundAttempts = (doc.stripeRefundAttempts || 0) + 1;
  doc.lastRefundAttemptAt = now;
  doc.lastRefundErrorCode = classification.code;
  doc.refundRetryable = classification.retryable;

  let deferred = false;
  let finalFailed = false;
  let configurationBlocked = false;

  if (classification.code === 'MISSING_CREDENTIAL') {
    // Config manquante : différé (long), JAMAIS final — se résout quand les clés sont saisies.
    doc.nextRefundRetryAt = new Date(now.getTime() + CONFIG_BACKOFF_MS);
    doc.refundFailedFinalAt = null;
    deferred = true;
    configurationBlocked = true;
  } else if (classification.terminal) {
    // Erreur terminale (transaction introuvable, état invalide) → plus jamais retenté.
    doc.nextRefundRetryAt = null;
    doc.refundFailedFinalAt = now;
    finalFailed = true;
  } else if (doc.stripeRefundAttempts >= MAX_STRIPE_REFUND_ATTEMPTS) {
    // Plafond de tentatives atteint → abandon (reprise manuelle).
    doc.nextRefundRetryAt = null;
    doc.refundFailedFinalAt = now;
    finalFailed = true;
  } else {
    // Retryable → replanifié avec backoff exponentiel.
    doc.nextRefundRetryAt = new Date(now.getTime() + computeBackoffMs(doc.stripeRefundAttempts));
    deferred = true;
  }

  await doc.save();
  return { code: classification.code, deferred, finalFailed, configurationBlocked };
}

export async function listRecoverableRefundRequests({ limit = 100, now = new Date() } = {}) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Number(limit))) : 100;
  return RefundRequest.find({
    status: { $in: RECOVERABLE_REFUND_STATUSES },
    // Jamais les échecs définitifs.
    $and: [
      { $or: [{ refundFailedFinalAt: null }, { refundFailedFinalAt: { $exists: false } }] },
      // Respecte le backoff : uniquement les remboursements dus (ou jamais tentés).
      { $or: [{ nextRefundRetryAt: null }, { nextRefundRetryAt: { $exists: false } }, { nextRefundRetryAt: { $lte: now } }] }
    ]
  })
    .sort({ requestedAt: 1 })
    .limit(safeLimit);
}

export async function recoverRefundRequest(refundRequestInput, { saleInput = null } = {}) {
  const refundRequest =
    refundRequestInput && typeof refundRequestInput.save === 'function'
      ? refundRequestInput
      : refundRequestInput?._id
        ? await RefundRequest.findById(refundRequestInput._id)
        : null;

  if (!refundRequest) {
    return { refund: null, recovered: false, skipped: true, reason: 'refund_not_found' };
  }
  if (!isRecoverableRefundRequest(refundRequest)) {
    return {
      refund: refundRequest,
      recovered: false,
      skipped: true,
      reason: `status_${normalizeStatus(refundRequest.status)}`
    };
  }

  const sale = saleInput && typeof saleInput === 'object' ? saleInput : null;
  try {
    const execution = await triggerRefundExecution(refundRequest, sale);
    return {
      refund: execution?.refund || refundRequest,
      recovered: true,
      stripeInitiated: Boolean(execution?.stripeInitiated),
      mode: execution?.mode || 'recovered'
    };
  } catch (error) {
    return {
      refund: refundRequest,
      recovered: false,
      skipped: false,
      error
    };
  }
}

// Lecture-seule : le compte Stripe institut est-il configuré (secret_key résolvable) ?
async function isStripeInstitutConfigured() {
  try {
    const key = await getCredential('stripe-institut', { role: 'secret_key' });
    return Boolean(key);
  } catch (_err) {
    return false;
  }
}

export async function runRefundRecovery({ limit = 100, trigger = 'cycle' } = {}) {
  const now = new Date();
  const summary = {
    inspectedCount: 0,
    recoveredCount: 0,
    skippedCount: 0,
    failedCount: 0,
    deferredCount: 0,
    finalFailedCount: 0,
    configurationBlockedCount: 0,
    stripeConfigured: true
  };

  try {
    summary.stripeConfigured = await isStripeInstitutConfigured();
    const refundRequests = await listRecoverableRefundRequests({ limit, now });
    summary.inspectedCount = refundRequests.length;

    for (const refundRequest of refundRequests) {
      try {
        const result = await recoverRefundRequest(refundRequest);
        if (result.recovered) {
          summary.recoveredCount += 1;
        } else if (result.skipped) {
          summary.skippedCount += 1;
        } else {
          // Échec classé → état de reprise borné (backoff / terminal). Pas de stack par
          // remboursement : on n'accumule que des compteurs, résumés en une ligne en fin de cycle.
          summary.failedCount += 1;
          const classification = classifyRefundError(result.error);
          const applied = await applyRefundFailureState(refundRequest._id, classification, now);
          if (applied.finalFailed) summary.finalFailedCount += 1;
          if (applied.deferred) summary.deferredCount += 1;
          if (applied.configurationBlocked) summary.configurationBlockedCount += 1;
        }
      } catch (error) {
        // Erreur inattendue hors exécution (ex. save) — comptée, non fatale.
        summary.failedCount += 1;
        console.error('[RefundRecovery] traitement inattendu échoué', {
          refundId: String(refundRequest?.refundId || '').trim() || 'n/a',
          error: error?.message || 'unknown error'
        });
      }
    }
  } catch (error) {
    console.error('[RefundRecovery] cycle échoué', error?.message || error);
  }

  // Résumé exploitable en UNE ligne (remplace N stacks à chaque démarrage).
  console.log(
    `[RefundRecovery] ${trigger}: inspected=${summary.inspectedCount} recovered=${summary.recoveredCount} ` +
      `deferred=${summary.deferredCount} finalFailed=${summary.finalFailedCount} ` +
      `configurationBlocked=${summary.configurationBlockedCount} stripeConfigured=${summary.stripeConfigured}`
  );

  return summary;
}
