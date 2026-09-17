import {
  ensureDefaultGiftCardTemplate,
  DEFAULT_GIFT_CARD_TEMPLATE_SLUG
} from '../services/giftCard/giftCardTemplateSeedService.js';

/**
 * M13 / GC-TPL-AUDIT — Seed du template carte cadeau par défaut.
 *
 * La logique canonique vit désormais dans `services/giftCard/giftCardTemplateSeedService.js`
 * (`ensureDefaultGiftCardTemplate`). Ce module reste le point d'appel historique du boot
 * (`app.js`) et des tests : il délègue simplement, sans changer le contrat.
 *
 * Idempotent, non destructif, garantit « impossible d'avoir zéro template actif ».
 */

export { DEFAULT_GIFT_CARD_TEMPLATE_SLUG };

export async function seedGiftCardTemplates() {
  return ensureDefaultGiftCardTemplate();
}

export default seedGiftCardTemplates;
