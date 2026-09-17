// tests/p1/mailEventActivationRefund.test.js
// M3C — refund.succeeded MIGRÉ vers le moteur événementiel. Flag true → e-mail engine
// (commerciale→client), direct legacy non envoyé, ledger sent, idempotent. Brevo mocké.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-M3C-KEY')
}));

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;
const MailEventDelivery = (await import('../../models/MailEventDelivery.js')).default;
const SendLog = (await import('../../models/SendLog.js')).default;
const User = (await import('../../models/user.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const ServiceBooking = (await import('../../models/ServiceBooking.js')).default;
const Service = (await import('../../models/Service.js')).default;
const { clearSubscribers } = await import('../../services/eventBusService.js');
const { registerMailEventSubscribers } = await import('../../subscribers/mailEventSubscriber.js');
const { sendRefundConfirmedEmailInternal } = await import('../../services/refundExecutionService.js');

const FLAG = 'MAIL_ROLE_RESOLVER_ENABLED';

async function seedCommerciale() {
  return CommunicationIdentity.create({ role: 'commerciale', scope: 'institute', email: 'com@beauty.fr', displayName: 'Commercial BS', status: 'verified', active: true });
}
async function seedClientAndRefund({ itemType = 'formation' } = {}) {
  const user = new User({ email: 'refund-client@test.local', firstName: 'Rosa', lastName: 'Klein', role: 'client' });
  await user.save({ validateBeforeSave: false });
  const refund = new RefundRequest({
    userId: user._id, saleId: 'S-REF-1', refundId: 'RF-1', amount: 42, status: 'succeeded',
    itemType, refundedAt: new Date('2026-06-20T10:00:00Z'), trackingToken: 'trk_abc',
    meta: { formationTitle: 'Formation Cils' }
  });
  await refund.save({ validateBeforeSave: false });
  return { user, refund };
}

describe('M3C — activation refund.succeeded', () => {
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

  it('flag true → e-mail engine commerciale→client (SendLog role-engine, ledger sent), direct non envoyé', async () => {
    process.env[FLAG] = 'true';
    await seedCommerciale();
    const { refund } = await seedClientAndRefund();

    await sendRefundConfirmedEmailInternal(refund);

    const logs = await SendLog.find({}).lean();
    expect(logs.length).toBe(1); // un seul envoi (engine), pas de doublon direct
    expect(logs[0].templateKey).toBe('refund_confirmed');
    expect(logs[0].metadata.tags).toEqual(expect.arrayContaining(['from:commerciale', 'to:client', 'role-engine']));
    const ledger = await MailEventDelivery.findOne({ eventName: 'refund.succeeded', contextId: String(refund._id) }).lean();
    expect(ledger.status).toBe('sent');
    // aucune fuite d'e-mail client
    expect(JSON.stringify(logs[0])).not.toContain('refund-client@test.local');
  });

  it('flag false → e-mail direct legacy (pas de role-engine), aucun ledger event', async () => {
    process.env[FLAG] = 'false';
    await seedCommerciale();
    const { refund } = await seedClientAndRefund();

    await sendRefundConfirmedEmailInternal(refund);

    const logs = await SendLog.find({}).lean();
    expect(logs.length).toBe(1); // envoi direct legacy
    const tags = logs[0].metadata?.tags || [];
    expect(tags).not.toContain('role-engine');
    expect(await MailEventDelivery.countDocuments({})).toBe(0); // subscriber no-op
  });

  it('flag true + variante service → templateKey refund_confirmed_service', async () => {
    process.env[FLAG] = 'true';
    await seedCommerciale();
    const { refund } = await seedClientAndRefund({ itemType: 'service' });
    const service = new Service({ name: 'Soin visage' });
    await service.save({ validateBeforeSave: false });
    const booking = new ServiceBooking({ clientId: refund.userId, serviceId: service._id, bookingId: 'BK-9', saleId: 'S-REF-1', startAt: new Date('2026-07-01T09:00:00Z'), endAt: new Date('2026-07-01T10:00:00Z'), totalPrice: 80, status: 'confirmed' });
    await booking.save({ validateBeforeSave: false });

    await sendRefundConfirmedEmailInternal(refund);

    const ledger = await MailEventDelivery.findOne({ eventName: 'refund.succeeded' }).lean();
    expect(ledger.templateKey).toBe('refund_confirmed_service');
    expect(ledger.status).toBe('sent');
  });

  it('flag true → replay (2 émissions) = 1 seul e-mail (idempotent)', async () => {
    process.env[FLAG] = 'true';
    await seedCommerciale();
    const { refund } = await seedClientAndRefund();

    await sendRefundConfirmedEmailInternal(refund);
    await sendRefundConfirmedEmailInternal(refund); // replay

    expect(await SendLog.countDocuments({})).toBe(1);
    expect(await MailEventDelivery.countDocuments({ eventName: 'refund.succeeded' })).toBe(1);
  });

  it('flag true + commerciale absente → identity_missing contrôlé, pas de throw, pas d’envoi', async () => {
    process.env[FLAG] = 'true';
    const { refund } = await seedClientAndRefund(); // pas de commerciale

    await expect(sendRefundConfirmedEmailInternal(refund)).resolves.toBeUndefined();
    const ledger = await MailEventDelivery.findOne({ eventName: 'refund.succeeded' }).lean();
    expect(ledger.status).toBe('identity_missing');
    expect(await SendLog.countDocuments({})).toBe(0);
  });

  it('flag true + client introuvable → client_missing contrôlé', async () => {
    process.env[FLAG] = 'true';
    await seedCommerciale();
    // refund avec userId inexistant
    const refund = new RefundRequest({ userId: new mongoose.Types.ObjectId(), saleId: 'S-X', refundId: 'RF-X', amount: 10, status: 'succeeded', itemType: 'formation', refundedAt: new Date() });
    await refund.save({ validateBeforeSave: false });

    await expect(sendRefundConfirmedEmailInternal(refund)).resolves.toBeUndefined();
    const ledger = await MailEventDelivery.findOne({ eventName: 'refund.succeeded' }).lean();
    expect(ledger.status).toBe('client_missing');
  });
});
