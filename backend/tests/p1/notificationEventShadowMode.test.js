// tests/p1/notificationEventShadowMode.test.js
// EVENT_NOTIFICATION_SUBSCRIBER_MODE = off | shadow | active.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import NotificationEventDelivery from '../../models/NotificationEventDelivery.js';
import SendLog from '../../models/SendLog.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { emitSaleEvent } from '../../services/businessEventService.js';
import { registerNotificationSubscribers } from '../../subscribers/notificationEventSubscriber.js';

async function seedConfig() {
  await NotificationConfig.create({
    events: [{ eventType: 'new_sale', label: 'Vente', isActive: true, category: 'ventes', targetType: 'all', titleTemplate: 'Vente {{saleId}}', messageTemplate: 'Montant {{amount}}' }]
  });
}
function setMode(m) { process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE = m; }

describe('notification subscriber shadow/active mode', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await NotificationEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); clearSubscribers(); await seedConfig(); await NotificationEventDelivery.syncIndexes(); registerNotificationSubscribers(); });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); delete process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE; });

  it('off → no notification, no delivery', async () => {
    setMode('off');
    await emitSaleEvent('sale.finalized', { saleId: 'S-OFF', totalAmount: 10 });
    expect(await Notification.countDocuments({})).toBe(0);
    expect(await NotificationEventDelivery.countDocuments({})).toBe(0);
  });

  it('shadow → NO notification, delivery status "shadow"', async () => {
    setMode('shadow');
    await emitSaleEvent('sale.finalized', { saleId: 'S-SH', totalAmount: 10 });
    expect(await Notification.countDocuments({})).toBe(0);
    const delivery = await NotificationEventDelivery.findOne({ contextId: 'S-SH' }).lean();
    expect(delivery).toBeTruthy();
    expect(delivery.status).toBe('shadow');
    expect(await SendLog.countDocuments({})).toBe(0); // never any email
  });

  it('active → notification created, delivery status "created"', async () => {
    setMode('active');
    await emitSaleEvent('sale.finalized', { saleId: 'S-AC', totalAmount: 10 });
    expect(await Notification.countDocuments({ eventType: 'new_sale' })).toBe(1);
    const delivery = await NotificationEventDelivery.findOne({ contextId: 'S-AC' }).lean();
    expect(delivery.status).toBe('created');
  });

  it('shadow then active upgrades the delivery and creates the notification once', async () => {
    setMode('shadow');
    await emitSaleEvent('sale.finalized', { saleId: 'S-UP', totalAmount: 10 });
    expect(await Notification.countDocuments({})).toBe(0);

    setMode('active');
    await emitSaleEvent('sale.finalized', { saleId: 'S-UP', totalAmount: 10 }); // same contextId
    expect(await Notification.countDocuments({ eventType: 'new_sale' })).toBe(1);
    const delivery = await NotificationEventDelivery.findOne({ contextId: 'S-UP' }).lean();
    expect(delivery.status).toBe('created');

    // re-emit in active → still one notification (idempotent)
    await emitSaleEvent('sale.finalized', { saleId: 'S-UP', totalAmount: 10 });
    expect(await Notification.countDocuments({ eventType: 'new_sale' })).toBe(1);
  });
});
