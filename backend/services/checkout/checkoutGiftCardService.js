// services/checkout/checkoutGiftCardService.js
// Pré-React E2 (refactor) — Extraction PUREMENT STRUCTURELLE du cœur "carte cadeau comme
// moyen de paiement" hors de clientController. Aucune modification de comportement : les
// fonctions et helpers sont déplacés verbatim depuis controllers/clientController.js.
//
// La carte cadeau est un MOYEN DE PAIEMENT (cf. concepts pricing) : ce service planifie
// l'usage (capé au solde réel, lecture seule) et le finalise (débit atomique + transaction +
// release de réservation), avec compensation atomique en cas d'échec.

import argon2 from 'argon2';
import mongoose from 'mongoose';

import GiftCard from '../../models/GiftCard.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import Sale from '../../models/Sale.js';
import {
  computeAvailableGiftCardBalance,
  releaseGiftCardReservationsForPaymentIntent,
  debitGiftCardBalanceAtomic,
  recreditGiftCardBalanceAtomic
} from '../giftCardReservationService.js';

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

function normalizeGiftCardCode(value) {
  return String(value || '').trim().toUpperCase();
}

function sanitizeGiftCardAmount(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, roundToCents(parsed));
}

async function deductGiftCardBalance(card, amount) {
  // Phase 1B-1: atomic conditional debit (no over-debit under concurrency).
  // Throws GIFT_CARD_BALANCE_INSUFFICIENT if the balance is no longer sufficient.
  const { balanceBefore, balanceAfter } = await debitGiftCardBalanceAtomic({
    giftCardId: card._id,
    amount
  });
  // Keep the in-memory document consistent for downstream reads (no extra save).
  card.balance = balanceAfter;
  card.status = balanceAfter > 0 ? 'active' : 'redeemed';
  return { balanceBefore, balanceAfter };
}

async function verifyGiftCardPasswordHash(card, candidatePassword) {
  const passwordHash = String(card?.passwordHash || '').trim();
  const password = String(candidatePassword || '').trim();
  if (!passwordHash || !password) return false;
  try {
    return await argon2.verify(passwordHash, password);
  } catch (_error) {
    return false;
  }
}

export async function planGiftCardUsage(
  rawGiftCards,
  totalAmount,
  { requirePassword = false, reservationPaymentIntentId = null } = {}
) {
  const normalizedTotal = roundToCents(totalAmount);
  if (!normalizedTotal || !Array.isArray(rawGiftCards) || !rawGiftCards.length) {
    return { usages: [], saleEntries: [], remainingAmount: normalizedTotal };
  }
  const seenReferences = new Set();
  const requests = [];
  for (const raw of rawGiftCards) {
    const rawGiftCardId = String(raw?.giftCardId || '').trim();
    const giftCardId = isValidObjectId(rawGiftCardId) ? rawGiftCardId : '';
    const code = normalizeGiftCardCode(raw?.code);
    const referenceKey = giftCardId ? `id:${giftCardId}` : code ? `code:${code}` : '';
    if (!referenceKey || seenReferences.has(referenceKey)) continue;
    seenReferences.add(referenceKey);
    const amount = sanitizeGiftCardAmount(raw?.amount);
    const password = String(raw?.password || '').trim();
    requests.push({
      giftCardId: giftCardId || null,
      code,
      amount,
      password
    });
  }
  if (!requests.length) {
    return { usages: [], saleEntries: [], remainingAmount: normalizedTotal };
  }
  const requestedGiftCardIds = requests.map(entry => entry.giftCardId).filter(Boolean);
  const requestedCodes = requests.map(entry => entry.code).filter(Boolean);
  const cardQuery = [];
  if (requestedGiftCardIds.length) {
    cardQuery.push({ _id: { $in: requestedGiftCardIds } });
  }
  if (requestedCodes.length) {
    cardQuery.push({ code: { $in: requestedCodes } });
  }
  const cards = cardQuery.length
    ? await GiftCard.find(cardQuery.length === 1 ? cardQuery[0] : { $or: cardQuery })
    : [];
  const cardById = new Map(cards.map(card => [String(card._id || '').trim(), card]));
  const cardByCode = new Map(cards.map(card => [card.code, card]));
  const usages = [];
  let remaining = normalizedTotal;
  for (const request of requests) {
    if (remaining <= 0) break;
    const card = request.giftCardId
      ? cardById.get(request.giftCardId)
      : cardByCode.get(request.code);
    const availableBalance = computeAvailableGiftCardBalance(card, {
      paymentIntentId: reservationPaymentIntentId
    });
    if (!card || card.status !== 'active' || availableBalance <= 0) {
      const error = new Error('Carte introuvable ou epuisee.');
      error.status = 404;
      throw error;
    }
    if (requirePassword && !request.password) {
      const error = new Error('Mot de passe carte cadeau requis.');
      error.status = 400;
      error.code = 'GIFT_CARD_PASSWORD_REQUIRED';
      throw error;
    }
    if (request.password) {
      const isPasswordValid = await verifyGiftCardPasswordHash(card, request.password);
      if (!isPasswordValid) {
        const error = new Error('Code ou mot de passe carte cadeau invalide.');
        error.status = 401;
        error.code = 'INVALID_GIFT_CARD_CREDENTIALS';
        throw error;
      }
    }
    const available = roundToCents(
      computeAvailableGiftCardBalance(card, { paymentIntentId: reservationPaymentIntentId })
    );
    if (available <= 0) {
      const error = new Error('Carte introuvable ou epuisee.');
      error.status = 404;
      throw error;
    }
    const desired =
      Number.isFinite(Number(request.amount)) && Number(request.amount) > 0
        ? roundToCents(request.amount)
        : available;
    const useAmount = Math.min(desired, available, remaining);
    if (useAmount <= 0) continue;
    usages.push({ card, amount: useAmount });
    remaining = roundToCents(Math.max(0, remaining - useAmount));
  }
  const saleEntries = usages.map(entry => ({
    giftCardId: entry.card._id,
    code: entry.card.code,
    amountUsed: entry.amount
  }));
  return { usages, saleEntries, remainingAmount: remaining };
}

export async function finalizeGiftCardUsage({
  userId,
  saleDoc,
  saleItems,
  usages,
  paymentIntentId = null
}) {
  if (!usages?.length || !saleDoc) return;
  const items = saleItems.map(entry => ({
    type: entry.type === 'gift-card' ? 'product' : entry.type,
    itemId: entry.itemId,
    price: entry.finalPrice
  }));
  const applied = [];
  const appliedUsageEntries = [];
  try {
    for (const entry of usages) {
      const { balanceBefore, balanceAfter } = await deductGiftCardBalance(entry.card, entry.amount);
      const transaction = new GiftCardTransaction({
        giftCardId: entry.card._id,
        userId,
        amount: entry.amount,
        balanceBefore,
        balanceAfter,
        saleId: saleDoc.saleId,
        items
      });
      await transaction.save();
      applied.push({
        card: entry.card,
        balanceBefore,
        amount: entry.amount,
        transactionId: transaction._id
      });
      appliedUsageEntries.push({
        giftCardId: entry.card._id,
        code: String(entry.card.code || '').trim().toUpperCase(),
        amountUsed: roundToCents(entry.amount)
      });
    }
    const normalizedPaymentIntentId = String(paymentIntentId || '').trim();
    if (normalizedPaymentIntentId) {
      await releaseGiftCardReservationsForPaymentIntent(normalizedPaymentIntentId, {
        reason: 'payment_succeeded'
      });
    }
    if (appliedUsageEntries.length) {
      if (typeof saleDoc.save === 'function') {
        saleDoc.giftCardUsage = appliedUsageEntries;
        await saleDoc.save();
      } else if (saleDoc?._id) {
        await Sale.findByIdAndUpdate(saleDoc._id, {
          giftCardUsage: appliedUsageEntries
        });
      }
    }
  } catch (error) {
    if (applied.length) {
      await GiftCardTransaction.deleteMany({
        _id: { $in: applied.map(entry => entry.transactionId).filter(Boolean) }
      }).catch(() => {});
      await Promise.all(
        applied.map(async entry => {
          // Phase 1B-1: atomic compensating recredit (no stale-doc overwrite).
          const recredited = await recreditGiftCardBalanceAtomic({
            giftCardId: entry.card._id,
            amount: entry.amount
          });
          if (recredited) {
            entry.card.balance = recredited.balance;
            entry.card.status = recredited.status;
          }
        })
      ).catch(() => {});
    }
    throw error;
  }
}

export default { planGiftCardUsage, finalizeGiftCardUsage };
