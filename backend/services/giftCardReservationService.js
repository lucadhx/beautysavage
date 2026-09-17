import mongoose from 'mongoose';
import GiftCard from '../models/GiftCard.js';

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizePaymentIntentId(value) {
  return String(value || '').trim();
}

function normalizeGiftCardCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeReservationAmount(value) {
  const amount = roundToCents(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount;
}

export function computeAvailableGiftCardBalance(card, { paymentIntentId = null } = {}) {
  if (!card || typeof card !== 'object') return 0;
  const balance = roundToCents(card.balance);
  const reservedAmount = roundToCents(card.reservedAmount);
  const normalizedPaymentIntentId = normalizePaymentIntentId(paymentIntentId);
  if (!normalizedPaymentIntentId) {
    return roundToCents(Math.max(0, balance - reservedAmount));
  }
  const ownReservedAmount = roundToCents(
    (Array.isArray(card.reservations) ? card.reservations : [])
      .filter(entry => normalizePaymentIntentId(entry?.paymentIntentId) === normalizedPaymentIntentId)
      .reduce((sum, entry) => sum + Number(entry?.amount || 0), 0)
  );
  return roundToCents(Math.max(0, balance - reservedAmount + ownReservedAmount));
}

function buildReservationReleasePipeline({
  paymentIntentId = null,
  expiredBefore = null
} = {}) {
  const normalizedPaymentIntentId = normalizePaymentIntentId(paymentIntentId);
  const validExpiredBefore =
    expiredBefore instanceof Date && !Number.isNaN(expiredBefore.getTime()) ? expiredBefore : null;
  let matchCondition = null;
  if (normalizedPaymentIntentId) {
    matchCondition = { $eq: ['$$reservation.paymentIntentId', normalizedPaymentIntentId] };
  } else if (validExpiredBefore) {
    matchCondition = {
      $and: [
        { $ne: ['$$reservation.createdAt', null] },
        { $lte: ['$$reservation.createdAt', validExpiredBefore] }
      ]
    };
  } else {
    matchCondition = { $eq: [1, 0] };
  }

  return [
    {
      $set: {
        _matchedReservations: {
          $filter: {
            input: { $ifNull: ['$reservations', []] },
            as: 'reservation',
            cond: matchCondition
          }
        }
      }
    },
    {
      $set: {
        _releaseAmount: {
          $sum: {
            $map: {
              input: '$_matchedReservations',
              as: 'reservation',
              in: { $ifNull: ['$$reservation.amount', 0] }
            }
          }
        },
        reservations: {
          $filter: {
            input: { $ifNull: ['$reservations', []] },
            as: 'reservation',
            cond: { $not: [matchCondition] }
          }
        }
      }
    },
    {
      $set: {
        reservedAmount: {
          $max: [0, { $subtract: [{ $ifNull: ['$reservedAmount', 0] }, { $ifNull: ['$_releaseAmount', 0] }] }]
        }
      }
    },
    {
      $unset: ['_matchedReservations', '_releaseAmount']
    }
  ];
}

export function normalizeAppliedGiftCardReservations(appliedGiftCards = []) {
  if (!Array.isArray(appliedGiftCards) || !appliedGiftCards.length) return [];
  const byKey = new Map();
  for (const raw of appliedGiftCards) {
    const amount = normalizeReservationAmount(raw?.amount ?? raw?.amountUsed);
    if (!amount) continue;
    const rawId = String(raw?.giftCardId || '').trim();
    const giftCardId = mongoose.Types.ObjectId.isValid(rawId) ? rawId : '';
    const code = normalizeGiftCardCode(raw?.code);
    const key = giftCardId ? `id:${giftCardId}` : code ? `code:${code}` : '';
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.amount = roundToCents(existing.amount + amount);
      continue;
    }
    byKey.set(key, {
      giftCardId: giftCardId || null,
      code: code || null,
      amount
    });
  }
  return Array.from(byKey.values()).filter(entry => normalizeReservationAmount(entry.amount) > 0);
}

export async function reserveGiftCardAmountsForPaymentIntent({
  paymentIntentId,
  appliedGiftCards = []
} = {}) {
  const normalizedPaymentIntentId = normalizePaymentIntentId(paymentIntentId);
  if (!normalizedPaymentIntentId) {
    const error = new Error('paymentIntentId manquant pour reservation carte cadeau.');
    error.status = 400;
    error.code = 'MISSING_PAYMENT_INTENT_ID';
    throw error;
  }
  const reservations = normalizeAppliedGiftCardReservations(appliedGiftCards);
  if (!reservations.length) {
    return { reserved: [], totalReservedAmount: 0 };
  }
  const reserved = [];
  let totalReservedAmount = 0;
  try {
    for (const entry of reservations) {
      const amount = normalizeReservationAmount(entry.amount);
      if (!amount) continue;
      const query = {
        status: 'active',
        $expr: {
          $gte: [
            { $subtract: [{ $ifNull: ['$balance', 0] }, { $ifNull: ['$reservedAmount', 0] }] },
            amount
          ]
        }
      };
      if (entry.giftCardId) {
        query._id = entry.giftCardId;
      } else if (entry.code) {
        query.code = normalizeGiftCardCode(entry.code);
      } else {
        const invalidError = new Error('Carte cadeau invalide.');
        invalidError.status = 400;
        invalidError.code = 'INVALID_GIFT_CARD_REFERENCE';
        throw invalidError;
      }

      const reservationDoc = {
        paymentIntentId: normalizedPaymentIntentId,
        amount,
        createdAt: new Date()
      };
      const updatedCard = await GiftCard.findOneAndUpdate(
        query,
        {
          $inc: { reservedAmount: amount },
          $push: { reservations: reservationDoc }
        },
        { new: true }
      );

      if (!updatedCard) {
        const error = new Error('Solde carte cadeau insuffisant ou deja reserve');
        error.status = 400;
        error.code = 'GIFT_CARD_RESERVED_BALANCE_INSUFFICIENT';
        throw error;
      }

      reserved.push({
        giftCardId: updatedCard._id?.toString() || '',
        code: String(updatedCard.code || '').trim().toUpperCase(),
        amount
      });
      totalReservedAmount = roundToCents(totalReservedAmount + amount);
    }
  } catch (error) {
    if (reserved.length) {
      await releaseGiftCardReservationsForPaymentIntent(normalizedPaymentIntentId, {
        reason: 'reservation_partial_rollback'
      }).catch(releaseError => {
        console.error('[GiftCard Reservation] Echec rollback reservation partielle', releaseError);
      });
    }
    throw error;
  }

  return { reserved, totalReservedAmount };
}

/**
 * Phase 1B-1: atomic gift-card debit. Decrements `balance` by `amount` ONLY if the
 * current balance is sufficient, in a single conditional findOneAndUpdate. This
 * prevents over-debit under concurrency (two concurrent debits can no longer both
 * read the same balance and overwrite it). Reservation fields are intentionally NOT
 * touched here — reservation release stays a separate, already-atomic step.
 * @returns {{ balanceBefore:number, balanceAfter:number, card:object }}
 * @throws  {Error} status 400 / code GIFT_CARD_BALANCE_INSUFFICIENT when balance < amount
 */
export async function debitGiftCardBalanceAtomic({ giftCardId, amount } = {}) {
  const debitAmount = roundToCents(amount);
  if (!giftCardId || !(debitAmount > 0)) {
    const error = new Error('Parametres de debit carte cadeau invalides.');
    error.status = 400;
    error.code = 'INVALID_GIFT_CARD_DEBIT';
    throw error;
  }
  const updated = await GiftCard.findOneAndUpdate(
    { _id: giftCardId, balance: { $gte: debitAmount } },
    [
      { $set: { balance: { $round: [{ $subtract: [{ $ifNull: ['$balance', 0] }, debitAmount] }, 2] } } },
      { $set: { status: { $cond: [{ $gt: ['$balance', 0] }, 'active', 'redeemed'] } } }
    ],
    { new: true }
  );
  if (!updated) {
    const error = new Error('Solde carte cadeau insuffisant.');
    error.status = 400;
    error.code = 'GIFT_CARD_BALANCE_INSUFFICIENT';
    throw error;
  }
  const balanceAfter = roundToCents(updated.balance);
  return { balanceBefore: roundToCents(balanceAfter + debitAmount), balanceAfter, card: updated };
}

/**
 * Phase 1B-1: atomic gift-card recredit, used to compensate a debit on rollback.
 * @returns {object|null} the updated card, or null on invalid input.
 */
export async function recreditGiftCardBalanceAtomic({ giftCardId, amount } = {}) {
  const creditAmount = roundToCents(amount);
  if (!giftCardId || !(creditAmount > 0)) return null;
  return GiftCard.findOneAndUpdate(
    { _id: giftCardId },
    [
      { $set: { balance: { $round: [{ $add: [{ $ifNull: ['$balance', 0] }, creditAmount] }, 2] } } },
      { $set: { status: 'active' } }
    ],
    { new: true }
  );
}

export async function releaseGiftCardReservationsForPaymentIntent(
  paymentIntentId,
  { reason = '' } = {}
) {
  const normalizedPaymentIntentId = normalizePaymentIntentId(paymentIntentId);
  if (!normalizedPaymentIntentId) {
    return { matchedCards: 0, modifiedCards: 0, reason };
  }
  const query = { 'reservations.paymentIntentId': normalizedPaymentIntentId };
  const matchedCards = await GiftCard.countDocuments(query);
  if (!matchedCards) {
    return { matchedCards: 0, modifiedCards: 0, reason };
  }
  const result = await GiftCard.updateMany(
    query,
    buildReservationReleasePipeline({ paymentIntentId: normalizedPaymentIntentId })
  );
  return {
    matchedCards,
    modifiedCards: Number(result?.modifiedCount || 0),
    reason
  };
}

export async function cleanupExpiredGiftCardReservations({
  olderThanMs = 2 * 60 * 60 * 1000
} = {}) {
  const normalizedOlderThanMs = Number(olderThanMs);
  const effectiveOlderThanMs =
    Number.isFinite(normalizedOlderThanMs) && normalizedOlderThanMs > 0
      ? normalizedOlderThanMs
      : 2 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - effectiveOlderThanMs);
  const query = { 'reservations.createdAt': { $lte: cutoff } };
  const matchedCards = await GiftCard.countDocuments(query);
  if (!matchedCards) {
    return { matchedCards: 0, modifiedCards: 0, cutoff };
  }
  const result = await GiftCard.updateMany(
    query,
    buildReservationReleasePipeline({ expiredBefore: cutoff })
  );
  return {
    matchedCards,
    modifiedCards: Number(result?.modifiedCount || 0),
    cutoff
  };
}
