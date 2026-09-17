// tests/p1/giftCardTemplateStudio.test.js
// M13 — Gift Card Template Studio : seed du template par défaut, règle "toujours un actif",
// archive de l'actif interdite, sélection de l'actif, versioning, et accès dev-only.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const { seedGiftCardTemplates } = await import('../../seeders/seedGiftCardTemplates.js');
const GiftCardTemplate = (await import('../../models/GiftCardTemplate.js')).default;
const {
  createGiftCardTemplate,
  activateGiftCardTemplate,
  archiveTemplate,
  createDraftFromPublished,
  publishDraft,
  getActiveGiftCardTemplate
} = await import('../../services/giftCard/giftCardTemplateService.js');

let agent;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('M13 — Gift Card Template Studio', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); await seedTestData(); });

  it('seed crée un template par défaut ACTIF (idempotent)', async () => {
    const first = await seedGiftCardTemplates();
    expect(first.activated).toBe(true);
    const second = await seedGiftCardTemplates();
    expect(second.reason).toBe('active_exists'); // no-op au 2e appel
    const activeCount = await GiftCardTemplate.countDocuments({ active: true });
    expect(activeCount).toBe(1);
  });

  it('impossible d\'avoir zéro template actif : on ne peut pas archiver l\'actif', async () => {
    await seedGiftCardTemplates();
    const active = await getActiveGiftCardTemplate();
    await expect(archiveTemplate(active._id)).rejects.toMatchObject({ code: 'TEMPLATE_ACTIVE_LOCKED' });
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });

  it('sélection de l\'actif : un seul actif à la fois', async () => {
    await seedGiftCardTemplates();
    const created = await createGiftCardTemplate({ name: 'Noël', html: '<div>{{amount}}</div>' }, 'dev@test');
    await activateGiftCardTemplate(created.id, 'dev@test');
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
    const active = await getActiveGiftCardTemplate();
    expect(active._id.toString()).toBe(created.id);
  });

  it('versioning : draft → publish archive l\'ancien publié et conserve l\'actif', async () => {
    await seedGiftCardTemplates();
    const active = await getActiveGiftCardTemplate();
    const draft = await createDraftFromPublished(active.slug, { html: '<div>v2 {{amount}}</div>' }, 'dev@test');
    expect(draft.status).toBe('draft');
    const published = await publishDraft(draft.id, 'dev@test');
    expect(published.status).toBe('published');
    expect(published.active).toBe(true); // l'actif suit la dernière version publiée
    // L'ancien publié est archivé.
    const archived = await GiftCardTemplate.find({ slug: active.slug, status: 'archived' }).lean();
    expect(archived.length).toBe(1);
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });

  it('studio dev-only : admin refusé (403), dev autorisé (200)', async () => {
    await seedGiftCardTemplates();
    const adminCookie = await login('admin@test.local');
    const devCookie = await login('dev@test.local');

    const adminRes = await agent.get('/api/gestion/dev/gift-card-templates').set('Cookie', adminCookie);
    expect(adminRes.status).toBe(403);

    const devRes = await agent.get('/api/gestion/dev/gift-card-templates').set('Cookie', devCookie);
    expect(devRes.status).toBe(200);
    expect(devRes.body.ok).toBe(true);
    expect(Array.isArray(devRes.body.templates)).toBe(true);
  });

  it('librairie admin : admin peut lister et activer un template', async () => {
    await seedGiftCardTemplates();
    const created = await createGiftCardTemplate({ name: 'Saint-Valentin', html: '<div>{{amount}}</div>' }, 'dev@test');
    const adminCookie = await login('admin@test.local');

    const listRes = await agent.get('/api/gestion/gift-cards/templates').set('Cookie', adminCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.templates.length).toBeGreaterThanOrEqual(2);

    const activateRes = await agent
      .post(`/api/gestion/gift-cards/templates/${created.id}/activate`)
      .set('Cookie', adminCookie);
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.template.active).toBe(true);
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });
});
