// tests/p1/refundRecoveryLifecycle.test.js
// LOT2 — La reprise de remboursement est BORNÉE : classification d'erreurs, backoff, état
// terminal. Une erreur terminale (transaction introuvable) n'est plus retentée à l'infini ;
// un credential manquant est différé (jamais final) ; le plafond de tentatives abandonne.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const triggerMock = vi.fn();
vi.mock('../../services/refundExecutionService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerRefundExecution: (...args) => triggerMock(...args) };
});

const { getTestApp } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const {
  runRefundRecovery,
  classifyRefundError,
  applyRefundFailureState
} = await import('../../services/refundRecoveryService.js');

function credError() {
  const e = new Error('[credentialService] no active credential: stripe-institut/secret_key (runtime=null)');
  e.name = 'CredentialNotFoundError';
  return e;
}
async function makeRefund(refundId) {
  return RefundRequest.create({
    refundId,
    saleId: `SALE-${refundId}`,
    userId: new mongoose.Types.ObjectId(),
    itemId: new mongoose.Types.ObjectId(),
    itemType: 'formation',
    amount: 100,
    currency: 'EUR',
    status: 'requested',
    requestedAt: new Date(),
    reason: 'session_canceled_by_institute',
    clientIp: '127.0.0.1',
    purchaseAcceptedText: 'CGV',
    eligibleRefund: true
  });
}

describe('refund recovery — cycle de vie borné (LOT2)', () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); triggerMock.mockReset(); });

  it('classifyRefundError mappe les erreurs vers des codes métier', () => {
    expect(classifyRefundError(credError())).toMatchObject({ code: 'MISSING_CREDENTIAL', retryable: false, terminal: false });
    expect(classifyRefundError(new Error('Remboursement Stripe impossible: transaction introuvable.')))
      .toMatchObject({ code: 'TRANSACTION_NOT_FOUND', terminal: true });
    expect(classifyRefundError({ type: 'StripeConnectionError', message: 'network' }))
      .toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(classifyRefundError({ status: 429, message: 'rate limit' }))
      .toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(classifyRefundError(new Error('boom'))).toMatchObject({ code: 'UNKNOWN', retryable: true });
  });

  it('MISSING_CREDENTIAL → différé (jamais final), non re-inspecté au cycle suivant', async () => {
    const rf = await makeRefund('RF-CRED');
    triggerMock.mockRejectedValue(credError());
    const summary = await runRefundRecovery({ limit: 10, trigger: 'startup' });
    expect(summary.inspectedCount).toBe(1);
    expect(summary.configurationBlockedCount).toBe(1);
    expect(summary.finalFailedCount).toBe(0);
    const after = await RefundRequest.findById(rf._id).lean();
    expect(after.lastRefundErrorCode).toBe('MISSING_CREDENTIAL');
    expect(after.refundFailedFinalAt).toBeNull();
    expect(after.nextRefundRetryAt).toBeInstanceOf(Date);
    // Cycle suivant : non dû (backoff) → non inspecté (plus de spam).
    const second = await runRefundRecovery({ limit: 10, trigger: 'interval' });
    expect(second.inspectedCount).toBe(0);
  });

  it('TRANSACTION_NOT_FOUND → terminal (final), plus jamais retenté', async () => {
    const rf = await makeRefund('RF-TXN');
    triggerMock.mockRejectedValue(new Error('Remboursement Stripe impossible: transaction introuvable.'));
    const summary = await runRefundRecovery({ limit: 10, trigger: 'startup' });
    expect(summary.finalFailedCount).toBe(1);
    const after = await RefundRequest.findById(rf._id).lean();
    expect(after.lastRefundErrorCode).toBe('TRANSACTION_NOT_FOUND');
    expect(after.refundFailedFinalAt).toBeInstanceOf(Date);
    expect(after.refundRetryable).toBe(false);
    const second = await runRefundRecovery({ limit: 10, trigger: 'interval' });
    expect(second.inspectedCount).toBe(0); // exclu (final)
  });

  it('plafond de tentatives → abandon final (applyRefundFailureState)', async () => {
    const rf = await makeRefund('RF-CAP');
    const cls = { code: 'PROVIDER_UNAVAILABLE', retryable: true, terminal: false };
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await applyRefundFailureState(rf._id, cls, new Date());
    }
    expect(last.finalFailed).toBe(true);
    const after = await RefundRequest.findById(rf._id).lean();
    expect(after.stripeRefundAttempts).toBe(5);
    expect(after.refundFailedFinalAt).toBeInstanceOf(Date);
  });

  it('succès → aucun état d\'échec posé, recovered compté', async () => {
    const rf = await makeRefund('RF-OK');
    triggerMock.mockResolvedValue({ refund: null, stripeInitiated: true, mode: 'recovered' });
    const summary = await runRefundRecovery({ limit: 10, trigger: 'startup' });
    expect(summary.recoveredCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    const after = await RefundRequest.findById(rf._id).lean();
    expect(after.refundFailedFinalAt).toBeNull();
    expect(after.stripeRefundAttempts).toBe(0);
  });
});
