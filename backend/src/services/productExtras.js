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

/* ── La fiche structurée (2026-11-13) ─────────────────────────────────────── */

/**
 * CE QUI ÉTAIT NOYÉ DANS LA DESCRIPTION, RANGÉ EN DONNÉES.
 *
 * Les fiches portaient tout dans un seul texte : programme, « ta formation
 * comprend », durée, niveau, prérequis, paiement en 3 fois, « à noter »… La
 * vitrine ne pouvait ni les mettre en page, ni les présenter en chiffres clés.
 * Chaque information a désormais sa place, saisie dans le Manager :
 *
 *   · training.format / level / prerequisites / durationLabel — chiffres clés ;
 *   · training.program  — le programme, en parties (« Cil à cil », « Volume
 *                         russe ») ou en une seule liste ;
 *   · training.includes — « Ta formation comprend », chaque élément avec un
 *                         pictogramme choisi dans une liste fermée ;
 *   · service.longevity — la tenue d'une prestation (« 6 à 8 semaines ») ;
 *   · additionalInfo    — « Bon à savoir », pour toute fiche (à noter, paiement
 *                         en plusieurs fois, conditions d'un remplissage…).
 */

export const INCLUDE_ICONS = Object.freeze(['livret', 'certificat', 'suivi', 'video', 'acces', 'maj', 'appel', 'kit', 'pause', 'etoile']);
export const DETAILS_LIMITS = Object.freeze({ sections: 8, itemsPerSection: 20, includes: 12, text: 200, title: 80 });

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Le programme : des parties, chacune une liste de points (une partie sans titre = liste simple). */
export function normalizeProgram(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((section) => ({
      title: clean(section?.title, DETAILS_LIMITS.title),
      items: (Array.isArray(section?.items) ? section.items : [])
        .map((item) => clean(item, DETAILS_LIMITS.text))
        .filter(Boolean)
        .slice(0, DETAILS_LIMITS.itemsPerSection),
    }))
    .filter((section) => section.items.length)
    .slice(0, DETAILS_LIMITS.sections);
}

/** « Ta formation comprend » : un libellé et un pictogramme de la liste fermée. */
export function normalizeIncludes(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      const label = clean(typeof item === 'string' ? item : item?.label, DETAILS_LIMITS.text);
      const icon = INCLUDE_ICONS.includes(item?.icon) ? item.icon : 'etoile';
      return { icon, label };
    })
    .filter((item) => item.label)
    .slice(0, DETAILS_LIMITS.includes);
}

/** Le bloc `training` : les champs existants intacts, les nouveaux ramenés à des valeurs sûres. */
export function normalizeTraining(raw) {
  const training = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  training.format = clean(training.format, DETAILS_LIMITS.title);
  training.level = clean(training.level, DETAILS_LIMITS.title);
  training.prerequisites = clean(training.prerequisites, DETAILS_LIMITS.text);
  training.durationLabel = clean(training.durationLabel, DETAILS_LIMITS.title);
  training.program = normalizeProgram(training.program);
  training.includes = normalizeIncludes(training.includes);
  return training;
}

/** Le bloc `service` : la tenue s'ajoute aux réglages existants. */
export function normalizeService(raw) {
  const service = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  service.longevity = clean(service.longevity, DETAILS_LIMITS.title);
  return service;
}

/** « Bon à savoir » : une information par ligne, 12 au plus (même règle que melinails). */
export function normalizeAdditionalInfo(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 12);
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
