// tests/p1/giftCardTemplateNoHardcodedPdf.test.js
// GC-TPL-AUDIT — Aucune carte n'est rendue depuis un template codé en dur quand un template ACTIF
// existe : le HTML rendu contient le markup UNIQUE du template actif et jamais un fallback vide.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const GiftCardTemplate = (await import('../../models/GiftCardTemplate.js')).default;
const {
  ensureDefaultGiftCardTemplate
} = await import('../../services/giftCard/giftCardTemplateSeedService.js');
const { activateGiftCardTemplate } = await import('../../services/giftCard/giftCardTemplateService.js');
const { generateGiftCardAssets } = await import('../../services/giftCard/giftCardRenderService.js');

const giftCardFixture = {
  _id: '507f1f77bcf86cd799439099',
  recipientName: 'Nadia',
  purchaserName: 'Sam',
  amount: 120,
  message: 'Bravo'
};

const UNIQUE_MARKER = 'bs-unique-marker-9f3a';

describe('GC-TPL-AUDIT — pas de PDF/HTML codé en dur si template actif', () => {
  beforeAll(async () => { await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('le rendu reflète le template actif (markup unique), jamais un template générique', async () => {
    await ensureDefaultGiftCardTemplate();
    // Un template custom devient l'actif (avec un marqueur HTML impossible à confondre).
    const custom = await GiftCardTemplate.create({
      name: 'Custom Actif',
      slug: 'custom-actif',
      html: `<section class="${UNIQUE_MARKER}">{{amount}} — {{recipientName}}</section>`,
      css: '.x{}',
      visible: true,
      active: false,
      status: 'published',
      publishedAt: new Date()
    });
    await activateGiftCardTemplate(custom._id.toString(), 'test');

    const assets = await generateGiftCardAssets(giftCardFixture, { code: 'C1', pin: 'P1' });

    // Le HTML vient bien du template ACTIF (marqueur unique + variables), pas d'un fallback vide.
    expect(assets.html).toContain(UNIQUE_MARKER);
    expect(assets.html).toContain('Nadia');
    expect(assets.templateId?.toString()).toBe(custom._id.toString());
    // Le défaut système seedé n'est PAS celui utilisé.
    expect(assets.html).not.toContain('bsgc-card');
  });

  it('template explicite passé au render → prioritaire sur l\'actif (aucun hardcode)', async () => {
    await ensureDefaultGiftCardTemplate();
    const explicit = {
      _id: '507f1f77bcf86cd7994390aa',
      html: `<article class="${UNIQUE_MARKER}-explicit">{{code}}</article>`,
      css: ''
    };
    const assets = await generateGiftCardAssets(giftCardFixture, { code: 'ZZ9', pin: 'P', template: explicit });
    expect(assets.html).toContain(`${UNIQUE_MARKER}-explicit`);
    expect(assets.html).toContain('ZZ9');
    expect(assets.templateId?.toString()).toBe(explicit._id);
  });
});
