// tests/p0/giftcard.concurrentDebit.test.js
// P0 (Phase 1B-1 — FIXED): gift-card debit is now atomic. Two concurrent debits
// that together exceed the balance can no longer both succeed (no over-debit), and
// the balance never goes negative. Also verifies reservation reserve→release
// integrity is preserved (Task 4).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getTestApp } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const GiftCard = (await import('../../models/GiftCard.js')).default;
const {
  debitGiftCardBalanceAtomic,
  reserveGiftCardAmountsForPaymentIntent,
  releaseGiftCardReservationsForPaymentIntent,
  computeAvailableGiftCardBalance
} = await import('../../services/giftCardReservationService.js');

describe('P0 — gift-card atomic debit & reservation integrity', () => {
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

  it('two concurrent debits exceeding the balance: only ONE succeeds, balance never negative', async () => {
    // Seed a card with balance 100 owned by client2 (client1 already has one).
    const card = await GiftCard.create({
      code: 'CONCDEBIT1',
      userId: fixtures.client2._id,
      amount: 100,
      balance: 100,
      status: 'active'
    });

    // Two concurrent debits of 80 each (160 > 100): exactly one must win.
    const results = await Promise.allSettled([
      debitGiftCardBalanceAtomic({ giftCardId: card._id, amount: 80 }),
      debitGiftCardBalanceAtomic({ giftCardId: card._id, amount: 80 })
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'GIFT_CARD_BALANCE_INSUFFICIENT' });

    const after = await GiftCard.findById(card._id).lean();
    expect(after.balance).toBe(20); // 100 - 80, never -60
    expect(after.balance).toBeGreaterThanOrEqual(0);
  });

  it('atomic debit flips status to redeemed when balance reaches 0', async () => {
    const card = await GiftCard.create({
      code: 'CONCDEBIT2',
      userId: fixtures.client2._id,
      amount: 50,
      balance: 50,
      status: 'active'
    });
    const res = await debitGiftCardBalanceAtomic({ giftCardId: card._id, amount: 50 });
    expect(res.balanceAfter).toBe(0);
    const after = await GiftCard.findById(card._id).lean();
    expect(after.status).toBe('redeemed');
  });

  it('reservation reserve→release restores the available balance (Task 4 preserved)', async () => {
    const card = await GiftCard.create({
      code: 'RESV1',
      userId: fixtures.client2._id,
      amount: 100,
      balance: 100,
      status: 'active'
    });
    const pi = 'pi_resv_1';

    await reserveGiftCardAmountsForPaymentIntent({
      paymentIntentId: pi,
      appliedGiftCards: [{ giftCardId: String(card._id), amount: 40 }]
    });
    let current = await GiftCard.findById(card._id).lean();
    expect(current.reservedAmount).toBe(40);
    expect(computeAvailableGiftCardBalance(current)).toBe(60); // 100 - 40 reserved

    await releaseGiftCardReservationsForPaymentIntent(pi, { reason: 'payment_failed' });
    current = await GiftCard.findById(card._id).lean();
    expect(current.reservedAmount).toBe(0);
    expect(computeAvailableGiftCardBalance(current)).toBe(100); // fully restored
    expect(current.balance).toBe(100); // reservation never touched the balance
  });
});
