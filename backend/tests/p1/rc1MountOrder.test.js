// RC1 — Régression mount-order : les routeurs admin montés après commissionRouter ne doivent plus
// renvoyer 403 aux admins (commissionRouter requireStrictDev déplacé en dernier). Les routes
// commissions restent dev-only et fonctionnelles.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
let agent;
async function login(email) {
  const r = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(r.status).toBe(200);
  return r.headers['set-cookie'];
}
describe('RC1 — mount-order admin access', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });

  it('admin atteint les routeurs admin sans 403 (plus de shadow strictDev)', async () => {
    const cookie = await login('admin@test.local');
    for (const path of ['/api/gestion/promotions', '/api/gestion/boosts', '/api/gestion/social-links', '/api/gestion/home-settings']) {
      const r = await agent.get(path).set('Cookie', cookie);
      expect(r.status, `${path} ne doit pas 403 pour admin`).not.toBe(403);
    }
  });

  it('routes commissions toujours dev-only (admin 403, dev OK)', async () => {
    const adminCookie = await login('admin@test.local');
    const adminRes = await agent.get('/api/gestion/commissions/config/stats').set('Cookie', adminCookie);
    expect(adminRes.status).toBe(403);
    const devCookie = await login('dev@test.local');
    const devRes = await agent.get('/api/gestion/commissions/config/stats').set('Cookie', devCookie);
    expect(devRes.status).not.toBe(403);
  });
});
