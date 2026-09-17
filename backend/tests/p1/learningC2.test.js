// tests/p1/learningC2.test.js
// C2 — Learning Studio + progression + présence.
//   - Manager : chapitres/leçons CRUD (formation distancielle), reorder
//   - Client : accès gated (Purchase), lecture parcours, complétion leçon → progression %
//   - Progression : computeProgress pur
//   - Présence : participants, mark, scan QR (token opaque), permissions
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Purchase = (await import('../../models/Purchase.js')).default;
const Chapter = (await import('../../models/Chapter.js')).default;
const Lesson = (await import('../../models/Lesson.js')).default;
const FormationProgress = (await import('../../models/FormationProgress.js')).default;
const { computeProgress } = await import('../../services/learning/progressionService.js');

let agent;
let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('C2 — Learning Studio', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('computeProgress calcule % chapitre et formation (leçons cachées ignorées)', () => {
    const chapters = [{ _id: 'c1', visible: true }, { _id: 'c2', visible: true }];
    const lessons = [
      { _id: 'l1', chapterId: 'c1', visible: true },
      { _id: 'l2', chapterId: 'c1', visible: true },
      { _id: 'l3', chapterId: 'c2', visible: true },
      { _id: 'l4', chapterId: 'c2', visible: false } // cachée → ignorée
    ];
    const r = computeProgress(chapters, lessons, ['l1', 'l3']);
    expect(r.formation.total).toBe(3);
    expect(r.formation.done).toBe(2);
    expect(r.formation.pct).toBe(67);
    const c1 = r.chapters.find(c => c.chapterId === 'c1');
    expect(c1.pct).toBe(50);
  });


  it('crée chapitre + leçon sur une formation distancielle', async () => {
    const cookie = await login('admin@test.local');
    const fid = String(fx.formationDistanciel._id);

    const ch = await agent.post(`/api/gestion/learning/formations/${fid}/chapters`).set('Cookie', cookie).send({ title: 'Chapitre 1' });
    expect(ch.status).toBe(201);
    const chapterId = ch.body.chapter.id;

    const le = await agent.post(`/api/gestion/learning/formations/${fid}/lessons`).set('Cookie', cookie).send({
      chapterId, title: 'Leçon 1', videoUrl: 'https://youtu.be/abc', estimatedMinutes: 10,
      resources: [{ name: 'Support', type: 'pdf', url: 'https://x/y.pdf' }]
    });
    expect(le.status).toBe(201);
    expect(le.body.lesson.resources.length).toBe(1);

    const tree = await agent.get(`/api/gestion/learning/formations/${fid}/tree`).set('Cookie', cookie);
    expect(tree.body.chapters.length).toBe(1);
    expect(tree.body.lessons.length).toBe(1);
  });

  it('refuse un chapitre sur une formation présentielle (distanciel only)', async () => {
    const cookie = await login('admin@test.local');
    const fid = String(fx.formationPresentiel._id);
    const ch = await agent.post(`/api/gestion/learning/formations/${fid}/chapters`).set('Cookie', cookie).send({ title: 'X' });
    expect(ch.status).toBe(404);
  });


  async function buildTree(adminCookie, fid) {
    const ch = await agent.post(`/api/gestion/learning/formations/${fid}/chapters`).set('Cookie', adminCookie).send({ title: 'C1' });
    const chapterId = ch.body.chapter.id;
    const l1 = await agent.post(`/api/gestion/learning/formations/${fid}/lessons`).set('Cookie', adminCookie).send({ chapterId, title: 'L1', videoUrl: 'https://youtu.be/a' });
    const l2 = await agent.post(`/api/gestion/learning/formations/${fid}/lessons`).set('Cookie', adminCookie).send({ chapterId, title: 'L2', videoUrl: 'https://youtu.be/b' });
    return { l1: l1.body.lesson.id, l2: l2.body.lesson.id };
  }

  it('client sans achat → 403 ; avec achat → 200 + complétion progresse', async () => {
    const adminCookie = await login('admin@test.local');
    const fid = String(fx.formationDistanciel._id);
    const { l1, l2 } = await buildTree(adminCookie, fid);

    const clientCookie = await login('client1@test.local');
    // Pas d'achat encore → 403
    const denied = await agent.get(`/api/client/learning/formations/${fid}`).set('Cookie', clientCookie);
    expect(denied.status).toBe(403);

    // Achat distanciel
    await Purchase.create({ userId: fx.client1._id, formationId: fx.formationDistanciel._id, itemId: fx.formationDistanciel._id, itemType: 'formation', paymentRef: 'PR-TEST-' + Math.random().toString(36).slice(2), paymentStatus: 'paid', participationStatus: 'active', sessionId: null });

    const ok = await agent.get(`/api/client/learning/formations/${fid}`).set('Cookie', clientCookie);
    expect(ok.status).toBe(200);
    expect(ok.body.lessons.length).toBe(2);
    expect(ok.body.progress.formationPct).toBe(0);

    // Termine L1 → 50%
    const c1 = await agent.post(`/api/client/learning/lessons/${l1}/complete`).set('Cookie', clientCookie);
    expect(c1.status).toBe(200);
    expect(c1.body.progress.formationPct).toBe(50);

    // Termine L2 → 100% + completedAt
    const c2 = await agent.post(`/api/client/learning/lessons/${l2}/complete`).set('Cookie', clientCookie);
    expect(c2.body.progress.formationPct).toBe(100);
    expect(c2.body.progress.completedAt).toBeTruthy();

    // Idempotent : re-compléter ne casse pas
    const again = await agent.post(`/api/client/learning/lessons/${l1}/complete`).set('Cookie', clientCookie);
    expect(again.body.progress.formationPct).toBe(100);

    const prog = await FormationProgress.findOne({ userId: fx.client1._id, formationId: fx.formationDistanciel._id }).lean();
    expect(prog.completedLessonIds.length).toBe(2);
  });

  it('liste mes formations distancielles avec %', async () => {
    const adminCookie = await login('admin@test.local');
    const fid = String(fx.formationDistanciel._id);
    await buildTree(adminCookie, fid);
    await Purchase.create({ userId: fx.client1._id, formationId: fx.formationDistanciel._id, itemId: fx.formationDistanciel._id, itemType: 'formation', paymentRef: 'PR-TEST-' + Math.random().toString(36).slice(2), paymentStatus: 'paid', participationStatus: 'active', sessionId: null });
    const clientCookie = await login('client1@test.local');
    const res = await agent.get('/api/client/learning/formations').set('Cookie', clientCookie);
    expect(res.status).toBe(200);
    expect(res.body.formations.length).toBe(1);
    expect(res.body.formations[0].progressPct).toBe(0);
  });


  it('participant → token → scan institut → présent', async () => {
    const sid = String(fx.formationSession._id);
    // Le client a réservé la session présentielle
    await Purchase.create({ userId: fx.client1._id, formationId: fx.formationPresentiel._id, itemId: fx.formationPresentiel._id, itemType: 'formation', paymentRef: 'PR-TEST-' + Math.random().toString(36).slice(2), paymentStatus: 'paid', participationStatus: 'active', sessionId: fx.formationSession._id });

    const clientCookie = await login('client1@test.local');
    const tok = await agent.get(`/api/client/learning/sessions/${sid}/attendance-token`).set('Cookie', clientCookie);
    expect(tok.status).toBe(200);
    expect(tok.body.attendance.token).toBeTruthy();
    expect(tok.body.attendance.payload).toContain('BS-PRESENCE:');

    const adminCookie = await login('admin@test.local');
    const list = await agent.get(`/api/gestion/learning/sessions/${sid}/participants`).set('Cookie', adminCookie);
    expect(list.status).toBe(200);
    expect(list.body.participants.length).toBe(1);
    expect(list.body.participants[0].status).toBe('pending');

    // Scan du payload complet
    const scan = await agent.post(`/api/gestion/learning/sessions/${sid}/scan`).set('Cookie', adminCookie).send({ token: tok.body.attendance.payload });
    expect(scan.status).toBe(200);
    expect(scan.body.participant.status).toBe('present');

    const after = await agent.get(`/api/gestion/learning/sessions/${sid}/participants`).set('Cookie', adminCookie);
    expect(after.body.participants[0].status).toBe('present');
    expect(after.body.summary.present).toBe(1);

    // QR invalide → 404
    const bad = await agent.post(`/api/gestion/learning/sessions/${sid}/scan`).set('Cookie', adminCookie).send({ token: 'BS-PRESENCE:' + sid + ':deadbeef' });
    expect(bad.status).toBe(404);
  });

  it('refuse le client sur les endpoints présence manager', async () => {
    const sid = String(fx.formationSession._id);
    const clientCookie = await login('client1@test.local');
    const res = await agent.get(`/api/gestion/learning/sessions/${sid}/participants`).set('Cookie', clientCookie);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(404);
  });
});
