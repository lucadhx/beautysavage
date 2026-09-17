// tests/p1/stripeWebhookFailureObservability.test.js
// Sprint pré-React A6 — Observabilité des pannes webhook Stripe.
//   - signature invalide → WebhookFailureLog safe (stage 'signature'), 400
//   - traitement qui échoue (contexte introuvable) → WebhookFailureLog safe, 500
//   - replay idempotent (vente déjà traitée) → 200, AUCUN faux failure
//   - le service recordWebhookFailure ne stocke aucune donnée sensible
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Stripe from 'stripe';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import WebhookFailureLog from '../../models/WebhookFailureLog.js';
import Sale from '../../models/Sale.js';
import { handleWebhook } from '../../controllers/stripeController.js';
import { recordWebhookFailure } from '../../services/webhookFailureService.js';

const WEBHOOK_SECRET = 'whsec_test_fake_harness'; // = process.env.STRIPE_WEBHOOK_SECRET (testEnv)
const signer = new Stripe('sk_test_fake_harness');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    sent: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.sent = b; return this; }
  };
}
function signedReq(eventObj, { secret = WEBHOOK_SECRET } = {}) {
  const payload = JSON.stringify(eventObj);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return { headers: { 'stripe-signature': header }, body: Buffer.from(payload) };
}

describe('A6 — Stripe webhook failure observability', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); vi.restoreAllMocks(); });

  it('records a safe failure on invalid signature and returns 400', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = { headers: { 'stripe-signature': 'bad' }, body: Buffer.from('{}') };
    const res = mockRes();
    await handleWebhook(req, res);
    expect(res.statusCode).toBe(400);
    const logs = await WebhookFailureLog.find({}).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].failureStage).toBe('signature');
    expect(logs[0].retryable).toBe(false);
    expect(logs[0].provider).toBe('stripe');
  });

  it('records a safe failure when the purchase context is not found (processing) and returns 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const event = {
      id: 'evt_proc_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_no_context', metadata: {} } }
    };
    const res = mockRes();
    await handleWebhook(signedReq(event), res);
    expect(res.statusCode).toBe(500);
    const logs = await WebhookFailureLog.find({}).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0].failureStage).toBe('processing');
    expect(logs[0].eventType).toBe('payment_intent.succeeded');
    expect(logs[0].stripeEventId).toBe('evt_proc_1');
    expect(logs[0].paymentIntentId).toBe('pi_no_context');
    expect(logs[0].retryable).toBe(true);
  });

  it('does NOT log a failure for an idempotent replay (sale already processed)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Pre-existing sale for this PaymentIntent → handler must short-circuit idempotently.
    await Sale.create({
      saleId: 'S-REPLAY-1',
      userId: new mongoose.Types.ObjectId(),
      items: [{ type: 'product', itemId: new mongoose.Types.ObjectId(), name: 'x', price: 10, finalPrice: 10 }],
      totalAmount: 10,
      itemCount: 1,
      stripePaymentIntentId: 'pi_replay'
    });
    const event = {
      id: 'evt_replay_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_replay', metadata: {} } }
    };
    const res = mockRes();
    await handleWebhook(signedReq(event), res);
    expect(res.statusCode).toBe(200);
    expect(res.body?.idempotent).toBe(true);
    expect(await WebhookFailureLog.countDocuments({})).toBe(0);
  });

  it('recordWebhookFailure never stores sensitive data (truncates message, drops malformed ids)', async () => {
    const longMessage = 'x'.repeat(1000);
    await recordWebhookFailure({
      provider: 'stripe',
      failureStage: 'processing',
      errorMessageSafe: longMessage,
      stripeEventId: 'evt ok? <script>',   // malformed → dropped
      paymentIntentId: 'pi_valid_123',
      retryable: true
    });
    const log = await WebhookFailureLog.findOne({}).lean();
    expect(log.errorMessageSafe.length).toBeLessThanOrEqual(300);
    expect(log.stripeEventId).toBeNull(); // malformed id rejected
    expect(log.paymentIntentId).toBe('pi_valid_123');
  });
});
