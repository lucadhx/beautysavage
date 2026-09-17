// tests/p1/checkoutSessionStatus.test.js
// R2C — GET /api/stripe/session-status résout un id de Checkout Session (cs_…) en PaymentIntent,
// en plus du chemin pi_… existant. requireAuth.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ stripe: null, retrievedSession: null }));
vi.mock('../../services/stripe/stripeConfigService.js', async orig => {
  const actual = await orig();
  return { ...actual, getStripeClient: async () => h.stripe };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

async function login(agent) {
  const r = await agent.post('/auth/login').send({ email: 'client1@test.local', password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}

describe('R2C — GET /api/stripe/session-status', () => {
  let agent;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase(); await seedTestData();
    h.retrievedSession = null;
    h.stripe = {
      checkout: { sessions: { retrieve: async (id) => { h.retrievedSession = id; return { id, payment_intent: 'pi_from_cs' }; } } },
      paymentIntents: { retrieve: async (id) => ({ id, status: id === 'pi_from_cs' ? 'succeeded' : 'processing' }) }
    };
  });

  it('cs_… → résout la Checkout Session puis le PaymentIntent (succeeded)', async () => {
    const cookie = await login(agent);
    const res = await agent.get('/api/stripe/session-status?session_id=cs_abc').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.payment_status).toBe('succeeded');
    expect(res.body.status).toBe('complete');
    expect(h.retrievedSession).toBe('cs_abc'); // la Session a bien été récupérée
  });

  it('pi_… → chemin inchangé (pas de retrieve de session)', async () => {
    const cookie = await login(agent);
    const res = await agent.get('/api/stripe/session-status?payment_intent_id=pi_direct').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.payment_status).toBe('processing');
    expect(h.retrievedSession).toBeNull();
  });

  it('cs_… sans payment_intent → statut open/unpaid', async () => {
    h.stripe.checkout.sessions.retrieve = async (id) => ({ id, payment_intent: null });
    const cookie = await login(agent);
    const res = await agent.get('/api/stripe/session-status?session_id=cs_nopi').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(res.body.payment_status).toBe('unpaid');
  });

  it('non authentifié → 401', async () => {
    const res = await agent.get('/api/stripe/session-status?session_id=cs_x');
    expect(res.status).toBe(401);
  });
});
