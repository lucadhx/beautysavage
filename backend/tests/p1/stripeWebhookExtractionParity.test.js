// tests/p1/stripeWebhookExtractionParity.test.js
// Sprint F2 — Le webhook Stripe a été extrait vers services/stripe/stripeWebhookService +
// stripeWebhookEventHandlers + stripeRefundEventService. Ce test verrouille le contrat HTTP
// du routing webhook après extraction (signature/secret/event non géré) et l'absence de fuite
// de secret. La finalisation de vente / idempotence est couverte par
// stripe.webhook.idempotence.characterization + stripeWebhookCredentialVault (inchangés).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Stripe from 'stripe';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import WebhookFailureLog from '../../models/WebhookFailureLog.js';
import { handleWebhook } from '../../controllers/stripeController.js';
import { handleWebhookFromRequest } from '../../services/stripe/stripeWebhookService.js';

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

describe('F2 — stripe webhook extraction parity', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); vi.restoreAllMocks(); });

  it('signature invalide → 400 (via le contrôleur délégateur)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = mockRes();
    await handleWebhook({ headers: { 'stripe-signature': 'bad' }, body: Buffer.from('{}') }, res);
    expect(res.statusCode).toBe(400);
  });

  it('event non géré → 200 { received: true } (routing inchangé)', async () => {
    const req = signedReq({ id: 'evt_unhandled', type: 'customer.created', data: { object: {} } });
    const res = mockRes();
    await handleWebhook(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('le service renvoie un résultat structuré { status, json } pour un event non géré', async () => {
    const req = signedReq({ id: 'evt_unhandled2', type: 'invoice.paid', data: { object: {} } });
    const result = await handleWebhookFromRequest(req);
    expect(result).toMatchObject({ status: 200, json: { received: true } });
  });

  it('payment_intent.payment_failed sans id → 200 received (aucune fuite, libère réservation si id)', async () => {
    const req = signedReq({
      id: 'evt_failed',
      type: 'payment_intent.payment_failed',
      data: { object: { id: '' } }
    });
    const res = mockRes();
    await handleWebhook(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    // Aucun WebhookFailureLog pour un échec de paiement normal.
    const logs = await WebhookFailureLog.find({}).lean();
    expect(logs).toHaveLength(0);
  });
});
