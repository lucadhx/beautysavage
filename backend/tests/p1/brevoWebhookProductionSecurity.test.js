// tests/p1/brevoWebhookProductionSecurity.test.js
// Sprint pré-React A3 — Webhook Brevo sécurisé en production.
//   - PROD sans secret      → 503 (endpoint désactivé, aucun événement traité)
//   - PROD avec mauvais secret → 401
//   - PROD avec bon secret   → traitement (200)
//   - DEV/TEST sans secret   → toléré (200) — comportement documenté
// Ne logge jamais le secret.
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

const SECRET = 'prod-webhook-secret-do-not-use';

describe('A3 — Brevo webhook production security', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.BREVO_WEBHOOK_SECRET;

  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await stopMemoryDb();
    process.env.NODE_ENV = prevEnv;
    if (prevSecret === undefined) delete process.env.BREVO_WEBHOOK_SECRET;
    else process.env.BREVO_WEBHOOK_SECRET = prevSecret;
  });
  beforeEach(async () => { await clearDatabase(); });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = prevEnv;
    if (prevSecret === undefined) delete process.env.BREVO_WEBHOOK_SECRET;
    else process.env.BREVO_WEBHOOK_SECRET = prevSecret;
  });

  it('PROD without secret → 503 and no event processed', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BREVO_WEBHOOK_SECRET;
    await seedSent('prod-nosecret');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await handleBrevoWebhook(mockReq({ body: { event: 'delivered', 'message-id': 'prod-nosecret' } }), res);
    expect(res.statusCode).toBe(503);
    expect((await SendLog.findOne({ providerMessageId: 'prod-nosecret' })).status).toBe('sent'); // untouched
    // never logs the secret value
    const logged = errSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain(SECRET);
  });

  it('PROD with wrong secret → 401', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BREVO_WEBHOOK_SECRET = SECRET;
    await seedSent('prod-wrong');
    const res = mockRes();
    await handleBrevoWebhook(
      mockReq({ body: { event: 'delivered', 'message-id': 'prod-wrong' }, headerSecret: 'WRONG' }),
      res
    );
    expect(res.statusCode).toBe(401);
    expect((await SendLog.findOne({ providerMessageId: 'prod-wrong' })).status).toBe('sent');
  });

  it('PROD with correct secret → processes the event (200)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BREVO_WEBHOOK_SECRET = SECRET;
    await seedSent('prod-ok');
    const res = mockRes();
    await handleBrevoWebhook(
      mockReq({ body: { event: 'delivered', 'message-id': 'prod-ok' }, headerSecret: SECRET }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.processed).toBe(1);
    expect((await SendLog.findOne({ providerMessageId: 'prod-ok' })).status).toBe('delivered');
  });

  it('DEV/TEST without secret → tolerated (200), documented limitation', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.BREVO_WEBHOOK_SECRET;
    await seedSent('dev-nosecret');
    const res = mockRes();
    await handleBrevoWebhook(mockReq({ body: { event: 'delivered', 'message-id': 'dev-nosecret' } }), res);
    expect(res.statusCode).toBe(200);
    expect((await SendLog.findOne({ providerMessageId: 'dev-nosecret' })).status).toBe('delivered');
  });

  it('never logs the configured secret value', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BREVO_WEBHOOK_SECRET = SECRET;
    await seedSent('prod-priv');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleBrevoWebhook(
      mockReq({ body: { event: 'delivered', 'message-id': 'prod-priv' }, headerSecret: SECRET }),
      mockRes()
    );
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain(SECRET);
  });
});
