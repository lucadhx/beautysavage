/**
 * LA DURÉE D'UN RENDEZ-VOUS = LA PRESTATION + LES OPTIONS COCHÉES.
 *
 * Une seule règle, lue partout où un créneau se calcule : les disponibilités
 * proposées, l'ajout au panier, le changement de créneau, la retenue pendant le
 * paiement. Si deux de ces chemins comptaient différemment, la vitrine
 * proposerait une heure que le paiement refuse — exactement le « créneau plus
 * disponible alors qu'il l'était » que les clientes ont rencontré.
 */

/** Durée par défaut d'une prestation sans durée renseignée (historique). */
export const DEFAULT_SERVICE_MINUTES = 60;

/** Les clés d'options réellement retenues : actives sur la fiche, sans doublon. */
export function activeOptionKeys(product, optionKeys = []) {
  const wanted = new Set((Array.isArray(optionKeys) ? optionKeys : String(optionKeys || '').split(','))
    .map((key) => String(key || '').trim())
    .filter(Boolean));
  return (product?.options || [])
    .filter((option) => option.active !== false && wanted.has(option.key))
    .map((option) => option.key);
}

/** Les minutes ajoutées par les options cochées. */
export function optionsExtraMinutes(product, optionKeys = []) {
  const keys = new Set(activeOptionKeys(product, optionKeys));
  return (product?.options || [])
    .filter((option) => keys.has(option.key))
    .reduce((sum, option) => sum + Math.max(0, Number(option.extraMinutes || 0)), 0);
}

/** La durée totale à bloquer au planning pour cette prestation et ces options. */
export function bookingDurationMinutes(product, optionKeys = []) {
  const base = Math.max(5, Number(product?.durationMinutes || DEFAULT_SERVICE_MINUTES));
  return base + optionsExtraMinutes(product, optionKeys);
}
