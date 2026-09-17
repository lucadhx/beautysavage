// tests/p1/themeMultiScopeBackend.test.js
// Thème multi-scope (T1) : scope vitrine/manager, 1 actif par scope, endpoints publics,
// legacy sans scope = vitrine. CRUD dev-only.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Theme = (await import('../../models/Theme.js')).default;

const IP_DEV = '203.0.113.70';
const COLORS_V = { primary: '#5f4ff7', secondary: '#f24692', background: '#f5f4ef', surface: '#ffffff', text: '#0f172a' };
const COLORS_M = { primary: '#2563eb', secondary: '#7c3aed', background: '#f1f5f9', surface: '#ffffff', text: '#0f172a' };

let agent;
let devCookie;

async function loginDev() {
  const res = await agent.post('/auth/login').set('X-Forwarded-For', IP_DEV).send({ email: 'dev@test.local', password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}
const asDev = (req) => req.set('Cookie', devCookie).set('X-Forwarded-For', IP_DEV);

async function createTheme(body) {
  const res = await asDev(agent.post('/api/gestion/themes')).send(body);
  return res;
}
async function activate(id) {
  return asDev(agent.post(`/api/gestion/themes/${id}/activate`));
}

describe('Theme multi-scope backend (T1)', () => {
  beforeAll(async () => { agent = await getAgent(); await Theme.syncIndexes(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    await Theme.syncIndexes();
    await seedTestData();
    devCookie = await loginDev();
  });

  it('GET /api/vitrine/theme : un document legacy sans scope est traité comme vitrine', async () => {
    await Theme.collection.insertOne({ name: 'Legacy', colors: COLORS_V, isActive: true, createdAt: new Date() });
    const res = await agent.get('/api/vitrine/theme');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.theme.name).toBe('Legacy');
    expect(res.body.theme.scope).toBe('vitrine');
  });

  it('createTheme : scope par défaut vitrine, scope manager accepté, scope invalide → 400', async () => {
    const v = await createTheme({ name: 'V1', colors: COLORS_V });
    expect(v.status).toBe(201);
    expect(v.body.theme.scope).toBe('vitrine');

    const m = await createTheme({ name: 'M1', scope: 'manager', colors: COLORS_M });
    expect(m.status).toBe(201);
    expect(m.body.theme.scope).toBe('manager');

    const bad = await createTheme({ name: 'X1', scope: 'admin', colors: COLORS_V });
    expect(bad.status).toBe(400);
  });

  it('un seul actif par scope ; activer un scope ne désactive pas l’autre', async () => {
    const v1 = (await createTheme({ name: 'V1', colors: COLORS_V })).body.theme;
    const m1 = (await createTheme({ name: 'M1', scope: 'manager', colors: COLORS_M })).body.theme;
    expect((await activate(v1.id)).status).toBe(200);
    expect((await activate(m1.id)).status).toBe(200);

    // Les deux scopes restent actifs simultanément.
    expect((await Theme.findById(v1.id)).isActive).toBe(true);
    expect((await Theme.findById(m1.id)).isActive).toBe(true);

    // Un second thème vitrine activé désactive V1 mais PAS M1.
    const v2 = (await createTheme({ name: 'V2', colors: COLORS_V })).body.theme;
    expect((await activate(v2.id)).status).toBe(200);
    expect((await Theme.findById(v1.id)).isActive).toBe(false);
    expect((await Theme.findById(v2.id)).isActive).toBe(true);
    expect((await Theme.findById(m1.id)).isActive).toBe(true);

    // Au plus un actif par scope.
    expect(await Theme.countDocuments({ scope: 'vitrine', isActive: true })).toBe(1);
    expect(await Theme.countDocuments({ scope: 'manager', isActive: true })).toBe(1);
  });

  it('GET /api/vitrine/theme et /api/theme/manager renvoient le bon scope', async () => {
    const v1 = (await createTheme({ name: 'V1', colors: COLORS_V })).body.theme;
    const m1 = (await createTheme({ name: 'M1', scope: 'manager', colors: COLORS_M })).body.theme;
    await activate(v1.id);
    await activate(m1.id);

    const vitrine = await agent.get('/api/vitrine/theme');
    expect(vitrine.body.theme.name).toBe('V1');

    const manager = await agent.get('/api/theme/manager');
    expect(manager.status).toBe(200);
    expect(manager.body.scope).toBe('manager');
    expect(manager.body.theme.name).toBe('M1');

    const vitrineScope = await agent.get('/api/theme/vitrine');
    expect(vitrineScope.body.theme.name).toBe('V1');

    const bad = await agent.get('/api/theme/nope');
    expect(bad.status).toBe(400);
  });

  it('/api/theme/manager renvoie theme:null si aucun thème manager actif (fallback côté client)', async () => {
    const res = await agent.get('/api/theme/manager');
    expect(res.status).toBe(200);
    expect(res.body.theme).toBeNull();
  });

  it('CRUD thèmes refusé hors dev (admin → 403/redirect)', async () => {
    const adminLogin = await agent.post('/auth/login').set('X-Forwarded-For', '203.0.113.71').send({ email: 'admin@test.local', password: TEST_PASSWORD });
    const res = await agent.post('/api/gestion/themes').set('Cookie', adminLogin.headers['set-cookie']).set('X-Forwarded-For', '203.0.113.71').send({ name: 'Nope', colors: COLORS_V });
    expect(res.status).not.toBe(201);
    expect([401, 403]).toContain(res.status);
  });
});
