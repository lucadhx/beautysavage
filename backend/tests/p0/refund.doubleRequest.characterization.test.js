// tests/p0/refund.doubleRequest.characterization.test.js
// P0 (Phase 1B-2): RefundRequest creation is now deduplicated per sale+item.
// The DB enforces a unique partial index for ACTIVE statuses only, and the
// creation helper refetches the existing refund on duplicate/E11000 so callers
// can avoid triggering the financial flow twice.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

const { getTestApp } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const {
  ACTIVE_REFUND_REQUEST_STATUSES,
  createRefundRequestOnce
} = await import('../../services/refundRequestService.js');

describe('P0 regression - duplicate RefundRequest for the same sale item', () => {
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
  });

  it('DB rejects a second active RefundRequest for the same sale+item+itemType', async () => {
    const itemId = new mongoose.Types.ObjectId();
    const base = {
      saleId: 'SALE-DUP-1',
      userId: fixtures.client1._id,
      itemId,
      itemType: 'service',
      amount: 80,
      reason: 'client_cancel_service',
      status: 'requested'
    };

    await RefundRequest.create({ ...base, refundId: 'RF-DUP-1' });

    await expect(
      RefundRequest.create({ ...base, refundId: 'RF-DUP-2' })
    ).rejects.toMatchObject({ code: 11000 });

    const count = await RefundRequest.countDocuments({
      saleId: 'SALE-DUP-1',
      itemId,
      itemType: 'service',
      status: { $in: ACTIVE_REFUND_REQUEST_STATUSES }
    });
    expect(count).toBe(1);
  });

  it('helper refetches the existing refund and only one financial trigger runs under concurrency', async () => {
    const executeSpy = vi.fn(async () => {});
    const itemId = new mongoose.Types.ObjectId();
    const base = {
      saleId: 'SALE-DUP-2',
      userId: fixtures.client1._id,
      itemId,
      itemType: 'service',
      amount: 80,
      reason: 'client_cancel_service',
      status: 'requested',
      eligibleRefund: true
    };

    async function createAndMaybeExecute(refundId) {
      const result = await createRefundRequestOnce({ ...base, refundId });
      if (result.created) {
        await executeSpy(result.refundRequest);
      }
      return result;
    }

    const [first, second] = await Promise.all([
      createAndMaybeExecute('RF-DUP-3'),
      createAndMaybeExecute('RF-DUP-4')
    ]);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(String(first.refundRequest._id)).toBe(String(second.refundRequest._id));

    const activeRefunds = await RefundRequest.find({
      saleId: 'SALE-DUP-2',
      itemId,
      itemType: 'service',
      status: { $in: ACTIVE_REFUND_REQUEST_STATUSES }
    }).lean();
    expect(activeRefunds).toHaveLength(1);
  });
});
