// tests/p1/mailSupervisionPrivacy.test.js
// M3E — Confidentialité : la supervision n'expose JAMAIS d'e-mail complet ni de secret.
// recipientHash + providerMessageId exposés (safe). Vérifié sur dev et admin.
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
const DEV_IP = '203.0.113.90';
const ADMIN_IP = '203.0.113.91';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

async function seedRows() {
  await MailEventDelivery.create([
    { eventName: 'refund.succeeded', templateKey: 'refund_confirmed', fromRole: 'commerciale', toRole: 'client', contextType: 'refund_request', contextId: 'R1', status: 'sent', detailSafe: 'ok' }
  ]);
  await SendLog.create([
    { provider: 'brevo', templateKey: 'refund_confirmed', recipientHash: 'abc123hash', status: 'sent', providerMessageId: '<msg-1>', subject: 'Votre remboursement', contextType: 'refund_request', contextId: 'R1', metadata: { tags: ['transactional', 'refund_confirmed', 'from:commerciale', 'to:client', 'role-engine'] } }
  ]);
}

describe('M3E — privacy supervision', () => {
  beforeAll(async () => { agent = await getAgent(); await MailEventDelivery.syncIndexes(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await MailEventDelivery.syncIndexes(); await seedTestData(); await seedRows(); });

  it('dev mail-deliveries : aucun e-mail, aucun secret, recipientHash exposé via détail', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const list = await agent.get('/api/gestion/dev/mail-deliveries').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(EMAIL_RE.test(JSON.stringify(list.body))).toBe(false);
    const row = await MailEventDelivery.findOne({ eventName: 'refund.succeeded' }).lean();
    const detail = await agent.get(`/api/gestion/dev/mail-deliveries/${row._id}`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    const raw = JSON.stringify(detail.body);
    expect(EMAIL_RE.test(raw)).toBe(false);
    expect(raw).not.toMatch(/xkeysib-|sk_live_|whsec_/);
    expect(detail.body.delivery.recipientHash).toBe('abc123hash');
    expect(detail.body.delivery.providerMessageId).toBe('<msg-1>');
  });

  it('admin send-logs : recipientHash présent, e-mail absent, pas de payload brut', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/send-logs').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    const raw = JSON.stringify(res.body);
    expect(EMAIL_RE.test(raw)).toBe(false);
    expect(raw).not.toMatch(/xkeysib-|sk_live_|whsec_/);
    const log = res.body.items.find(i => i.templateKey === 'refund_confirmed');
    expect(log.recipientHash).toBe('abc123hash');
    expect(log.providerMessageId).toBe('<msg-1>');
    expect(log.senderRole).toBe('commerciale');
    expect(log.recipientRole).toBe('client');
    expect(log).not.toHaveProperty('htmlContent');
    expect(log).not.toHaveProperty('payload');
  });
});
