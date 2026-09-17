// tests/p1/sendLogEvents.test.js
// SendLog transitions emit the matching email.* events into the EventLog, with
// safe payloads (no recipient email).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EventLog from '../../models/EventLog.js';
import SendLog from '../../models/SendLog.js';
import {
  createQueuedSendLog,
  markSendLogSent,
  markSendLogFailed,
  applyBrevoEvent
} from '../../services/sendLogService.js';

const PAYLOAD = { to: [{ email: 'buyer@example.com' }], subject: 'Hi', tags: ['transactional', 'vente'] };

describe('SendLog -> EventBus', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('queued -> email.queued (contextType auto-derived from tag)', async () => {
    const log = await createQueuedSendLog(PAYLOAD);
    const ev = await EventLog.findOne({ eventName: 'email.queued' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.payloadSafe.sendLogId).toBe(String(log._id));
    expect(ev.contextType).toBe('sale'); // derived from "vente"
    // never the email
    expect(JSON.stringify(ev)).not.toContain('buyer@example.com');
  });

  it('explicit context is attached and carried into the event', async () => {
    await createQueuedSendLog(PAYLOAD, { contextType: 'sale', contextId: 'SALE-42' });
    const ev = await EventLog.findOne({ eventName: 'email.queued' }).lean();
    expect(ev.contextType).toBe('sale');
    expect(ev.contextId).toBe('SALE-42');
  });

  it('sent -> email.sent', async () => {
    const log = await createQueuedSendLog(PAYLOAD);
    await markSendLogSent(log, { providerMessageId: '<m-1>' });
    const ev = await EventLog.findOne({ eventName: 'email.sent' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.payloadSafe.status).toBe('sent');
  });

  it('failed -> email.failed (with errorCode)', async () => {
    const log = await createQueuedSendLog(PAYLOAD);
    await markSendLogFailed(log, { errorCode: 'http_401', errorMessageSafe: 'rejected' });
    const ev = await EventLog.findOne({ eventName: 'email.failed' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.payloadSafe.errorCode).toBe('http_401');
  });

  it('Brevo delivered -> email.delivered', async () => {
    await SendLog.create({ provider: 'brevo', providerMessageId: '<m-2>', status: 'sent', recipientHash: 'h', templateKey: 'vente', contextType: 'sale' });
    await applyBrevoEvent({ event: 'delivered', messageId: '<m-2>' });
    const ev = await EventLog.findOne({ eventName: 'email.delivered' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.contextType).toBe('sale');
  });
});
