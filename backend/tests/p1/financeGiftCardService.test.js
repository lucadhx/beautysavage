// tests/p1/financeGiftCardService.test.js
// RX2.6 — Gift Card Finance : liste + détail (source paiement, acteurs, solde, transactions, lifecycle, QR masqué).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import GiftCard from '../../models/GiftCard.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import {
  listGiftCardFinanceCards, getGiftCardFinanceDetail, resolveGiftCardPaymentSource,
} from '../../services/finance/giftCardFinanceService.js';

const oid = () => new mongoose.Types.ObjectId();

async function seedManualCard(over = {}) {
  return GiftCard.create({
    code: 'GCMANUAL1234', userId: oid(), amount: 100, balance: 100, status: 'active',
    purchasedAt: new Date(), creationMode: 'manual_institute', paymentMode: 'on_site',
    paymentLabel: 'Paiement sur place', recipientName: 'Alice', purchaserName: 'Bob',
    qrTokenHash: 'a'.repeat(64), generatedPdfUrl: '/storage/gc.pdf', ...over,
  });
}

describe('RX2.6 — giftCardFinanceService', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('resolveGiftCardPaymentSource : manual → on_site / online → stripe', () => {
    expect(resolveGiftCardPaymentSource({ creationMode: 'manual_institute', paymentMode: 'on_site' }).mode).toBe('on_site');
    expect(resolveGiftCardPaymentSource({ creationMode: 'online', paymentMode: 'stripe' }).mode).toBe('stripe');
  });

  it('liste : summary + cards (code masqué)', async () => {
    await seedManualCard();
    await GiftCard.create({ code: 'GCONLINE9999', userId: oid(), amount: 50, balance: 20, status: 'active', purchasedAt: new Date(), creationMode: 'online', paymentMode: 'stripe' });
    const { summary, cards } = await listGiftCardFinanceCards({});
    expect(summary.count).toBe(2);
    expect(summary.issuedAmount).toBe(150);
    expect(summary.activeBalanceAmount).toBe(120);
    expect(cards.every((c) => c.maskedCode.startsWith('••••'))).toBe(true);
    expect(cards.some((c) => c.maskedCode.includes('GCMANUAL'))).toBe(false); // jamais le code complet
  });

  it('détail : solde, acteurs, source, transactions, lifecycle, QR masqué', async () => {
    const card = await seedManualCard();
    await GiftCardTransaction.create({ giftCardId: card._id, userId: card.userId, transactionType: 'manual_issued', source: 'manual_institute', amount: 100, balanceBefore: 0, balanceAfter: 100, createdAt: new Date(Date.now() - 3000) });
    await GiftCardTransaction.create({ giftCardId: card._id, userId: card.userId, transactionType: 'redeem', source: 'client', amount: 30, balanceBefore: 100, balanceAfter: 70, createdAt: new Date(Date.now() - 2000) });
    await GiftCardTransaction.create({ giftCardId: card._id, userId: card.userId, transactionType: 'manual_debit', source: 'manual_institute', amount: 10, balanceBefore: 70, balanceAfter: 60, note: 'Prestation offerte', createdAt: new Date(Date.now() - 1000) });

    const detail = await getGiftCardFinanceDetail(String(card._id));
    expect(detail.giftCard.maskedCode).toBe('••••1234');
    expect(detail.paymentSource.mode).toBe('on_site');
    expect(detail.actors.recipient.name).toBe('Alice');
    expect(detail.actors.purchaser.name).toBe('Bob');
    expect(detail.currentBalance.balance).toBe(100);
    expect(detail.transactions.length).toBe(3);
    // lifecycle : created + qr + pdf + offered + used + manual_debit
    const types = detail.lifecycle.map((l) => l.type);
    expect(types).toContain('created');
    expect(types).toContain('used');
    expect(types).toContain('manual_debit');
    // QR masqué, jamais le hash
    expect(detail.qr.available).toBe(true);
    expect(detail.qr.maskedToken).toBe('••••');
    expect(JSON.stringify(detail)).not.toContain('a'.repeat(64));
  });

  it('détail : carte introuvable → null', async () => {
    expect(await getGiftCardFinanceDetail(String(oid()))).toBeNull();
  });
});
