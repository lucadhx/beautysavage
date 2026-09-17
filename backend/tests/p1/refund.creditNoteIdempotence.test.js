import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const creditNotesCreateMock = vi.fn();
const constructEventMock = vi.fn();
const stripeMock = {
  webhooks: {
    constructEvent: constructEventMock
  },
  creditNotes: {
    create: creditNotesCreateMock
  },
  refunds: {
    create: vi.fn()
  },
  customers: {
    create: vi.fn()
  },
  invoices: {
    create: vi.fn(),
    finalizeInvoice: vi.fn(),
    pay: vi.fn()
  },
  invoiceItems: {
    create: vi.fn()
  },
  paymentIntents: {
    retrieve: vi.fn()
  }
};

vi.mock('stripe', () => {
  class MockStripe {
    constructor() {
      return stripeMock;
    }
  }

  return { default: MockStripe };
});

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const Invoice = (await import('../../models/Invoice.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const { handleWebhook } = await import('../../controllers/stripeController.js');

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    send(body) {
      this.payload = body;
      return this;
    }
  };
}

describe('P1 - Stripe credit note idempotence', () => {
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
    creditNotesCreateMock.mockReset();
    constructEventMock.mockReset();
    creditNotesCreateMock.mockResolvedValue({
      id: 'cn_credit_note_1',
      pdf: 'https://example.test/credit-note.pdf'
    });
  });

  it('creates the credit note once and skips the replay thanks to the persisted creditNoteId', async () => {
    const sale = await Sale.create({
      saleId: 'SALE-CREDIT-NOTE-1',
      userId: fixtures.client1._id,
      customer: {
        firstName: 'Client',
        lastName: 'Test',
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
      stripePaymentIntentId: 'pi_credit_note_1',
      accepted_cgv: true,
      createdAt: new Date()
    });

    await Invoice.create({
      saleId: sale.saleId,
      userId: fixtures.client1._id,
      status: 'finalized',
      totalAmount: 40,
      stripeInvoiceId: 'in_credit_note_1',
      stripeInvoiceNumber: 'INV-1'
    });

    await RefundRequest.create({
      refundId: 'RF-CREDIT-NOTE-1',
      saleId: sale.saleId,
      userId: fixtures.client1._id,
      itemId: fixtures.product._id,
      itemType: 'product',
      amount: 12.34,
      currency: 'EUR',
      status: 'succeeded',
      requestedAt: new Date(),
      processedAt: new Date(),
      reason: 'client_cancel',
      clientIp: '127.0.0.1',
      purchaseAcceptedText: 'CGV',
      eligibleRefund: true,
      stripeRefundId: 're_credit_note_1',
      stripeRefundStatus: 'succeeded',
      stripeRefundAmount: 12.34,
      giftCardRefundStatus: 'not_applicable',
      refundedAt: new Date()
    });

    const event = {
      type: 'charge.refund.updated',
      data: {
        object: {
          id: 're_credit_note_1',
          status: 'succeeded',
          created: Math.floor(Date.now() / 1000),
          updated: Math.floor(Date.now() / 1000)
        }
      }
    };
    constructEventMock.mockReturnValue(event);

    const firstResponse = createResponse();
    await handleWebhook(
      { body: Buffer.from('raw-event'), headers: { 'stripe-signature': 'sig_test' } },
      firstResponse
    );

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.payload).toEqual({ received: true });
    expect(creditNotesCreateMock).toHaveBeenCalledTimes(1);
    expect(creditNotesCreateMock.mock.calls[0][0]).toMatchObject({
      invoice: 'in_credit_note_1',
      amount: 1234,
      out_of_band_amount: 1234,
      reason: 'order_change',
      memo: 'Remboursement vente SALE-CREDIT-NOTE-1'
    });
    expect(creditNotesCreateMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        idempotencyKey: 'refund-request:RF-CREDIT-NOTE-1:credit-note'
      })
    );

    const afterFirstPass = await RefundRequest.findOne({ refundId: 'RF-CREDIT-NOTE-1' }).lean();
    expect(afterFirstPass.creditNoteId).toBeTruthy();
    expect(afterFirstPass.creditNotePdfUrl).toBeTruthy();

    const secondResponse = createResponse();
    await handleWebhook(
      { body: Buffer.from('raw-event'), headers: { 'stripe-signature': 'sig_test' } },
      secondResponse
    );

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.payload).toEqual({ received: true });
    expect(creditNotesCreateMock).toHaveBeenCalledTimes(1);
  });
});
