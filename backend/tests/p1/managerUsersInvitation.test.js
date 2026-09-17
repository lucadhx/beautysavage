// tests/p1/managerUsersInvitation.test.js
// RX-BLOCKER-2 — Comptes manager par invitation : contrôle d'accès (dev-only), création admin/dev sans mot de
// passe, invitation tokenisée (hashée, usage unique), acceptation → activation + login. Brevo mocké (le mail
// d'invitation est intercepté pour récupérer le token brut — jamais renvoyé par l'API).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ lastToken: null }));
vi.mock('../../services/authMailService.js', () => ({
  sendManagerInvitationEmail: vi.fn(async (_user, token) => { h.lastToken = token; return true; }),
  sendManagerPasswordResetEmail: vi.fn(async () => true),
  sendClientPasswordResetEmail: vi.fn(async () => true)
}));
vi.mock('../../services/notificationService.js', async (o) => ({ ...(await o()), triggerNotification: async () => {} }));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const ManagerInvitationToken = (await import('../../models/ManagerInvitationToken.js')).default;

async function loginGestion(agent, email) {
  const r = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  const cookie = r.headers['set-cookie'];
  await agent.post('/api/mode/enter-gestion').set('Cookie', cookie); // requireMode('gestion')
  return cookie;
}

describe('RX-BLOCKER-2 — manager users & invitations', () => {
  let agent;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); h.lastToken = null; });

  it('contrôle d\'accès : dev OK, admin 403 (dev-only), client 403, anonyme refusé', async () => {
    const devCookie = await loginGestion(agent, 'dev@test.local');
    expect((await agent.get('/api/gestion/manager-users').set('Cookie', devCookie)).status).toBe(200);
    const adminCookie = await loginGestion(agent, 'admin@test.local');
    expect((await agent.get('/api/gestion/manager-users').set('Cookie', adminCookie)).status).toBe(403);
    const clientR = await agent.post('/auth/login').send({ email: 'client1@test.local', password: TEST_PASSWORD });
    expect((await agent.get('/api/gestion/manager-users').set('Cookie', clientR.headers['set-cookie'])).status).toBe(403);
    expect((await agent.get('/api/gestion/manager-users').redirects(0)).status).not.toBe(200);
  });

  it('dev crée un admin (sans mot de passe) → invitation envoyée + token hashé en DB', async () => {
    const devCookie = await loginGestion(agent, 'dev@test.local');
    const res = await agent.post('/api/gestion/manager-users').set('Cookie', devCookie)
      .send({ email: 'newadmin@test.local', role: 'admin', firstName: 'Nina' });
    expect(res.status).toBe(201);
    expect(res.body.user.status).toBe('invited');
    expect(res.body.user).not.toHaveProperty('password');
    expect(h.lastToken).toBeTruthy();
    const doc = await ManagerInvitationToken.findOne({}).lean();
    expect(doc.tokenHash).toBeTruthy();
    expect(doc.tokenHash).not.toBe(h.lastToken); // jamais le token brut en DB
  });

  it('dev crée un dev ; admin ne peut pas créer (dev-only) ; e-mail unique (409)', async () => {
    const devCookie = await loginGestion(agent, 'dev@test.local');
    expect((await agent.post('/api/gestion/manager-users').set('Cookie', devCookie).send({ email: 'newdev@test.local', role: 'dev' })).status).toBe(201);
    // doublon
    expect((await agent.post('/api/gestion/manager-users').set('Cookie', devCookie).send({ email: 'newdev@test.local', role: 'dev' })).status).toBe(409);
    // admin dev-only refusé
    const adminCookie = await loginGestion(agent, 'admin@test.local');
    expect((await agent.post('/api/gestion/manager-users').set('Cookie', adminCookie).send({ email: 'x@test.local', role: 'admin' })).status).toBe(403);
  });

  it('acceptation invitation : GET safe → accept → login ; token usage unique', async () => {
    const devCookie = await loginGestion(agent, 'dev@test.local');
    await agent.post('/api/gestion/manager-users').set('Cookie', devCookie).send({ email: 'invitee@test.local', role: 'admin', firstName: 'Iv' });
    const token = h.lastToken;
    // GET public safe
    const info = await agent.get(`/auth/manager-invitations/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.email).toBe('invitee@test.local');
    expect(info.body.role).toBe('admin');
    // Accept
    const acc = await agent.post(`/auth/manager-invitations/${token}/accept`).send({ password: 'Motdepasse1', confirmPassword: 'Motdepasse1' });
    expect(acc.status).toBe(200);
    // Login activé
    const login = await agent.post('/auth/login').send({ email: 'invitee@test.local', password: 'Motdepasse1' });
    expect(login.status).toBe(200);
    // Usage unique
    const again = await agent.post(`/auth/manager-invitations/${token}/accept`).send({ password: 'Motdepasse1', confirmPassword: 'Motdepasse1' });
    expect(again.status).toBe(400);
    expect(again.body.status).toBe('used');
  });

  it('accept : mot de passe faible refusé, mismatch refusé, token invalide refusé', async () => {
    const devCookie = await loginGestion(agent, 'dev@test.local');
    await agent.post('/api/gestion/manager-users').set('Cookie', devCookie).send({ email: 'weak@test.local', role: 'admin' });
    const token = h.lastToken;
    expect((await agent.post(`/auth/manager-invitations/${token}/accept`).send({ password: 'short', confirmPassword: 'short' })).status).toBe(400);
    expect((await agent.post(`/auth/manager-invitations/${token}/accept`).send({ password: 'Motdepasse1', confirmPassword: 'Autre1234' })).status).toBe(400);
    expect((await agent.get('/auth/manager-invitations/deadbeef')).status).toBe(400);
  });
});
