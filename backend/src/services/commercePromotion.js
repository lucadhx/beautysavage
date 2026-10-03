import { zonedWallTime } from './calendar.service.js';

/**
 * LES PROMOTIONS D'UN PRODUIT — une remise (pourcentage ou montant fixe) sur
 * une période, réglée dans le Manager (onglet « Promotion »).
 *
 * Elle n'était qu'enregistrée : ni la vitrine, ni le panier, ni le paiement ne
 * la lisaient. Elle s'applique désormais au PRIX lui-même — fiche, cartes,
 * panier et Stripe voient le même montant.
 *
 * Les dates sont des heures de l'institut (Paris), quel que soit le fuseau du
 * serveur. Une date seule couvre la journée entière : début à 0 h, fin à
 * 23 h 59 min 59 s.
 */

const TIME_ZONE = 'Europe/Paris';

/** « 2026-10-12 » ou « 2026-10-12T18:30 » (heure de Paris), ou un instant ISO complet. */
export function promotionMoment(value, { endOfDay = false } = {}) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4] !== undefined) return zonedWallTime(y, mo, d, Number(m[4]) * 60 + Number(m[5]), TIME_ZONE);
    return endOfDay
      ? new Date(zonedWallTime(y, mo, d + 1, 0, TIME_ZONE).getTime() - 1000)
      : zonedWallTime(y, mo, d, 0, TIME_ZONE);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * LA PROMOTION EN COURS, ou `null`. Une carte cadeau n'est jamais remisée (son
 * prix est sa valeur). La remise ne descend jamais sous 0 €.
 */
export function activePromotion(product, now = new Date()) {
  const promo = product?.promotion || {};
  if (!promo.enabled || product?.kind === 'GIFT_CARD') return null;
  const base = Number(product?.price?.amountCents || 0);
  const value = Number(promo.value || 0);
  if (base <= 0 || !(value > 0)) return null;
  const startsAt = promotionMoment(promo.startsAt);
  const endsAt = promotionMoment(promo.endsAt, { endOfDay: true });
  if (startsAt && now < startsAt) return null;
  if (endsAt && now > endsAt) return null;
  const type = promo.type === 'FIXED' ? 'FIXED' : 'PERCENT';
  const discountCents = Math.min(base, type === 'PERCENT' ? Math.round((base * Math.min(100, value)) / 100) : Math.round(value * 100));
  if (discountCents <= 0) return null;
  return {
    type,
    value,
    discountCents,
    originalCents: base,
    priceCents: base - discountCents,
    percentOff: Math.round((discountCents / base) * 100),
    startsAt: startsAt ? startsAt.toISOString() : null,
    endsAt: endsAt ? endsAt.toISOString() : null,
  };
}

/** Le prix à payer maintenant (promotion comprise). */
export function effectivePriceCents(product, now = new Date()) {
  return activePromotion(product, now)?.priceCents ?? Number(product?.price?.amountCents || 0);
}
