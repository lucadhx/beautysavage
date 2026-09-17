// tests/p1/notificationContextEnrichment.test.js
// M3B — Notifications enrichies : eventId/eventName/contextType/contextId propagés,
// variables enrichies depuis le contexte, targetRole (M3A) conservé, replay sans
// doublon, aucun vrai e-mail.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import NotificationEventDelivery from '../../models/NotificationEventDelivery.js';
import SendLog from '../../models/SendLog.js';
import Sale from '../../models/Sale.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { emitSaleEvent } from '../../services/businessEventService.js';
import { registerNotificationSubscribers } from '../../subscribers/notificationEventSubscriber.js';
import { triggerNotification } from '../../services/notificationService.js';

async function seedConfig() {
  await NotificationConfig.create({
    events: [
      { eventType: 'new_sale', label: 'Vente', isActive: true, category: 'ventes', targetType: 'all', titleTemplate: 'Vente {{saleId}}', messageTemplate: 'Montant {{amount}} pour {{clientName}}' }
    ]
  });
}

describe('notification context enrichment (M3B)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await NotificationEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase(); clearSubscribers(); await seedConfig();
    process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE = 'active';
  });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); delete process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE; });

  it('triggerNotification persiste la corrélation event (options.event)', async () => {
    const eventId = new mongoose.Types.ObjectId();
    await triggerNotification('new_sale', { saleId: 'S-1', amount: '120.00' }, {
      event: { eventId, eventName: 'sale.finalized', contextType: 'sale', contextId: 'S-1' }
    });
    const n = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(String(n.eventId)).toBe(String(eventId));
    expect(n.eventName).toBe('sale.finalized');
    expect(n.contextType).toBe('sale');
    expect(n.contextId).toBe('S-1');
    expect(n.targetRole).toBe('admin'); // M3A préservé
  });

  it('subscriber sale.finalized → notification corrélée + targetRole admin', async () => {
    registerNotificationSubscribers();
    const sale = new Sale({ saleId: 'S-2', userId: new mongoose.Types.ObjectId(), customer: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }, totalAmount: 90 });
    await sale.save({ validateBeforeSave: false });

    const ev = await emitSaleEvent('sale.finalized', sale);
    const n = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(n).toBeTruthy();
    expect(n.eventName).toBe('sale.finalized');
    expect(n.contextType).toBe('sale');
    expect(n.contextId).toBe('S-2');
    expect(String(n.eventId)).toBe(String(ev._id));
    expect(n.targetRole).toBe('admin');
    // pas de fuite e-mail dans la notification
    expect(JSON.stringify(n)).not.toContain('jane@example.com');
  });

  it('replay du même event → une seule notification (idempotent)', async () => {
    registerNotificationSubscribers();
    const sale = new Sale({ saleId: 'S-3', totalAmount: 40 });
    await sale.save({ validateBeforeSave: false });
    await emitSaleEvent('sale.finalized', sale);
    await emitSaleEvent('sale.finalized', sale); // replay
    expect(await Notification.countDocuments({ eventType: 'new_sale' })).toBe(1);
  });

  it('aucun SendLog / e-mail créé par le subscriber', async () => {
    registerNotificationSubscribers();
    const sale = new Sale({ saleId: 'S-4', totalAmount: 10 });
    await sale.save({ validateBeforeSave: false });
    await emitSaleEvent('sale.finalized', sale);
    expect(await SendLog.countDocuments({})).toBe(0);
  });
});
