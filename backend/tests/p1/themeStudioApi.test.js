// tests/p1/themeStudioApi.test.js
// M5 — Le Theme Studio (dev-only) persiste les tokens visuels additifs (typography/radius/
// shadow/spacing) en create + update, sans casser le contrat existant. Active par scope.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Theme from '../../models/Theme.js';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

let agent;
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}
const DEV_IP = '203.0.113.150';
const ADMIN_IP = '203.0.113.151';

const COLORS = { primary: '#5f4ff7', secondary: '#f24692', background: '#f5f4ef', surface: '#ffffff', text: '#0f172a' };

describe('M5 — Theme Studio API (tokens visuels)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });

  it('create persiste typography/radius/shadow/spacing (additif)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.post('/api/gestion/themes').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({
      name: 'Vitrine M5', scope: 'vitrine', colors: COLORS,
      typography: { fontFamily: 'Inter, sans-serif' }, radius: '10px',
      shadow: '0 2px 8px rgba(0,0,0,.1)', spacing: { x1: '4px', x2: '8px', x3: '16px', x4: '24px' },
    });
    expect(res.status).toBe(201);
    expect(res.body.theme.typography.fontFamily).toBe('Inter, sans-serif');
    expect(res.body.theme.radius).toBe('10px');
    expect(res.body.theme.shadow).toBe('0 2px 8px rgba(0,0,0,.1)');
    expect(res.body.theme.spacing.x3).toBe('16px');
  });

  it('update modifie les tokens visuels sans toucher aux couleurs', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const created = await agent.post('/api/gestion/themes').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({
      name: 'Panel M5', scope: 'manager', colors: COLORS, radius: '6px',
    });
    const id = created.body.theme.id;
    const res = await agent.put(`/api/gestion/themes/${id}`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({
      radius: '12px', typography: { fontFamily: 'Roboto' },
    });
    expect(res.status).toBe(200);
    expect(res.body.theme.radius).toBe('12px');
    expect(res.body.theme.typography.fontFamily).toBe('Roboto');
    expect(res.body.theme.colors.primary).toBe('#5f4ff7'); // inchangé
  });

  it('activate rend le thème actif et GET public renvoie les tokens visuels', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const created = await agent.post('/api/gestion/themes').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({
      name: 'Vitrine actif', scope: 'vitrine', colors: COLORS, radius: '9px',
    });
    const id = created.body.theme.id;
    const act = await agent.post(`/api/gestion/themes/${id}/activate`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(act.status).toBe(200);
    expect(act.body.theme.isActive).toBe(true);

    const pub = await agent.get('/api/theme/vitrine');
    expect(pub.status).toBe(200);
    expect(pub.body.theme.radius).toBe('9px');
  });

  it('mapping scope manager = panel : create scope manager OK', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.post('/api/gestion/themes').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({
      name: 'Panel scope', scope: 'manager', colors: COLORS,
    });
    expect(res.status).toBe(201);
    expect(res.body.theme.scope).toBe('manager');
  });

  it('admin (non dev) interdit sur le Theme Studio', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/themes').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(403);
  });

  it('spacing invalide ignoré sans casser (chaînes seulement)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.post('/api/gestion/themes').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({
      name: 'Spacing robuste', scope: 'vitrine', colors: COLORS, spacing: { x1: 4, x2: '8px' },
    });
    expect(res.status).toBe(201);
    // x1 numérique ignoré ; x2 conservé.
    const doc = await Theme.findById(res.body.theme.id).lean();
    expect(doc.spacing?.x2).toBe('8px');
    expect(doc.spacing?.x1).toBeUndefined();
  });
});
