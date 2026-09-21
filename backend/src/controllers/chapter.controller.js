import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { Chapter } from '../models/Chapter.model.js';
import { uniqueSlug } from '../utils/slug.js';
import { projectChapterMedia, projectChaptersMedia } from '../services/media/mediaProjection.service.js';

/**
 * LES CHAPITRES DU RÉCIT — administration du contenu structuré du site.
 *
 * ══ L'ORDRE DES VOLETS EST CELUI DU TABLEAU REÇU ════════════════════════════
 *
 * L'éditeur réordonne par glisser-déposer et renvoie la liste dans l'ordre
 * voulu. On renumérote donc `order` à partir de la POSITION, sans faire
 * confiance au champ : un éditeur qui oublierait de le mettre à jour
 * produirait un chapitre dont l'aperçu et le rendu ne racontent pas la même
 * histoire. C'est la règle déjà tenue par les pages éditoriales.
 *
 * ══ LE SLUG NE SUIT PAS LE TITRE APRÈS COUP ═════════════════════════════════
 *
 * Il est dérivé du titre À LA CRÉATION, puis figé. Le renommer à chaque
 * correction de titre casserait des liens déjà partagés et l'entrée de menu
 * qu'un visiteur a mise en favori — pour un gain purement cosmétique dans une
 * barre d'adresse. C'est l'inverse du choix fait pour `SitePage`, et c'est
 * délibéré : les quatre chapitres sont la COLONNE VERTÉBRALE du site, pas du
 * contenu qu'on republie.
 */

const trierParOrdre = { navOrder: 1, order: 1, createdAt: 1 };

/** Renumérote les volets d'après leur POSITION dans la liste. */
function normaliserVolets(items) {
  if (!Array.isArray(items)) return undefined;
  return items.map((item, i) => ({ ...item, order: (i + 1) * 10 }));
}

export const list = asyncHandler(async (req, res) => {
  const chapitres = await Chapter.find().sort(trierParOrdre);
  return ok(res, await projectChaptersMedia(chapitres));
});

export const getOne = asyncHandler(async (req, res) => {
  const chapitre = await Chapter.findById(req.params.id);
  if (!chapitre) throw ApiError.notFound('Chapitre introuvable');
  return ok(res, await projectChapterMedia(chapitre));
});

export const create = asyncHandler(async (req, res) => {
  const { _id, __v, slug, ...corps } = req.body ?? {};
  void _id; void __v; void slug;
  const chapitre = await Chapter.create({
    ...corps,
    items: normaliserVolets(corps.items) ?? [],
    slug: await uniqueSlug(Chapter, corps.title, null, 'chapitre'),
  });
  return created(res, await projectChapterMedia(chapitre));
});

export const update = asyncHandler(async (req, res) => {
  const { _id, __v, slug, ...corps } = req.body ?? {};
  void _id; void __v; void slug;

  const existant = await Chapter.findById(req.params.id);
  if (!existant) throw ApiError.notFound('Chapitre introuvable');

  const volets = normaliserVolets(corps.items);
  existant.set({ ...corps, ...(volets ? { items: volets } : {}) });
  await existant.save();
  return ok(res, await projectChapterMedia(existant));
});

export const remove = asyncHandler(async (req, res) => {
  const chapitre = await Chapter.findByIdAndDelete(req.params.id);
  if (!chapitre) throw ApiError.notFound('Chapitre introuvable');
  return noContent(res);
});

export const reorder = asyncHandler(async (req, res) => {
  const items = req.body?.items ?? [];
  await Promise.all(items.map((u) => Chapter.findByIdAndUpdate(u.id, { navOrder: u.order })));
  const chapitres = await Chapter.find().sort(trierParOrdre);
  return ok(res, await projectChaptersMedia(chapitres));
});

export const chapterController = { list, getOne, create, update, remove, reorder };
export default chapterController;
