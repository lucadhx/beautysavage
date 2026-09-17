// tests/p1/mailEventDispatchService.test.js
// M2 — Moteur : dispatchTemplateByRoles (sent/template missing/identity missing/client missing) +
// dispatchMailForEvent (no rule / shadow direct-sender / idempotence). Brevo mocké (getCredential+fetch).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-M2-KEY')
}));

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;
const MailEventDelivery = (await import('../../models/MailEventDelivery.js')).default;
const SendLog = (await import('../../models/SendLog.js')).default;
const { dispatchTemplateByRoles, dispatchMailForEvent, resolveMailRule } = await import('../../services/mail/mailEventDispatchService.js');

async function seedIdentity(role, scope, email) {
  return CommunicationIdentity.create({ role, scope, email, displayName: `${role} BS`, status: 'verified', active: true });
}

describe('mailEventDispatchService', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await Promise.all([CommunicationIdentity.syncIndexes(), MailEventDelivery.syncIndexes()]);
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    await Promise.all([CommunicationIdentity.syncIndexes(), MailEventDelivery.syncIndexes()]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('dispatchTemplateByRoles → sent (commerciale → client), SendLog templateKey + tags rôles', async () => {
    await seedIdentity('commerciale', 'institute', 'com@beauty.fr');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messageId: '<m1>' }), { status: 200 })
    );
    const res = await dispatchTemplateByRoles({
      templateKey: 'vente',
      fromRole: 'commerciale',
      toRole: 'client',
      context: { client: { email: 'jane@mail.fr', name: 'Jane' }, contextType: 'sale', contextId: 'S1' }
    });
    expect(res.status).toBe('sent');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const log = await SendLog.findOne({ contextType: 'sale', contextId: 'S1' }).lean();
    expect(log.templateKey).toBe('vente');
    expect(log.metadata.tags).toEqual(expect.arrayContaining(['from:commerciale', 'to:client', 'role-engine']));
    // L'e-mail réel ne fuite pas (recipientHash, jamais l'adresse).
    expect(JSON.stringify(log)).not.toContain('jane@mail.fr');
  });

  it('template absent → skipped_template_missing', async () => {
    await seedIdentity('commerciale', 'institute', 'com@beauty.fr');
    const res = await dispatchTemplateByRoles({
      templateKey: 'inexistant_xyz',
      fromRole: 'commerciale',
      toRole: 'client',
      context: { client: { email: 'jane@mail.fr' } }
    });
    expect(res.status).toBe('skipped_template_missing');
  });

  it('identité commerciale absente → identity_missing', async () => {
    const res = await dispatchTemplateByRoles({
      templateKey: 'vente', fromRole: 'commerciale', toRole: 'client',
      context: { client: { email: 'jane@mail.fr' } }
    });
    expect(res.status).toBe('identity_missing');
  });

  it('client absent du contexte → client_missing', async () => {
    await seedIdentity('commerciale', 'institute', 'com@beauty.fr');
    const res = await dispatchTemplateByRoles({ templateKey: 'vente', fromRole: 'commerciale', toRole: 'client', context: {} });
    expect(res.status).toBe('client_missing');
  });

  it('support → commerciale (sent)', async () => {
    await seedIdentity('support', 'platform', 'sup@beauty.fr');
    await seedIdentity('commerciale', 'institute', 'com@beauty.fr');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ messageId: '<m2>' }), { status: 200 }));
    const res = await dispatchTemplateByRoles({
      templateKey: 'commission_available', fromRole: 'support', toRole: 'commerciale',
      context: { contextType: 'commission_payment', contextId: 'CP1' }
    });
    expect(res.status).toBe('sent');
  });

  it('dispatchMailForEvent : event inconnu → skipped_no_rule', async () => {
    const res = await dispatchMailForEvent({ eventName: 'nope.unknown', contextId: 'X' });
    expect(res.status).toBe('skipped_no_rule');
  });

  it('dispatchMailForEvent : sale.finalized → shadow (skipped_duplicate_direct_sender) + ledger', async () => {
    const res = await dispatchMailForEvent({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'S9' });
    expect(res.status).toBe('skipped_duplicate_direct_sender');
    const ledger = await MailEventDelivery.findOne({ eventName: 'sale.finalized', contextId: 'S9' }).lean();
    expect(ledger.status).toBe('skipped_duplicate_direct_sender');
    expect(ledger.templateKey).toBe('vente');
    // aucun e-mail envoyé en shadow
    expect(await SendLog.countDocuments({})).toBe(0);
  });

  it('dispatchMailForEvent : replay → idempotent (1 seule entrée ledger)', async () => {
    await dispatchMailForEvent({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'S10' });
    const second = await dispatchMailForEvent({ eventName: 'sale.finalized', contextType: 'sale', contextId: 'S10' });
    expect(second.idempotent).toBe(true);
    expect(await MailEventDelivery.countDocuments({ eventName: 'sale.finalized', contextId: 'S10' })).toBe(1);
  });

  it('resolveMailRule expose la règle', () => {
    expect(resolveMailRule('commission.reminder_sent').fromRole).toBe('support');
  });
});
