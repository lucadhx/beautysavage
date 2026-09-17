// tests/p1/sendLogContextAttachment.test.js
// postToBrevo(payload, context) attaches contextType/contextId to the SendLog and
// to the email.* events. Explicit context wins over the tag-derived contextType.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import SendLog from '../../models/SendLog.js';
import EventLog from '../../models/EventLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { postToBrevo } from '../../services/mailService.js';

function brevoOk() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ messageId: '<m>' }) });
}
const PAYLOAD = (tag) => ({ to: [{ email: 'client@example.com' }], subject: 'S', tags: ['transactional', tag] });

describe('SendLog context attachment', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); brevoOk(); });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); });

  it('refund email context → SendLog contextType/contextId', async () => {
    await postToBrevo(PAYLOAD('refund_confirmed'), { contextType: 'refund_request', contextId: 'R-1' });
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('refund_request');
    expect(log.contextId).toBe('R-1');
    expect(log.recipientHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(log)).not.toContain('client@example.com');
  });

  it('commission email context → SendLog contextType/contextId', async () => {
    await postToBrevo(PAYLOAD('commission_reminder'), { contextType: 'commission_payment', contextId: 'C-1' });
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('commission_payment');
    expect(log.contextId).toBe('C-1');
  });

  it('gift_card email context → SendLog contextType/contextId (dispatcher supports it)', async () => {
    await postToBrevo(PAYLOAD('gift_card_compensation'), { contextType: 'gift_card', contextId: 'G-1' });
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('gift_card');
    expect(log.contextId).toBe('G-1');
  });

  it('explicit context wins over the tag-derived contextType', async () => {
    // tag "vente" would auto-derive contextType "sale"; explicit context overrides it.
    await postToBrevo(PAYLOAD('vente'), { contextType: 'refund_request', contextId: 'R-9' });
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('refund_request');
    expect(log.contextId).toBe('R-9');
  });

  it('the email.* events carry the same contextType/contextId', async () => {
    await postToBrevo(PAYLOAD('refund_confirmed'), { contextType: 'refund_request', contextId: 'R-7' });
    const queued = await EventLog.findOne({ eventName: 'email.queued' }).lean();
    expect(queued.contextType).toBe('refund_request');
    expect(queued.contextId).toBe('R-7');
    expect(JSON.stringify(queued)).not.toContain('client@example.com');
  });

  it('no explicit context → contextType auto-derived from tag (unchanged behaviour)', async () => {
    await postToBrevo(PAYLOAD('vente'));
    const log = await SendLog.findOne({}).lean();
    expect(log.contextType).toBe('sale');
  });
});
