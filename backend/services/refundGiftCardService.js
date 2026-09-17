import GiftCardTransaction from '../models/GiftCardTransaction.js';
import {
  debitGiftCardBalanceAtomic,
  recreditGiftCardBalanceAtomic
} from './giftCardReservationService.js';
import { emitGiftCardEvent } from './businessEventService.js';

function roundToCents(value) {
  const candidate = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(candidate * 100) / 100;
}

async function resolveGiftCardUsagesFromSale(sale) {
  const normalizedSaleId = String(sale?.saleId || '').trim();
  let usages = Array.isArray(sale?.giftCardUsage)
    ? sale.giftCardUsage.filter(entry => entry?.giftCardId && Number(entry?.amountUsed || 0) > 0)
    : [];
  if (!usages.length && normalizedSaleId) {
    const fallbackRedeems = await GiftCardTransaction.find({
      saleId: normalizedSaleId,
      transactionType: 'redeem'
    })
      .select({ giftCardId: 1, amount: 1 })
      .lean();
    const usageByCardId = new Map();
    for (const tx of fallbackRedeems) {
      const cardId = String(tx?.giftCardId || '').trim();
      const amount = roundToCents(Number(tx?.amount || 0));
      if (!cardId || amount <= 0) continue;
      usageByCardId.set(cardId, roundToCents((usageByCardId.get(cardId) || 0) + amount));
    }
    usages = Array.from(usageByCardId.entries()).map(([giftCardId, amountUsed]) => ({
      giftCardId,
      amountUsed
    }));
  }
  return usages;
}

export async function recreditGiftCardPortion(sale, amountEur) {
  const normalizedSaleId = String(sale?.saleId || '').trim();
  const usages = await resolveGiftCardUsagesFromSale(sale);
  const refundNote = normalizedSaleId
    ? `Remboursement de vente ${normalizedSaleId}`
    : 'Remboursement carte cadeau';

  let remaining = roundToCents(amountEur);
  for (const usage of usages) {
    if (remaining <= 0) break;
    const portion = roundToCents(Math.min(remaining, Number(usage?.amountUsed || 0)));
    if (portion <= 0) continue;
    if (!usage?.giftCardId) {
      throw new Error('Gift card usage without giftCardId.');
    }

    const updatedCard = await recreditGiftCardBalanceAtomic({
      giftCardId: usage.giftCardId,
      amount: portion
    });
    if (!updatedCard) {
      throw new Error(`Gift card not found: ${String(usage.giftCardId)}`);
    }

    const balanceAfter = roundToCents(Number(updatedCard.balance || 0));
    const balanceBefore = roundToCents(balanceAfter - portion);

    try {
      await GiftCardTransaction.create({
        giftCardId: updatedCard._id,
        transactionType: 'credit',
        userId: updatedCard.userId,
        actorRole: 'system',
        amount: portion,
        balanceBefore,
        balanceAfter,
        saleId: normalizedSaleId,
        note: refundNote,
        items: []
      });
    } catch (transactionError) {
      await debitGiftCardBalanceAtomic({
        giftCardId: updatedCard._id,
        amount: portion
      }).catch(() => {});
      throw transactionError;
    }

    remaining = roundToCents(remaining - portion);
  }

  if (remaining > 0) {
    throw new Error(`Gift card recredit incomplete. Remaining=${remaining}`);
  }

  // Audit-only event (best-effort, no side effect). Summary per recredit operation.
  await emitGiftCardEvent('gift_card.recredited', null, {
    extra: { saleId: normalizedSaleId || null, amountEur: roundToCents(amountEur), cardCount: usages.length },
    contextType: 'sale',
    contextId: normalizedSaleId || null
  });
}
