// tests/p1/mailSupervisionRoutesAdmin.test.js
// M3E — Endpoints ADMIN supervision (roleView=admin) : institut/client uniquement, pas de
// données plateforme/dev. Client interdit. Lecture seule.
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
const ADMIN_IP = '203.0.113.80';
const CLIENT_IP = '203.0.113.81';

async function seedRows() {
  await MailEventDelivery.create([
    { eventName: 'refund.succeeded', templateKey: 'refund_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'refund_request', contextId: 'R1', status: 'sent' },
    { eventName: 'commission.available', templateKey: 'commission_available', fromRole: 'support', toRole: 'commerciale', contextType: 'commission_payment', contextId: 'C1', status: 'shadow' }
  ]);
  await SendLog.create([
    { provider: 'brevo', templateKey: 'refund_confirmed', recipientHash: 'h1', status: 'sent', providerMessageId: '<m1>', contextType: 'refund_request', contextId: 'R1', metadata: { tags: ['transactional', 'refund_confirmed', 'from:commerciale', 'to:client', 'role-engine'] } },
    { provider: 'brevo', templateKey: 'password_reset', recipientHash: 'h2', status: 'sent', contextType: 'user', contextId: 'U1', metadata: { tags: ['transactional', 'password_reset'] } }
  ]);
}

describe('M3E — routes admin supervision', () => {
  beforeAll(async () => { agent = await getAgent(); await MailEventDelivery.syncIndexes(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await MailEventDelivery.syncIndexes(); await seedTestData(); await seedRows(); });

  it('admin liste mail-deliveries (institut/client uniquement, pas la plateforme)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/mail-deliveries').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    expect(res.body.roleView).toBe('admin');
    const events = res.body.items.map(i => i.eventName);
    expect(events).toContain('refund.succeeded');
    expect(events).not.toContain('commission.available');
  });

  it('admin : détail d’une livraison plateforme → 404 (hors audience)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const commission = await MailEventDelivery.findOne({ eventName: 'commission.available' }).lean();
    const res = await agent.get(`/api/gestion/mail-deliveries/${commission._id}`).set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(404);
  });

  it('admin : stats mail-deliveries (périmètre admin)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/mail-deliveries/stats').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBe(1); // seul refund.succeeded est dans l'audience admin
    expect(res.body.stats.roleView).toBe('admin');
  });

  it('admin : send-logs masquent les templates plateforme', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/send-logs').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    const keys = res.body.items.map(i => i.templateKey);
    expect(keys).toContain('refund_confirmed');
    expect(keys).not.toContain('password_reset');
  });

  it('admin : stats send-logs', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/send-logs/stats').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBe(1); // password_reset exclu
  });

  it('client interdit (mail-deliveries + send-logs)', async () => {
    const cookie = await login('client1@test.local', CLIENT_IP);
    const a = await agent.get('/api/gestion/mail-deliveries').set('Cookie', cookie).set('X-Forwarded-For', CLIENT_IP);
    const b = await agent.get('/api/gestion/send-logs').set('Cookie', cookie).set('X-Forwarded-For', CLIENT_IP);
    expect([401, 403]).toContain(a.status);
    expect([401, 403]).toContain(b.status);
  });
});
