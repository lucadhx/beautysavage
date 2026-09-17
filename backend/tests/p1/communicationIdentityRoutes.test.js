// tests/p1/communicationIdentityRoutes.test.js
// M1 — Routes gestion : dev gère support, admin gère commerciale mais PAS support, payload safe.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Adapter Brevo mocké → aucun appel réseau.
vi.mock('../../services/communicationBrevoSenderAdapter.js', () => ({
  requestSenderVerification: vi.fn(async () => ({ senderId: 'snd_1', status: 'verification_pending' })),
  confirmSenderVerification: vi.fn(async () => ({ status: 'verified' })),
  getSenderStatus: vi.fn(async () => ({ active: true, senderId: 'snd_1' })),
  getDomainStatus: vi.fn(async () => ({ authenticated: false, status: 'unknown', dnsRecords: [] }))
}));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const CommunicationIdentity = (await import('../../models/CommunicationIdentity.js')).default;

let agent;
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}
const DEV_IP = '203.0.113.90';
const ADMIN_IP = '203.0.113.91';

describe('communication-identities routes', () => {
  beforeAll(async () => { agent = await getAgent(); await CommunicationIdentity.syncIndexes(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await CommunicationIdentity.syncIndexes(); await seedTestData(); });

  it('dev crée une identité support (201)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.post('/api/gestion/dev/communication-identities/support')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ email: 'support@beautysavage.fr', displayName: 'Support BS' });
    expect(res.status).toBe(201);
    expect(res.body.identity.role).toBe('support');
    expect(res.body.identity.scope).toBe('platform');
    // Payload safe : aucun champ secret
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/encryptedValue|api[-_]?key|xkeysib-/i);
  });

  it('admin crée une identité commerciale (201)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.post('/api/gestion/communication-identities/commerciale')
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP)
      .send({ email: 'commercial@beautysavage.fr', displayName: 'Commercial BS' });
    expect(res.status).toBe(201);
    expect(res.body.identity.role).toBe('commerciale');
  });

  it('admin ne peut PAS créer de support (aucune route /support sur le routeur admin)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.post('/api/gestion/communication-identities/support')
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP)
      .send({ email: 'x@y.fr', displayName: 'X' });
    // Pas de route /support côté admin → jamais créé (403 fall-through dev-only OU 404).
    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);
  });

  it('admin ne peut PAS gérer une identité support (403)', async () => {
    const devCookie = await login('dev@test.local', DEV_IP);
    const created = await agent.post('/api/gestion/dev/communication-identities/support')
      .set('Cookie', devCookie).set('X-Forwarded-For', DEV_IP)
      .send({ email: 'support@beautysavage.fr', displayName: 'Support BS' });
    const id = created.body.identity.id;

    const adminCookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.post(`/api/gestion/communication-identities/${id}/request-verification`)
      .set('Cookie', adminCookie).set('X-Forwarded-For', ADMIN_IP).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden_support_identity');
  });

  it('dev peut demander la vérification d’un support (mock Brevo, 200)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const created = await agent.post('/api/gestion/dev/communication-identities/support')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ email: 'support@beautysavage.fr', displayName: 'Support BS' });
    const id = created.body.identity.id;
    const res = await agent.post(`/api/gestion/dev/communication-identities/${id}/request-verification`)
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({});
    expect(res.status).toBe(200);
    expect(res.body.identity.status).toBe('verification_pending');
    expect(res.body.identity.providerSenderId).toBe('snd_1');
  });

  it('GET liste (dev) renvoie les identités', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    await agent.post('/api/gestion/dev/communication-identities/support')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP)
      .send({ email: 'support@beautysavage.fr', displayName: 'Support BS' });
    const res = await agent.get('/api/gestion/dev/communication-identities')
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    expect(res.body.identities.length).toBe(1);
  });

  it('client (non connecté) refusé', async () => {
    const res = await agent.get('/api/gestion/dev/communication-identities');
    expect([401, 403]).toContain(res.status);
  });
});
