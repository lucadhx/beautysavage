import { asyncHandler } from '../utils/asyncHandler.js';
import { created, ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { importProjectMedia, deleteProjectMedia, listProjectMedia } from '../services/media/projectMedia.service.js';
import {
  resolveProjectMediaAuthority, relayToProjectAuthority,
} from '../services/media/projectMediaAuthority.js';
import { validateImage } from '../services/media/mediaValidation.js';
import { policyFor } from '../services/media/mediaPolicy.js';

/**
 * MÉDIAS MÉTIER — import et retrait.
 *
 * ══ UNE SEULE AUTORITÉ ══════════════════════════════════════════════════════
 *
 * Chaque instance écrivait autrefois dans son propre dossier : un média
 * importé depuis un poste de développement n'existait que sur ce poste, et le
 * site déployé ne l'avait jamais vu. Désormais une seule instance STOCKE — le
 * backend déployé du projet — et les autres RELAIENT, sans jamais rien
 * conserver.
 *
 * Le relais porte le jeton de l'appelant : les instances partagent la clé de
 * signature, donc rien n'est à provisionner, et aucun identifiant permanent
 * n'approche le navigateur — il ne parle qu'à son propre backend.
 *
 * ══ AUCUNE ÉCRITURE SI L'AUTORITÉ EST INDISPONIBLE ══════════════════════════
 *
 * Si le relais échoue, l'import échoue. Se rabattre sur le disque local
 * recréerait exactement les deux vérités qu'on vient de supprimer.
 */

/**
 * LES TYPES MÉTIER RECONNUS — la liste fait foi.
 *
 * Elle est ici, et pas dans un commentaire : un type refusé nomme les types
 * acceptés, ce qui transforme un rejet en indication. Ajouter un écran, c'est
 * ajouter une entrée — le refus rappelle où.
 */
export const MEDIA_TYPES = new Set([
  'company-logo',
  'company-favicon',
  'hero',
  // Récit du site : image de tête d'un chapitre, images des pages éditoriales.
  'chapter-image',
  'page-image',
  'gallery-image',
  'team-photo',
  'commerce-cover',
]);

/** Le seul en-tête relayé : l'identité de l'appelant. */
const identite = (req) => {
  const jeton = req.get('authorization');
  return jeton ? { authorization: jeton } : {};
};

/** Réémet la réponse de l'autorité sans la réinterpréter. */
async function rendreAmont(res, amont) {
  const texte = await amont.text();
  return res
    .status(amont.status)
    .type(amont.headers.get('content-type') || 'application/json')
    .send(texte);
}

/** Relaie un fichier tel que l'appelant l'a envoyé — le réencodage a lieu chez l'autorité. */
async function relayerFichier(req, res, chemin) {
  const { authority } = await resolveProjectMediaAuthority();
  const corps = new FormData();
  corps.append(
    'file',
    new Blob([req.file.buffer], { type: req.file.mimetype }),
    req.file.originalname || 'image',
  );
  const amont = await relayToProjectAuthority(authority, chemin, {
    method: 'POST', headers: identite(req), body: corps,
  }).catch(() => null);
  if (!amont) {
    throw ApiError.badRequest(
      'Le stockage média du projet est injoignable : l’import est refusé. '
      + 'Rien n’a été écrit localement — un média ne doit exister qu’à un seul endroit.',
      { code: 'PROJECT_MEDIA_AUTHORITY_UNREACHABLE' },
    );
  }
  return rendreAmont(res, amont);
}

export const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Aucun fichier reçu');

  /**
   * Le TYPE MÉTIER accompagne le fichier — logo, hero, galerie, avant/après.
   * Il n'est pas déduit d'un préfixe : un préfixe nomme un fichier, il ne dit
   * pas ce que l'image représente, et deux informations écrites à deux
   * endroits finissent par diverger.
   */
  const brut = String(req.query.mediaType || req.query.prefix || '');
  const mediaType = brut.replace(/[^a-z0-9_-]/gi, '').slice(0, 32);

  /**
   * LE TYPE MÉTIER EST EXIGÉ — pas de repli sur « other ».
   *
   * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────
   * Le paramètre existait des deux côtés et n'était JAMAIS transmis : tous les
   * médias métier — logo, bannière, avant/après, avis — étaient enregistrés en
   * `other`. Le champ existait, l'inventaire était aveugle, et la
   * déduplication scopée par type ne scopait rien.
   *
   * Un défaut est exactement ce qui a produit cette situation : il rendait
   * l'oubli indolore. Sans type, on refuse — et on dit lesquels sont attendus.
   */
  if (!mediaType || mediaType === 'other') {
    throw ApiError.badRequest(
      'Type de média requis : une image doit dire ce qu’elle REPRÉSENTE. '
      + `Attendu l’un de : ${[...MEDIA_TYPES].join(', ')}.`,
      { code: 'PROJECT_MEDIA_TYPE_REQUIRED' },
    );
  }
  if (!MEDIA_TYPES.has(mediaType)) {
    throw ApiError.badRequest(
      `Type de média inconnu : « ${mediaType} ». `
      + `Attendu l’un de : ${[...MEDIA_TYPES].join(', ')}.`,
      { code: 'PROJECT_MEDIA_TYPE_UNKNOWN' },
    );
  }

  const { isAuthority } = await resolveProjectMediaAuthority();
  if (!isAuthority) {
    return relayerFichier(req, res, `/api/uploads/image?mediaType=${encodeURIComponent(mediaType)}`);
  }

  /**
   * VALIDATION AVANT ÉCRITURE — et sur les octets, pas sur le nom du fichier.
   *
   * Elle a lieu chez l'AUTORITÉ, après le relais : une instance cliente ne doit
   * pas décider seule ce que l'autorité acceptera, sans quoi deux versions du
   * produit pourraient diverger sur ce qui est un média valide.
   */
  await validateImage(req.file.buffer, { mediaType });

  // La politique décide de la SORTIE — plus aucun appelant ne choisit.
  const { maxWidth, format, square } = policyFor(mediaType);
  const result = await importProjectMedia(req.file.buffer, {
    mediaType,
    maxWidth,
    format,
    square: Boolean(square),
    createdBy: req.user?.email ?? req.user?.id ?? null,
  });
  return created(res, result);
});

export const uploadFavicon = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Aucun fichier reçu');

  const { isAuthority } = await resolveProjectMediaAuthority();
  if (!isAuthority) return relayerFichier(req, res, '/api/uploads/favicon');

  await validateImage(req.file.buffer, { mediaType: 'company-favicon' });

  // Le favicon garde son traitement propre — carré, et PNG plutôt que WebP :
  // les navigateurs anciens ne lisent pas tous le WebP dans un onglet.
  const { format, square } = policyFor('company-favicon');
  const result = await importProjectMedia(req.file.buffer, {
    mediaType: 'company-favicon',
    format,
    square: Boolean(square),
    createdBy: req.user?.email ?? req.user?.id ?? null,
  });
  return created(res, result);
});

export const mediaLibrary = asyncHandler(async (req, res) => {
  const { authority, isAuthority } = await resolveProjectMediaAuthority();
  if (!isAuthority) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const amont = await relayToProjectAuthority(
      authority,
      `/api/uploads/library${suffix}`,
      { method: 'GET', headers: identite(req) },
    ).catch(() => null);
    if (!amont) {
      throw ApiError.badRequest(
        'Le stockage media du projet est injoignable : la mediatheque est indisponible.',
        { code: 'PROJECT_MEDIA_AUTHORITY_UNREACHABLE' },
      );
    }
    return rendreAmont(res, amont);
  }

  return ok(res, await listProjectMedia(req.query));
});

/**
 * RETRAIT D'UN MÉDIA — une opération unique sur l'autorité.
 *
 * Ce n'est pas une synchronisation entre deux dossiers : il n'y a qu'un
 * dossier. Retirer depuis un poste de développement supprime donc le fichier
 * là où il vit réellement, et toutes les interfaces cessent de le voir au même
 * instant.
 */
export const deleteMedia = asyncHandler(async (req, res) => {
  const nom = String(req.params.filename || '');
  const { authority, isAuthority } = await resolveProjectMediaAuthority();

  if (!isAuthority) {
    const amont = await relayToProjectAuthority(
      authority,
      `/api/uploads/image/${encodeURIComponent(nom)}`,
      { method: 'DELETE', headers: identite(req) },
    ).catch(() => null);
    if (!amont) {
      throw ApiError.badRequest(
        'Le stockage média du projet est injoignable : la suppression est refusée.',
        { code: 'PROJECT_MEDIA_AUTHORITY_UNREACHABLE' },
      );
    }
    return rendreAmont(res, amont);
  }

  return ok(res, await deleteProjectMedia(nom, { force: req.query.force === 'true' }));
});
