// tests/p0/security.tracking-token.test.js
// P0 (Phase 1A — FIXED): the public, unauthenticated refund tracking endpoint
// `GET /api/refund-tracking/:token` previously returned the DECRYPTED gift-card
// password. It must no longer expose any password / full credential.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import crypto from 'node:crypto';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const GiftCard = (await import('../../models/GiftCard.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const Sale = (await import('../../models/Sale.js')).default;

// Replicates the app's gift-card password encryption (aes-256-gcm, key=sha256(secret)).
function encryptGiftCardPassword(plain, secret) {
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

const PLAINTEXT_PASSWORD = 'SECRET-PW-DO-NOT-LEAK';
const TRACKING_TOKEN = 'tok_phase1a_test';

describe('P0 — refund tracking endpoint does not leak the gift-card password', () => {
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

    const secret =
      process.env.GIFT_CARD_PASSWORD_SECRET || process.env.SESSION_SECRET;
    const card = await GiftCard.create({
      code: 'GIFTLEAK1',
      userId: fixtures.client1._id,
      amount: 100,
      balance: 50,
      status: 'active',
      passwordEncrypted: encryptGiftCardPassword(PLAINTEXT_PASSWORD, secret)
    });

    // Minimal raw Sale doc (bypass full validation) carrying the gift-card usage
    // that resolveRecreditedGiftCardPayload reads.
    await Sale.collection.insertOne({
      saleId: 'SALE-TRACK-1',
      giftCardUsage: [{ giftCardId: card._id, amountUsed: 50 }]
    });

    await RefundRequest.create({
      refundId: 'RF-TRACK-1',
      saleId: 'SALE-TRACK-1',
      userId: fixtures.client1._id,
      itemId: new mongoose.Types.ObjectId(),
      itemType: 'service',
      amount: 50,
      status: 'succeeded',
      giftCardRefundStatus: 'succeeded',
      giftCardRecredited: true,
      giftCardRecreditAmount: 50,
      trackingToken: TRACKING_TOKEN,
      trackingTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
  });

  it('returns recredit info but NEVER the gift-card password', async () => {
    const res = await agent.get(`/api/refund-tracking/${TRACKING_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The gift-card block is present (recredit succeeded) ...
    expect(res.body.giftCard).toBeTruthy();
    expect(res.body.giftCard.code).toBe('GIFTLEAK1');

    // ... but it must NOT contain a password field, and the plaintext password
    // must NOT appear anywhere in the response payload.
    expect(res.body.giftCard.password).toBeUndefined();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(PLAINTEXT_PASSWORD);
    expect(raw.toLowerCase()).not.toContain('"password"');
  });
});
