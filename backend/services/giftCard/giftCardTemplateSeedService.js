import GiftCardTemplate from '../../models/GiftCardTemplate.js';

/**
 * GC-TPL-AUDIT — Seed / garantie du template carte cadeau par défaut.
 *
 * `ensureDefaultGiftCardTemplate()` garantit la règle « impossible d'avoir zéro template actif »,
 * de façon idempotente et NON destructive :
 *
 *  - si un template ACTIF existe déjà              → no-op (on ne touche à rien) ;
 *  - si des templates publiés/visibles existent
 *    mais aucun n'est actif                        → active le MEILLEUR candidat (jamais destructif) ;
 *  - si aucun candidat activable                   → crée « BeautySavage Classic » publié+visible+actif.
 *
 * Ne désactive JAMAIS un template actif existant. Aucun effet destructif (pas de delete, pas de
 * downgrade de statut). Sûr à appeler à chaque boot ET au moment de la résolution (via le resolver).
 */

export const DEFAULT_GIFT_CARD_TEMPLATE_SLUG = 'classique';
export const DEFAULT_GIFT_CARD_TEMPLATE_NAME = 'BeautySavage Classic';

export const DEFAULT_GIFT_CARD_TEMPLATE_HTML = `
<div class="bsgc-card">
  <div class="bsgc-card__head">
    <span class="bsgc-card__brand">{{instituteName}}</span>
    <span class="bsgc-card__pill">{{paymentLabel}}</span>
  </div>
  <div class="bsgc-card__amount">{{amount}}</div>
  <div class="bsgc-card__names">
    <p class="bsgc-card__to">Pour <strong>{{recipientName}}</strong></p>
    <p class="bsgc-card__from">De la part de {{purchaserName}}</p>
  </div>
  <p class="bsgc-card__message">{{message}}</p>
  <div class="bsgc-card__codes">
    <div class="bsgc-card__field"><span>Code</span><strong>{{code}}</strong></div>
    <div class="bsgc-card__field"><span>Mot de passe</span><strong>{{pin}}</strong></div>
  </div>
  <div class="bsgc-card__qr">{{qrCode}}</div>
  <div class="bsgc-card__foot">Émise le {{createdAt}}</div>
</div>
`.trim();

export const DEFAULT_GIFT_CARD_TEMPLATE_CSS = `
.bsgc-card {
  box-sizing: border-box;
  width: 420px;
  padding: 28px;
  border-radius: 18px;
  color: #ffffff;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #5f4ff7 0%, #f24692 100%);
}
.bsgc-card__head { display: flex; justify-content: space-between; align-items: center; }
.bsgc-card__brand { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 14px; }
.bsgc-card__pill { font-size: 11px; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.22); }
.bsgc-card__amount { font-size: 46px; font-weight: 800; margin: 22px 0 6px; }
.bsgc-card__names p { margin: 2px 0; font-size: 14px; }
.bsgc-card__message { margin: 14px 0; font-size: 13px; opacity: 0.92; font-style: italic; min-height: 16px; }
.bsgc-card__codes { display: flex; gap: 14px; margin-top: 12px; }
.bsgc-card__field { background: rgba(255,255,255,0.16); border-radius: 10px; padding: 8px 12px; flex: 1; }
.bsgc-card__field span { display: block; font-size: 10px; text-transform: uppercase; opacity: 0.8; }
.bsgc-card__field strong { font-size: 16px; letter-spacing: 0.08em; }
.bsgc-card__qr { display: flex; justify-content: center; margin-top: 18px; }
.bsgc-card__qr img { background: #fff; padding: 8px; border-radius: 10px; width: 120px; height: 120px; }
.bsgc-card__foot { margin-top: 16px; font-size: 11px; opacity: 0.8; text-align: center; }
`.trim();

export const DEFAULT_GIFT_CARD_TEMPLATE_PREVIEW = {
  recipientName: 'Camille Martin',
  purchaserName: 'Léa Dubois',
  amount: '80,00 €',
  code: 'A3F2B9E1',
  pin: 'K7M2P9QXTV',
  message: 'Joyeux anniversaire ! Profite bien de ton moment beauté.',
  createdAt: '30/06/2026',
  paymentLabel: 'Paiement sur place',
  instituteName: 'Beauty Savage'
};

/**
 * Choisit le meilleur candidat activable parmi les templates publiés & visibles.
 * Priorité : template système par défaut → slug `classique` → plus ancien publié visible.
 */
async function pickBestActivableCandidate() {
  const candidates = await GiftCardTemplate.find({ status: 'published', visible: true })
    .sort({ isSystemDefault: -1, createdAt: 1 })
    .lean();
  if (!candidates.length) return null;
  return (
    candidates.find((c) => c.isSystemDefault) ||
    candidates.find((c) => c.slug === DEFAULT_GIFT_CARD_TEMPLATE_SLUG) ||
    candidates[0]
  );
}

/**
 * @returns {Promise<{ seeded: boolean, activated: boolean, slug: string, templateId: string|null, reason?: string }>}
 */
export async function ensureDefaultGiftCardTemplate() {
  // 1) Un actif existe déjà → rien à faire (idempotent, jamais destructif).
  const active = await GiftCardTemplate.findOne({ active: true }).select('_id slug').lean();
  if (active) {
    return {
      seeded: false,
      activated: false,
      slug: active.slug || DEFAULT_GIFT_CARD_TEMPLATE_SLUG,
      templateId: active._id?.toString() || null,
      reason: 'active_exists'
    };
  }

  // 2) Aucun actif mais un candidat publié/visible existe → on l'active (aucune destruction).
  const candidate = await pickBestActivableCandidate();
  if (candidate) {
    // Défense : libère tout actif résiduel avant d'activer (contrainte index unique partiel).
    await GiftCardTemplate.updateMany({ active: true, _id: { $ne: candidate._id } }, { active: false });
    await GiftCardTemplate.updateOne({ _id: candidate._id }, { active: true });
    return {
      seeded: false,
      activated: true,
      slug: candidate.slug || DEFAULT_GIFT_CARD_TEMPLATE_SLUG,
      templateId: candidate._id?.toString() || null,
      reason: 'activated_existing'
    };
  }

  // 3) Rien d'activable → réutilise le système publié s'il existe (invisible/archivé impossible ici)
  //    sinon crée le défaut. Puis active.
  let template = await GiftCardTemplate.findOne({
    slug: DEFAULT_GIFT_CARD_TEMPLATE_SLUG,
    status: 'published'
  });
  let seeded = false;
  if (!template) {
    template = await GiftCardTemplate.create({
      name: DEFAULT_GIFT_CARD_TEMPLATE_NAME,
      slug: DEFAULT_GIFT_CARD_TEMPLATE_SLUG,
      html: DEFAULT_GIFT_CARD_TEMPLATE_HTML,
      css: DEFAULT_GIFT_CARD_TEMPLATE_CSS,
      previewData: DEFAULT_GIFT_CARD_TEMPLATE_PREVIEW,
      visible: true,
      active: false,
      version: 1,
      status: 'published',
      publishedAt: new Date(),
      isSystemDefault: true,
      createdBy: 'system-seed',
      updatedBy: 'system-seed'
    });
    seeded = true;
  }

  await GiftCardTemplate.updateMany({ active: true, _id: { $ne: template._id } }, { active: false });
  template.active = true;
  await template.save();

  return {
    seeded,
    activated: true,
    slug: DEFAULT_GIFT_CARD_TEMPLATE_SLUG,
    templateId: template._id?.toString() || null,
    reason: seeded ? 'seeded_default' : 'activated_system_default'
  };
}

export default ensureDefaultGiftCardTemplate;
