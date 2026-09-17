// tests/p1/giftCardRecreditRecovery.test.js
// Pré-React C1 — Moteur de reprise du recrédit carte cadeau (rollback_needed). Idempotent,
// jamais de double-crédit, limite d'essais, pas d'impact sur un refund déjà succeeded.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import RefundRequest from '../../models/RefundRequest.js';
import GiftCard from '../../models/GiftCard.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import EventLog from '../../models/EventLog.js';
import { recoverGiftCardRecredit, runGiftCardRecreditRecovery } from '../../services/giftCardRecreditRecoveryService.js';

async function seedRollback({ balance = 50, used = 50, refundAmount = 50, recredited = false } = {}) {
  const card = await GiftCard.create({ code: 'GCROLL', userId: new mongoose.Types.ObjectId(), amount: 100, balance, status: 'active' });
  const sale = await Sale.create({
    saleId: 'S-ROLL', userId: card.userId,
    items: [{ type: 'formation', itemId: new mongoose.Types.ObjectId(), name: 'F', price: 100, finalPrice: 100 }],
    totalAmount: 100, itemCount: 1,
    giftCardUsage: [{ giftCardId: card._id, code: card.code, amountUsed: used }]
  });
  const refund = await RefundRequest.create({
    refundId: 'REF-ROLL', saleId: sale.saleId, userId: card.userId,
    itemId: new mongoose.Types.ObjectId(), itemType: 'formation', amount: refundAmount, status: 'pending',
    stripeRefundStatus: 'succeeded', stripeRefundConfirmedAt: new Date(),
    giftCardRefundStatus: 'rollback_needed', giftCardRefundAmount: refundAmount,
    giftCardRecredited: recredited
  });
  return { card, sale, refund };
}

describe('C1 — gift card recredit recovery', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('rollback_needed → reprise réussie (recrédit + statut succeeded + event)', async () => {
    const { card, refund } = await seedRollback({ balance: 50, used: 50, refundAmount: 50 });
    const res = await recoverGiftCardRecredit(refund);
    expect(res.recovered).toBe(true);
    const updatedCard = await GiftCard.findById(card._id).lean();
    expect(updatedCard.balance).toBe(100); // 50 + 50 recrédité
    const updatedRefund = await RefundRequest.findById(refund._id).lean();
    expect(updatedRefund.giftCardRefundStatus).toBe('succeeded');
    expect(updatedRefund.giftCardRecredited).toBe(true);
    expect(updatedRefund.status).toBe('succeeded');
    expect(await EventLog.countDocuments({ eventName: 'gift_card.recredit_recovered' })).toBe(1);
  });

  it('double lancement → pas de double crédit', async () => {
    const { card, refund } = await seedRollback({ balance: 50, used: 50, refundAmount: 50 });
    await recoverGiftCardRecredit(refund);
    const second = await recoverGiftCardRecredit(refund); // relancé
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('already_recredited');
    const updatedCard = await GiftCard.findById(card._id).lean();
    expect(updatedCard.balance).toBe(100); // toujours 100, pas 150
    const txns = await GiftCardTransaction.find({ giftCardId: card._id, transactionType: 'credit' }).lean();
    expect(txns).toHaveLength(1); // un seul mouvement de recrédit
  });

  it('runGiftCardRecreditRecovery balaye et reprend les rollback_needed', async () => {
    await seedRollback({ balance: 50, used: 50, refundAmount: 50 });
    const summary = await runGiftCardRecreditRecovery({ limit: 50 });
    expect(summary.inspected).toBe(1);
    expect(summary.recovered).toBe(1);
  });

  it('refund déjà succeeded (recrédité) → aucun impact', async () => {
    const { card, refund } = await seedRollback({ balance: 100, used: 50, refundAmount: 50, recredited: true });
    await RefundRequest.findByIdAndUpdate(refund._id, { giftCardRefundStatus: 'succeeded', status: 'succeeded' });
    const res = await recoverGiftCardRecredit(refund._id);
    expect(res.recovered).toBe(false);
    expect(res.skipped).toBe(true);
    const updatedCard = await GiftCard.findById(card._id).lean();
    expect(updatedCard.balance).toBe(100); // inchangé
  });

  it('échec persistant (carte introuvable) → statut sûr + event failed + compteur', async () => {
    const { refund } = await seedRollback({ balance: 50, used: 50, refundAmount: 50 });
    // Casser le lien : supprimer la carte cadeau référencée par la vente.
    await GiftCard.deleteMany({});
    const res = await recoverGiftCardRecredit(refund);
    expect(res.recovered).toBe(false);
    const updated = await RefundRequest.findById(refund._id).lean();
    expect(updated.giftCardRefundStatus).toBe('rollback_needed'); // reste à reprendre
    expect(updated.giftCardRecredited).toBe(false);
    expect(updated.giftCardRecreditAttempts).toBe(1);
    expect(await EventLog.countDocuments({ eventName: 'gift_card.recredit_failed' })).toBe(1);
  });
});
