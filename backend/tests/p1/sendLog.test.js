// tests/p1/sendLog.test.js
// SendLog model + sendLogService + postToBrevo instrumentation (queued/sent/failed).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import SendLog from '../../models/SendLog.js';
import {
  hashRecipient,
  createQueuedSendLog,
  markSendLogSent,
  markSendLogFailed,
  applyBrevoEvent
} from '../../services/sendLogService.js';
import { postToBrevo } from '../../services/mailService.js';

const PAYLOAD = { to: [{ email: 'client@example.com', name: 'Client' }], subject: 'Bonjour', tags: ['transactional', 'vente'] };

describe('SendLog + sendLogService', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('hashRecipient hashes the email (never stores it raw)', () => {
    const h = hashRecipient('Client@Example.com');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('client@example.com');
    expect(hashRecipient('client@example.com')).toBe(h); // case-insensitive, deterministic
  });

  it('createQueuedSendLog records queued status, hashed recipient, derived templateKey', async () => {
    const log = await createQueuedSendLog(PAYLOAD);
    expect(log).toBeTruthy();
    expect(log.status).toBe('queued');
    expect(log.channel).toBe('email');
    expect(log.provider).toBe('brevo');
    expect(log.templateKey).toBe('vente');
    expect(log.recipientHash).toBe(hashRecipient('client@example.com'));
    expect(log.subject).toBe('Bonjour');
    // the raw email is never stored
    const raw = JSON.stringify(log.toObject());
    expect(raw).not.toContain('client@example.com');
  });

  it('markSendLogSent / markSendLogFailed transition the status', async () => {
    const a = await createQueuedSendLog(PAYLOAD);
    await markSendLogSent(a, { providerMessageId: '<msg-1>' });
    const reloadedA = await SendLog.findById(a._id).lean();
    expect(reloadedA.status).toBe('sent');
    expect(reloadedA.providerMessageId).toBe('<msg-1>');
    expect(reloadedA.sentAt).toBeTruthy();

    const b = await createQueuedSendLog(PAYLOAD);
    await markSendLogFailed(b, { errorCode: 'http_401', errorMessageSafe: 'rejected' });
    const reloadedB = await SendLog.findById(b._id).lean();
    expect(reloadedB.status).toBe('failed');
    expect(reloadedB.errorCode).toBe('http_401');
  });

  it('applyBrevoEvent updates delivered/opened/bounce by providerMessageId', async () => {
    await SendLog.create({ provider: 'brevo', providerMessageId: '<m>', status: 'sent', recipientHash: 'h' });

    expect(await applyBrevoEvent({ event: 'delivered', messageId: '<m>' })).toMatchObject({ matched: true, status: 'delivered' });
    expect((await SendLog.findOne({ providerMessageId: '<m>' })).deliveredAt).toBeTruthy();

    expect(await applyBrevoEvent({ event: 'opened', messageId: '<m>' })).toMatchObject({ matched: true, status: 'opened' });
    expect((await SendLog.findOne({ providerMessageId: '<m>' })).openedAt).toBeTruthy();

    expect(await applyBrevoEvent({ event: 'hard_bounce', messageId: '<m>' })).toMatchObject({ matched: true, status: 'bounced' });
    expect((await SendLog.findOne({ providerMessageId: '<m>' })).bouncedAt).toBeTruthy();
  });

  it('applyBrevoEvent ignores unsupported events and missing/unknown ids', async () => {
    expect(await applyBrevoEvent({ event: 'click', messageId: '<m>' })).toMatchObject({ matched: false });
    expect(await applyBrevoEvent({ event: 'delivered', messageId: '' })).toMatchObject({ matched: false });
    expect(await applyBrevoEvent({ event: 'delivered', messageId: 'does-not-exist' })).toMatchObject({ matched: false });
  });

  it('postToBrevo: success -> SendLog "sent" with providerMessageId', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: '<brevo-ok-1>' })
    });
    const ok = await postToBrevo(PAYLOAD);
    expect(ok).toBe(true);
    const log = await SendLog.findOne({ providerMessageId: '<brevo-ok-1>' }).lean();
    expect(log).toBeTruthy();
    expect(log.status).toBe('sent');
    expect(log.templateKey).toBe('vente');
  });

  it('postToBrevo: provider rejection -> SendLog "failed" with safe error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    });
    const ok = await postToBrevo(PAYLOAD);
    expect(ok).toBe(false);
    const log = await SendLog.findOne({ status: 'failed' }).lean();
    expect(log).toBeTruthy();
    expect(log.errorCode).toBe('http_401');
    // raw provider body is never stored
    expect(log.errorMessageSafe).not.toContain('unauthorized');
  });

  it('postToBrevo: network error -> SendLog "failed" (flow never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));
    const ok = await postToBrevo(PAYLOAD);
    expect(ok).toBe(false);
    const log = await SendLog.findOne({ status: 'failed', errorCode: 'network_error' }).lean();
    expect(log).toBeTruthy();
  });
});
