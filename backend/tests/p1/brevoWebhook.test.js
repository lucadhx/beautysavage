// tests/p1/brevoWebhook.test.js
// Brevo webhook controller: delivered / opened / bounce update SendLog by
// providerMessageId; optional shared-secret protection; never logs the email.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import SendLog from '../../models/SendLog.js';
import { handleBrevoWebhook } from '../../controllers/brevoWebhookController.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}
function mockReq({ body, querySecret, headerSecret } = {}) {
  const headers = headerSecret ? { 'x-brevo-secret': headerSecret } : {};
  return {
    body,
    query: querySecret ? { secret: querySecret } : {},
    headers,
    get(name) { return headers[String(name).toLowerCase()]; }
  };
}

async function seedSent(messageId) {
  return SendLog.create({ provider: 'brevo', providerMessageId: messageId, status: 'sent', recipientHash: 'h', templateKey: 'vente' });
}

describe('Brevo webhook', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('marks delivered', async () => {
    await seedSent('msg-deliv');
    const res = mockRes();
    await handleBrevoWebhook(mockReq({ body: { event: 'delivered', 'message-id': 'msg-deliv', email: 'x@y.com' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.processed).toBe(1);
    const log = await SendLog.findOne({ providerMessageId: 'msg-deliv' }).lean();
    expect(log.status).toBe('delivered');
    expect(log.deliveredAt).toBeTruthy();
  });

  it('marks opened', async () => {
    await seedSent('msg-open');
    const res = mockRes();
    await handleBrevoWebhook(mockReq({ body: { event: 'opened', 'message-id': 'msg-open' } }), res);
    const log = await SendLog.findOne({ providerMessageId: 'msg-open' }).lean();
    expect(log.status).toBe('opened');
    expect(log.openedAt).toBeTruthy();
  });

  it('marks hard_bounce and soft_bounce as bounced', async () => {
    await seedSent('msg-hb');
    await seedSent('msg-sb');
    await handleBrevoWebhook(mockReq({ body: { event: 'hard_bounce', 'message-id': 'msg-hb' } }), mockRes());
    await handleBrevoWebhook(mockReq({ body: { event: 'soft_bounce', 'message-id': 'msg-sb' } }), mockRes());
    expect((await SendLog.findOne({ providerMessageId: 'msg-hb' })).status).toBe('bounced');
    expect((await SendLog.findOne({ providerMessageId: 'msg-sb' })).status).toBe('bounced');
  });

  it('accepts a batch array and counts processed', async () => {
    await seedSent('b1');
    await seedSent('b2');
    const res = mockRes();
    await handleBrevoWebhook(mockReq({ body: [
      { event: 'delivered', 'message-id': 'b1' },
      { event: 'opened', 'message-id': 'b2' },
      { event: 'click', 'message-id': 'b1' } // unsupported -> ignored
    ] }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.received).toBe(3);
    expect(res.body.processed).toBe(2);
  });

  it('returns 200 with processed=0 for an unknown message id', async () => {
    const res = mockRes();
    await handleBrevoWebhook(mockReq({ body: { event: 'delivered', 'message-id': 'nope' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.processed).toBe(0);
  });

  it('enforces the shared secret when BREVO_WEBHOOK_SECRET is configured', async () => {
    const prev = process.env.BREVO_WEBHOOK_SECRET;
    try {
      process.env.BREVO_WEBHOOK_SECRET = 'top-secret';
      await seedSent('msg-sec');

      const denied = mockRes();
      await handleBrevoWebhook(mockReq({ body: { event: 'delivered', 'message-id': 'msg-sec' } }), denied);
      expect(denied.statusCode).toBe(401);
      expect((await SendLog.findOne({ providerMessageId: 'msg-sec' })).status).toBe('sent'); // unchanged

      const allowed = mockRes();
      await handleBrevoWebhook(mockReq({ body: { event: 'delivered', 'message-id': 'msg-sec' }, headerSecret: 'top-secret' }), allowed);
      expect(allowed.statusCode).toBe(200);
      expect((await SendLog.findOne({ providerMessageId: 'msg-sec' })).status).toBe('delivered');
    } finally {
      if (prev === undefined) delete process.env.BREVO_WEBHOOK_SECRET;
      else process.env.BREVO_WEBHOOK_SECRET = prev;
    }
  });

  it('never logs the recipient email', async () => {
    await seedSent('msg-priv');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleBrevoWebhook(mockReq({ body: { event: 'delivered', 'message-id': 'msg-priv', email: 'secret-person@example.com' } }), mockRes());
    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('secret-person@example.com');
  });
});
