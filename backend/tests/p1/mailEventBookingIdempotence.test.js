// tests/p1/mailEventBookingIdempotence.test.js
// M3D — Anti-doublon booking.confirmed. Clé = bookingId (booking._id) + templateKey.
//   - replay du MÊME event (même _id) → 1 e-mail max.
//   - report de créneau = NOUVEAU booking (nouveau _id) → nouvelle confirmation (légitime).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-M3D-KEY')
}));

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;
const MailEventDelivery = (await import('../../models/MailEventDelivery.js')).default;
const SendLog = (await import('../../models/SendLog.js')).default;
const User = (await import('../../models/user.js')).default;
const Service = (await import('../../models/Service.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const { clearSubscribers } = await import('../../services/eventBusService.js');
const { emitBookingEvent } = await import('../../services/businessEventService.js');
const { registerMailEventSubscribers } = await import('../../subscribers/mailEventSubscriber.js');

const FLAG = 'MAIL_ROLE_RESOLVER_ENABLED';

let bkSeq = 0;
async function makeBooking(bookingId) {
  bkSeq += 1;
  const user = new User({ email: `idem-${bookingId}@test.local`, firstName: 'I', lastName: 'D', role: 'client' });
  await user.save({ validateBeforeSave: false });
  const service = new Service({ name: 'Prestation', slug: `svc-${bookingId}` });
  await service.save({ validateBeforeSave: false });
  const start = new Date('2026-09-01T09:00:00Z');
  start.setUTCHours(9 + bkSeq); // startAt distinct → évite l'index unique {practitionerId,startAt}
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, bookingId, startAt: start, endAt: end, totalPrice: 70, status: 'confirmed' });
  await booking.save({ validateBeforeSave: false });
  return booking;
}

describe('M3D — idempotence booking.confirmed', () => {
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
    await CommunicationIdentity.create({ role: 'commerciale', scope: 'institute', email: 'com@beauty.fr', displayName: 'C', status: 'verified', active: true });
    process.env[FLAG] = 'true';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ messageId: '<m>' }), { status: 200 }));
  });
  afterEach(() => { vi.restoreAllMocks(); clearSubscribers(); delete process.env[FLAG]; });

  it('replay du même event (même booking) → 1 seul e-mail', async () => {
    const booking = await makeBooking('BKG-IDEM');
    await emitBookingEvent('booking.confirmed', booking);
    await emitBookingEvent('booking.confirmed', booking); // replay
    expect(await SendLog.countDocuments({})).toBe(1);
    expect(await MailEventDelivery.countDocuments({ eventName: 'booking.confirmed' })).toBe(1);
  });

  it('report = nouveau booking → 2 confirmations distinctes', async () => {
    const original = await makeBooking('BKG-ORIG');
    const rescheduled = await makeBooking('BKG-NEW'); // report crée un nouveau booking
    await emitBookingEvent('booking.confirmed', original);
    await emitBookingEvent('booking.confirmed', rescheduled);
    expect(await SendLog.countDocuments({})).toBe(2);
    expect(await MailEventDelivery.countDocuments({ eventName: 'booking.confirmed' })).toBe(2);
  });

  it('concurrent emit du même booking → 1 seul e-mail', async () => {
    const booking = await makeBooking('BKG-CONC');
    await Promise.all([
      emitBookingEvent('booking.confirmed', booking),
      emitBookingEvent('booking.confirmed', booking),
      emitBookingEvent('booking.confirmed', booking)
    ]);
    expect(await MailEventDelivery.countDocuments({ eventName: 'booking.confirmed' })).toBe(1);
    expect(await SendLog.countDocuments({})).toBeLessThanOrEqual(1);
  });
});
