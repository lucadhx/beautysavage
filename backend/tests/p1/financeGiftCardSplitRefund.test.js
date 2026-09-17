// tests/p1/financeGiftCardSplitRefund.test.js
// RX2.6 — Remboursements splittés d'une carte cadeau : 100% GC, mix Stripe+GC, partiel, rollback, recovered.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import GiftCard from '../../models/GiftCard.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import Sale from '../../models/Sale.js';
import RefundRequest from '../../models/RefundRequest.js';
import { buildGiftCardRefundTimeline, mapGiftCardRefund } from '../../services/finance/giftCardFinanceService.js';

const oid = () => new mongoose.Types.ObjectId();

async function seedCardUsedInSale(saleId, over = {}) {
  const card = await GiftCard.create({ code: 'GC-SPLIT-0001', userId: oid(), amount: 100, balance: 60, status: 'active', purchasedAt: new Date() });
  await Sale.create({ saleId, userId: card.userId, totalAmount: 120, itemCount: 1, items: [{ type: 'formation', itemId: oid(), name: 'F', finalPrice: 120 }], giftCardUsage: [{ giftCardId: card._id, code: card.code, amountUsed: 40 }], createdAt: new Date() });
  await RefundRequest.create({ refundId: 'REF-SPLIT-1', saleId, userId: card.userId, itemId: oid(), itemType: 'formation', amount: 60, status: 'succeeded', stripeRefundAmount: 40, giftCardRefundAmount: 20, giftCardRefundStatus: 'succeeded', giftCardRecredited: true, refundedAt: new Date(), ...over });
  return card;
}

describe('RX2.6 — remboursements splittés carte cadeau', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('mix Stripe + carte cadeau → parts visibles', async () => {
    const card = await seedCardUsedInSale('S-SPLIT-1');
    const refunds = await buildGiftCardRefundTimeline(card);
    expect(refunds.length).toBe(1);
    const r = refunds[0];
    expect(r.amount).toBe(60);
    expect(r.stripeRefundAmount).toBe(40);
    expect(r.giftCardRefundAmount).toBe(20);
    expect(r.isSplit).toBe(true);
    expect(r.giftCardRefundStatus).toBe('succeeded');
  });

  it('rollback_needed → statut visible comme anomalie', async () => {
    const card = await seedCardUsedInSale('S-SPLIT-2', { refundId: 'REF-SPLIT-2', giftCardRefundStatus: 'rollback_needed', giftCardRecredited: false });
    const refunds = await buildGiftCardRefundTimeline(card);
    expect(refunds[0].giftCardRefundStatus).toBe('rollback_needed');
  });

  it('recovered = recrédit succeeded après >1 tentative', () => {
    const m = mapGiftCardRefund({ refundId: 'R', amount: 20, giftCardRefundAmount: 20, giftCardRefundStatus: 'succeeded', giftCardRecredited: true, giftCardRecreditAttempts: 3 });
    expect(m.recovered).toBe(true);
  });

  it('100% carte cadeau (pas de part Stripe)', async () => {
    const card = await seedCardUsedInSale('S-SPLIT-3', { refundId: 'REF-SPLIT-3', stripeRefundAmount: 0, giftCardRefundAmount: 40, amount: 40 });
    const refunds = await buildGiftCardRefundTimeline(card);
    expect(refunds[0].stripeRefundAmount).toBe(0);
    expect(refunds[0].giftCardRefundAmount).toBe(40);
    expect(refunds[0].isSplit).toBe(false);
  });
});
