import type { CommerceProduct } from '@/lib/api';

/**
 * PLUSIEURS PRESTATIONS À LA SUITE — ce que la vitrine sait d'un enchaînement.
 *
 * Le serveur fait foi (il recompte les durées depuis les fiches) ; ces outils
 * ne servent qu'à AFFICHER la durée et à écrire la séquence dans l'adresse des
 * disponibilités, au format `idA:opt|opt,idB`.
 */
export type SequenceItem = { product: CommerceProduct; optionKeys: string[] };

/** La durée d'une prestation et de ses options cochées. */
export function itemMinutes(product: CommerceProduct, optionKeys: string[]) {
  const extra = (product.options || []).filter((o) => optionKeys.includes(o.key)).reduce((sum, o) => sum + Number(o.extraMinutes || 0), 0);
  return Number(product.durationMinutes || 60) + extra;
}

/** Le supplément des options cochées. */
export function itemPriceCents(product: CommerceProduct, optionKeys: string[]) {
  return product.price.amountCents + (product.options || []).filter((o) => optionKeys.includes(o.key)).reduce((sum, o) => sum + (o.priceCents || 0), 0);
}

export const sequenceMinutes = (items: SequenceItem[]) => items.reduce((sum, i) => sum + itemMinutes(i.product, i.optionKeys), 0);

export function sequenceParam(items: { productId: string; optionKeys: string[] }[]) {
  return items.map((i) => `${i.productId}${i.optionKeys.length ? `:${i.optionKeys.join('|')}` : ''}`).join(',');
}

/** Au-delà, l'institut préfère qu'on l'appelle (même limite côté serveur). */
export const MAX_SEQUENCE_ITEMS = 4;
