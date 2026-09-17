// tests/p1/notificationEventSubscriberTargetRole.test.js
// M3A — Le subscriber EventBus → Notification crée des notifs avec targetRole correct
// (audience admin pour new_sale/no_show_recorded) et sans fuite de payload sensible.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import NotificationEventDelivery from '../../models/NotificationEventDelivery.js';
import User from '../../models/user.js';
import Service from '../../models/Service.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import { clearSubscribers } from '../../services/eventBusService.js';
import { emitSaleEvent, emitBookingEvent } from '../../services/businessEventService.js';
import { registerNotificationSubscribers } from '../../subscribers/notificationEventSubscriber.js';

async function seedConfig() {
  await NotificationConfig.create({
    events: [
      { eventType: 'new_sale', label: 'Vente', isActive: true, category: 'ventes', targetType: 'all', titleTemplate: 'Vente {{saleId}}', messageTemplate: 'Montant {{amount}}' },
      { eventType: 'no_show_recorded', label: 'No-show', isActive: true, category: 'prestations', targetType: 'all', titleTemplate: 'No-show', messageTemplate: 'Booking {{bookingId}}' }
    ]
  });
}

describe('notification subscriber — targetRole (M3A)', () => {
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

  it('sale.finalized → notification new_sale targetRole=admin', async () => {
    registerNotificationSubscribers();
    await emitSaleEvent('sale.finalized', { saleId: 'S-1', totalAmount: 120, itemCount: 1 });
    const notif = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(notif).toBeTruthy();
    expect(notif.targetRole).toBe('admin');
  });

  it('booking.no_show_marked → notification no_show_recorded targetRole=admin', async () => {
    registerNotificationSubscribers();
    const user = new User({ firstName: 'Jane', lastName: 'Roe', email: 'jr@test.local', role: 'client' });
    await user.save({ validateBeforeSave: false });
    const service = new Service({ name: 'Soin' });
    await service.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, startAt: new Date('2026-07-02T09:00:00Z'), status: 'no_show' });
    await booking.save({ validateBeforeSave: false });

    await emitBookingEvent('booking.no_show_marked', { _id: booking._id, serviceId: service._id, status: 'no_show' });
    const notif = await Notification.findOne({ eventType: 'no_show_recorded' }).lean();
    expect(notif).toBeTruthy();
    expect(notif.targetRole).toBe('admin');
  });

  it('aucune notif dev créée par les événements métier', async () => {
    registerNotificationSubscribers();
    await emitSaleEvent('sale.finalized', { saleId: 'S-2', totalAmount: 50 });
    expect(await Notification.countDocuments({ targetRole: 'dev' })).toBe(0);
  });

  it('no_show : pas de fuite e-mail client dans variables', async () => {
    registerNotificationSubscribers();
    const user = new User({ firstName: 'Max', lastName: 'Doe', email: 'max-secret@private.example', role: 'client' });
    await user.save({ validateBeforeSave: false });
    const service = new Service({ name: 'Soin' });
    await service.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, startAt: new Date('2026-07-03T09:00:00Z'), status: 'no_show' });
    await booking.save({ validateBeforeSave: false });

    await emitBookingEvent('booking.no_show_marked', { _id: booking._id, serviceId: service._id, status: 'no_show' });
    const notif = await Notification.findOne({ eventType: 'no_show_recorded' }).lean();
    expect(JSON.stringify(notif.variables)).not.toContain('max-secret@private.example');
  });
});
