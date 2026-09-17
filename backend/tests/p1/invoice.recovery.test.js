import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const customersCreateMock = vi.fn();
const invoicesCreateMock = vi.fn();
const invoiceItemsCreateMock = vi.fn();
const finalizeInvoiceMock = vi.fn();
const payInvoiceMock = vi.fn();

vi.mock('stripe', () => {
  class MockStripe {
    constructor() {
      this.webhooks = {
        constructEvent: vi.fn()
      };
      this.creditNotes = {
        create: vi.fn()
      };
      this.refunds = {
        create: vi.fn()
      };
      this.customers = {
        create: customersCreateMock
      };
      this.invoices = {
        create: invoicesCreateMock,
        finalizeInvoice: finalizeInvoiceMock,
        pay: payInvoiceMock
      };
      this.invoiceItems = {
        create: invoiceItemsCreateMock
      };
      this.paymentIntents = {
        retrieve: vi.fn()
      };
    }
  }

  return { default: MockStripe };
});

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const { createStripeInvoiceForSale } = await import('../../services/stripeInvoiceService.js');

describe('P1 - Stripe invoice recovery and idempotence', () => {
  let fixtures;

  beforeAll(async () => {
    await startMemoryDb();
    await mongoose.connect(process.env.MONGODB_URI);
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    fixtures = await seedTestData();
    customersCreateMock.mockReset();
    invoicesCreateMock.mockReset();
    invoiceItemsCreateMock.mockReset();
    finalizeInvoiceMock.mockReset();
    payInvoiceMock.mockReset();
    customersCreateMock.mockResolvedValue({ id: 'cus_invoice_recovery_1' });
    invoicesCreateMock.mockResolvedValue({ id: 'draft_invoice_recovery_1' });
    invoiceItemsCreateMock.mockResolvedValue({ id: 'ii_invoice_recovery_1' });
    finalizeInvoiceMock.mockResolvedValue({
      id: 'in_sale_invoice_recovery_1',
      number: 'INV-RECOVERY-1',
      invoice_pdf: 'https://example.test/invoice.pdf',
      hosted_invoice_url: 'https://example.test/hosted-invoice'
    });
    payInvoiceMock.mockResolvedValue({ id: 'in_sale_invoice_recovery_1' });
  });

  it('creates a Stripe invoice once and returns the persisted invoice on replay', async () => {
    const sale = await Sale.create({
      saleId: 'SALE-INVOICE-RECOVERY-1',
      userId: fixtures.client1._id,
      customer: {
        firstName: 'Client',
        lastName: 'Invoice',
        email: fixtures.client1.email
      },
      items: [
        {
          type: 'product',
          itemId: fixtures.product._id,
          name: fixtures.product.name,
          finalPrice: 40
        }
      ],
      totalAmount: 40,
      stripePaymentIntentId: 'pi_invoice_recovery_1',
      accepted_cgv: true,
      createdAt: new Date()
    });

    const firstResult = await createStripeInvoiceForSale(sale, fixtures.client1);
    const secondResult = await createStripeInvoiceForSale(sale, fixtures.client1);

    expect(firstResult).toBeTruthy();
    expect(secondResult).toBeTruthy();
    expect(firstResult.stripeInvoiceId).toBe('in_sale_invoice_recovery_1');
    expect(secondResult.stripeInvoiceId).toBe('in_sale_invoice_recovery_1');

    expect(customersCreateMock).toHaveBeenCalledTimes(1);
    expect(invoicesCreateMock).toHaveBeenCalledTimes(1);
    expect(invoiceItemsCreateMock).toHaveBeenCalledTimes(1);
    expect(finalizeInvoiceMock).toHaveBeenCalledTimes(1);
    expect(payInvoiceMock).toHaveBeenCalledTimes(1);

    expect(customersCreateMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        idempotencyKey: `stripe-invoice:customer:${String(fixtures.client1._id)}`
      })
    );
    expect(invoicesCreateMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        idempotencyKey: 'stripe-invoice:SALE-INVOICE-RECOVERY-1:create'
      })
    );
    expect(invoiceItemsCreateMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        idempotencyKey: `stripe-invoice:SALE-INVOICE-RECOVERY-1:item:product:${String(
          fixtures.product._id
        )}:4000`
      })
    );
    expect(finalizeInvoiceMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        idempotencyKey: 'stripe-invoice:SALE-INVOICE-RECOVERY-1:finalize'
      })
    );
    expect(payInvoiceMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        idempotencyKey: 'stripe-invoice:SALE-INVOICE-RECOVERY-1:pay'
      })
    );
  });
});
