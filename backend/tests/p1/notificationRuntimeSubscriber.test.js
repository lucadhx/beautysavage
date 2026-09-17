// tests/p1/notificationRuntimeSubscriber.test.js
// M8 — Le subscriber (sale.finalized) déclenche le moteur avec templateKey ; si un
// template 'new_sale' est publié, la notification est rendue depuis le template, sans
// doublon, en conservant la corrélation event (M3B) et la cible admin (M3A).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationCategory from '../../models/NotificationCategory.js';
import NotificationEventDelivery from '../../models/NotificationEventDelivery.js';
import Sale from '../../models/Sale.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { emitSaleEvent } from '../../services/businessEventService.js';
import { registerNotificationSubscribers } from '../../subscribers/notificationEventSubscriber.js';
import { createTemplate } from '../../services/notificationTemplateVersioningService.js';

describe('notification runtime subscriber (M8)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await NotificationEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase(); clearSubscribers();
    process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE = 'active';
    const cat = await NotificationCategory.create({ name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#abc' });
    await createTemplate('new_sale', { title: 'Nouvelle vente {{saleId}}', body: 'Montant {{amount}}', categoryId: cat._id, priority: 'high' }, 'tester');
  });
  afterEach(() => { clearSubscribers(); delete process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE; });

  it('sale.finalized → notification rendue depuis le template, corrélée, sans doublon', async () => {
    registerNotificationSubscribers();
    const sale = new Sale({ saleId: 'S-10', totalAmount: 120, customer: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' } });
    await sale.save({ validateBeforeSave: false });

    const ev = await emitSaleEvent('sale.finalized', sale);
    await emitSaleEvent('sale.finalized', sale); // replay → idempotent

    const notifs = await Notification.find({ eventType: 'new_sale' }).lean();
    expect(notifs.length).toBe(1);
    const n = notifs[0];
    expect(n.title).toBe('Nouvelle vente S-10');
    expect(n.templateKey).toBe('new_sale');
    expect(n.templateRuntimeStatus).toBe('template');
    expect(n.priority).toBe('high');
    expect(n.categorySnapshot.slug).toBe('ventes');
    expect(n.targetRole).toBe('admin'); // M3A
    expect(String(n.eventId)).toBe(String(ev._id)); // M3B
    expect(n.contextId).toBe('S-10');
    // privacy : aucune fuite d'e-mail
    expect(JSON.stringify(n)).not.toContain('jane@example.com');
  });
});
