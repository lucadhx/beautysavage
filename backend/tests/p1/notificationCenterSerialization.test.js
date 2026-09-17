// tests/p1/notificationCenterSerialization.test.js
// M9 — La sérialisation du centre expose les métadonnées M8 (categorySnapshot/priority/
// persistent/action/templateKey) MAIS PAS variablesSnapshot (privacy). Scopes admin/dev.
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
const ADMIN_IP = '203.0.113.61';

describe('notification center — sérialisation enrichie (M9)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });

  it('expose categorySnapshot/priority/persistent/action/templateKey, jamais variablesSnapshot', async () => {
    await Notification.create({
      title: 'Vente', message: 'Montant 120', targetType: 'all', targetRole: 'admin', eventType: 'new_sale',
      templateKey: 'new_sale', templateVersion: 1, priority: 'high', persistent: true, action: 'refund_details',
      categorySnapshot: { name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#abc' },
      templateRuntimeStatus: 'template',
      variables: { saleId: 'S1', clientEmail: 'secret-client@private.example' },
      variablesSnapshot: { saleId: 'S1' }
    });

    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/notifications').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(res.status).toBe(200);
    const n = res.body.notifications.find(x => x.eventType === 'new_sale');
    expect(n).toBeTruthy();
    expect(n.priority).toBe('high');
    expect(n.persistent).toBe(true);
    expect(n.action).toBe('refund_details');
    expect(n.templateKey).toBe('new_sale');
    expect(n.templateVersion).toBe(1);
    expect(n.categorySnapshot).toMatchObject({ name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#abc' });

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('variablesSnapshot');
    expect(raw).not.toContain('secret-client@private.example');
    expect(raw).not.toContain('templateRuntimeStatus'); // détail interne non exposé
  });

  it('valeurs par défaut sûres quand la notif est legacy (sans champs M8)', async () => {
    await Notification.create({ title: 'Legacy', message: 'm', targetType: 'all', targetRole: 'admin', eventType: 'new_client' });
    const cookie = await login('admin@test.local', ADMIN_IP);
    const res = await agent.get('/api/gestion/notifications').set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    const n = res.body.notifications.find(x => x.eventType === 'new_client');
    expect(n.priority).toBe('normal');
    expect(n.persistent).toBe(false);
    expect(n.categorySnapshot).toBeNull();
    expect(n.action).toBeNull();
  });
});
