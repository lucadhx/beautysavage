// tests/p1/managerModeAccess.test.js
// RX-BLOCKER — POST /api/mode/enter-gestion (idempotent) débloque le manager : sans mode 'gestion', les
// routes /api/gestion/* gardées par requireMode redirigent (302) → pages « indisponible ». Vérifie : rôle
// (dev/admin OK, client 403, anonyme 401), idempotence, et la régression d'accès dans les deux sens.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../services/notificationService.js', async (o) => ({ ...(await o()), triggerNotification: async () => {} }));

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

const MODE_GATED = '/api/gestion/availability/calendar-events'; // requireMode('gestion')

async function login(agent, email) {
  const r = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}

describe('RX-BLOCKER — accès manager (mode gestion)', () => {
  let agent;
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });

  it('dev : enter-gestion 200 + /auth/me currentMode=gestion', async () => {
    const cookie = await login(agent, 'dev@test.local');
    const res = await agent.post('/api/mode/enter-gestion').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('gestion');
    const me = await agent.get('/auth/me').set('Cookie', cookie);
    expect(me.body.user.currentMode).toBe('gestion');
  });

  it('idempotent : deux appels → toujours gestion (jamais bascule vers vitrine)', async () => {
    const cookie = await login(agent, 'dev@test.local');
    await agent.post('/api/mode/enter-gestion').set('Cookie', cookie);
    const res2 = await agent.post('/api/mode/enter-gestion').set('Cookie', cookie);
    expect(res2.status).toBe(200);
    expect(res2.body.currentMode).toBe('gestion');
  });

  it('régression d\'accès : gestion → OK, vitrine → 302 (bloqué), re-gestion → OK', async () => {
    const cookie = await login(agent, 'dev@test.local');
    // Mode gestion → route mode-gated accessible (pas de 302 vers /vitrine.html).
    await agent.post('/api/mode/enter-gestion').set('Cookie', cookie);
    const okRes = await agent.get(MODE_GATED).set('Cookie', cookie).redirects(0);
    expect(okRes.status).not.toBe(302);
    // Bascule en vitrine (toggle) → la même route redirige (302) = le bug d'origine.
    await agent.post('/api/mode/toggle').set('Cookie', cookie);
    const blockedRes = await agent.get(MODE_GATED).set('Cookie', cookie).redirects(0);
    expect(blockedRes.status).toBe(302);
    // enter-gestion re-débloque.
    await agent.post('/api/mode/enter-gestion').set('Cookie', cookie);
    const okAgain = await agent.get(MODE_GATED).set('Cookie', cookie).redirects(0);
    expect(okAgain.status).not.toBe(302);
  });

  it('admin : enter-gestion autorisé (200)', async () => {
    const cookie = await login(agent, 'admin@test.local');
    const res = await agent.post('/api/mode/enter-gestion').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.currentMode).toBe('gestion');
  });

  it('client : enter-gestion refusé (403)', async () => {
    const cookie = await login(agent, 'client1@test.local');
    const res = await agent.post('/api/mode/enter-gestion').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('anonyme : 401', async () => {
    const res = await agent.post('/api/mode/enter-gestion');
    expect(res.status).toBe(401);
  });
});
