/**
 * VALIDATION D'UNE IMAGE REÇUE — sur les OCTETS, jamais sur ce qu'on nous dit.
 *
 * ══ CE QUE LE FILTRE PRÉCÉDENT NE VÉRIFIAIT PAS ═════════════════════════════
 *
 * Le seul contrôle était `file.mimetype.startsWith('image/')`. Or ce champ
 * n'est pas mesuré : il est DÉCLARÉ par le navigateur, à partir de l'extension
 * du fichier. Renommer `charge.zip` en `charge.png` suffisait à le franchir.
 *
 * Ce n'était pas exploitable jusqu'au bout — `sharp` refusait ensuite de
 * décoder — mais l'échec arrivait sous la forme d'une exception non typée,
 * rendue à l'écran comme une panne serveur. Le fichier était rejeté par
 * accident plutôt que par décision.
 *
 * On DÉCODE donc l'en-tête. Ce que `sharp` réussit à lire est une image ; ce
 * qu'il ne lit pas n'en est pas une, quel que soit son nom.
 *
 * ══ ET LA BOMBE DE DÉCOMPRESSION ════════════════════════════════════════════
 *
 * Une image peut peser 40 Ko et déclarer 60 000 × 60 000 pixels : la décoder
 * réclamerait plusieurs gigaoctets. Le poids ne protège de rien — on borne donc
 * aussi les DIMENSIONS, avant tout redimensionnement.
 */
import sharp from 'sharp';
import { ApiError } from '../../utils/ApiError.js';
import { ACCEPTED_IMAGE_FORMATS, humanBytes, policyFor } from './mediaPolicy.js';

/**
 * Au-delà, on refuse sans décoder davantage.
 *
 * 12 000 px est déjà quatre fois la plus grande dimension qu'on redimensionne
 * (2560). Une image légitime n'en approche jamais ; une bombe les dépasse
 * toujours.
 */
export const MAX_PIXELS_PER_SIDE = 12_000;

/** Codes rendus à l'appelant — stables, et distincts les uns des autres. */
export const MEDIA_ERROR = Object.freeze({
  TOO_LARGE: 'MEDIA_TOO_LARGE',
  TYPE_UNSUPPORTED: 'MEDIA_TYPE_UNSUPPORTED',
  INVALID: 'MEDIA_INVALID',
  DIMENSIONS_EXCEEDED: 'MEDIA_DIMENSIONS_EXCEEDED',
});

/**
 * Valide un buffer contre la politique de son type. Rend les métadonnées
 * mesurées — l'appelant n'a plus à redécoder pour les connaître.
 *
 * Lève une `ApiError` TYPÉE : chaque refus a son code, son statut HTTP et ses
 * détails. Aucun de ces cas n'est une panne, et aucun ne doit s'afficher comme
 * telle.
 */
export async function validateImage(buffer, { mediaType = null } = {}) {
  const policy = policyFor(mediaType);

  if (!buffer || buffer.length === 0) {
    throw ApiError.badRequest('Aucun fichier reçu.', { code: MEDIA_ERROR.INVALID });
  }

  /**
   * LA TAILLE D'ABORD — c'est le refus le moins coûteux, et le plus fréquent.
   * Le décodage d'un fichier de 40 Mo coûte de la mémoire ; le refuser sur sa
   * longueur n'en coûte aucune.
   */
  if (buffer.length > policy.maxInputBytes) {
    throw new ApiError(
      413,
      `Cette image est trop volumineuse (${humanBytes(buffer.length)}). `
      + `Maximum pour ce type : ${humanBytes(policy.maxInputBytes)}.`,
      {
        code: MEDIA_ERROR.TOO_LARGE,
        maxBytes: policy.maxInputBytes,
        receivedBytes: buffer.length,
        mediaType,
      },
    );
  }

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    metadata = null;
  }

  // Indécodable = pas une image, quel que soit le nom du fichier.
  if (!metadata || !metadata.format) {
    throw ApiError.badRequest(
      'Ce fichier n’est pas une image lisible. Formats acceptés : '
      + `${ACCEPTED_IMAGE_FORMATS.join(', ')}.`,
      { code: MEDIA_ERROR.INVALID, mediaType },
    );
  }

  if (!ACCEPTED_IMAGE_FORMATS.includes(metadata.format)) {
    throw new ApiError(
      415,
      `Format d’image non pris en charge : ${metadata.format}. `
      + `Formats acceptés : ${ACCEPTED_IMAGE_FORMATS.join(', ')}.`,
      { code: MEDIA_ERROR.TYPE_UNSUPPORTED, format: metadata.format, mediaType },
    );
  }

  const largeur = metadata.width ?? 0;
  const hauteur = metadata.height ?? 0;
  if (largeur > MAX_PIXELS_PER_SIDE || hauteur > MAX_PIXELS_PER_SIDE) {
    throw ApiError.badRequest(
      `Cette image est trop grande (${largeur}×${hauteur} pixels). `
      + `Maximum : ${MAX_PIXELS_PER_SIDE} pixels de côté.`,
      {
        code: MEDIA_ERROR.DIMENSIONS_EXCEEDED,
        width: largeur,
        height: hauteur,
        maxPixelsPerSide: MAX_PIXELS_PER_SIDE,
        mediaType,
      },
    );
  }

  return {
    format: metadata.format,
    width: largeur,
    height: hauteur,
    bytes: buffer.length,
    policy,
  };
}

export default { validateImage, MEDIA_ERROR, MAX_PIXELS_PER_SIDE };
