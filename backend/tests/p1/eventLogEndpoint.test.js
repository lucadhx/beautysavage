// tests/p1/eventLogEndpoint.test.js
// GET /api/gestion/dev/events — requireStrictDev. No secret/email/token returned.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/mailService.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendEmailConfirmationCodeEmail: async () => true,
    sendPasswordResetEmail: async () => true
  };
});
vi.mock('../../services/notificationService.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, triggerNotification: async () => {} };
});

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const EventLog = (await import('../../models/EventLog.js')).default;

const IP_DEV = '203.0.113.50';
const IP_ADMIN = '203.0.113.51';
const IP_CLIENT = '203.0.113.52';

let agent;
async function login(email, ip) {
  return agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
}

describe('GET /api/gestion/dev/events', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    await seedTestData();
    await EventLog.create({ eventName: 'sale.created', domain: 'sale', version: 1, contextType: 'sale', contextId: 'S-1', payloadSafe: { saleId: 'S-1' }, emittedAt: new Date() });
  });

  it('dev gets the events (200), no secret/email', async () => {
    const loginRes = await login('dev@test.local', IP_DEV);
    expect(loginRes.status).toBe(200);
    const res = await agent.get('/api/gestion/dev/events')
      .set('Cookie', loginRes.headers['set-cookie']).set('X-Forwarded-For', IP_DEV);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.events[0]).toHaveProperty('eventName');
    expect(res.body.events[0]).toHaveProperty('domain');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('sk_live');
    expect(raw).not.toContain('xkeysib-');
    expect(raw).not.toContain('@test.local'); // no recipient email leaks into events
  });

  it('admin is refused (requireStrictDev) -> 403', async () => {
    const loginRes = await login('admin@test.local', IP_ADMIN);
    const res = await agent.get('/api/gestion/dev/events')
      .set('Cookie', loginRes.headers['set-cookie']).set('X-Forwarded-For', IP_ADMIN);
    expect(res.status).toBe(403);
  });

  it('client is refused -> 403', async () => {
    const loginRes = await login('client1@test.local', IP_CLIENT);
    const res = await agent.get('/api/gestion/dev/events')
      .set('Cookie', loginRes.headers['set-cookie']).set('X-Forwarded-For', IP_CLIENT);
    expect(res.status).toBe(403);
  });
});
