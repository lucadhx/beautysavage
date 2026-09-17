// tests/p1/deferredBusinessEvents.test.js
// Phase 4B newly-wired business events (booking.reminded/no_show_marked/
// client_suspended, gift_card.created, commission.paid) — audit-only, safe payload.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EventLog from '../../models/EventLog.js';
import SendLog from '../../models/SendLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { emitBookingEvent, emitGiftCardEvent, emitCommissionEvent } from '../../services/businessEventService.js';

describe('Phase 4B deferred business events', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); });

  it('booking.reminded → EventLog', async () => {
    const booking = { _id: new mongoose.Types.ObjectId(), serviceId: new mongoose.Types.ObjectId(), status: 'confirmed' };
    await emitBookingEvent('booking.reminded', booking, { extra: { hoursAhead: 24 } });
    const ev = await EventLog.findOne({ eventName: 'booking.reminded' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.domain).toBe('booking');
    expect(ev.payloadSafe.hoursAhead).toBe(24);
    expect(ev.contextId).toBe(String(booking._id));
  });

  it('booking.no_show_marked / booking.client_suspended → EventLog', async () => {
    const booking = { _id: new mongoose.Types.ObjectId(), clientId: new mongoose.Types.ObjectId(), status: 'no_show' };
    await emitBookingEvent('booking.no_show_marked', booking);
    await emitBookingEvent('booking.client_suspended', booking, { contextType: 'user', contextId: String(booking.clientId), extra: { userId: String(booking.clientId) } });
    expect(await EventLog.countDocuments({ eventName: { $in: ['booking.no_show_marked', 'booking.client_suspended'] } })).toBe(2);
    const suspended = await EventLog.findOne({ eventName: 'booking.client_suspended' }).lean();
    expect(suspended.contextType).toBe('user');
    expect(suspended.payloadSafe.userId).toBe(String(booking.clientId));
  });

  it('gift_card.created → EventLog WITHOUT the gift-card password', async () => {
    const giftCard = { _id: new mongoose.Types.ObjectId(), passwordHash: 'HASH', passwordEncrypted: 'ENC', code: 'ABCD1234' };
    await emitGiftCardEvent('gift_card.created', giftCard, { extra: { amount: 50, password: 'PLAINTEXT_PWD' } });
    const ev = await EventLog.findOne({ eventName: 'gift_card.created' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.payloadSafe.giftCardId).toBe(String(giftCard._id));
    expect(ev.payloadSafe.amount).toBe(50);
    const raw = JSON.stringify(ev);
    expect(raw).not.toContain('PLAINTEXT_PWD'); // redacted (key "password")
    expect(raw).not.toContain('HASH');
    expect(raw).not.toContain('ENC');
  });

  it('commission.paid → EventLog', async () => {
    const payment = { _id: new mongoose.Types.ObjectId(), month: 5, year: 2026, status: 'succeeded' };
    await emitCommissionEvent('commission.paid', payment);
    const ev = await EventLog.findOne({ eventName: 'commission.paid' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.contextType).toBe('commission_payment');
    expect(ev.payloadSafe.commissionPaymentId).toBe(String(payment._id));
  });

  it('these events have NO side effect (no SendLog/email)', async () => {
    await emitBookingEvent('booking.reminded', { _id: new mongoose.Types.ObjectId() });
    await emitCommissionEvent('commission.paid', { _id: new mongoose.Types.ObjectId() });
    expect(await SendLog.countDocuments({})).toBe(0);
  });
});
