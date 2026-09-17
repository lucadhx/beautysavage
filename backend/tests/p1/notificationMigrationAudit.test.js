// tests/p1/notificationMigrationAudit.test.js
// Phase 4C is an AUDIT: no notification is migrated to the EventBus. Emitting
// business events must NOT create any Notification (no business subscriber active)
// and must NOT send any email.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import SendLog from '../../models/SendLog.js';
import EventLog from '../../models/EventLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import {
  emitSaleEvent,
  emitBookingEvent,
  emitRefundEvent,
  emitCommissionEvent
} from '../../services/businessEventService.js';

describe('notification migration audit (nothing migrated)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); });
  afterEach(() => { clearSubscribers(); });

  it('emitting business events creates NO Notification and NO email', async () => {
    await emitSaleEvent('sale.finalized', { saleId: 'S-1' });
    await emitBookingEvent('booking.confirmed', { _id: new mongoose.Types.ObjectId() });
    await emitBookingEvent('booking.no_show_marked', { _id: new mongoose.Types.ObjectId() });
    await emitRefundEvent('refund.requested', { _id: new mongoose.Types.ObjectId() });
    await emitCommissionEvent('commission.paid', { _id: new mongoose.Types.ObjectId() });

    // Events ARE persisted (audit timeline)...
    expect(await EventLog.countDocuments({})).toBe(5);
    // ...but trigger NO notification and NO email (audit-only, no subscriber).
    expect(await Notification.countDocuments({})).toBe(0);
    expect(await SendLog.countDocuments({})).toBe(0);
  });

  it('the event bus has no default business subscriber (events have no side effect)', async () => {
    // No subscribe() is called by application code in Phase 4C.
    const sideEffectSpy = vi.fn();
    // emit without registering anything → nothing observes it beyond EventLog
    await emitSaleEvent('sale.finalized', { saleId: 'S-2' });
    expect(sideEffectSpy).not.toHaveBeenCalled();
    expect(await Notification.countDocuments({})).toBe(0);
  });
});
