// tests/p1/giftCardUsageReceipt.test.js
// D2 — Commande 100 % carte cadeau → reçu d'utilisation interne NON fiscal (la carte cadeau
// est un règlement, pas une remise). Facture officielle = Stripe (absente si Stripe n'encaisse rien).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Invoice from '../../models/Invoice.js';
import { createInvoiceForSale, buildGiftCardReceiptInfo, resolveOfficialInvoiceRef } from '../../services/invoiceService.js';
import { VAT_LEGAL_LABEL } from '../../constants/tax.js';

function fakeSale({ saleId, total, giftCardUsed }) {
  return {
    saleId, userId: new mongoose.Types.ObjectId(),
    customer: { firstName: 'A', lastName: 'B', email: 'a@b.test' },
    items: [{ type: 'product', name: 'Produit', finalPrice: total, price: total, basePrice: total }],
    totalAmount: total,
    giftCardUsage: giftCardUsed > 0 ? [{ giftCardId: new mongoose.Types.ObjectId(), code: 'GC', amountUsed: giftCardUsed }] : [],
    createdAt: new Date()
  };
}

describe('D2 — reçu carte cadeau 100 %', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('buildGiftCardReceiptInfo : carte cadeau = règlement, prix vendu inchangé', () => {
    const info = buildGiftCardReceiptInfo({ totalAmount: 40, giftCardUsage: [{ amountUsed: 40 }] });
    expect(info.soldAmount).toBe(40);
    expect(info.giftCardPaymentAmount).toBe(40);
    expect(info.balanceDue).toBe(0);
    expect(info.fullyCoveredByGiftCard).toBe(true);
  });

  it('achat 100 % carte cadeau → reçu interne NON fiscal (gift_card_usage_receipt)', async () => {
    const inv = await createInvoiceForSale(fakeSale({ saleId: 'S-GC100', total: 40, giftCardUsed: 40 }));
    expect(inv.documentKind).toBe('gift_card_usage_receipt');
    expect(inv.official).toBe(false);
    // Pas de facture Stripe → pas de document fiscal officiel.
    expect(resolveOfficialInvoiceRef(inv.toObject ? inv.toObject() : inv).official).toBe(false);
  });

  it('achat partiel carte cadeau → snapshot interne (pas reçu 100 %)', async () => {
    const inv = await createInvoiceForSale(fakeSale({ saleId: 'S-GCpart', total: 40, giftCardUsed: 20 }));
    expect(inv.documentKind).toBe('internal_snapshot');
    expect(inv.official).toBe(false);
  });

  it('facture officielle Stripe reste officielle si Stripe encaisse (carte cadeau achetée)', async () => {
    const inv = await Invoice.create({
      saleId: 'S-GiftPurchase', userId: new mongoose.Types.ObjectId(), totalAmount: 60,
      documentKind: 'stripe_official', official: true, stripeInvoiceId: 'in_gc', stripeHostedUrl: 'https://stripe/in_gc'
    });
    const ref = resolveOfficialInvoiceRef(inv.toObject());
    expect(ref.official).toBe(true);
    expect(ref.source).toBe('stripe');
  });

  it('V1 sans TVA conservée (label 293 B)', () => {
    expect(VAT_LEGAL_LABEL).toMatch(/293\s*B/);
  });
});
