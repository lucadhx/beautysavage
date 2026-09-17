// tests/setup/stripeWebhookTestUtils.js
// Utility to forge a valid Stripe webhook signature header for a given payload,
// using the same scheme stripe.webhooks.constructEvent() verifies:
//
//   signed_payload = `${timestamp}.${rawBody}`
//   signature      = HMAC_SHA256(signed_payload, STRIPE_WEBHOOK_SECRET)  // hex
//   header         = `t=${timestamp},v1=${signature}`
//
// This lets characterization tests POST signed events to /api/stripe/webhook
// WITHOUT a real Stripe account. The webhook secret comes from
// process.env.STRIPE_WEBHOOK_SECRET (set to a fake value in testEnv.js).
import crypto from 'node:crypto';

export function buildStripeSignatureHeader(rawBody, { secret, timestamp } = {}) {
  const webhookSecret = secret || process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set for the test.');
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const payload = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
  const signedPayload = `${ts}.${payload}`;
  const signature = crypto.createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
  return { header: `t=${ts},v1=${signature}`, payload, timestamp: ts };
}

/**
 * Build a minimal Stripe `payment_intent.succeeded` event envelope.
 * @param {object} opts
 * @param {string} opts.id        event id (vary it for non-idempotent delivery; keep equal for replay)
 * @param {string} opts.paymentIntentId pi_xxx
 * @param {number} opts.amount    amount in cents
 * @param {object} opts.metadata  PI metadata (used by the webhook fallback path)
 */
export function buildPaymentIntentSucceededEvent({
  id = 'evt_test_1',
  paymentIntentId = 'pi_test_1',
  amount = 5000,
  metadata = {}
} = {}) {
  return {
    id,
    object: 'event',
    api_version: '2024-06-20',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        amount,
        currency: 'eur',
        status: 'succeeded',
        latest_charge: null,
        metadata
      }
    }
  };
}

/**
 * POST a signed event to /api/stripe/webhook using a supertest agent.
 * Sends the RAW body so express.raw + constructEvent see the exact bytes signed.
 */
export async function postSignedWebhook(agent, event, { secret } = {}) {
  const rawBody = JSON.stringify(event);
  const { header } = buildStripeSignatureHeader(rawBody, { secret });
  return agent
    .post('/api/stripe/webhook')
    .set('stripe-signature', header)
    .set('content-type', 'application/json')
    .send(rawBody);
}
