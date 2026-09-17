// tests/p1/notificationDeleteById.test.js
// LOT2 — La suppression/lecture d'une notification accepte le `_id` Mongo (ce que le frontend
// envoie via `notification.id`) ET le `notificationId` métier. Corrige le 404 dû au mismatch.
// Suppression idempotente. Scoping d'audience préservé.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Notification from '../../models/Notification.js';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

let agent;
const ADMIN_IP = '203.0.113.60';
const DEV_IP = '203.0.113.61';
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}

describe('notifications — suppression/lecture par _id (LOT2)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });

  it('DELETE via le _id Mongo (frontend) supprime la notification (ex-404)', async () => {
    const n = await Notification.create({ title: 'A', message: 'm', targetType: 'all', targetRole: 'admin', eventType: 'new_client' });
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.delete(`/api/gestion/notifications/${n._id.toString()}`)
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(await Notification.findById(n._id)).toBeNull();
  });

  it('DELETE via le notificationId métier fonctionne aussi', async () => {
    const n = await Notification.create({ title: 'B', message: 'm', targetType: 'all', targetRole: 'admin', eventType: 'new_client' });
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.delete(`/api/gestion/notifications/${n.notificationId}`)
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it('double suppression = idempotente (200, deleted:false)', async () => {
    const n = await Notification.create({ title: 'C', message: 'm', targetType: 'all', targetRole: 'admin', eventType: 'new_client' });
    const cookie = await login('admin@test.local', ADMIN_IP);
    const id = n._id.toString();
    await agent.delete(`/api/gestion/notifications/${id}`).set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    const again = await agent.delete(`/api/gestion/notifications/${id}`).set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(again.status).toBe(200);
    expect(again.body.deleted).toBe(false);
  });

  it('mark-read via le _id Mongo fonctionne', async () => {
    const n = await Notification.create({ title: 'D', message: 'm', targetType: 'all', targetRole: 'admin', eventType: 'new_client' });
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.patch(`/api/gestion/notifications/${n._id.toString()}/read`)
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
  });

  it('scoping d\'audience préservé : admin ne supprime pas une notif dev (idempotent, non supprimée)', async () => {
    const dev = await Notification.create({ title: 'devN', message: 'm', targetType: 'all', targetRole: 'dev', eventType: 'webhook_failure' });
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.delete(`/api/gestion/notifications/${dev._id.toString()}`)
      .set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.body.deleted).toBe(false); // hors audience → rien supprimé
    expect(await Notification.findById(dev._id)).not.toBeNull(); // toujours présente
  });
});
