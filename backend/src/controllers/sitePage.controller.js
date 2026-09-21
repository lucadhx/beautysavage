import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { SitePage } from '../models/SitePage.model.js';
import { uniqueSlug } from '../utils/slug.js';
import { projectSitePageMedia, projectSitePagesMedia } from '../services/media/mediaProjection.service.js';

/**
 * LES PAGES ÉDITORIALES — administration du contenu libre du site.
 *
 * ══ CE QUE CE CONTRÔLEUR NE FAIT PAS ════════════════════════════════════════
 *
 * Il n'assainit PAS le HTML : c'est le schéma qui le fait, à l'écriture, pour
 * tous les chemins d'écriture à la fois (voir `SitePage.model.js`). Le refaire
 * ici donnerait deux nettoyages à maintenir, et le jour où ils divergent, c'est
 * le plus permissif qui gagne.
 *
 * ══ L'ORDRE DES BLOCS EST CELUI DU TABLEAU REÇU ═════════════════════════════
 *
 * L'éditeur réordonne par glisser-déposer et renvoie la liste dans l'ordre
 * voulu. On renumérote donc `order` à partir de la POSITION, sans faire
 * confiance au champ : un éditeur qui oublierait de le mettre à jour
 * produirait une page dont l'aperçu et le rendu ne racontent pas la même
 * histoire.
 */

const trierParOrdre = { navOrder: 1, order: 1, createdAt: 1 };

/** Renumérote blocs, éléments et images d'après leur POSITION dans la liste. */
function normaliserBlocs(blocks) {
  if (!Array.isArray(blocks)) return undefined;
  return blocks.map((bloc, i) => ({
    ...bloc,
    order: (i + 1) * 10,
    items: Array.isArray(bloc?.items)
      ? bloc.items.map((it, j) => ({ ...it, order: (j + 1) * 10 }))
      : bloc?.items,
    images: Array.isArray(bloc?.images)
      ? bloc.images.map((im, j) => ({ ...im, order: (j + 1) * 10 }))
      : bloc?.images,
  }));
}

export const list = asyncHandler(async (req, res) => {
  const pages = await SitePage.find().sort(trierParOrdre);
  return ok(res, await projectSitePagesMedia(pages));
});

export const getOne = asyncHandler(async (req, res) => {
  const page = await SitePage.findById(req.params.id);
  if (!page) throw ApiError.notFound('Page introuvable');
  return ok(res, await projectSitePageMedia(page));
});

export const create = asyncHandler(async (req, res) => {
  const { _id, __v, slug, ...corps } = req.body ?? {};
  void _id; void __v; void slug;
  const page = await SitePage.create({
    ...corps,
    blocks: normaliserBlocs(corps.blocks) ?? [],
    slug: await uniqueSlug(SitePage, corps.title, null, 'page'),
  });
  return created(res, await projectSitePageMedia(page));
});

export const update = asyncHandler(async (req, res) => {
  const { _id, __v, slug, ...corps } = req.body ?? {};
  void _id; void __v; void slug;

  const existante = await SitePage.findById(req.params.id);
  if (!existante) throw ApiError.notFound('Page introuvable');

  if (corps.title && corps.title !== existante.title) {
    existante.slug = await uniqueSlug(SitePage, corps.title, existante._id, 'page');
  }
  const blocs = normaliserBlocs(corps.blocks);
  existante.set({ ...corps, ...(blocs ? { blocks: blocs } : {}) });
  await existante.save();
  return ok(res, await projectSitePageMedia(existante));
});

export const remove = asyncHandler(async (req, res) => {
  const page = await SitePage.findByIdAndDelete(req.params.id);
  if (!page) throw ApiError.notFound('Page introuvable');
  return noContent(res);
});

export const reorder = asyncHandler(async (req, res) => {
  const items = req.body?.items ?? [];
  await Promise.all(items.map((u) => SitePage.findByIdAndUpdate(u.id, { navOrder: u.order })));
  const pages = await SitePage.find().sort(trierParOrdre);
  return ok(res, await projectSitePagesMedia(pages));
});

export const sitePageController = { list, getOne, create, update, remove, reorder };
export default sitePageController;
