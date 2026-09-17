import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

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
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const SessionCancellationFlow = (await import('../../models/SessionCancellationFlow.js')).default;
const {
  applyFlowRefundDecision,
  createOrRefreshInstituteDecisionFlow
} = await import('../../services/sessionCancellationFlowService.js');
const { runRefundRecovery } = await import('../../services/refundRecoveryService.js');

describe('P1 - refund recovery keeps blocked refunds retryable', () => {
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
  });

  it('keeps an institute refund flow retryable when the Stripe refund trigger fails once', async () => {
    const sale = await Sale.create({
      saleId: 'SALE-RECOVERY-FLOW-1',
      userId: fixtures.client1._id,
      customer: {
        firstName: 'Client',
        lastName: 'Test',
        email: fixtures.client1.email
      },
      items: [
        {
          type: 'formation',
          itemId: fixtures.formationPresentiel._id,
          formationId: fixtures.formationPresentiel._id,
          name: fixtures.formationPresentiel.name,
          finalPrice: 120
        }
      ],
      totalAmount: 120,
      stripePaymentIntentId: 'pi_recovery_flow_1',
      accepted_cgv: true,
      createdAt: new Date()
    });

    const { flow } = await createOrRefreshInstituteDecisionFlow({
      session: fixtures.formationSession,
      formationId: fixtures.formationPresentiel._id,
      formation: fixtures.formationPresentiel,
      userId: fixtures.client1._id,
      clientEmail: fixtures.client1.email,
      saleId: sale.saleId,
      referenceDate: new Date()
    });

    refundsCreateMock.mockRejectedValueOnce(new Error('temporary Stripe outage'));
    refundsCreateMock.mockResolvedValueOnce({ id: 're_recovery_flow_1' });

    await applyFlowRefundDecision({
      flow,
      clientIp: '127.0.0.1',
      triggeredBy: 'client'
    });

    const afterFailure = await SessionCancellationFlow.findOne({ flowId: flow.flowId }).lean();
    expect(afterFailure.decision).toBe('pending');
    expect(afterFailure.usedAt).toBeNull();
    expect(afterFailure.refundRequestId).toBeTruthy();

    const firstRefund = await RefundRequest.findOne({ refundId: afterFailure.refundRequestId }).lean();
    expect(firstRefund.status).toBe('requested');
    expect(firstRefund.stripeRefundId).toBeNull();

    const retryFlow = await SessionCancellationFlow.findOne({ flowId: flow.flowId });
    await applyFlowRefundDecision({
      flow: retryFlow,
      clientIp: '127.0.0.1',
      triggeredBy: 'client'
    });

    const finalFlow = await SessionCancellationFlow.findOne({ flowId: flow.flowId }).lean();
    const finalRefund = await RefundRequest.findOne({ refundId: finalFlow.refundRequestId }).lean();

    expect(finalFlow.decision).toBe('refund');
    expect(finalFlow.usedAt).not.toBeNull();
    expect(finalRefund.status).toBe('pending');
    expect(finalRefund.stripeRefundId).toBe('re_recovery_flow_1');
    expect(refundsCreateMock).toHaveBeenCalledTimes(2);
    expect(refundsCreateMock.mock.calls[0][1].idempotencyKey).toBe(
      refundsCreateMock.mock.calls[1][1].idempotencyKey
    );
  });

  it('replays requested refunds through the recovery job without creating a second Stripe refund', async () => {
    await Sale.create({
      saleId: 'SALE-RECOVERY-JOB-1',
      userId: fixtures.client1._id,
      customer: {
        firstName: 'Client',
        lastName: 'Test',
        email: fixtures.client1.email
      },
      items: [
        {
          type: 'formation',
          itemId: fixtures.formationPresentiel._id,
          formationId: fixtures.formationPresentiel._id,
          name: fixtures.formationPresentiel.name,
          finalPrice: 80
        }
      ],
      totalAmount: 80,
      stripePaymentIntentId: 'pi_recovery_job_1',
      accepted_cgv: true,
      createdAt: new Date()
    });

    const refund = await RefundRequest.create({
      refundId: 'RF-RECOVERY-JOB-1',
      saleId: 'SALE-RECOVERY-JOB-1',
      userId: fixtures.client1._id,
      itemId: fixtures.formationPresentiel._id,
      itemType: 'formation',
      formationId: fixtures.formationPresentiel._id,
      amount: 80,
      currency: 'EUR',
      status: 'requested',
      requestedAt: new Date(),
      reason: 'session_canceled_by_institute',
      clientIp: '127.0.0.1',
      purchaseAcceptedText: 'CGV',
      eligibleRefund: true,
      meta: {
        formationTitle: fixtures.formationPresentiel.name
      }
    });

    refundsCreateMock.mockResolvedValueOnce({ id: 're_recovery_job_1' });

    const summary = await runRefundRecovery({ limit: 10 });
    const afterRecovery = await RefundRequest.findOne({ refundId: refund.refundId }).lean();

    expect(summary.inspectedCount).toBe(1);
    expect(summary.recoveredCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(afterRecovery.status).toBe('pending');
    expect(afterRecovery.stripeRefundId).toBe('re_recovery_job_1');
    expect(refundsCreateMock).toHaveBeenCalledTimes(1);
    expect(refundsCreateMock.mock.calls[0][1].idempotencyKey).toBe(
      'refund-request:RF-RECOVERY-JOB-1:stripe-refund'
    );

    const secondSummary = await runRefundRecovery({ limit: 10 });
    const afterSecondRun = await RefundRequest.findOne({ refundId: refund.refundId }).lean();

    expect(secondSummary.inspectedCount).toBe(1);
    expect(secondSummary.failedCount).toBe(0);
    expect(afterSecondRun.status).toBe('pending');
    expect(refundsCreateMock).toHaveBeenCalledTimes(1);
  });
});
