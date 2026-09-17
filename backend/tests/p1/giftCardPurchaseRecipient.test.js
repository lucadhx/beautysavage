// tests/p1/giftCardPurchaseRecipient.test.js
// RX3 S4 — L'achat de carte cadeau en ligne (React) persiste le bénéficiaire (recipientName/message)
// sur la carte. Champs additifs M13 (jusqu'ici remplis seulement par le flux manuel). Additif, aucun
// e-mail bénéficiaire (non modélisé). La carte est créée AU PAIEMENT (createGiftCardForPurchase).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const { startMemoryDb, stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const GiftCard = (await import('../../models/GiftCard.js')).default;
const GiftCardConfig = (await import('../../models/GiftCardConfig.js')).default;
const { createGiftCardForPurchase } = await import('../../controllers/giftCardController.js');

describe('createGiftCardForPurchase — bénéficiaire (RX3 S4)', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => {
    await stopMemoryDb();
  });
  beforeEach(async () => {
    await clearDatabase();
    await GiftCardConfig.create({ minAmount: 20 });
  });

  it('persiste recipientName + message sur la carte créée', async () => {
    const userId = new mongoose.Types.ObjectId();
    const { giftCard } = await createGiftCardForPurchase({
      userId,
      amount: 60,
      recipientName: '  Camille  ',
      message: '  Joyeux anniversaire !  '
    });
    const saved = await GiftCard.findById(giftCard._id).lean();
    expect(saved.recipientName).toBe('Camille'); // trim
    expect(saved.message).toBe('Joyeux anniversaire !');
    expect(saved.amount).toBe(60);
    expect(saved.balance).toBe(60);
  });

  it('bénéficiaire absent → champs vides (par défaut), aucune régression', async () => {
    const { giftCard } = await createGiftCardForPurchase({ userId: new mongoose.Types.ObjectId(), amount: 40 });
    const saved = await GiftCard.findById(giftCard._id).lean();
    expect(saved.recipientName).toBe('');
    expect(saved.message).toBe('');
  });

  it('borne la longueur du message (anti-abus)', async () => {
    const { giftCard } = await createGiftCardForPurchase({
      userId: new mongoose.Types.ObjectId(),
      amount: 40,
      message: 'x'.repeat(900)
    });
    const saved = await GiftCard.findById(giftCard._id).lean();
    expect(saved.message.length).toBe(500);
  });
});
