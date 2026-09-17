// constants/pricingConcepts.js
// Pré-React — Concepts de pricing formalisés (promotion / carte cadeau / commission).
//
// Décisions produit :
//   - UNE seule promotion applicable par ligne (pas de cumul). Le prix vendu est le prix
//     catalogue moins la promotion validée.
//   - La carte cadeau est un MOYEN DE PAIEMENT, jamais une réduction commerciale : elle ne
//     réduit ni le prix vendu, ni la base de commission. Elle apparaît comme ligne de
//     règlement (solde négatif) sur la facture.
//   - La base de commission = prix vendu après promotion, AVANT moyens de paiement.
//
// Invariants :
//   soldAmount           = max(0, catalogAmount - promotionDiscountAmount)
//   giftCardPaymentAmount = min(giftCard, soldAmount)   // moyen de paiement, ne réduit pas sold
//   stripePaymentAmount  = max(0, soldAmount - giftCardPaymentAmount)
//   commissionBaseAmount = soldAmount                   // indépendant du moyen de paiement
//   refundableAmount     = soldAmount

export const PRICING_SNAPSHOT_VERSION = '1.0-promo-giftcard';

// Vocabulaire canonique (pour documentation/observabilité).
export const PRICING_CONCEPTS = Object.freeze({
  catalogPrice: 'Prix catalogue (avant toute promotion).',
  promotionDiscountAmount: 'Réduction de la promotion validée (une seule).',
  soldPrice: 'Prix réellement vendu = catalogPrice - promotionDiscountAmount.',
  giftCardPaymentAmount: 'Montant réglé par carte cadeau (moyen de paiement, pas une remise).',
  stripePaymentAmount: 'Montant réglé par carte bancaire = soldPrice - giftCardPaymentAmount.',
  commissionBaseAmount: 'Base de commission = soldPrice (indépendante du moyen de paiement).',
  refundableAmount: 'Montant remboursable = soldPrice.'
});

function roundToCents(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(n * 100) / 100;
}

/**
 * Construit le snapshot de pricing immuable d'une vente.
 * @param {object} input
 * @param {number} input.catalogAmount  prix catalogue total (avant promo)
 * @param {number} [input.promotionDiscountAmount] réduction promo (>=0)
 * @param {number} [input.soldAmount] prix vendu (sinon dérivé de catalog - promo)
 * @param {number} [input.giftCardPaymentAmount] montant carte cadeau (moyen de paiement)
 * @returns {object} pricingSnapshot
 */
export function buildPricingSnapshot({
  catalogAmount,
  promotionDiscountAmount = 0,
  soldAmount,
  giftCardPaymentAmount = 0
} = {}) {
  const catalog = roundToCents(catalogAmount);
  const sold = roundToCents(
    soldAmount != null ? soldAmount : Math.max(0, catalog - roundToCents(promotionDiscountAmount))
  );
  // La réduction est dérivée de (catalogue - vendu) pour rester cohérente avec sold.
  const discount = roundToCents(Math.max(0, catalog - sold));
  // La carte cadeau est un moyen de paiement : capée au prix vendu, ne réduit JAMAIS sold.
  const giftCard = roundToCents(Math.max(0, Math.min(Number(giftCardPaymentAmount || 0), sold)));
  const stripe = roundToCents(Math.max(0, sold - giftCard));
  return {
    catalogAmount: catalog,
    promotionDiscountAmount: discount,
    soldAmount: sold,
    giftCardPaymentAmount: giftCard,
    stripePaymentAmount: stripe,
    commissionBaseAmount: sold, // = soldAmount, indépendant du moyen de paiement
    refundableAmount: sold,
    version: PRICING_SNAPSHOT_VERSION
  };
}

/**
 * Choisit UNE seule promotion (la meilleure réduction) parmi des candidates — garantit
 * l'absence de cumul. Chaque candidate : { discountAmount, promotionId, source }.
 * @param {Array<{discountAmount:number, promotionId?:string, source?:string}>} candidates
 * @returns {{discountAmount:number, promotionId:string|null, source:string|null}}
 */
export function pickSinglePromotion(candidates = []) {
  const valid = (Array.isArray(candidates) ? candidates : [])
    .filter(c => c && Number.isFinite(Number(c.discountAmount)) && Number(c.discountAmount) > 0);
  if (!valid.length) return { discountAmount: 0, promotionId: null, source: null };
  // Pas de cumul : on retient la MEILLEURE réduction (la plus avantageuse pour le client).
  const best = valid.reduce((a, b) => (Number(b.discountAmount) > Number(a.discountAmount) ? b : a));
  return {
    discountAmount: roundToCents(best.discountAmount),
    promotionId: best.promotionId || null,
    source: best.source || null
  };
}

export default {
  PRICING_SNAPSHOT_VERSION,
  PRICING_CONCEPTS,
  buildPricingSnapshot,
  pickSinglePromotion
};
