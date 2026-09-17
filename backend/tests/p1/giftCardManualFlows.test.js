// tests/p1/giftCardManualFlows.test.js
// M13 — Cartes cadeaux manuelles (institut, paiement sur place) : création, mode on_site, pas de
// facture Stripe, recipientName obligatoire, transaction manual_issued, QR sûr, débit manuel par
// code/QR avec motif obligatoire, refus si montant > solde, events émis.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData, TEST_PASSWORD } = await import('../setup/seedTestData.js');
const { seedGiftCardTemplates } = await import('../../seeders/seedGiftCardTemplates.js');
const GiftCard = (await import('../../models/GiftCard.js')).default;
const GiftCardTransaction = (await import('../../models/GiftCardTransaction.js')).default;
const Sale = (await import('../../models/Sale.js')).default;
const Invoice = (await import('../../models/Invoice.js')).default;
const EventLog = (await import('../../models/EventLog.js')).default;
const { rotateGiftCardQrToken } = await import('../../services/giftCard/giftCardQrService.js');

let agent;
let fx;

async function login(email) {
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers['set-cookie'];
}

async function createManualCard(cookie, overrides = {}) {
  return agent.post('/api/gestion/gift-cards/manual').set('Cookie', cookie).send({
    customerId: String(fx.client1._id),
    recipientName: 'Camille Martin',
    amount: 80,
    manualPaymentMethod: 'cash',
    manualPaymentNote: 'Réglé en espèces',
    message: 'Joyeux anniversaire',
    ...overrides
  });
}

describe('M13 — cartes cadeaux manuelles', () => {
  beforeAll(async () => { agent = await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); await seedGiftCardTemplates(); });

  it('création manuelle → 201, paymentMode on_site, transaction manual_issued, AUCUNE facture Stripe', async () => {
    const cookie = await login('admin@test.local');
    const res = await createManualCard(cookie);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.giftCard.creationMode).toBe('manual_institute');
    expect(res.body.giftCard.paymentMode).toBe('on_site');
    expect(res.body.giftCard.paymentLabel).toBe('Paiement sur place');
    expect(res.body.giftCard.code).toBeTruthy();
    expect(res.body.giftCard.password).toBeTruthy();

    const card = await GiftCard.findById(res.body.giftCard.id).lean();
    expect(card.balance).toBe(80);
    expect(card.qrTokenHash).toMatch(/^[a-f0-9]{64}$/);
    // Le hash QR ne contient pas le code en clair.
    expect(card.qrTokenHash).not.toContain(card.code);

    const tx = await GiftCardTransaction.findOne({ giftCardId: card._id }).lean();
    expect(tx.transactionType).toBe('manual_issued');
    expect(tx.source).toBe('manual_institute');
    expect(tx.balanceAfter).toBe(80);

    // Pas de Stripe : aucune Sale ni Invoice créée pour cette émission.
    expect(await Sale.countDocuments()).toBe(0);
    expect(await Invoice.countDocuments()).toBe(0);

    // Event métier émis.
    const evt = await EventLog.findOne({ eventName: 'gift_card.manual_created' }).lean();
    expect(evt).toBeTruthy();
  });

  it('recipientName obligatoire → 400', async () => {
    const cookie = await login('admin@test.local');
    const res = await createManualCard(cookie, { recipientName: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECIPIENT_NAME_REQUIRED');
  });

  it('montant invalide → 400', async () => {
    const cookie = await login('admin@test.local');
    const res = await createManualCard(cookie, { amount: 0 });
    expect(res.status).toBe(400);
  });

  it('débit manuel par id : motif obligatoire, preview, refus si > solde, succès', async () => {
    const cookie = await login('admin@test.local');
    const created = await createManualCard(cookie);
    const cardId = created.body.giftCard.id;

    // Motif obligatoire.
    const noReason = await agent.post(`/api/gestion/gift-cards/${cardId}/manual-debit`)
      .set('Cookie', cookie).send({ amount: 10 });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('DEBIT_REASON_REQUIRED');

    // Montant > solde.
    const tooMuch = await agent.post(`/api/gestion/gift-cards/${cardId}/manual-debit`)
      .set('Cookie', cookie).send({ amount: 999, reason: 'Test' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe('GIFT_CARD_BALANCE_INSUFFICIENT');

    // Preview : aucun débit réel.
    const preview = await agent.post(`/api/gestion/gift-cards/${cardId}/manual-debit`)
      .set('Cookie', cookie).send({ amount: 30, reason: 'Prestation', preview: true });
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.balanceAfter).toBe(50);
    expect((await GiftCard.findById(cardId).lean()).balance).toBe(80); // inchangé

    // Débit réel.
    const debit = await agent.post(`/api/gestion/gift-cards/${cardId}/manual-debit`)
      .set('Cookie', cookie).send({ amount: 30, reason: 'Prestation sur place' });
    expect(debit.status).toBe(200);
    expect((await GiftCard.findById(cardId).lean()).balance).toBe(50);
    const tx = await GiftCardTransaction.findOne({ giftCardId: cardId, transactionType: 'manual_debit' }).lean();
    expect(tx.note).toBe('Prestation sur place');
    expect(tx.source).toBe('manual_institute');
    const evt = await EventLog.findOne({ eventName: 'gift_card.manual_debited' }).lean();
    expect(evt).toBeTruthy();
  });

  it('lookup par code (GET) et par QR retrouvent la carte ; QR invalide rejeté', async () => {
    const cookie = await login('admin@test.local');
    // Carte avec QR connu.
    const card = await GiftCard.create({
      code: 'QRLOOKUP01', userId: fx.client1._id, amount: 50, balance: 50, status: 'active'
    });
    const { payload } = rotateGiftCardQrToken(card);
    await card.save();

    const byCode = await agent.get('/api/gestion/gift-cards/lookup?code=QRLOOKUP01').set('Cookie', cookie);
    expect(byCode.status).toBe(200);
    expect(byCode.body.card.code).toBe('QRLOOKUP01');

    const byQr = await agent.post('/api/gestion/gift-cards/lookup-qr').set('Cookie', cookie).send({ qrPayload: payload });
    expect(byQr.status).toBe(200);
    expect(byQr.body.card.code).toBe('QRLOOKUP01');

    const invalid = await agent.post('/api/gestion/gift-cards/lookup-qr').set('Cookie', cookie).send({ qrPayload: 'BSGC.v1.GARBAGE' });
    expect(invalid.status).toBe(404);
    expect(invalid.body.code).toBe('GIFT_CARD_QR_INVALID');
  });
});
