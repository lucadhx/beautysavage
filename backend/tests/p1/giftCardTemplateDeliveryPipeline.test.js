// tests/p1/giftCardTemplateDeliveryPipeline.test.js
// GC-TPL-AUDIT — Pipeline officiel : GiftCard → template actif → HTML → PDF → (attachment).
//  - le PDF/HTML viennent du template ACTIF ;
//  - variables résolues (recipientName, amount, code, pin, message, instituteName...) ;
//  - QR RÉEL dans le rendu final ; QR FACTICE en preview studio (jamais le vrai token).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const { getAgent } = await import('../setup/testApp.js');
const { stopMemoryDb, clearDatabase } = await import('../setup/testDb.js');
const GiftCardTemplate = (await import('../../models/GiftCardTemplate.js')).default;
const { ensureDefaultGiftCardTemplate } = await import('../../services/giftCard/giftCardTemplateSeedService.js');
const { generateGiftCardQrPayload } = await import('../../services/giftCard/giftCardQrService.js');
const {
  generateGiftCardAssets,
  renderGiftCardPreview,
  buildGiftCardVariables
} = await import('../../services/giftCard/giftCardRenderService.js');

const giftCardFixture = {
  _id: '507f1f77bcf86cd799439011',
  recipientName: 'Camille Martin',
  purchaserName: 'Léa Dubois',
  amount: 80,
  message: 'Joyeux anniversaire',
  paymentLabel: 'Paiement sur place',
  purchasedAt: new Date('2026-06-30')
};

describe('GC-TPL-AUDIT — pipeline de rendu carte cadeau', () => {
  beforeAll(async () => { await getAgent(); });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => { await clearDatabase(); });

  it('génère HTML + PDF depuis le template actif, variables résolues, QR réel présent', async () => {
    const seed = await ensureDefaultGiftCardTemplate();
    const qrPayload = generateGiftCardQrPayload({ token: 'REAL_TOKEN_ABC123' });

    const assets = await generateGiftCardAssets(giftCardFixture, {
      code: 'A3F2B9E1',
      pin: 'K7M2P9QXTV',
      qrPayload
    });

    // PDF produit + non vide.
    expect(typeof assets.pdfBase64).toBe('string');
    expect(assets.pdfBase64.length).toBeGreaterThan(500);
    expect(assets.pdfFileName).toMatch(/\.pdf$/);

    // Le template utilisé est bien l'actif.
    expect(assets.templateId?.toString()).toBe(seed.templateId);

    // HTML issu du template actif (markup bsgc-card) + variables résolues + QR réel (<img>).
    expect(assets.html).toContain('bsgc-card');
    expect(assets.html).toContain('Camille Martin');
    expect(assets.html).toContain('A3F2B9E1');
    expect(assets.html).toContain('K7M2P9QXTV');
    expect(assets.html).toContain('<img src="data:image/png;base64');
  });

  it('sans template passé ET aucun actif → resolver seed puis rend depuis le template seedé', async () => {
    expect(await GiftCardTemplate.countDocuments()).toBe(0);
    const assets = await generateGiftCardAssets(giftCardFixture, { code: 'X', pin: 'Y' });
    // Un template a été seedé et utilisé (pas de rendu depuis {} vide).
    expect(assets.templateId).toBeTruthy();
    expect(assets.html).toContain('bsgc-card');
    expect(await GiftCardTemplate.countDocuments({ active: true })).toBe(1);
  });

  it('preview studio : QR FACTICE (jamais le vrai token) et pas d\'écriture', async () => {
    await ensureDefaultGiftCardTemplate();
    const template = await GiftCardTemplate.findOne({ active: true }).lean();
    const realPayload = generateGiftCardQrPayload({ token: 'SECRET_REAL_TOKEN' });

    const preview = await renderGiftCardPreview(template);
    // Le QR de preview n'encode PAS le vrai token.
    expect(preview.qrDataUrl).toContain('data:image/png;base64');
    expect(preview.html).not.toContain('SECRET_REAL_TOKEN');
    expect(preview.qrDataUrl).not.toBe(realPayload);
    // Preview = HTML seulement, pas de PDF ni de chemin persistant.
    expect(preview).not.toHaveProperty('pdfBase64');
  });

  it('buildGiftCardVariables n\'expose le pin que si explicitement fourni', async () => {
    const withPin = buildGiftCardVariables(giftCardFixture, { code: 'C', pin: 'P' });
    expect(withPin.pin).toBe('P');
    const withoutPin = buildGiftCardVariables(giftCardFixture);
    expect(withoutPin.pin).toBe('');
  });
});
