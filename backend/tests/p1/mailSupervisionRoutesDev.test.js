// tests/p1/mailSupervisionRoutesDev.test.js
// M3E — Endpoints DEV supervision (strict dev). Admin/client refusés. Lecture seule.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import MailEventDelivery from '../../models/MailEventDelivery.js';
import SendLog from '../../models/SendLog.js';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

let agent;
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}
const DEV_IP = '203.0.113.70';
const ADMIN_IP = '203.0.113.71';
const CLIENT_IP = '203.0.113.72';

async function seedRows() {
  await MailEventDelivery.create([
    { eventName: 'refund.succeeded', templateKey: 'refund_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'refund_request', contextId: 'R1', status: 'sent' },
    { eventName: 'commission.available', templateKey: 'commission_available', fromRole: 'support', toRole: 'commerciale', contextType: 'commission_payment', contextId: 'C1', status: 'shadow' }
  ]);
  await SendLog.create([
    { provider: 'brevo', templateKey: 'refund_confirmed', recipientHash: 'h1', status: 'sent', providerMessageId: '<m1>', contextType: 'refund_request', contextId: 'R1', metadata: { tags: ['transactional', 'refund_confirmed', 'from:commerciale', 'to:client', 'role-engine'] } }
  ]);
}

describe('M3E — routes dev supervision', () => {
  beforeAll(async () => { agent = await getAgent(); await MailEventDelivery.syncIndexes(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await MailEventDelivery.syncIndexes(); await seedTestData(); await seedRows(); });

  it('dev liste les mail-deliveries (toutes, plateforme incluse)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.get('/api/gestion/dev/mail-deliveries').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    expect(res.body.roleView).toBe('dev');
    expect(res.body.items.map(i => i.eventName)).toContain('commission.available');
  });

  it('dev : stats mail-deliveries', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.get('/api/gestion/dev/mail-deliveries/stats').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBe(2);
  });

  it('dev : détail mail-delivery', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const row = await MailEventDelivery.findOne({ eventName: 'refund.succeeded' }).lean();
    const res = await agent.get(`/api/gestion/dev/mail-deliveries/${row._id}`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    expect(res.body.delivery.providerMessageId).toBe('<m1>');
  });

  it('dev : stats send-logs', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.get('/api/gestion/dev/send-logs/stats').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBe(1);
  });

  it('dev : send-logs liste existante toujours OK (contrat conservé)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.get('/api/gestion/dev/send-logs').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it('admin NE PEUT PAS accéder aux endpoints dev (403)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/dev/mail-deliveries').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(403);
  });

  it('client interdit', async () => {
    const cookie = await login('client1@test.local', CLIENT_IP);
    const res = await agent.get('/api/gestion/dev/mail-deliveries').set('Cookie', cookie).set('X-Forwarded-For', CLIENT_IP);
    expect([401, 403]).toContain(res.status);
  });
});
