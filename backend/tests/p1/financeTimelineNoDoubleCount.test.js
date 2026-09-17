// tests/p1/financeTimelineNoDoubleCount.test.js
// RX2.2 — Garantie anti double-count : la facture liée à une vente n'est PAS comptée deux fois,
// et la carte cadeau utilisée (moyen de paiement) reste neutre. netAmount invariant aux factures.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Sale from '../../models/Sale.js';
import Invoice from '../../models/Invoice.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import { buildFinanceTimeline } from '../../services/finance/financeTimelineService.js';

const oid = () => new mongoose.Types.ObjectId();

describe('RX2.2 — pas de double-count Sale/Invoice', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('une vente + sa facture officielle → grossIn = vente seule (facture non comptée)', async () => {
    const now = new Date();
    await Sale.create({ saleId: 'SALE-X', userId: oid(), totalAmount: 120, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', finalPrice: 120 }], createdAt: now });
    await Invoice.create({ saleId: 'SALE-X', userId: oid(), invoiceId: 'INV-X', official: true, status: 'paid', totalAmount: 120, invoiceDate: now });

    const all = await buildFinanceTimeline({ type: 'all', limit: 200 });
    // La vente apparaît une fois, la facture pas du tout (lien seulement).
    expect(all.items.filter((i) => i.type === 'sale').length).toBe(1);
    expect(all.items.filter((i) => i.type === 'invoice').length).toBe(0);
    expect(all.summary.grossIn).toBe(120);

    // La facture est exposée comme action invoice_view sur la vente.
    const sale = all.items.find((i) => i.type === 'sale');
    const invoiceAction = sale.actions.find((a) => a.kind === 'invoice_view');
    expect(invoiceAction).toBeTruthy();

    // Même filtrée explicitement, la facture est neutral → netAmount inchangé.
    const invoicesOnly = await buildFinanceTimeline({ type: 'invoice', limit: 200 });
    expect(invoicesOnly.summary.netAmount).toBe(0);
  });

  it('carte cadeau utilisée = moyen de paiement neutre (jamais dans grossIn)', async () => {
    const now = new Date();
    await Sale.create({ saleId: 'SALE-Y', userId: oid(), totalAmount: 90, itemCount: 1, items: [{ type: 'service', itemId: oid(), name: 'Soin', finalPrice: 90 }], giftCardUsage: [{ giftCardId: oid(), code: 'GC', amountUsed: 30 }], createdAt: now });
    await GiftCardTransaction.create({ giftCardId: oid(), userId: oid(), transactionType: 'redeem', source: 'client', amount: 30, balanceBefore: 30, balanceAfter: 0, createdAt: now });

    const all = await buildFinanceTimeline({ type: 'all', limit: 200 });
    // grossIn = 90 (la vente), PAS 90 + 30.
    expect(all.summary.grossIn).toBe(90);
    const usage = all.items.find((i) => i.type === 'gift_card_usage');
    expect(usage.direction).toBe('neutral');
  });
});
