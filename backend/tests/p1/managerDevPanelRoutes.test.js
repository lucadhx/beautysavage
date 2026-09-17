import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/stripe/dev/stripeDevContractSyncService.js', () => ({
  syncStripeStatuses: vi.fn(async () => {}),
}));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const EventLog = (await import('../../models/EventLog.js')).default;
const Review = (await import('../../models/Review.js')).default;
const UnifiedCheckout = (await import('../../models/UnifiedCheckout.js')).default;
const WebhookFailureLog = (await import('../../models/WebhookFailureLog.js')).default;

let agent;
let fx;

async function login(email, ip) {
  const res = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('manager and dev panel routes', () => {
  beforeAll(async () => {
    agent = await getAgent();
    await Review.syncIndexes();
    await UnifiedCheckout.syncIndexes();
  });

  afterAll(async () => {
    await stopMemoryDb();
  });

  beforeEach(async () => {
    await clearDatabase();
    await Review.syncIndexes();
    await UnifiedCheckout.syncIndexes();
    fx = await seedTestData();

    await Review.create({
      userId: fx.client1._id,
      formationId: fx.formationDistanciel._id,
      targetType: 'formation',
      sourceType: 'client',
      rating: 5,
      comment: 'Avis manager.',
      status: 'published',
    });

    await EventLog.create({
      eventName: 'booking.confirmed',
      domain: 'booking',
      version: 1,
      contextType: 'booking',
      contextId: 'BK-1',
      payloadSafe: { bookingId: 'BK-1' },
      emittedAt: new Date(),
    });

    await WebhookFailureLog.create({
      provider: 'stripe',
      webhookType: 'checkout',
      eventType: 'payment_intent.succeeded',
      failureStage: 'processing',
      errorCode: 'TEST_FAILURE',
      errorMessageSafe: 'Failure safe.',
      stripeEventId: 'evt_test_1',
      paymentIntentId: 'pi_test_1',
      status: 'failed',
      retryable: true,
      createdAt: new Date(),
    });

    await UnifiedCheckout.create({
      checkoutId: 'UC-TEST-1',
      kind: 'service',
      status: 'pricing_ready',
      source: 'test',
      payment: {
        mode: 'stripe',
        amountToPay: 80,
        giftCardPaymentAmount: 0,
        provider: 'stripe',
        status: 'pending',
        stripePaymentIntentId: 'pi_hidden',
      },
      pricingSnapshot: { total: 80 },
      taxSnapshot: { rate: 0.2 },
      legalConsentSnapshot: { acceptedCgv: true },
    });
  });

  it('dev can access strict diagnostics and shared contract endpoints with safe payloads', async () => {
    const cookie = await login('dev@test.local', '203.0.113.140');

    const current = await agent.get('/api/contract/current').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.140');
    expect(current.status).toBe(200);
    expect(current.body.contract.status).toBe('active');

    const status = await agent.get('/api/contract/check-payment-status').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.140');
    expect(status.status).toBe(200);
    expect(status.body.contractStatus).toBe('active');

    const events = await agent.get('/api/gestion/dev/events').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.140');
    expect(events.status).toBe(200);
    expect(events.body.events).toHaveLength(1);

    const failures = await agent.get('/api/gestion/dev/webhook-failures').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.140');
    expect(failures.status).toBe(200);
    expect(failures.body.failures).toHaveLength(1);

    const checkouts = await agent.get('/api/gestion/dev/unified-checkouts').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.140');
    expect(checkouts.status).toBe(200);
    expect(checkouts.body.checkouts).toHaveLength(1);
    expect(checkouts.body.checkouts[0].checkoutId).toBe('UC-TEST-1');
    expect(checkouts.body.checkouts[0].payment.amountToPay).toBe(80);
    expect(checkouts.body.checkouts[0].payment.stripePaymentIntentId).toBeUndefined();
    expect(checkouts.body.checkouts[0].inputSnapshot).toBeUndefined();
  });

  it('admin keeps shared manager access but stays blocked from strict dev diagnostics', async () => {
    const cookie = await login('admin@test.local', '203.0.113.141');

    const reviews = await agent.get('/api/gestion/learning/reviews').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.141');
    expect(reviews.status).toBe(200);
    expect(reviews.body.reviews).toHaveLength(1);

    const current = await agent.get('/api/contract/current').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.141');
    expect(current.status).toBe(200);

    const events = await agent.get('/api/gestion/dev/events').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.141');
    expect(events.status).toBe(403);

    const failures = await agent.get('/api/gestion/dev/webhook-failures').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.141');
    expect(failures.status).toBe(403);

    const checkouts = await agent.get('/api/gestion/dev/unified-checkouts').set('Cookie', cookie).set('X-Forwarded-For', '203.0.113.141');
    expect(checkouts.status).toBe(403);
  });
});
