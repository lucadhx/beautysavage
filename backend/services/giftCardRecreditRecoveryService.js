// services/giftCardRecreditRecoveryService.js
// Pré-React C1 — Moteur de reprise du recrédit carte cadeau.
//
// Contexte : si un remboursement Stripe réussit mais que le recrédit de la carte cadeau
// échoue (refundGiftCardService.recreditGiftCardPortion throw), le RefundRequest est marqué
// `giftCardRefundStatus='rollback_needed'` (intervention requise). Ce service retente le
// recrédit de façon SÛRE et IDEMPOTENTE.
//
// Idempotence : on réutilise le claim atomique `claimGiftCardRecredit` (pose
// giftCardRecreditInProgress uniquement si pas déjà recrédité/en cours) → JAMAIS de
// double-crédit. Limite d'essais (MAX_ATTEMPTS) avant abandon manuel. Logs safe, events
// d'audit (gift_card.recredit_recovered / gift_card.recredit_failed).

import RefundRequest from '../models/RefundRequest.js';
import Sale from '../models/Sale.js';
import { recreditGiftCardPortion } from './refundGiftCardService.js';
import { claimGiftCardRecredit } from './refundRequestService.js';
import { emitGiftCardEvent } from './businessEventService.js';

const MAX_ATTEMPTS = 5;

function roundToCents(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(n * 100) / 100;
}

async function emitRecoveryEvent(eventName, refund, extra = {}) {
  try {
    await emitGiftCardEvent(eventName, null, {
      contextType: 'refund_request',
      contextId: String(refund?._id || '') || null,
      extra: { refundId: String(refund?.refundId || '') || null, saleId: String(refund?.saleId || '') || null, ...extra }
    });
  } catch (err) {
    console.warn(`[giftCardRecreditRecovery] emit ${eventName} failed:`, err?.message || err);
  }
}

/**
 * Retente le recrédit carte cadeau d'un RefundRequest en `rollback_needed`.
 * @param {object|string} refundInput document RefundRequest, { _id }, ou id string
 * @returns {Promise<{recovered:boolean, skipped?:boolean, reason?:string, error?:Error}>}
 */
export async function recoverGiftCardRecredit(refundInput) {
  const refund = refundInput && typeof refundInput.save === 'function'
    ? refundInput
    : await RefundRequest.findById(refundInput?._id || refundInput);

  if (!refund) return { recovered: false, skipped: true, reason: 'not_found' };
  if (String(refund.giftCardRefundStatus || '') !== 'rollback_needed') {
    return { recovered: false, skipped: true, reason: 'not_rollback_needed' };
  }
  if (refund.giftCardRecredited === true) {
    return { recovered: false, skipped: true, reason: 'already_recredited' };
  }

  const amount = roundToCents(Number(refund.giftCardRefundAmount ?? refund.giftCardRecreditAmount ?? 0));
  if (amount <= 0) return { recovered: false, skipped: true, reason: 'no_amount' };

  const attempts = Number(refund.giftCardRecreditAttempts || 0);
  if (attempts >= MAX_ATTEMPTS) {
    return { recovered: false, skipped: true, reason: 'max_attempts' };
  }

  // Claim atomique → empêche tout double recrédit (concurrent ou répété).
  const claim = await claimGiftCardRecredit(refund._id);
  if (!claim.claimed) {
    const latest = claim.refundRequest;
    if (latest?.giftCardRecredited) return { recovered: false, skipped: true, reason: 'already_recredited' };
    return { recovered: false, skipped: true, reason: 'in_progress' };
  }
  const claimed = claim.refundRequest;

  const sale = await Sale.findOne({ saleId: String(claimed.saleId || '').trim() }).lean();
  if (!sale) {
    claimed.giftCardRecreditInProgress = false;
    claimed.giftCardRecreditAttempts = attempts + 1;
    await claimed.save().catch(() => {});
    await emitRecoveryEvent('gift_card.recredit_failed', claimed, { reason: 'sale_not_found', attempts: attempts + 1 });
    return { recovered: false, reason: 'sale_not_found' };
  }

  try {
    await recreditGiftCardPortion(sale, amount);
    claimed.giftCardRefundStatus = 'succeeded';
    claimed.giftCardRecredited = true;
    claimed.giftCardRecreditInProgress = false;
    claimed.giftCardRecreditAmount = amount;
    // Finaliser le remboursement global si la part Stripe est déjà réglée (ou absente).
    const stripeStatus = String(claimed.stripeRefundStatus || '');
    if (stripeStatus === 'succeeded' || stripeStatus === 'not_applicable') {
      claimed.status = 'succeeded';
      claimed.refundedAt = claimed.refundedAt || new Date();
    }
    claimed.processedAt = new Date();
    await claimed.save();
    await emitRecoveryEvent('gift_card.recredit_recovered', claimed, { amountEur: amount });
    return { recovered: true };
  } catch (error) {
    // Libère le claim, incrémente le compteur, garde rollback_needed pour une prochaine tentative.
    claimed.giftCardRecreditInProgress = false;
    claimed.giftCardRecreditAttempts = attempts + 1;
    await claimed.save().catch(() => {});
    await emitRecoveryEvent('gift_card.recredit_failed', claimed, { reason: 'recredit_error', attempts: attempts + 1 });
    return { recovered: false, error };
  }
}

/**
 * Balaye et retente les recrédits carte cadeau en `rollback_needed`.
 * @param {{ limit?: number }} [opts]
 */
export async function runGiftCardRecreditRecovery({ limit = 100 } = {}) {
  const summary = { inspected: 0, recovered: 0, skipped: 0, failed: 0 };
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Number(limit))) : 100;
  try {
    const candidates = await RefundRequest.find({
      giftCardRefundStatus: 'rollback_needed',
      giftCardRecredited: { $ne: true }
    })
      .sort({ requestedAt: 1 })
      .limit(safeLimit);
    summary.inspected = candidates.length;
    for (const refund of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const res = await recoverGiftCardRecredit(refund);
      if (res.recovered) summary.recovered += 1;
      else if (res.skipped) summary.skipped += 1;
      else summary.failed += 1;
    }
  } catch (error) {
    console.error('[giftCardRecreditRecovery] cycle failed:', error?.message || error);
  }
  return summary;
}

export { MAX_ATTEMPTS };
export default runGiftCardRecreditRecovery;
