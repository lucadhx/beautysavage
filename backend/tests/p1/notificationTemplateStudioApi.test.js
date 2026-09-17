// tests/p1/notificationTemplateStudioApi.test.js
// M7 — Studio notifications (dev-only) : catégories CRUD + templates versioning (draft/publish/
// rollback/archive). Le template ne porte JAMAIS de scope/targetRole. Admin interdit.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import NotificationTemplate from '../../models/NotificationTemplate.js';
import NotificationCategory from '../../models/NotificationCategory.js';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');

let agent;
async function login(email, ip) {
  const r = await agent.post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: TEST_PASSWORD });
  return r.headers['set-cookie'];
}
const DEV_IP = '203.0.113.200';
const ADMIN_IP = '203.0.113.201';
const CAT_BASE = '/api/gestion/dev/notification-categories';
const TPL_BASE = '/api/gestion/dev/notification-templates';

describe('M7 — Notification Studio API', () => {
  beforeAll(async () => { agent = await getAgent(); await Promise.all([NotificationTemplate.syncIndexes(), NotificationCategory.syncIndexes()]); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await Promise.all([NotificationTemplate.syncIndexes(), NotificationCategory.syncIndexes()]); await seedTestData(); });

  it('catégories CRUD (create/list/update/delete) avec slug auto', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const created = await agent.post(CAT_BASE).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ name: 'Paiement', icon: 'bi-cash', color: '#1f7a3a' });
    expect(created.status).toBe(201);
    expect(created.body.category.slug).toBe('paiement');
    const id = created.body.category.id;

    const list = await agent.get(CAT_BASE).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(list.body.categories.length).toBe(1);

    const upd = await agent.put(`${CAT_BASE}/${id}`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ color: '#000000', sortOrder: 5, active: false });
    expect(upd.body.category.color).toBe('#000000');
    expect(upd.body.category.active).toBe(false);

    const del = await agent.delete(`${CAT_BASE}/${id}`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(del.status).toBe(200);
    expect(await NotificationCategory.countDocuments({})).toBe(0);
  });

  it('template : create → draft → publish → rollback, sans scope/targetRole', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    const cat = await agent.post(CAT_BASE).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ name: 'Business' });
    const categoryId = cat.body.category.id;

    const created = await agent.post(`${TPL_BASE}/new_sale`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({
      title: 'Nouvelle vente {{amount}}', body: 'Vente {{saleid}} enregistrée', categoryId,
      variables: ['amount', 'saleid'], priority: 'high', persistent: true, action: 'commission_details',
    });
    expect(created.status).toBe(201);
    expect(created.body.template.status).toBe('published');
    expect(created.body.template.priority).toBe('high');
    expect(created.body.template.persistent).toBe(true);
    expect(created.body.template.action).toBe('commission_details');
    // Jamais de scope/targetRole dans le payload.
    const raw = JSON.stringify(created.body.template);
    expect(raw).not.toMatch(/targetRole|"admin"|"dev"|"both"/);

    const draft = await agent.post(`${TPL_BASE}/new_sale/draft`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ title: 'Vente modifiée {{amount}}' });
    expect(draft.status).toBe(201);
    expect(draft.body.draft.status).toBe('draft');
    expect(draft.body.draft.version).toBe(2);

    const pub = await agent.post(`${TPL_BASE}/drafts/${draft.body.draft.id}/publish`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(pub.body.published.status).toBe('published');
    expect(pub.body.published.version).toBe(2);

    // une seule version publiée
    expect(await NotificationTemplate.countDocuments({ templateKey: 'new_sale', status: 'published' })).toBe(1);

    const versions = await agent.get(`${TPL_BASE}/new_sale/versions`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(versions.body.versions.length).toBe(2);

    const rb = await agent.post(`${TPL_BASE}/new_sale/rollback/1`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(rb.status).toBe(200);
    expect(rb.body.published.version).toBe(3);
    expect(rb.body.published.title).toBe('Nouvelle vente {{amount}}'); // contenu de la v1
  });

  it('liste = 1 ligne par templateKey (version publiée)', async () => {
    const cookie = await login('dev@test.local', DEV_IP);
    await agent.post(`${TPL_BASE}/a_tpl`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ title: 'A', body: 'a' });
    await agent.post(`${TPL_BASE}/b_tpl`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ title: 'B', body: 'b' });
    await agent.post(`${TPL_BASE}/a_tpl/draft`).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP).send({ title: 'A2' });
    const list = await agent.get(TPL_BASE).set('Cookie', cookie).set('X-Forwarded-For', DEV_IP);
    expect(list.body.templates.length).toBe(2);
    expect(list.body.templates.every((t) => t.status === 'published')).toBe(true);
  });

  it('admin interdit sur le studio (templates + catégories)', async () => {
    const cookie = await login('admin@test.local', ADMIN_IP);
    const a = await agent.get(TPL_BASE).set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    const b = await agent.get(CAT_BASE).set('Cookie', cookie).set('X-Forwarded-For', ADMIN_IP);
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
  });
});
