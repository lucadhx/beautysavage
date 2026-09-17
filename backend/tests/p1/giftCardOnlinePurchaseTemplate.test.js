// tests/p1/giftCardOnlinePurchaseTemplate.test.js
// GC-TPL-AUDIT — L'achat en ligne (Stripe) utilise le MÊME pipeline que le manuel :
//  - template actif résolu + figé (activeTemplateId) ;
//  - QR réel + PDF généré + carte persistée ;
//  - event gift_card.online_created émis SANS secret (pas de mot de passe / token en clair) ;
//  - Brevo non configuré en test → aucun mail réel envoyé.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const { seedTestData } = await import('../setup/seedTestData.js');
const GiftCard = (await import('../../models/GiftCard.js')).default;
const GiftCardTemplate = (await import('../../models/GiftCardTemplate.js')).default;
const EventLog = (await import('../../models/EventLog.js')).default;
const { ensureDefaultGiftCardTemplate } = await import('../../services/giftCard/giftCardTemplateSeedService.js');
const { createGiftCardForPurchase } = await import('../../controllers/giftCardController.js');

let fx;

describe('GC-TPL-AUDIT — achat carte cadeau en ligne', () => {
  beforeAll(async () => { await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); fx = await seedTestData(); });

  it('achat online → template actif figé, QR réel, PDF, event online_created sans secret', async () => {
    const seed = await ensureDefaultGiftCardTemplate();

    const { giftCard } = await createGiftCardForPurchase({
      userId: fx.client1._id,
      amount: 60,
      enforceMinAmount: false,
      recipientName: 'Camille Martin',
      message: 'Pour toi'
    });

    const card = await GiftCard.findById(giftCard._id).lean();
    // Template actif figé sur la carte (même pipeline que manuel).
    expect(card.activeTemplateId?.toString()).toBe(seed.templateId);
    // QR réel : hash présent, jamais le code en clair.
    expect(card.qrTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(card.qrTokenHash).not.toContain(card.code);
    // PDF + visuel générés depuis le template.
    expect(card.generatedPdfUrl).toMatch(/\.pdf$/);
    expect(card.cardVisualUrl).toMatch(/\.html$/);
    expect(card.recipientName).toBe('Camille Martin');

    // Event émis SANS secret (mot de passe / token opaque).
    const evt = await EventLog.findOne({ eventName: 'gift_card.online_created' }).lean();
    expect(evt).toBeTruthy();
    const serialized = JSON.stringify(evt);
    expect(serialized).not.toContain(card.code);
  });

  it('aucun template actif au moment de l\'achat → resolver seed puis fige le template seedé', async () => {
    expect(await GiftCardTemplate.countDocuments()).toBe(0);
    const { giftCard } = await createGiftCardForPurchase({
      userId: fx.client1._id,
      amount: 50,
      enforceMinAmount: false
    });
    const card = await GiftCard.findById(giftCard._id).lean();
    expect(card.activeTemplateId).toBeTruthy();
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });
});
