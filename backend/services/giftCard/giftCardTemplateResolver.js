import { getActiveGiftCardTemplate as getActiveFromStore } from './giftCardTemplateService.js';
import { ensureDefaultGiftCardTemplate } from './giftCardTemplateSeedService.js';

/**
 * GC-TPL-AUDIT — Resolver du template actif carte cadeau.
 *
 * Point d'entrée UNIQUE pour tout rendu réel (PDF/HTML joint au mail), flux manuel comme achat en
 * ligne. Garantit qu'on ne génère jamais une carte depuis un template vide/codé en dur tant qu'un
 * template actif peut être obtenu (au besoin via seed idempotent).
 *
 *  - `getActiveGiftCardTemplate()`        : lecture simple (peut renvoyer null).
 *  - `getActiveGiftCardTemplateOrSeed()`  : lecture + seed si absent (ne renvoie null que si le seed
 *                                           lui-même échoue à produire un actif).
 *  - `assertActiveGiftCardTemplate()`     : idem mais lève une erreur contrôlée si impossible.
 */

/** Template actif (lecture seule). null si aucun. */
export async function getActiveGiftCardTemplate(opts = {}) {
  return getActiveFromStore(opts);
}

/**
 * Template actif, en seedant/activant le défaut si aucun n'existe. Best-effort : si le seed échoue
 * (ex. DB indisponible), on retente une lecture puis renvoie ce qu'on a (potentiellement null).
 * @returns {Promise<object|null>}
 */
export async function getActiveGiftCardTemplateOrSeed(opts = {}) {
  const existing = await getActiveFromStore(opts);
  if (existing) return existing;
  try {
    await ensureDefaultGiftCardTemplate();
  } catch (error) {
    console.error('[giftCardTemplateResolver] ensureDefaultGiftCardTemplate failed:', error?.message || error);
  }
  return getActiveFromStore(opts);
}

/**
 * Comme `getActiveGiftCardTemplateOrSeed` mais garantit un retour non-null : lève une erreur
 * contrôlée (`GIFT_CARD_TEMPLATE_UNAVAILABLE`) si aucun template actif ne peut être obtenu.
 * @returns {Promise<object>}
 */
export async function assertActiveGiftCardTemplate(opts = {}) {
  const template = await getActiveGiftCardTemplateOrSeed(opts);
  if (!template) {
    const error = new Error('Aucun template carte cadeau actif disponible.');
    error.status = 500;
    error.code = 'GIFT_CARD_TEMPLATE_UNAVAILABLE';
    throw error;
  }
  return template;
}

export default {
  getActiveGiftCardTemplate,
  getActiveGiftCardTemplateOrSeed,
  assertActiveGiftCardTemplate
};
