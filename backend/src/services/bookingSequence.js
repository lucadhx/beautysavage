import mongoose from 'mongoose';
import { CommerceProduct, PRODUCT_STATUS } from '../models/CommerceProduct.model.js';
import { ApiError } from '../utils/ApiError.js';
import { activeOptionKeys, bookingDurationMinutes } from './bookingDuration.js';

/**
 * PLUSIEURS PRESTATIONS À LA SUITE — un « rendez-vous composé ».
 *
 * La cliente choisit ses prestations (et leurs options) PUIS une seule heure :
 * elles s'enchaînent sans battement, la deuxième commence à la minute où la
 * première finit. Chaque prestation reste un rendez-vous à part entière au
 * planning, contrôlé comme les autres — l'enchaînement ne crée aucune
 * exception à la règle anti-chevauchement : il vérifie simplement CHAQUE
 * segment, et le paiement retient tout ou rien.
 *
 * Une séquence s'écrit `[{ productId, optionKeys }]`, ou en paramètre d'URL
 * `idA:french|chrome,idB` (prestations séparées par des virgules, options par
 * des barres verticales).
 */

/** Au-delà, ce n'est plus un rendez-vous mais une journée : l'institut s'en charge. */
export const MAX_SEQUENCE_ITEMS = 4;

export function parseSequence(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => ({
      productId: String(item?.productId || '').trim(),
      optionKeys: Array.isArray(item?.optionKeys) ? item.optionKeys.map(String) : [],
    })).filter((item) => item.productId);
  }
  return String(raw || '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [productId, options = ''] = part.split(':');
    return { productId: productId.trim(), optionKeys: options.split('|').map((k) => k.trim()).filter(Boolean) };
  });
}

/** Les fiches de la séquence, dans l'ordre, avec la durée de chacune (options comprises). */
export async function loadSequence(raw) {
  const items = parseSequence(raw);
  if (items.length === 0) throw ApiError.badRequest('Choisissez au moins une prestation');
  if (items.length > MAX_SEQUENCE_ITEMS) {
    throw ApiError.badRequest(`Au plus ${MAX_SEQUENCE_ITEMS} prestations à la suite en ligne. Pour davantage, contactez l’institut.`, { code: 'SEQUENCE_TOO_LONG' });
  }
  if (items.some((item) => !mongoose.isValidObjectId(item.productId))) throw ApiError.badRequest('Prestation invalide');
  const products = await CommerceProduct.find({ _id: { $in: items.map((i) => i.productId) }, status: PRODUCT_STATUS.PUBLISHED, kind: 'SERVICE' });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) throw ApiError.notFound('Une des prestations choisies n’est plus proposée');
    const optionKeys = activeOptionKeys(product, item.optionKeys);
    return { product, optionKeys, durationMinutes: bookingDurationMinutes(product, optionKeys) };
  });
}

export const sequenceMinutes = (sequence) => sequence.reduce((sum, item) => sum + item.durationMinutes, 0);

/** Le créneau découpé : chaque prestation commence à la fin de la précédente. */
export function sequenceSegments(startsAt, sequence) {
  let cursor = new Date(startsAt).getTime();
  return sequence.map((item, index) => {
    const start = new Date(cursor);
    cursor += item.durationMinutes * 60_000;
    return {
      index,
      productId: String(item.product._id ?? item.product.id),
      title: item.product.title,
      optionKeys: item.optionKeys,
      startsAt: start,
      endsAt: new Date(cursor),
      durationMinutes: item.durationMinutes,
    };
  });
}
