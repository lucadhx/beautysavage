// tests/p1/bookingConfirmedEventAlignment.test.js
// M3D — Alignement : la règle booking.confirmed est active, et l'event porte le contexte
// (related IDs) nécessaire au resolver. Deux bookings distincts (checkout + report) →
// deux confirmations (contextId = booking._id discrimine).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-M3D-KEY')
}));

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const EventLog = (await import('../../models/EventLog.js')).default;
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;
const MailEventDelivery = (await import('../../models/MailEventDelivery.js')).default;
const User = (await import('../../models/user.js')).default;
const Service = (await import('../../models/Service.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const { clearSubscribers } = await import('../../services/eventBusService.js');
const { emitBookingEvent } = await import('../../services/businessEventService.js');
const { registerMailEventSubscribers } = await import('../../subscribers/mailEventSubscriber.js');
const { getMailDispatchRule } = await import('../../constants/mailDispatchRules.js');

const FLAG = 'MAIL_ROLE_RESOLVER_ENABLED';

let bkSeq = 0;
async function makeBooking(bookingId) {
  bkSeq += 1;
  const user = new User({ email: `align-${bookingId}@test.local`, firstName: 'A', lastName: 'B', role: 'client' });
  await user.save({ validateBeforeSave: false });
  const service = new Service({ name: 'Prestation', slug: `svc-${bookingId}` });
  await service.save({ validateBeforeSave: false });
  const start = new Date('2026-08-01T09:00:00Z');
  start.setUTCHours(9 + bkSeq); // startAt distinct → évite l'index unique {practitionerId,startAt}
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, bookingId, startAt: start, endAt: end, totalPrice: 60, status: 'confirmed' });
  await booking.save({ validateBeforeSave: false });
  return booking;
}

describe('M3D — alignement booking.confirmed', () => {
  let prev;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await Promise.all([CommunicationIdentity.syncIndexes(), MailEventDelivery.syncIndexes()]);
    prev = process.env[FLAG];
  });
  afterAll(async () => { process.env[FLAG] = prev; await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase(); clearSubscribers();
    await Promise.all([CommunicationIdentity.syncIndexes(), MailEventDelivery.syncIndexes()]);
    registerMailEventSubscribers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ messageId: '<m>' }), { status: 200 }));
  });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); delete process.env[FLAG]; });

  it('la règle booking.confirmed est active (migrée)', () => {
    const rule = getMailDispatchRule('booking.confirmed');
    expect(rule.mode).toBe('active');
    expect(rule.directSenderExists).toBe(false);
    expect(rule.fromRole).toBe('commerciale');
    expect(rule.toRole).toBe('client');
  });

  it('l’event booking.confirmed porte contextType + related IDs (resolver-ready)', async () => {
    const booking = await makeBooking('BKG-CTX');
    await emitBookingEvent('booking.confirmed', booking);
    const ev = await EventLog.findOne({ eventName: 'booking.confirmed' }).lean();
    expect(ev.contextType).toBe('service_booking');
    expect(ev.contextId).toBe(String(booking._id));
    expect(ev.payloadSafe.context.related.bookingId).toBe('BKG-CTX');
    expect(ev.payloadSafe.context.related.clientId).toBe(String(booking.clientId));
    expect(ev.payloadSafe.context.related.serviceId).toBe(String(booking.serviceId));
  });

  it('deux bookings distincts (checkout + report) → deux confirmations (contextId discrimine)', async () => {
    process.env[FLAG] = 'true';
    await CommunicationIdentity.create({ role: 'commerciale', scope: 'institute', email: 'com@beauty.fr', displayName: 'C', status: 'verified', active: true });
    const original = await makeBooking('BKG-ORIG');
    const rescheduled = await makeBooking('BKG-RESCHED'); // report → nouveau booking (nouveau _id)

    await emitBookingEvent('booking.confirmed', original);
    await emitBookingEvent('booking.confirmed', rescheduled);

    expect(await MailEventDelivery.countDocuments({ eventName: 'booking.confirmed', status: 'sent' })).toBe(2);
  });
});
