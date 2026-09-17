// tests/p1/mailEventActivationRollbackFlag.test.js
// M3C — Rollback par flag : MAIL_ROLE_RESOLVER_ENABLED pilote la voie d'envoi.
//   false → e-mail direct legacy (subscriber no-op, pas de ledger)
//   true  → moteur événementiel (direct désactivé, ledger sent)
// L'event refund.succeeded est TOUJOURS émis (audit) dans les deux cas.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-M3C-KEY')
}));

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;
const MailEventDelivery = (await import('../../models/MailEventDelivery.js')).default;
const EventLog = (await import('../../models/EventLog.js')).default;
const SendLog = (await import('../../models/SendLog.js')).default;
const User = (await import('../../models/user.js')).default;
const RefundRequest = (await import('../../models/RefundRequest.js')).default;
const { clearSubscribers } = await import('../../services/eventBusService.js');
const { registerMailEventSubscribers } = await import('../../subscribers/mailEventSubscriber.js');
const { sendRefundConfirmedEmailInternal } = await import('../../services/refundExecutionService.js');

const FLAG = 'MAIL_ROLE_RESOLVER_ENABLED';

async function seed() {
  await CommunicationIdentity.create({ role: 'commerciale', scope: 'institute', email: 'com@beauty.fr', displayName: 'C', status: 'verified', active: true });
  const user = new User({ email: 'rb@test.local', firstName: 'Zoe', lastName: 'Vix', role: 'client' });
  await user.save({ validateBeforeSave: false });
  const refund = new RefundRequest({ userId: user._id, saleId: 'S-RB', refundId: 'RF-RB', amount: 20, status: 'succeeded', itemType: 'formation', refundedAt: new Date(), meta: { formationTitle: 'F' } });
  await refund.save({ validateBeforeSave: false });
  return refund;
}

describe('M3C — rollback flag refund.succeeded', () => {
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

  it('flag false → direct legacy, event émis, aucun ledger event', async () => {
    process.env[FLAG] = 'false';
    const refund = await seed();
    await sendRefundConfirmedEmailInternal(refund);
    expect(await EventLog.countDocuments({ eventName: 'refund.succeeded' })).toBe(1); // event toujours émis
    expect(await MailEventDelivery.countDocuments({})).toBe(0); // moteur no-op
    expect(await SendLog.countDocuments({})).toBe(1); // direct legacy
  });

  it('flag true → moteur événementiel, ledger sent', async () => {
    process.env[FLAG] = 'true';
    const refund = await seed();
    await sendRefundConfirmedEmailInternal(refund);
    expect(await EventLog.countDocuments({ eventName: 'refund.succeeded' })).toBe(1);
    const ledger = await MailEventDelivery.findOne({ eventName: 'refund.succeeded' }).lean();
    expect(ledger.status).toBe('sent');
    expect(await SendLog.countDocuments({})).toBe(1); // un seul envoi (engine)
  });
});
