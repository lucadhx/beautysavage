// tests/p1/businessEvents.test.js
// businessEventService emits audit-only EventLog entries with safe payloads, and a
// failing EventBus never breaks the (best-effort) emit.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EventLog from '../../models/EventLog.js';
import SendLog from '../../models/SendLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import {
  emitSaleEvent,
  emitBookingEvent,
  emitRefundEvent,
  emitGiftCardEvent,
  emitCommissionEvent
} from '../../services/businessEventService.js';

describe('businessEventService (audit-only)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); });

  it('sale.finalized → EventLog (safe payload, contextType sale)', async () => {
    await emitSaleEvent('sale.finalized', { saleId: 'S-1', totalAmount: 120, itemCount: 2, stripePaymentIntentId: 'pi_x', customer: { email: 'buyer@example.com' } });
    const ev = await EventLog.findOne({ eventName: 'sale.finalized' }).lean();
    expect(ev).toBeTruthy();
    expect(ev.domain).toBe('sale');
    expect(ev.contextType).toBe('sale');
    expect(ev.contextId).toBe('S-1');
    expect(ev.payloadSafe.saleId).toBe('S-1');
    expect(ev.payloadSafe.hasStripePayment).toBe(true);
    expect(JSON.stringify(ev)).not.toContain('buyer@example.com');
  });

  it('sale.zero_payment_finalized → EventLog', async () => {
    await emitSaleEvent('sale.zero_payment_finalized', { saleId: 'S-2' }, { extra: { zeroPayment: true } });
    const ev = await EventLog.findOne({ eventName: 'sale.zero_payment_finalized' }).lean();
    expect(ev.payloadSafe.zeroPayment).toBe(true);
  });

  it('booking.created/confirmed/cancelled → EventLog', async () => {
    const booking = { _id: new mongoose.Types.ObjectId(), serviceId: new mongoose.Types.ObjectId(), status: 'confirmed', startAt: new Date() };
    await emitBookingEvent('booking.created', booking);
    await emitBookingEvent('booking.confirmed', booking);
    await emitBookingEvent('booking.cancelled', { ...booking, status: 'cancelled' });
    expect(await EventLog.countDocuments({ domain: 'booking' })).toBe(3);
    const created = await EventLog.findOne({ eventName: 'booking.created' }).lean();
    expect(created.contextType).toBe('service_booking');
    expect(created.payloadSafe.bookingId).toBe(String(booking._id));
  });

  it('refund.requested/succeeded → EventLog', async () => {
    const refund = { _id: new mongoose.Types.ObjectId(), saleId: 'S-1', itemType: 'formation', status: 'requested', amount: 50 };
    await emitRefundEvent('refund.requested', refund);
    await emitRefundEvent('refund.succeeded', { ...refund, status: 'succeeded' });
    expect(await EventLog.countDocuments({ domain: 'refund' })).toBe(2);
  });

  it('gift_card.recredited / commission.reminder_sent → EventLog', async () => {
    await emitGiftCardEvent('gift_card.recredited', null, { extra: { saleId: 'S-1', amountEur: 30, cardCount: 1 }, contextType: 'sale', contextId: 'S-1' });
    await emitCommissionEvent('commission.reminder_sent', { _id: new mongoose.Types.ObjectId(), month: 5, year: 2026, status: 'pending' }, { extra: { daysLeft: 3 } });
    expect((await EventLog.findOne({ eventName: 'gift_card.recredited' }).lean()).payloadSafe.amountEur).toBe(30);
    expect((await EventLog.findOne({ eventName: 'commission.reminder_sent' }).lean()).payloadSafe.daysLeft).toBe(3);
  });

  it('a failing EventBus does NOT throw to the business flow', async () => {
    vi.spyOn(EventLog, 'create').mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(emitSaleEvent('sale.finalized', { saleId: 'S-9' })).resolves.toBeNull();
  });

  it('emitting business events has NO side effect (no SendLog/email created)', async () => {
    await emitSaleEvent('sale.finalized', { saleId: 'S-1' });
    await emitBookingEvent('booking.confirmed', { _id: new mongoose.Types.ObjectId() });
    expect(await SendLog.countDocuments({})).toBe(0);
  });
});
