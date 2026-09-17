import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const GiftCard = (await import('../../models/GiftCard.js')).default;
const GiftCardTransaction = (await import('../../models/GiftCardTransaction.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const { postSignedWebhook } = await import('../setup/stripeWebhookTestUtils.js');

function buildChargeRefundUpdatedEvent({
  id = 'evt_refund_1',
  stripeRefundId = 're_test_1',
  status = 'succeeded'
} = {}) {
  return {
    id,
    object: 'event',
    api_version: '2024-06-20',
    type: 'charge.refund.updated',
    data: {
      object: {
        id: stripeRefundId,
        object: 'refund',
        status,
        amount: 6000,
        currency: 'eur',
        created: Math.floor(Date.now() / 1000),
        updated: Math.floor(Date.now() / 1000)
      }
    }
  };
}

describe('P0 - gift-card recredit is idempotent on duplicate refund webhook delivery', () => {
  let agent;
  let fixtures;

  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    fixtures = await seedTestData();
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

  it('duplicate concurrent charge.refund.updated events credit the gift card only once', async () => {
    const card = await GiftCard.create({
      code: 'RCREDIT1',
      userId: fixtures.client1._id,
      amount: 100,
      balance: 60,
      status: 'active'
    });

    await Sale.create({
      saleId: 'SALE-REF-IDEMP-1',
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
          giftCardId: card._id,
          code: card.code,
          amountUsed: 40
        }
      ],
      totalAmount: 100,
      accepted_cgv: true,
      createdAt: new Date()
    });

    await RefundRequest.create({
      refundId: 'RF-IDEMP-1',
      saleId: 'SALE-REF-IDEMP-1',
      userId: fixtures.client1._id,
      itemId: fixtures.formationPresentiel._id,
      itemType: 'formation',
      formationId: fixtures.formationPresentiel._id,
      amount: 100,
      currency: 'EUR',
      status: 'pending',
      reason: 'session_canceled_by_institute',
      eligibleRefund: true,
      stripeRefundId: 're_test_idemp_1',
      stripeRefundStatus: 'pending',
      stripeRefundAmount: 60,
      giftCardRefundStatus: 'pending',
      giftCardRefundAmount: 40,
      meta: {
        formationTitle: fixtures.formationPresentiel.name
      }
    });

    const event = buildChargeRefundUpdatedEvent({
      id: 'evt_refund_dup_1',
      stripeRefundId: 're_test_idemp_1',
      status: 'succeeded'
    });

    const responses = await Promise.allSettled([
      postSignedWebhook(agent, event),
      postSignedWebhook(agent, event)
    ]);
    for (const response of responses) {
      expect(response.status).toBe('fulfilled');
      expect(response.value.status).toBe(200);
    }

    const updatedCard = await GiftCard.findById(card._id).lean();
    expect(updatedCard.balance).toBe(100);

    const creditTransactions = await GiftCardTransaction.find({
      giftCardId: card._id,
      saleId: 'SALE-REF-IDEMP-1',
      transactionType: 'credit'
    }).lean();
    expect(creditTransactions).toHaveLength(1);
    expect(creditTransactions[0].amount).toBe(40);

    const refund = await RefundRequest.findOne({ refundId: 'RF-IDEMP-1' }).lean();
    expect(refund.status).toBe('succeeded');
    expect(refund.giftCardRecredited).toBe(true);
    expect(refund.giftCardRecreditAmount).toBe(40);
    expect(refund.giftCardRecreditInProgress).toBe(false);
    expect(refund.giftCardRefundStatus).toBe('succeeded');
  });
});
