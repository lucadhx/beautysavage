// tests/p1/learningC3.test.js
// C3 — Attestation PDF, modération avis, reorder chapitres/leçons.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Purchase = (await import('../../models/Purchase.js')).default;
const Review = (await import('../../models/Review.js')).default;
const Chapter = (await import('../../models/Chapter.js')).default;

let agent;
let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('C3 — Learning completion', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  // ── Attestation ────────────────────────────────────────────────────────────
  it('attestation : 409 si non terminée, PDF si terminée, idempotent', async () => {
    const adminCookie = await login('admin@test.local');
    const clientCookie = await login('client1@test.local');
    const fid = String(fx.formationDistanciel._id);

    // Achat + chapitre + leçon (non terminée)
    const ch = await agent.post(`/api/gestion/learning/formations/${fid}/chapters`).set('Cookie', adminCookie).send({ title: 'C1' });
    await agent.post(`/api/gestion/learning/formations/${fid}/lessons`).set('Cookie', adminCookie).send({ chapterId: ch.body.chapter.id, title: 'L1', videoUrl: 'https://youtu.be/a' });
    await Purchase.create({ userId: fx.client1._id, formationId: fx.formationDistanciel._id, itemId: fx.formationDistanciel._id, itemType: 'formation', paymentRef: 'PR-C3', paymentStatus: 'paid', participationStatus: 'active', sessionId: null });

    const notDone = await agent.get(`/api/client/learning/formations/${fid}/attestation`).set('Cookie', clientCookie);
    expect(notDone.status).toBe(409);
    expect(notDone.body.code).toBe('NOT_COMPLETED');

    // Termine la formation
    const lessons = await agent.get(`/api/gestion/learning/formations/${fid}/tree`).set('Cookie', adminCookie);
    await agent.post(`/api/client/learning/lessons/${lessons.body.lessons[0].id}/complete`).set('Cookie', clientCookie);

    const pdf = await agent.get(`/api/client/learning/formations/${fid}/attestation`).set('Cookie', clientCookie);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('attestation-');

    // Idempotent : le manager récupère la MÊME attestation (200 PDF)
    const mgr = await agent.get(`/api/gestion/learning/customers/${fx.client1._id}/formations/${fid}/attestation`).set('Cookie', adminCookie);
    expect(mgr.status).toBe(200);
    expect(mgr.headers['content-type']).toContain('application/pdf');
  });

  it('attestation : refuse un client sans achat (403)', async () => {
    const clientCookie = await login('client1@test.local');
    const fid = String(fx.formationDistanciel._id);
    const res = await agent.get(`/api/client/learning/formations/${fid}/attestation`).set('Cookie', clientCookie);
    expect(res.status).toBe(403);
  });

  // ── Modération avis ─────────────────────────────────────────────────────────
  it('modération : rejeter un avis le masque de la vitrine', async () => {
    const adminCookie = await login('admin@test.local');
    const fid = String(fx.formationDistanciel._id);
    const r = await Review.create({ userId: fx.client1._id, formationId: fx.formationDistanciel._id, rating: 5, comment: 'Super', status: 'published' });

    // Vitrine : visible
    let stats = await agent.get(`/api/vitrine/formations/${fid}/reviews/stats`);
    expect(stats.body.reviewCount).toBe(1);

    // Modération : liste + reject
    const list = await agent.get('/api/gestion/learning/reviews').set('Cookie', adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.reviews.length).toBe(1);

    const mod = await agent.patch(`/api/gestion/learning/reviews/${r._id}`).set('Cookie', adminCookie).send({ status: 'rejected' });
    expect(mod.status).toBe(200);

    // Vitrine : masqué
    stats = await agent.get(`/api/vitrine/formations/${fid}/reviews/stats`);
    expect(stats.body.reviewCount).toBe(0);
    const reviews = await agent.get(`/api/vitrine/formations/${fid}/reviews`);
    expect(reviews.body.reviews.length).toBe(0);
  });

  it('modération : avis legacy sans statut reste visible', async () => {
    const fid = String(fx.formationDistanciel._id);
    // Insertion brute sans le champ status (legacy)
    await Review.collection.insertOne({ userId: fx.client1._id, formationId: fx.formationDistanciel._id, rating: 4, comment: 'Legacy', createdAt: new Date() });
    const stats = await agent.get(`/api/vitrine/formations/${fid}/reviews/stats`);
    expect(stats.body.reviewCount).toBe(1);
  });

  it('modération : refuse le client', async () => {
    const clientCookie = await login('client1@test.local');
    const res = await agent.get('/api/gestion/learning/reviews').set('Cookie', clientCookie);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(404);
  });

  // ── Reorder ──────────────────────────────────────────────────────────────────
  it('reorder : l\'ordre des chapitres persiste', async () => {
    const adminCookie = await login('admin@test.local');
    const fid = String(fx.formationDistanciel._id);
    const a = await agent.post(`/api/gestion/learning/formations/${fid}/chapters`).set('Cookie', adminCookie).send({ title: 'A' });
    const b = await agent.post(`/api/gestion/learning/formations/${fid}/chapters`).set('Cookie', adminCookie).send({ title: 'B' });
    // Inverser l'ordre
    const reord = await agent.put(`/api/gestion/learning/formations/${fid}/chapters/reorder`).set('Cookie', adminCookie).send({ orderedChapterIds: [b.body.chapter.id, a.body.chapter.id] });
    expect(reord.status).toBe(200);
    const chB = await Chapter.findById(b.body.chapter.id).lean();
    const chA = await Chapter.findById(a.body.chapter.id).lean();
    expect(chB.order).toBe(1);
    expect(chA.order).toBe(2);
  });
});
