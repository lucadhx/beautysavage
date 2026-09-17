// tests/p1/mailRoleResolverIntegration.test.js
// M2 — Intégration moteur ↔ resolver M1 : injection from/to à l'envoi, SendLog porte les rôles,
// aucun fallback hardcodé. Brevo mocké (getCredential + fetch).
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../services/integratedApiCredentialService.js', () => ({
  getCredential: vi.fn(async () => 'xkeysib-FAKE-M2-INT')
}));

const mongoose = (await import('mongoose')).default;
const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;
const SendLog = (await import('../../models/SendLog.js')).default;
const { dispatchTemplateByRoles } = await import('../../services/mail/mailEventDispatchService.js');

async function seedIdentity(role, scope, email) {
  return CommunicationIdentity.create({ role, scope, email, displayName: `${role} BS`, status: 'verified', active: true });
}
let bodies = [];
function mockFetchOk() {
  bodies = [];
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ messageId: '<int>' }), { status: 200 });
  });
}

describe('mail role resolver integration', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
    await CommunicationIdentity.syncIndexes();
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await CommunicationIdentity.syncIndexes(); });
  afterEach(() => vi.restoreAllMocks());

  it('commerciale → client : sender = identité commerciale active, to = client du contexte', async () => {
    await seedIdentity('commerciale', 'institute', 'com@beauty.fr');
    mockFetchOk();
    const res = await dispatchTemplateByRoles({
      templateKey: 'vente', fromRole: 'commerciale', toRole: 'client',
      context: { client: { email: 'jane@mail.fr', name: 'Jane' }, contextType: 'sale', contextId: 'S1' }
    });
    expect(res.status).toBe('sent');
    expect(bodies[0].sender.email).toBe('com@beauty.fr');
    expect(bodies[0].to[0].email).toBe('jane@mail.fr');
    const log = await SendLog.findOne({ contextId: 'S1' }).lean();
    expect(log.metadata.tags).toEqual(expect.arrayContaining(['from:commerciale', 'to:client']));
  });

  it('support → commerciale : sender = support, to = identité commerciale active', async () => {
    await seedIdentity('support', 'platform', 'sup@beauty.fr');
    await seedIdentity('commerciale', 'institute', 'com@beauty.fr');
    mockFetchOk();
    const res = await dispatchTemplateByRoles({
      templateKey: 'commission_available', fromRole: 'support', toRole: 'commerciale',
      context: { contextType: 'commission_payment', contextId: 'CP1' }
    });
    expect(res.status).toBe('sent');
    expect(bodies[0].sender.email).toBe('sup@beauty.fr');
    expect(bodies[0].to[0].email).toBe('com@beauty.fr');
  });

  it('aucun fallback hardcodé : sans identité, aucun envoi (identity_missing)', async () => {
    const spy = mockFetchOk();
    const res = await dispatchTemplateByRoles({
      templateKey: 'vente', fromRole: 'commerciale', toRole: 'client',
      context: { client: { email: 'jane@mail.fr' } }
    });
    expect(res.status).toBe('identity_missing');
    expect(spy).not.toHaveBeenCalled();
  });
});
