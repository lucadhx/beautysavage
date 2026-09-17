// tests/p1/notificationEventIdempotence.test.js
// Re-emitting the same business event creates the notification only ONCE.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import NotificationEventDelivery from '../../models/NotificationEventDelivery.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { emitSaleEvent, emitBookingEvent } from '../../services/businessEventService.js';
import {
  registerNotificationSubscribers,
  handleSaleFinalizedNotification
} from '../../subscribers/notificationEventSubscriber.js';

async function seedConfig() {
  await NotificationConfig.create({
    events: [
      { eventType: 'new_sale', label: 'Vente', isActive: true, category: 'ventes', targetType: 'all', titleTemplate: 'Vente {{saleId}}', messageTemplate: 'Montant {{amount}}' },
      { eventType: 'no_show_recorded', label: 'No-show', isActive: true, category: 'prestations', targetType: 'all', titleTemplate: 'No-show', messageTemplate: 'Booking {{bookingId}}' }
    ]
  });
}

describe('notification event idempotence', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await NotificationEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); await seedConfig(); await NotificationEventDelivery.syncIndexes(); process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE = 'active'; });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); delete process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE; });

  it('re-emitting the same sale.finalized event creates ONE notification', async () => {
    registerNotificationSubscribers();
    await emitSaleEvent('sale.finalized', { saleId: 'S-DUP', totalAmount: 99 });
    await emitSaleEvent('sale.finalized', { saleId: 'S-DUP', totalAmount: 99 }); // same contextId
    expect(await Notification.countDocuments({ eventType: 'new_sale' })).toBe(1);
    expect(await NotificationEventDelivery.countDocuments({ contextId: 'S-DUP' })).toBe(1);
  });

  it('calling the handler twice on the same event is idempotent', async () => {
    const eventLog = { _id: new mongoose.Types.ObjectId(), eventName: 'sale.finalized', contextType: 'sale', contextId: 'S-H', payloadSafe: { saleId: 'S-H', totalAmount: 10 } };
    await handleSaleFinalizedNotification(eventLog);
    await handleSaleFinalizedNotification(eventLog);
    expect(await Notification.countDocuments({ eventType: 'new_sale' })).toBe(1);
  });

  it('different contextIds create separate notifications', async () => {
    registerNotificationSubscribers();
    await emitSaleEvent('sale.finalized', { saleId: 'S-A', totalAmount: 10 });
    await emitSaleEvent('sale.finalized', { saleId: 'S-B', totalAmount: 20 });
    expect(await Notification.countDocuments({ eventType: 'new_sale' })).toBe(2);
  });

  it('a failing notification creation does not throw to the emitter', async () => {
    registerNotificationSubscribers();
    vi.spyOn(NotificationEventDelivery, 'findOne').mockImplementation(() => { throw new Error('db down'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(emitBookingEvent('booking.no_show_marked', { _id: new mongoose.Types.ObjectId() })).resolves.toBeTruthy();
  });
});
