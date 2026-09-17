// tests/p1/notificationTargetRoutes.test.js
// M3A — Endpoints filtrés par audience : manager (admin) vs dev (dev-only).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Notification from '../../models/Notification.js';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

let agent;
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}
const DEV_IP = '203.0.113.40';
const ADMIN_IP = '203.0.113.41';
const CLIENT_IP = '203.0.113.42';

async function seedNotifs() {
  await Notification.create({ title: 'Vente admin', message: 'm', targetType: 'all', targetRole: 'admin', eventType: 'new_sale' });
  await Notification.create({ title: 'Webhook dev', message: 'm', targetType: 'all', targetRole: 'dev', eventType: 'webhook_failure' });
}

describe('notifications — endpoints filtrés par audience (M3A)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); await seedNotifs(); });

  it('endpoint manager ne renvoie QUE l’audience admin (pas dev)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/notifications').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    const types = res.body.notifications.map(n => n.eventType);
    expect(types).toContain('new_sale');
    expect(types).not.toContain('webhook_failure');
    expect(res.body.notifications.every(n => n.targetRole !== 'dev')).toBe(true);
  });

  it('endpoint dev ne renvoie QUE l’audience dev (pas admin)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.get('/api/gestion/dev/notifications').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    const types = res.body.notifications.map(n => n.eventType);
    expect(types).toContain('webhook_failure');
    expect(types).not.toContain('new_sale');
    expect(res.body.notifications.every(n => n.targetRole === 'dev')).toBe(true);
  });

  it('admin NE PEUT PAS accéder à l’endpoint dev (403)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/dev/notifications').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(403);
  });

  it('dev peut consulter le panel manager (audience admin) — autorisé', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.get('/api/gestion/notifications').set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
    const types = res.body.notifications.map(n => n.eventType);
    expect(types).toContain('new_sale');
    expect(types).not.toContain('webhook_failure');
  });

  it('client interdit (manager et dev)', async () => {
    const cookie = await login('client1@test.local', CLIENT_IP);
    const mgr = await agent.get('/api/gestion/notifications').set('Cookie', cookie).set('X-Forwarded-For', CLIENT_IP);
    expect([401, 403]).toContain(mgr.status);
    const dev = await agent.get('/api/gestion/dev/notifications').set('Cookie', cookie).set('X-Forwarded-For', CLIENT_IP);
    expect([401, 403]).toContain(dev.status);
  });

  it('non authentifié refusé', async () => {
    const mgr = await agent.get('/api/gestion/notifications');
    expect([401, 403]).toContain(mgr.status);
    const dev = await agent.get('/api/gestion/dev/notifications');
    expect([401, 403]).toContain(dev.status);
  });

  it('marquer lu respecte l’audience : admin ne peut pas marquer une notif dev', async () => {
    const devNotif = await Notification.findOne({ targetRole: 'dev' }).lean();
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.patch(`/api/gestion/notifications/${devNotif.notificationId}/read`)
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(404); // hors audience admin → introuvable
  });

  it('dev marque lu sa notif dev (200)', async () => {
    const devNotif = await Notification.findOne({ targetRole: 'dev' }).lean();
    const cookie = await login('dev@test.local', DEV_IP);
    const res = await agent.patch(`/api/gestion/dev/notifications/${devNotif.notificationId}/read`)
      .set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(res.status).toBe(200);
  });

  it('pas de fuite de payload sensible dans la réponse', async () => {
    await Notification.create({
      title: 'Nouveau client', message: 'inscription', targetType: 'all', targetRole: 'admin',
      eventType: 'new_client', variables: { clientEmail: 'secret-client@private.example', apiKey: 'xkeysib-LEAK' }
    });
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/notifications').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('secret-client@private.example');
    expect(raw).not.toMatch(/xkeysib-/i);
    expect(raw).not.toContain('variables');
  });
});
