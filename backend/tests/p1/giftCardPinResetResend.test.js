// LOT2 §4 — Reset PIN + renvoi carte cadeau.
// Vérifie : nouveau hash (ancien invalidé), pinVersion incrémenté, transaction 'pin_reset'
// journalisée, e-mail renvoyé (event gift_card.pin_reset_and_resent), et SURTOUT que le PIN
// n'est JAMAIS renvoyé par l'API. Rendu PDF + envoi mockés (aucun fichier, aucun envoi réel).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-abcdefghijklmnop';

const h = vi.hoisted(() => ({ mailCalls: [] }));

vi.mock('../../services/giftCard/giftCardRenderService.js', () => ({
  generateGiftCardAssets: vi.fn(async () => ({
    cardVisualUrl: '/storage/giftcards/ex.html',
    generatedPdfUrl: '/storage/giftcards/ex.pdf',
    pdfBase64: 'QUFB',
    pdfFileName: 'ex.pdf',
    templateId: null,
    variables: {},
  })),
  formatGiftCardAmount: (n) => String(n),
}));
vi.mock('../../services/giftCard/giftCardMailService.js', () => ({
  sendGiftCardEventMail: vi.fn(async (a) => { h.mailCalls.push(a); return { event: true, mail: 'sent' }; }),
}));
vi.mock('../../services/giftCard/giftCardTemplateResolver.js', () => ({
  getActiveGiftCardTemplateOrSeed: vi.fn(async () => null),
}));

import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import GiftCard from '../../models/GiftCard.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import User from '../../models/user.js';

const { resetGiftCardPinAndResend } = await import('../../controllers/giftCardController.js');

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

describe('LOT2 — reset PIN carte cadeau', () => {
  let owner;
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await mongoose.disconnect(); await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    h.mailCalls.length = 0;
    owner = await User.create({ email: 'owner@bs.test', firstName: 'Léa', lastName: 'Martin', role: 'client', passwordHash: 'x', passwordSalt: 'x' });
  });

  async function seedCard() {
    return GiftCard.create({
      code: 'BS-GC-TEST1', userId: owner._id, amount: 50, balance: 30,
      status: 'active', recipientName: 'Léa Martin',
      passwordHash: 'OLD_HASH', passwordEncrypted: 'OLD_ENC', pinVersion: 0,
    });
  }

  it('génère un nouveau PIN (ancien invalidé), incrémente pinVersion, journalise, et NE renvoie PAS le PIN', async () => {
    const card = await seedCard();
    const res = mockRes();
    await resetGiftCardPinAndResend({ params: { id: String(card._id) }, sessionUser: { _id: owner._id, role: 'admin' } }, res);

    expect(res.body.ok).toBe(true);
    expect(res.body.pinVersion).toBe(1);
    // SÉCURITÉ : aucun PIN en clair ni hash/chiffré dans la réponse API.
    expect(res.body).not.toHaveProperty('pin');
    expect(res.body).not.toHaveProperty('password');
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('passwordHash');
    expect(bodyStr).not.toContain('passwordEncrypted');
    // le PIN généré (renvoyé à sendGiftCardEventMail) ne doit pas apparaître dans la réponse
    const sentPin = String(h.mailCalls[0]?.variables?.pin || '');
    expect(sentPin.length).toBeGreaterThan(0);
    expect(bodyStr).not.toContain(sentPin);

    const updated = await GiftCard.findById(card._id).lean();
    expect(updated.passwordHash).not.toBe('OLD_HASH'); // ancien hash invalidé
    expect(updated.passwordHash).toBeTruthy();
    expect(updated.pinVersion).toBe(1);
    expect(updated.pinResetAt).toBeTruthy();

    const tx = await GiftCardTransaction.findOne({ giftCardId: card._id, transactionType: 'pin_reset' }).lean();
    expect(tx).toBeTruthy();
    expect(tx.actorRole).toBe('admin');

    // E-mail renvoyé via l'event dédié.
    expect(h.mailCalls).toHaveLength(1);
    expect(h.mailCalls[0].eventName).toBe('gift_card.pin_reset_and_resent');
    expect(h.mailCalls[0].attachment).toBeTruthy();
  });

  it('refuse une carte inactive (409)', async () => {
    const card = await seedCard();
    await GiftCard.updateOne({ _id: card._id }, { status: 'redeemed' });
    const res = mockRes();
    await resetGiftCardPinAndResend({ params: { id: String(card._id) }, sessionUser: { _id: owner._id, role: 'admin' } }, res);
    expect(res.statusCode).toBe(409);
    expect(h.mailCalls).toHaveLength(0);
  });

  it('refuse un id invalide (400)', async () => {
    const res = mockRes();
    await resetGiftCardPinAndResend({ params: { id: 'not-an-id' }, sessionUser: { _id: owner._id, role: 'admin' } }, res);
    expect(res.statusCode).toBe(400);
  });
});
