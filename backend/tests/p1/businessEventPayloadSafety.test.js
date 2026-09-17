// tests/p1/businessEventPayloadSafety.test.js
// Business event payloads never contain email/secret/token/password/banking data,
// even when the source entity carries them.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import EventLog from '../../models/EventLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { emitSaleEvent, emitBookingEvent, emitRefundEvent } from '../../services/businessEventService.js';

function rawOf(ev) { return JSON.stringify(ev); }

describe('business event payload safety', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); });
  afterEach(() => { clearSubscribers(); });

  it('sale event drops customer email / ip / stripe secret-like fields', async () => {
    await emitSaleEvent('sale.finalized', {
      saleId: 'S-1', totalAmount: 100, itemCount: 1, stripePaymentIntentId: 'pi_123',
      customer: { email: 'leak@example.com', firstName: 'A' },
      client_ip: '203.0.113.9',
      stripeClientSecret: 'sk_live_should_never_appear'
    });
    const ev = await EventLog.findOne({ eventName: 'sale.finalized' }).lean();
    const raw = rawOf(ev);
    expect(raw).not.toContain('leak@example.com');
    expect(raw).not.toContain('203.0.113.9');
    expect(raw).not.toContain('sk_live_should_never_appear');
    // only the safe keys are present (M3B adds a safe `context` envelope — no PII/secret).
    expect(Object.keys(ev.payloadSafe).sort()).toEqual(['context', 'giftCardCount', 'hasStripePayment', 'itemCount', 'saleId', 'totalAmount']);
    // the M3B context itself carries IDs/variables but never an email.
    expect(ev.payloadSafe.context.contextType).toBe('sale');
    expect(JSON.stringify(ev.payloadSafe.context)).not.toContain('leak@example.com');
  });

  it('booking event drops populated client email', async () => {
    await emitBookingEvent('booking.cancelled', {
      _id: new mongoose.Types.ObjectId(),
      serviceId: new mongoose.Types.ObjectId(),
      status: 'cancelled',
      clientId: { email: 'client@example.com', firstName: 'B' }
    });
    const ev = await EventLog.findOne({ eventName: 'booking.cancelled' }).lean();
    expect(rawOf(ev)).not.toContain('client@example.com');
  });

  it('redacts an email/secret accidentally passed in extra', async () => {
    await emitRefundEvent('refund.requested', { _id: new mongoose.Types.ObjectId(), saleId: 'S-1', status: 'requested' }, {
      extra: { note: 'contact buyer@example.com', token: 'whsec_abc', password: 'p@ssw0rd' }
    });
    const ev = await EventLog.findOne({ eventName: 'refund.requested' }).lean();
    const raw = rawOf(ev);
    expect(raw).not.toContain('buyer@example.com');
    expect(raw).not.toContain('whsec_abc');
    expect(raw).not.toContain('p@ssw0rd');
  });
});
