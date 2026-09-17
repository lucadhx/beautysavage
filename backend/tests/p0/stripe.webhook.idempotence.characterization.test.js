// tests/p0/stripe.webhook.idempotence.characterization.test.js
// P0 (Phase 1B-1 — FIXED): the Stripe webhook (`payment_intent.succeeded`) now
// creates AT MOST ONE Sale per PaymentIntent, enforced at the DB level by a unique
// partial index on Sale.stripePaymentIntentId (set AT INSERT in persistSale) plus
// idempotent E11000 handling in the webhook.
//
// Covers:
//   - invalid signature is rejected (400)
//   - DB unique partial index: two sales with the same stripePaymentIntentId is
//     rejected (E11000); null PaymentIntent ids are NOT constrained (mock/internal)
//   - realistic webhook: sequential replay AND concurrent delivery of the same
//     payment_intent.succeeded create exactly ONE Sale
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const Sale = (await import('../../models/Sale.js')).default;
const StripeCheckoutIntent = (await import('../../models/StripeCheckoutIntent.js')).default;
const {
  buildPaymentIntentSucceededEvent,
  postSignedWebhook
} = await import('../setup/stripeWebhookTestUtils.js');

describe('P0 — Stripe webhook idempotence (atomic)', () => {
  let agent;

  beforeAll(async () => {
    agent = await getAgent();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    // Neutralize outbound HTTP (Brevo) so post-sale side effects don't hit network.
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

  it('rejects a webhook with an invalid signature (400)', async () => {
    const event = buildPaymentIntentSucceededEvent({ id: 'evt_bad', paymentIntentId: 'pi_bad' });
    const res = await agent
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .set('content-type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(400);
  });

  it('DB enforces ONE sale per stripePaymentIntentId; null ids are unconstrained', async () => {
    // First sale with a concrete PaymentIntent id is fine.
    await Sale.collection.insertOne({ saleId: 'IDX-A', stripePaymentIntentId: 'pi_unique_1' });
    // Second with the SAME id must be rejected by the unique partial index.
    await expect(
      Sale.collection.insertOne({ saleId: 'IDX-B', stripePaymentIntentId: 'pi_unique_1' })
    ).rejects.toMatchObject({ code: 11000 });

    // null PaymentIntent ids (mock / internal gift-card / legacy sales) are NOT
    // constrained — multiple nulls coexist.
    await Sale.collection.insertOne({ saleId: 'IDX-C', stripePaymentIntentId: null });
    await Sale.collection.insertOne({ saleId: 'IDX-D', stripePaymentIntentId: null });
    const nullCount = await Sale.countDocuments({ stripePaymentIntentId: null });
    expect(nullCount).toBe(2);
  });

  async function seedProductCheckoutIntent(paymentIntentId) {
    const fixtures = await seedTestData();
    const intent = await StripeCheckoutIntent.create({
      userId: fixtures.client1._id,
      clientIp: '127.0.0.1',
      stripeSessionId: paymentIntentId,
      checkoutState: {
        item: { type: 'product', id: String(fixtures.product._id) },
        appliedGiftCards: []
      }
    });
    return { fixtures, intent };
  }

  it('sequential replay of the same payment_intent.succeeded creates exactly ONE sale', async () => {
    const pi = 'pi_replay_seq';
    const { intent } = await seedProductCheckoutIntent(pi);
    const event = buildPaymentIntentSucceededEvent({
      id: 'evt_seq',
      paymentIntentId: pi,
      amount: 4000,
      metadata: { intentId: String(intent._id) }
    });

    const first = await postSignedWebhook(agent, event);
    expect(first.status).toBe(200);
    const second = await postSignedWebhook(agent, event); // replay
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ idempotent: true });

    const count = await Sale.countDocuments({ stripePaymentIntentId: pi });
    expect(count).toBe(1);
  });

  it('concurrent delivery of the same payment_intent.succeeded creates exactly ONE sale', async () => {
    const pi = 'pi_replay_concurrent';
    const { intent } = await seedProductCheckoutIntent(pi);
    const event = buildPaymentIntentSucceededEvent({
      id: 'evt_concurrent',
      paymentIntentId: pi,
      amount: 4000,
      metadata: { intentId: String(intent._id) }
    });

    // Fire both at once; whichever loses the race is caught by the findOne guard
    // or the unique-index E11000 handler — either way only ONE sale exists.
    await Promise.allSettled([postSignedWebhook(agent, event), postSignedWebhook(agent, event)]);

    const count = await Sale.countDocuments({ stripePaymentIntentId: pi });
    expect(count).toBe(1);
  });
});
