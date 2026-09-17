// tests/p1/financeGiftCardTimelineIntegration.test.js
// RX2.6 — Timeline finance : recrédit (credit) + échec recrédit (rollback_needed) visibles ; action
// gift_card_view → détail ; pas de double-count (gift card = moyen de paiement / recrédit = neutral).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import RefundRequest from '../../models/RefundRequest.js';
import {
  buildFinanceTimeline, mapGiftCardTransactionToFinanceMovement, mapGiftCardRecreditFailedToMovement,
} from '../../services/finance/financeTimelineService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.6 — gift card timeline integration', () => {
  it('mapper credit → gift_card_refund_recredit (neutral) + action gift_card_view → détail', () => {
    const gcId = oid();
    const m = mapGiftCardTransactionToFinanceMovement({ _id: oid(), giftCardId: gcId, userId: oid(), transactionType: 'credit', amount: 20, createdAt: new Date() });
    expect(m.type).toBe('gift_card_refund_recredit');
    expect(m.direction).toBe('neutral');
    const view = m.actions.find((a) => a.kind === 'gift_card_view');
    expect(view.enabled).toBe(true);
    expect(view.to).toBe(`/finance/cartes-cadeaux/${gcId}`);
  });

  it('mapper rollback_needed → gift_card_recredit_failed (neutral, danger)', () => {
    const m = mapGiftCardRecreditFailedToMovement({ refundId: 'REF-RB', userId: oid(), giftCardRefundAmount: 20, requestedAt: new Date() });
    expect(m.type).toBe('gift_card_recredit_failed');
    expect(m.direction).toBe('neutral');
    expect(m.badges.some((b) => b.tone === 'danger')).toBe(true);
  });

  describe('intégration', () => {
    beforeAll(async () => {
      const uri = await startMemoryDb();
      await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    });
    afterAll(async () => { await stopMemoryDb(); });
    beforeEach(async () => { await clearDatabase(); });

    it('recrédit + rollback apparaissent en neutral (pas dans grossIn/grossOut)', async () => {
      const now = new Date();
      await GiftCardTransaction.create({ giftCardId: oid(), userId: oid(), transactionType: 'credit', source: 'system', amount: 20, balanceBefore: 40, balanceAfter: 60, createdAt: now });
      await RefundRequest.create({ refundId: 'REF-RB2', saleId: 'S', userId: oid(), itemId: oid(), itemType: 'formation', amount: 30, status: 'pending', giftCardRefundStatus: 'rollback_needed', giftCardRefundAmount: 30, requestedAt: now });
      const { items, summary } = await buildFinanceTimeline({ type: 'gift_card', limit: 50 });
      expect(items.some((i) => i.type === 'gift_card_refund_recredit')).toBe(true);
      expect(items.some((i) => i.type === 'gift_card_recredit_failed')).toBe(true);
      expect(summary.grossIn).toBe(0);
      expect(summary.grossOut).toBe(0);
    });
  });
});
