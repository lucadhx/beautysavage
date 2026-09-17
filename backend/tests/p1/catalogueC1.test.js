// tests/p1/catalogueC1.test.js
// C1 — Catalogue Studio : endpoints additifs manager.
//   - Duplication prestation (brouillon, slug unique)
//   - Duplication formation (status draft, nom unique)
//   - GET formation unique (404 si introuvable)
//   - Config cartes cadeaux : maxAmount + presetAmounts (tri/dédup, min>max refusé)
//   - QR de présence session (génération opaque, idempotence, régénération)
//   - Permissions : client refusé sur les endpoints gestion
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const Service = (await import('../../models/Service.js')).default;
const GiftCardConfig = (await import('../../models/GiftCardConfig.js')).default;

let agent;
let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

describe('C1 — Catalogue Studio (endpoints additifs)', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  // ── Duplication prestation ────────────────────────────────────────────────
  it('duplique une prestation en brouillon avec un slug unique', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.post(`/api/gestion/services/${fx.service._id}/duplicate`).set('Cookie', cookie);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.service.name).toContain('(copie)');
    expect(res.body.service.isActive).toBe(false);
    expect(res.body.service.slug).not.toBe(fx.service.slug);
    // La copie existe bien en base.
    const count = await Service.countDocuments({});
    expect(count).toBe(2);
  });

  it('expose balanceSettlementMode (paiement sur place) sur la prestation', async () => {
    const cookie = await login('admin@test.local');
    const upd = await agent.put(`/api/gestion/services/${fx.service._id}`)
      .set('Cookie', cookie)
      .send({ balanceSettlementMode: 'pay_on_site' });
    expect(upd.status).toBe(200);
    expect(upd.body.service.balanceSettlementMode).toBe('pay_on_site');
  });

  it('gère la FAQ prestation (mise à jour manager + exposition sur la fiche vitrine, entrées vides ignorées)', async () => {
    const cookie = await login('admin@test.local');
    const upd = await agent.put(`/api/gestion/services/${fx.service._id}`)
      .set('Cookie', cookie)
      .send({
        faq: [
          { question: 'Faut-il venir démaquillée ?', answer: 'Oui, de préférence.' },
          { question: '', answer: 'ligne ignorée (question vide)' }
        ]
      });
    expect(upd.status).toBe(200);
    expect(upd.body.service.faq).toHaveLength(1);
    expect(upd.body.service.faq[0]).toMatchObject({ question: 'Faut-il venir démaquillée ?', answer: 'Oui, de préférence.' });

    const publicDetail = await agent.get(`/api/vitrine/services/${fx.service.slug}`);
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.service.faq).toHaveLength(1);
    expect(publicDetail.body.service.faq[0].question).toBe('Faut-il venir démaquillée ?');
  });

  it('persiste la galerie prestation (photos via Save) et l’expose sur la fiche vitrine', async () => {
    const cookie = await login('admin@test.local');
    const id = String(fx.service._id);
    const upd = await agent.put(`/api/gestion/services/${id}`)
      .set('Cookie', cookie)
      .send({ photos: ['/uploads/services/cover.jpg', 'https://cdn.test/2.jpg'] });
    expect(upd.status).toBe(200);
    expect(upd.body.service.photos).toEqual(['/uploads/services/cover.jpg', 'https://cdn.test/2.jpg']);

    const pub = await agent.get(`/api/vitrine/services/${fx.service.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.service.photos).toEqual(['/uploads/services/cover.jpg', 'https://cdn.test/2.jpg']);
  });

  it('gère la galerie formation (coverImage + photos) et l’expose sur la fiche vitrine', async () => {
    const cookie = await login('admin@test.local');
    const id = String(fx.formationDistanciel._id);
    const upd = await agent.put(`/api/gestion/formations/${id}`)
      .set('Cookie', cookie)
      .send({ coverImage: '/uploads/formations/cover.jpg', photos: ['/uploads/formations/a.jpg', '/uploads/formations/b.jpg'] });
    expect(upd.status).toBe(200);
    expect(upd.body.formation.photos).toEqual(['/uploads/formations/a.jpg', '/uploads/formations/b.jpg']);

    const pub = await agent.get(`/api/vitrine/formations/${id}`);
    expect(pub.status).toBe(200);
    // La fiche publique fusionne couverture + galerie (couverture en 1re position).
    expect(pub.body.formation.photos).toEqual([
      '/uploads/formations/cover.jpg',
      '/uploads/formations/a.jpg',
      '/uploads/formations/b.jpg'
    ]);
  });

  it('gère la FAQ générale de l’accueil (PUT partiel préserve, exposée en public)', async () => {
    const cookie = await login('admin@test.local');
    const upd = await agent.put('/api/gestion/home-settings')
      .set('Cookie', cookie)
      .send({ faq: [{ question: 'Où êtes-vous situés ?', answer: 'Au centre-ville.' }] });
    expect(upd.status).toBe(200);
    expect(upd.body.settings.faq).toHaveLength(1);

    const pub = await agent.get('/api/vitrine/home-settings');
    expect(pub.status).toBe(200);
    expect(pub.body.settings.faq).toHaveLength(1);
    expect(pub.body.settings.faq[0].answer).toBe('Au centre-ville.');
  });

  // ── Formation : single-get + duplicate ────────────────────────────────────
  it('lit une formation unique et renvoie 404 si absente', async () => {
    const cookie = await login('admin@test.local');
    const ok = await agent.get(`/api/gestion/formations/${fx.formationDistanciel._id}`).set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.formation.id).toBe(String(fx.formationDistanciel._id));

    const missing = await agent.get('/api/gestion/formations/64b000000000000000000000').set('Cookie', cookie);
    expect(missing.status).toBe(404);
  });

  it('duplique une formation en brouillon avec un nom unique', async () => {
    const cookie = await login('admin@test.local');
    const res = await agent.post(`/api/gestion/formations/${fx.formationDistanciel._id}/duplicate`).set('Cookie', cookie);
    expect(res.status).toBe(201);
    expect(res.body.formation.status).toBe('draft');
    expect(res.body.formation.name).toContain('(copie)');
    expect(res.body.formation.id).not.toBe(String(fx.formationDistanciel._id));
  });

  // ── Config cartes cadeaux : montants ──────────────────────────────────────
  it('met à jour maxAmount + presetAmounts (tri/dédup) et refuse min>max', async () => {
    const cookie = await login('admin@test.local');
    const ok = await agent.put('/api/gestion/gift-cards/config').set('Cookie', cookie).send({
      minAmount: 20,
      maxAmount: 500,
      presetAmounts: [50, 100, 50, 30]
    });
    expect(ok.status).toBe(200);
    expect(ok.body.config.maxAmount).toBe(500);
    expect(ok.body.config.presetAmounts).toEqual([30, 50, 100]);

    const bad = await agent.put('/api/gestion/gift-cards/config').set('Cookie', cookie).send({
      minAmount: 600,
      maxAmount: 100
    });
    expect(bad.status).toBe(400);
    // La config valide précédente est conservée.
    const persisted = await GiftCardConfig.findOne({}).lean();
    expect(persisted.minAmount).toBe(20);
  });

  // ── QR de présence session ────────────────────────────────────────────────
  it('génère un QR de session opaque, idempotent, régénérable', async () => {
    const cookie = await login('admin@test.local');
    const base = `/api/gestion/formations/${fx.formationPresentiel._id}/sessions/${fx.formationSession._id}/qr`;

    const first = await agent.post(base).set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body.qr.hasToken).toBe(true);
    expect(first.body.qr.token).toBeTruthy();
    expect(first.body.qr.payload).toBe(`BS-SESSION:${fx.formationSession._id}:${first.body.qr.token}`);

    // Idempotent : même token sans `regenerate`.
    const again = await agent.post(base).set('Cookie', cookie);
    expect(again.body.qr.token).toBe(first.body.qr.token);

    // Régénération : nouveau token.
    const rotated = await agent.post(base).set('Cookie', cookie).send({ regenerate: true });
    expect(rotated.body.qr.token).not.toBe(first.body.qr.token);
  });

  // ── Permissions ───────────────────────────────────────────────────────────
  it('refuse un client sur les endpoints catalogue gestion', async () => {
    const cookie = await login('client1@test.local');
    const dup = await agent.post(`/api/gestion/services/${fx.service._id}/duplicate`).set('Cookie', cookie);
    expect(dup.status).toBeGreaterThanOrEqual(401);
    expect(dup.status).toBeLessThan(404);
  });
});
