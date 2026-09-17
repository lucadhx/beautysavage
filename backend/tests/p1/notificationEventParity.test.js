// tests/p1/notificationEventParity.test.js
// The subscriber (active mode) produces notification variables equivalent to the
// direct triggerNotification calls, via a light re-fetch. Object not found -> no
// notification, no throw. No email/secret in the variables.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import NotificationEventDelivery from '../../models/NotificationEventDelivery.js';
import Sale from '../../models/Sale.js';
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
      { eventType: 'no_show_recorded', label: 'No-show', isActive: true, category: 'prestations', targetType: 'all', titleTemplate: 'No-show {{clientName}}', messageTemplate: '{{serviceName}} le {{bookingDate}}' }
    ]
  });
}

describe('notification subscriber parity (active)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await NotificationEventDelivery.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase(); clearSubscribers(); await seedConfig();
    process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE = 'active';
    registerNotificationSubscribers();
  });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); delete process.env.EVENT_NOTIFICATION_SUBSCRIBER_MODE; });

  it('new_sale: subscriber rebuilds {saleId, amount, link} from the Sale', async () => {
    const sale = new Sale({ saleId: 'S-1', totalAmount: 120, userId: new mongoose.Types.ObjectId(), items: [] });
    await sale.save({ validateBeforeSave: false });

    await emitSaleEvent('sale.finalized', { saleId: 'S-1', totalAmount: 120, itemCount: 1 });

    const notif = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(notif).toBeTruthy();
    expect(notif.variables.saleId).toBe('S-1');
    expect(notif.variables.amount).toBe('120.00'); // re-fetched authoritative amount
    expect(notif.variables.link).toBe('/gestion.html?page=ventes');
    expect(notif.title).toContain('S-1');
  });

  it('no_show_recorded: subscriber re-fetches client + service + date', async () => {
    const user = new User({ firstName: 'John', lastName: 'Doe', email: 'ns@test.local', role: 'client' });
    await user.save({ validateBeforeSave: false });
    const service = new Service({ name: 'Massage' });
    await service.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, startAt: new Date('2026-07-01T10:00:00Z'), status: 'no_show' });
    await booking.save({ validateBeforeSave: false });

    await emitBookingEvent('booking.no_show_marked', { _id: booking._id, serviceId: service._id, status: 'no_show' });

    const notif = await Notification.findOne({ eventType: 'no_show_recorded' }).lean();
    expect(notif).toBeTruthy();
    expect(notif.variables.clientName).toBe('John Doe');
    expect(notif.variables.serviceName).toBe('Massage');
    expect(notif.variables.bookingDate).toBeTruthy();
    expect(notif.variables.bookingId).toBe(String(booking._id));
    // privacy: the client email is NOT included
    expect(JSON.stringify(notif.variables)).not.toContain('ns@test.local');
  });

  it('object not found → no notification, no delivery, no throw', async () => {
    const ghost = new mongoose.Types.ObjectId();
    await expect(emitBookingEvent('booking.no_show_marked', { _id: ghost })).resolves.toBeTruthy();
    expect(await Notification.countDocuments({})).toBe(0);
    expect(await NotificationEventDelivery.countDocuments({ contextId: String(ghost) })).toBe(0);
  });
});
