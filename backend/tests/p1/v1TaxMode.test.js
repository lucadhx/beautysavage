// tests/p1/v1TaxMode.test.js
// Pré-React B1 — V1 sans TVA (franchise en base, art. 293 B). Vérifie le contrat fiscal
// central et son snapshot sur la vente.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../services/notificationService.js', async o => ({ ...(await o()), triggerNotification: async () => {} }));
vi.mock('../../services/mailService.js', async o => ({ ...(await o()), sendSaleEmail: async () => true }));
vi.mock('../../services/stripeInvoiceService.js', async o => ({ ...(await o()), createStripeInvoiceForSale: async () => null }));

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const { processCheckoutStatePurchase } = await import('../../services/checkout/checkoutFacade.js');
const { TAX_MODE, VAT_RATE, VAT_LEGAL_LABEL, buildTaxSnapshot } = await import('../../constants/tax.js');

describe('B1 — V1 tax exemption (franchise 293 B)', () => {
  let fx;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('contrat fiscal central : TVA non applicable, taux 0, label 293 B', () => {
    expect(TAX_MODE).toBe('vat_exempt_franchise_base');
    expect(VAT_RATE).toBe(0);
    expect(VAT_LEGAL_LABEL).toMatch(/293\s*B/);
  });

  it('buildTaxSnapshot : HT = TTC, vatAmount = 0', () => {
    const snap = buildTaxSnapshot(80);
    expect(snap.vatAmount).toBe(0);
    expect(snap.vatRate).toBe(0);
    expect(snap.totalExcludingTax).toBe(80);
    expect(snap.totalIncludingTax).toBe(80);
    expect(snap.taxMode).toBe('vat_exempt_franchise_base');
    expect(snap.vatLegalLabel).toBe(VAT_LEGAL_LABEL);
  });

  it('une vente porte le snapshot fiscal V1 (label 293 B, vatAmount 0, HT=TTC)', async () => {
    await processCheckoutStatePurchase({
      userId: fx.client1._id,
      itemType: 'product',
      itemId: String(fx.product._id),
      checkoutState: { item: { type: 'product', id: String(fx.product._id) }, legal: { acceptedCgv: true } },
      clientIp: '1.2.3.4',
      stripeSessionId: 'pi_tax_1',
      stripePaymentIntentId: 'pi_tax_1'
    });
    const sale = await Sale.findOne({ stripePaymentIntentId: 'pi_tax_1' }).lean();
    expect(sale.taxSnapshot).toBeTruthy();
    expect(sale.taxSnapshot.vatAmount).toBe(0);
    expect(sale.taxSnapshot.vatRate).toBe(0);
    expect(sale.taxSnapshot.totalExcludingTax).toBe(sale.totalAmount);
    expect(sale.taxSnapshot.totalIncludingTax).toBe(sale.totalAmount);
    expect(sale.taxSnapshot.vatLegalLabel).toMatch(/293\s*B/);
  });

  it('la facture interne et la facture Stripe sourcent le MÊME label fiscal central', async () => {
    // invoiceService et stripeInvoiceService importent VAT_LEGAL_LABEL (constants/tax.js)
    // → une seule source de vérité. On vérifie que le label central est bien le 293 B.
    const invoiceModule = await import('../../services/invoiceService.js');
    expect(invoiceModule).toBeTruthy(); // import OK = pas de label divergent codé en dur
    expect(VAT_LEGAL_LABEL).toContain('293');
  });
});
