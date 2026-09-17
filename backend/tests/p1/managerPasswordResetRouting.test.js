// tests/p1/managerPasswordResetRouting.test.js
// RX-BLOCKER-2 — POST /auth/password-reset/request route l'e-mail selon le rôle de la cible : manager
// (admin/dev) → sendManagerPasswordResetEmail (support) ; client → sendClientPasswordResetEmail (commerciale).
// Réponse neutre 200 (anti-énumération). Reset manager de bout en bout (validate → complete → login).
// Brevo mocké via authMailService : aucun envoi réel, aucun token en clair loggé.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ manager: [], client: [] }));
vi.mock('../../services/authMailService.js', () => ({
  sendManagerInvitationEmail: vi.fn(async () => true),
  sendManagerPasswordResetEmail: vi.fn(async (user, token) => { h.manager.push({ email: user?.email, token }); return true; }),
  sendClientPasswordResetEmail: vi.fn(async (user, token) => { h.client.push({ email: user?.email, token }); return true; })
}));
vi.mock('../../services/notificationService.js', async (o) => ({ ...(await o()), triggerNotification: async () => {} }));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

describe('RX-BLOCKER-2 — routage reset mot de passe par rôle', () => {
  let agent;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); h.manager.length = 0; h.client.length = 0; });

  it('reset admin → sender manager (support) ; jamais client', async () => {
    const res = await agent.post('/auth/password-reset/request').send({ email: 'admin@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(h.manager.map((m) => m.email)).toContain('admin@test.local');
    expect(h.client).toHaveLength(0);
  });

  it('reset dev → sender manager (support)', async () => {
    await agent.post('/auth/password-reset/request').send({ email: 'dev@test.local' });
    expect(h.manager.map((m) => m.email)).toContain('dev@test.local');
    expect(h.client).toHaveLength(0);
  });

  it('reset client → sender client (commerciale) ; jamais manager', async () => {
    await agent.post('/auth/password-reset/request').send({ email: 'client1@test.local' });
    expect(h.client.map((c) => c.email)).toContain('client1@test.local');
    expect(h.manager).toHaveLength(0);
  });

  it('email inconnu → 200 neutre, aucun e-mail envoyé (anti-énumération)', async () => {
    const res = await agent.post('/auth/password-reset/request').send({ email: 'nobody@test.local' });
    expect(res.status).toBe(200);
    expect(h.manager).toHaveLength(0);
    expect(h.client).toHaveLength(0);
  });

  it('reset manager de bout en bout : validate → complete → login avec le nouveau mot de passe', async () => {
    await agent.post('/auth/password-reset/request').send({ email: 'admin@test.local' });
    const token = h.manager[0]?.token;
    expect(token).toBeTruthy();
    expect((await agent.post('/auth/password-reset/validate').send({ token })).status).toBe(200);
    const done = await agent.post('/auth/password-reset/complete').send({ token, password: 'Nouveau1234' });
    expect(done.status).toBe(200);
    const login = await agent.post('/auth/login').send({ email: 'admin@test.local', password: 'Nouveau1234' });
    expect(login.status).toBe(200);
    // Token à usage unique : re-complete refusé.
    expect((await agent.post('/auth/password-reset/complete').send({ token, password: 'Nouveau1234' })).status).toBe(400);
  });
});
