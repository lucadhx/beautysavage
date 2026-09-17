// tests/p1/giftCardManualTemplateSelection.test.js
// GC-TPL-AUDIT — Flux manuel (institut, paiement sur place) & sélection du template :
//  - sans templateId → template ACTIF utilisé, PDF attaché, "Paiement sur place" ;
//  - avec templateId explicite (publié) → CE template est figé sur la carte ;
//  - transaction manual_issued inchangée (aucune Sale/Invoice Stripe).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const { seedGiftCardTemplates } = await import('../../seeders/seedGiftCardTemplates.js');
const GiftCard = (await import('../../models/GiftCard.js')).default;
const GiftCardTemplate = (await import('../../models/GiftCardTemplate.js')).default;
const GiftCardTransaction = (await import('../../models/GiftCardTransaction.js')).default;
const Sale = (await import('../../models/Sale.js')).default;

let agent;
let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

function manualBody(overrides = {}) {
  return {
    customerId: String(fx.client1._id),
    recipientName: 'Camille Martin',
    amount: 80,
    manualPaymentMethod: 'cash',
    manualPaymentNote: 'Réglé en espèces',
    message: 'Joyeux anniversaire',
    ...overrides
  };
}

describe('GC-TPL-AUDIT — flux manuel & sélection template', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); await seedGiftCardTemplates(); });

  it('sans templateId → template ACTIF figé, PDF attaché, paiement sur place, manual_issued', async () => {
    const cookie = await login('admin@test.local');
    const active = await GiftCardTemplate.findOne({ active: true }).lean();

    const res = await agent.post('/api/gestion/gift-cards/manual').set('Cookie', cookie).send(manualBody());
    expect(res.status).toBe(201);
    expect(res.body.giftCard.paymentLabel).toBe('Paiement sur place');
    expect(res.body.giftCard.generatedPdfUrl).toMatch(/\.pdf$/);

    const card = await GiftCard.findById(res.body.giftCard.id).lean();
    expect(card.activeTemplateId.toString()).toBe(active._id.toString());

    const tx = await GiftCardTransaction.findOne({ giftCardId: card._id }).lean();
    expect(tx.transactionType).toBe('manual_issued');
    expect(await Sale.countDocuments()).toBe(0);
  });

  it('avec templateId explicite (publié) → ce template est figé sur la carte', async () => {
    const cookie = await login('admin@test.local');
    const custom = await GiftCardTemplate.create({
      name: 'Édition Noël',
      slug: 'edition-noel',
      html: '<div class="xmas">{{amount}} {{recipientName}}</div>',
      visible: true,
      active: false,
      status: 'published',
      publishedAt: new Date()
    });

    const res = await agent
      .post('/api/gestion/gift-cards/manual')
      .set('Cookie', cookie)
      .send(manualBody({ templateId: String(custom._id) }));
    expect(res.status).toBe(201);

    const card = await GiftCard.findById(res.body.giftCard.id).lean();
    expect(card.activeTemplateId.toString()).toBe(custom._id.toString());
  });

  it('templateId non publié → 404 (pas de rendu depuis un template invalide)', async () => {
    const cookie = await login('admin@test.local');
    const draft = await GiftCardTemplate.create({
      name: 'Brouillon', slug: 'brouillon', html: '<div>{{amount}}</div>',
      visible: true, active: false, status: 'draft'
    });
    const res = await agent
      .post('/api/gestion/gift-cards/manual')
      .set('Cookie', cookie)
      .send(manualBody({ templateId: String(draft._id) }));
    expect(res.status).toBe(404);
  });
});
