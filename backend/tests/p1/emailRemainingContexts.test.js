// tests/p1/emailRemainingContexts.test.js
// Remaining email contexts (password_reset user context added; email_confirmation/
// system/gift_card auto-derived). No email/token/code ever stored on SendLog.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import SendLog from '../../models/SendLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { postToBrevo } from '../../services/mailService.js';

function brevoOk() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ messageId: '<m>' }) });
}
function payload(tag, extra = {}) {
  return { to: [{ email: 'person@example.com' }], subject: 'S', tags: ['transactional', tag], ...extra };
}

describe('remaining email contexts', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); brevoOk(); });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); });

  it('password_reset → SendLog contextType user + contextId (no email leak)', async () => {
    await postToBrevo(payload('password_reset'), { contextType: 'user', contextId: 'U-1' });
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('user');
    expect(log.contextId).toBe('U-1');
    expect(log.recipientHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(log)).not.toContain('person@example.com');
  });

  it('email_confirmation_code → contextType user (auto), contextId null, no code/email stored', async () => {
    await postToBrevo(payload('email_confirmation_code', { htmlContent: '<p>code 123456</p>' }));
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('user'); // auto-derived
    expect(log.contextId).toBeNull();
    const raw = JSON.stringify(log);
    expect(raw).not.toContain('person@example.com');
    expect(raw).not.toContain('123456'); // SendLog never stores the body/code
  });

  it('system email (site_*) → contextType system, contextId null', async () => {
    await postToBrevo(payload('site_suspended'));
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('system');
    expect(log.contextId).toBeNull();
  });

  it('gift_card email → contextType gift_card (auto), contextId null (deferred)', async () => {
    await postToBrevo(payload('gift_card_compensation'));
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('gift_card');
    expect(log.contextId).toBeNull();
  });
});
