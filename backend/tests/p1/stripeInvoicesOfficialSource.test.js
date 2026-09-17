// tests/p1/stripeInvoicesOfficialSource.test.js
// Pré-React C2 — La facture OFFICIELLE (fiscale) est la facture Stripe ; le PDF interne
// Beauty Savage est un snapshot opérationnel non fiscal. Vente client + commission.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Invoice from '../../models/Invoice.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import { resolveOfficialInvoiceRef } from '../../services/invoiceService.js';
import { VAT_LEGAL_LABEL } from '../../constants/tax.js';

describe('C2 — facture officielle = Stripe', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('vente avec facture Stripe → source officielle = Stripe (id + url)', async () => {
    const inv = await Invoice.create({
      saleId: 'S-OFF', userId: new mongoose.Types.ObjectId(), totalAmount: 80,
      documentKind: 'stripe_official', official: true,
      stripeInvoiceId: 'in_123', stripeHostedUrl: 'https://invoice.stripe/in_123'
    });
    const ref = resolveOfficialInvoiceRef(inv.toObject());
    expect(ref.official).toBe(true);
    expect(ref.source).toBe('stripe');
    expect(ref.id).toBe('in_123');
    expect(ref.url).toContain('stripe');
  });

  it('facture interne (PDF) sans Stripe → NON officielle', async () => {
    const inv = await Invoice.create({
      saleId: 'S-INT', userId: new mongoose.Types.ObjectId(), totalAmount: 80,
      pdfPath: 'storage/invoices/facture-x.pdf', documentKind: 'internal_snapshot', official: false
    });
    expect(inv.documentKind).toBe('internal_snapshot');
    expect(inv.official).toBe(false);
    const ref = resolveOfficialInvoiceRef(inv.toObject());
    expect(ref.official).toBe(false);
    expect(ref.source).toBe('none');
  });

  it('paiement 0 € (aucune facture Stripe) → pas de fausse facture officielle', async () => {
    const inv = await Invoice.create({
      saleId: 'S-ZERO', userId: new mongoose.Types.ObjectId(), totalAmount: 0,
      documentKind: 'internal_snapshot', official: false
    });
    const ref = resolveOfficialInvoiceRef(inv.toObject());
    expect(ref.official).toBe(false);
  });

  it('commission payée via Stripe Dev → facture Stripe officielle (stripeInvoiceId/url)', async () => {
    const cp = await CommissionPayment.create({
      month: 0, year: 2026, periodStart: new Date(2026, 0, 1), periodEnd: new Date(2026, 1, 1),
      amount: 20, netAmountDue: 20, status: 'succeeded', settledReason: 'paid', paidAt: new Date(),
      stripeInvoiceId: 'in_comm_1', stripeInvoicePdfUrl: 'https://invoice.stripe/in_comm_1.pdf'
    });
    expect(cp.stripeInvoiceId).toBe('in_comm_1');
    expect(cp.stripeInvoicePdfUrl).toContain('stripe');
    // La facture officielle de commission = la facture Stripe Dev attachée.
    expect(Boolean(cp.stripeInvoiceId)).toBe(true);
  });

  it('label TVA 293 B conservé (V1 franchise)', () => {
    expect(VAT_LEGAL_LABEL).toMatch(/293\s*B/);
  });
});
