import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

const refundsCreateMock = vi.fn();

vi.mock('stripe', () => {
  class MockStripe {
    constructor() {
      this.refunds = { create: refundsCreateMock };
    }
  }
  return { default: MockStripe };
});

const { getTestApp } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const GiftCard = (await import('../../models/GiftCard.js')).default;
const GiftCardTransaction = (await import('../../models/GiftCardTransaction.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const { triggerRefundExecution } = await import('../../services/refundExecutionService.js');

describe('P0 - refund amount is capped to the sale total', () => {
  let fixtures;

  beforeAll(async () => {
    await getTestApp();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    fixtures = await seedTestData();
    refundsCreateMock.mockReset();
    refundsCreateMock.mockResolvedValue({ id: 're_cap_1' });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => ''
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caps mixed refunds so Stripe and gift-card portions never exceed the paid sale total', async () => {
    const sale = await Sale.create({
      saleId: 'SALE-CAP-1',
      userId: fixtures.client1._id,
      customer: {
        firstName: 'Client',
        lastName: 'Test',
        email: 'client1@test.local'
      },
      items: [
        {
          type: 'formation',
          itemId: fixtures.formationPresentiel._id,
          formationId: fixtures.formationPresentiel._id,
          name: fixtures.formationPresentiel.name,
          finalPrice: 100
        }
      ],
      giftCardUsage: [
        {
          giftCardId: fixtures.giftCard._id,
          code: fixtures.giftCard.code,
          amountUsed: 30
        }
      ],
      totalAmount: 100,
      stripePaymentIntentId: 'pi_cap_1',
      accepted_cgv: true,
      createdAt: new Date()
    });

    const refund = await RefundRequest.create({
      refundId: 'RF-CAP-1',
      saleId: sale.saleId,
      userId: fixtures.client1._id,
      itemId: fixtures.formationPresentiel._id,
      itemType: 'formation',
      formationId: fixtures.formationPresentiel._id,
      amount: 150,
      currency: 'EUR',
      status: 'requested',
      reason: 'session_canceled_by_institute',
      eligibleRefund: true,
      meta: {
        formationTitle: fixtures.formationPresentiel.name
      }
    });

    const execution = await triggerRefundExecution(refund, sale.toObject());
    const updatedRefund = execution.refund;

    expect(refundsCreateMock).toHaveBeenCalledTimes(1);
    expect(refundsCreateMock).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_cap_1',
        amount: 7000
      },
      expect.objectContaining({
        idempotencyKey: 'refund-request:RF-CAP-1:stripe-refund'
      })
    );
    expect(updatedRefund.amount).toBe(100);
    expect(updatedRefund.stripeRefundAmount).toBe(70);
    expect(updatedRefund.giftCardRefundAmount).toBe(30);
    expect(updatedRefund.status).toBe('pending');
    expect(updatedRefund.giftCardRefundStatus).toBe('pending');
  });

  it('caps gift-card-only refunds so the card cannot be recredited beyond the paid amount', async () => {
    const card = await GiftCard.create({
      code: 'CAPGIFT1',
      userId: fixtures.client1._id,
      amount: 50,
      balance: 10,
      status: 'active'
    });

    const sale = await Sale.create({
      saleId: 'SALE-CAP-2',
      userId: fixtures.client1._id,
      customer: {
        firstName: 'Client',
        lastName: 'Test',
        email: 'client1@test.local'
      },
      items: [
        {
          type: 'product',
          itemId: fixtures.product._id,
          name: fixtures.product.name,
          finalPrice: 40
        }
      ],
      giftCardUsage: [
        {
          giftCardId: card._id,
          code: card.code,
          amountUsed: 40
        }
      ],
      totalAmount: 40,
      accepted_cgv: true,
      createdAt: new Date()
    });

    const refund = await RefundRequest.create({
      refundId: 'RF-CAP-2',
      saleId: sale.saleId,
      userId: fixtures.client1._id,
      itemId: fixtures.product._id,
      itemType: 'product',
      amount: 80,
      currency: 'EUR',
      status: 'requested',
      reason: 'refund_adjustment',
      eligibleRefund: true,
      meta: {
        formationTitle: fixtures.product.name
      }
    });

    const execution = await triggerRefundExecution(refund, sale.toObject());
    const updatedRefund = execution.refund;

    expect(updatedRefund.amount).toBe(40);
    expect(updatedRefund.status).toBe('succeeded');
    expect(updatedRefund.giftCardRefundAmount).toBe(40);
    expect(updatedRefund.giftCardRecreditAmount).toBe(40);

    const updatedCard = await GiftCard.findById(card._id).lean();
    expect(updatedCard.balance).toBe(50);

    const creditTransactions = await GiftCardTransaction.find({
      giftCardId: card._id,
      saleId: sale.saleId,
      transactionType: 'credit'
    }).lean();
    expect(creditTransactions).toHaveLength(1);
    expect(creditTransactions[0].amount).toBe(40);
  });
});
