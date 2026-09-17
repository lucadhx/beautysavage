// tests/p1/mailEventActivationBookingConfirmed.test.js
// M3D — booking.confirmed MIGRÉ vers le moteur événementiel. Flag true → e-mail engine
// (commerciale→client), ledger sent, anti-doublon. Flag false → moteur no-op (l'e-mail
// direct legacy n'existe que sur le chemin report, testé ailleurs). Brevo mocké.
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

async function seedCommerciale() {
  return CommunicationIdentity.create({ role: 'commerciale', scope: 'institute', email: 'com@beauty.fr', displayName: 'Commercial BS', status: 'verified', active: true });
}
async function seedBooking() {
  const user = new User({ email: 'bk-client@test.local', firstName: 'Lou', lastName: 'Marin', role: 'client' });
  await user.save({ validateBeforeSave: false });
  const service = new Service({ name: 'Soin visage' });
  await service.save({ validateBeforeSave: false });
  const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, bookingId: 'BKG-1', startAt: new Date('2026-07-10T09:00:00Z'), endAt: new Date('2026-07-10T10:00:00Z'), totalPrice: 80, paymentType: 'full', status: 'confirmed' });
  await booking.save({ validateBeforeSave: false });
  return { user, service, booking };
}

describe('M3D — activation booking.confirmed', () => {
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

  it('flag true → e-mail engine commerciale→client, ledger sent, SendLog tags rôles', async () => {
    process.env[FLAG] = 'true';
    await seedCommerciale();
    const { booking } = await seedBooking();

    await emitBookingEvent('booking.confirmed', booking);

    const logs = await SendLog.find({}).lean();
    expect(logs.length).toBe(1);
    expect(logs[0].templateKey).toBe('booking_confirmed');
    expect(logs[0].metadata.tags).toEqual(expect.arrayContaining(['from:commerciale', 'to:client', 'role-engine']));
    const ledger = await MailEventDelivery.findOne({ eventName: 'booking.confirmed', contextId: String(booking._id) }).lean();
    expect(ledger.status).toBe('sent');
    expect(JSON.stringify(logs[0])).not.toContain('bk-client@test.local');
  });

  it('flag false → moteur no-op (aucun ledger, aucun SendLog côté engine)', async () => {
    process.env[FLAG] = 'false';
    await seedCommerciale();
    const { booking } = await seedBooking();

    await emitBookingEvent('booking.confirmed', booking);

    expect(await MailEventDelivery.countDocuments({})).toBe(0);
    expect(await SendLog.countDocuments({})).toBe(0);
  });

  it('flag true + commerciale absente → identity_missing contrôlé, pas d’envoi', async () => {
    process.env[FLAG] = 'true';
    const { booking } = await seedBooking();
    await emitBookingEvent('booking.confirmed', booking);
    const ledger = await MailEventDelivery.findOne({ eventName: 'booking.confirmed' }).lean();
    expect(ledger.status).toBe('identity_missing');
    expect(await SendLog.countDocuments({})).toBe(0);
  });

  it('flag true + client sans e-mail → client_missing contrôlé', async () => {
    process.env[FLAG] = 'true';
    await seedCommerciale();
    const service = new Service({ name: 'Massage' });
    await service.save({ validateBeforeSave: false });
    const user = new User({ firstName: 'Sans', lastName: 'Mail', role: 'client' }); // pas d'email
    await user.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: user._id, serviceId: service._id, bookingId: 'BKG-NM', startAt: new Date(), endAt: new Date(), totalPrice: 50, status: 'confirmed' });
    await booking.save({ validateBeforeSave: false });

    await emitBookingEvent('booking.confirmed', booking);
    const ledger = await MailEventDelivery.findOne({ eventName: 'booking.confirmed' }).lean();
    expect(ledger.status).toBe('client_missing');
  });
});
