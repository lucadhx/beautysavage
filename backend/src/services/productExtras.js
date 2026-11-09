import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError.js';

/**
 * RÉGLAGES DE FICHE (repris de melinails, 2026-11-09) — le PROGRAMME PUBLIC
 * des formations et le contenu des packs. Module pur, sauf la vérification du
 * contenu d'un pack, qui lit le catalogue.
 */

/* ── Le programme public d'une formation ───────────────────────────────────── */

/**
 * CE QUE LA FICHE PUBLIQUE DIT DES MODULES — le titre, la description, et
 * combien de vidéos et de documents. Jamais le contenu.
 *
 * La fiche publique transportait les modules TELS QUELS : textes, liens des
 * vidéos, documents. N'importe qui pouvait suivre une formation payante sans
 * l'acheter. Le contenu ne sort plus que vers une cliente qui y a accès
 * (espace formation, voir trainingAccess.js).
 */
export function publicModulesOutline(modules) {
  return (Array.isArray(modules) ? modules : []).map((module, index) => ({
    id: String(module?.id || `module-${index + 1}`),
    order: Number(module?.order ?? index + 1),
    title: String(module?.title || `Module ${index + 1}`),
    description: String(module?.description || ''),
    videoCount: Array.isArray(module?.videos) ? module.videos.length : 0,
    fileCount: Array.isArray(module?.files) ? module.files.length : 0,
  }));
}

/* ── Les packs de formations en ligne ──────────────────────────────────────── */

export const PACK_LIMITS = Object.freeze({ minTrainings: 2, maxTrainings: 12 });

/**
 * LE CONTENU D'UN PACK — des formations EN LIGNE existantes, sans doublon.
 * Un pack publié doit en contenir au moins deux, toutes publiées : une cliente
 * ne doit jamais payer l'accès à une formation retirée.
 */
export async function normalizePack(raw, { status, Product }) {
  const ids = [...new Set((Array.isArray(raw?.productIds) ? raw.productIds : []).map(String))]
    .filter((value) => mongoose.isValidObjectId(value))
    .slice(0, PACK_LIMITS.maxTrainings);
  const found = ids.length ? await Product.find({ _id: { $in: ids } }).select('kind status title').lean() : [];
  const byId = new Map(found.map((p) => [String(p._id), p]));
  const wrongKind = ids.filter((value) => byId.get(value) && byId.get(value).kind !== 'DISTANCE_TRAINING');
  if (wrongKind.length) throw ApiError.badRequest('Un pack ne contient que des formations en ligne.', { code: 'PACK_KIND_INVALID' });
  const kept = ids.filter((value) => byId.has(value));
  if (status === 'PUBLISHED') {
    if (kept.length < PACK_LIMITS.minTrainings) {
      throw ApiError.badRequest(`Un pack publié réunit au moins ${PACK_LIMITS.minTrainings} formations en ligne.`, { code: 'PACK_TOO_SMALL' });
    }
    const unpublished = kept.filter((value) => byId.get(value).status !== 'PUBLISHED');
    if (unpublished.length) {
      throw ApiError.badRequest(`« ${byId.get(unpublished[0]).title} » n’est pas publiée : publiez-la ou retirez-la du pack avant de publier le pack.`, { code: 'PACK_ITEM_UNPUBLISHED' });
    }
  }
  return { productIds: kept.map((value) => new mongoose.Types.ObjectId(value)) };
}
