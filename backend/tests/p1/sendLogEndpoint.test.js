// tests/p1/sendLogEndpoint.test.js
// GET /api/gestion/dev/send-logs — requireStrictDev (dev only). Returns no email,
// token, or secret.
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
const SendLog = (await import('../../models/SendLog.js')).default;
const { hashRecipient } = await import('../../services/sendLogService.js');

const IP_DEV = '203.0.113.40';
const IP_ADMIN = '203.0.113.41';
const IP_CLIENT = '203.0.113.42';

let agent;
async function login(email, ip) {
  return agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
}

describe('GET /api/gestion/dev/send-logs', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    await seedTestData();
    await SendLog.create({
      channel: 'email', provider: 'brevo', templateKey: 'vente', status: 'sent',
      providerMessageId: '<diag-1>', subject: 'Confirmation',
      recipientHash: hashRecipient('buyer@example.com')
    });
  });

  it('dev gets the logs (200) and the payload contains no email/secret', async () => {
    const loginRes = await login('dev@test.local', IP_DEV);
    expect(loginRes.status).toBe(200);

    const res = await agent
      .get('/api/gestion/dev/send-logs')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_DEV);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(1);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('buyer@example.com'); // hashed, never raw
    expect(raw).not.toContain('xkeysib-');
    expect(raw).not.toContain('sk_live');
    // a known-safe field is present
    expect(res.body.logs[0]).toHaveProperty('status');
    expect(res.body.logs[0]).toHaveProperty('templateKey');
  });

  it('admin is refused (requireStrictDev) -> 403', async () => {
    const loginRes = await login('admin@test.local', IP_ADMIN);
    expect(loginRes.status).toBe(200);
    const res = await agent
      .get('/api/gestion/dev/send-logs')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_ADMIN);
    expect(res.status).toBe(403);
  });

  it('client is refused -> 403', async () => {
    const loginRes = await login('client1@test.local', IP_CLIENT);
    expect(loginRes.status).toBe(200);
    const res = await agent
      .get('/api/gestion/dev/send-logs')
      .set('Cookie', loginRes.headers['set-cookie'])
      .set('X-Forwarded-For', IP_CLIENT);
    expect(res.status).toBe(403);
  });
});
