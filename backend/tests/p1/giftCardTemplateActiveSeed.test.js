// tests/p1/giftCardTemplateActiveSeed.test.js
// GC-TPL-AUDIT — Garantie "toujours exactement un template actif".
//  - premier boot sans template → seed BeautySavage Classic actif ;
//  - templates existants sans actif → un actif garanti (activation, pas de doublon) ;
//  - idempotence, non destructif ;
//  - impossible d'avoir zéro actif (resolver seed + assert).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const GiftCardTemplate = (await import('../../models/GiftCardTemplate.js')).default;
const {
  ensureDefaultGiftCardTemplate,
  DEFAULT_GIFT_CARD_TEMPLATE_SLUG
} = await import('../../services/giftCard/giftCardTemplateSeedService.js');
const {
  getActiveGiftCardTemplate,
  getActiveGiftCardTemplateOrSeed,
  assertActiveGiftCardTemplate
} = await import('../../services/giftCard/giftCardTemplateResolver.js');

describe('GC-TPL-AUDIT — seed / garantie template actif', () => {
  beforeAll(async () => { await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('premier boot sans template → seed BeautySavage Classic actif publié visible', async () => {
    expect(await GiftCardTemplate.countDocuments()).toBe(0);
    const result = await ensureDefaultGiftCardTemplate();
    expect(result.seeded).toBe(true);
    expect(result.activated).toBe(true);
    expect(result.slug).toBe(DEFAULT_GIFT_CARD_TEMPLATE_SLUG);

    const active = await GiftCardTemplate.findOne({ active: true }).lean();
    expect(active).toBeTruthy();
    expect(active.name).toBe('BeautySavage Classic');
    expect(active.status).toBe('published');
    expect(active.visible).toBe(true);
    expect(active.isSystemDefault).toBe(true);
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });

  it('idempotent : 2e appel = no-op, toujours exactement un actif', async () => {
    const first = await ensureDefaultGiftCardTemplate();
    const second = await ensureDefaultGiftCardTemplate();
    expect(second.seeded).toBe(false);
    expect(second.activated).toBe(false);
    expect(second.reason).toBe('active_exists');
    expect(second.templateId).toBe(first.templateId);
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });

  it('templates existants mais aucun actif → active le meilleur candidat (sans créer de doublon)', async () => {
    const custom = await GiftCardTemplate.create({
      name: 'Noël',
      slug: 'noel',
      html: '<div>{{amount}}</div>',
      visible: true,
      active: false,
      status: 'published',
      publishedAt: new Date()
    });
    const before = await GiftCardTemplate.countDocuments();

    const result = await ensureDefaultGiftCardTemplate();
    expect(result.seeded).toBe(false);
    expect(result.activated).toBe(true);
    expect(result.reason).toBe('activated_existing');
    // Aucun template créé (pas de seed du défaut) — on a activé l'existant.
    expect(await GiftCardTemplate.countDocuments()).toBe(before);
    expect(result.templateId).toBe(custom._id.toString());
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });

  it('ne désactive jamais un actif existant', async () => {
    const first = await ensureDefaultGiftCardTemplate();
    await ensureDefaultGiftCardTemplate();
    const active = await getActiveGiftCardTemplate();
    expect(active._id.toString()).toBe(first.templateId);
  });

  it('resolver : OrSeed garantit un template, assert ne throw jamais quand seed possible', async () => {
    expect(await getActiveGiftCardTemplate()).toBeNull();
    const seeded = await getActiveGiftCardTemplateOrSeed();
    expect(seeded).toBeTruthy();
    expect(seeded.active).toBe(true);
    const asserted = await assertActiveGiftCardTemplate();
    expect(asserted._id.toString()).toBe(seeded._id.toString());
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });
});
