// tests/p1/eventBus.test.js
// In-process event bus: persists EventLog, redacts payloads, notifies subscribers,
// and a failing subscriber never breaks emitEvent.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EventLog from '../../models/EventLog.js';
import { emitEvent, subscribe, clearSubscribers } from '../../services/eventBusService.js';

describe('eventBusService', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); });

  it('persists an EventLog with domain/version from the catalog', async () => {
    await emitEvent('sale.created', { saleId: 'S-1' }, { source: 'test', contextType: 'sale', contextId: 'S-1' });
    const log = await EventLog.findOne({ eventName: 'sale.created' }).lean();
    expect(log).toBeTruthy();
    expect(log.domain).toBe('sale');
    expect(log.version).toBe(1);
    expect(log.contextType).toBe('sale');
    expect(log.contextId).toBe('S-1');
    expect(log.payloadSafe.saleId).toBe('S-1');
  });

  it('redacts emails/secrets from the persisted payload', async () => {
    await emitEvent('email.sent', { sendLogId: 'x', recipient: 'someone@example.com', email: 'a@b.com', secret: 'sk_live_xxx', note: 'contact me at z@w.com' });
    const log = await EventLog.findOne({ eventName: 'email.sent' }).lean();
    const raw = JSON.stringify(log.payloadSafe);
    expect(raw).not.toContain('someone@example.com');
    expect(raw).not.toContain('a@b.com');
    expect(raw).not.toContain('sk_live_xxx');
    expect(raw).not.toContain('z@w.com'); // email embedded in a string value is redacted
  });

  it('notifies subscribers (specific + wildcard)', async () => {
    const specific = vi.fn();
    const wildcard = vi.fn();
    subscribe('booking.confirmed', specific);
    subscribe('*', wildcard);
    await emitEvent('booking.confirmed', { bookingId: 'B-1' });
    expect(specific).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
    expect(specific.mock.calls[0][0].eventName).toBe('booking.confirmed');
  });

  it('a failing subscriber does NOT break emitEvent (still persists)', async () => {
    subscribe('refund.failed', () => { throw new Error('subscriber boom'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(emitEvent('refund.failed', { refundId: 'R-1' })).resolves.toBeTruthy();
    const log = await EventLog.findOne({ eventName: 'refund.failed' }).lean();
    expect(log).toBeTruthy();
  });

  it('emits unknown events with a warning but still logs them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await emitEvent('totally.unknown', { x: 1 });
    expect(warn).toHaveBeenCalled();
    const log = await EventLog.findOne({ eventName: 'totally.unknown' }).lean();
    expect(log.domain).toBe('unknown');
  });
});
