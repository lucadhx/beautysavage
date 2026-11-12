import mongoose from 'mongoose';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { CommerceProduct, PRODUCT_STATUS } from '../models/CommerceProduct.model.js';
import { TrainingAccessGrant } from '../models/TrainingAccessGrant.model.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * QUI A ACCÈS À QUELLE FORMATION — une seule règle, lue par tous les parcours
 * (repris de melinails, 2026-11-09).
 *
 * Une cliente a accès à une formation quand une vente PAYÉE porte :
 *   · une ligne de cette formation (en ligne ou en présentiel) ;
 *   · ou une ligne de PACK qui la contient. Le pack est lu dans l'INSTANTANÉ de
 *     la vente (`productSnapshot.pack.productIds`) : retirer une formation du
 *     pack au Manager n'enlève rien à celles qui l'ont déjà payé.
 *
 * Une ligne annulée (`cancellation.at`) ne donne plus accès.
 */

export const TRAINING_KINDS = Object.freeze(['DISTANCE_TRAINING', 'IN_PERSON_TRAINING']);
export const PACK_KIND = 'TRAINING_PACK';

const id = (value) => String(value?._id ?? value ?? '');

/** Les formations qu'ouvre une ligne de vente (elle-même, ou le contenu du pack). */
export function trainingIdsOfLine(line) {
  const kind = line?.productSnapshot?.kind;
  if (TRAINING_KINDS.includes(kind)) return [id(line.productId)];
  if (kind === PACK_KIND) return (line.productSnapshot?.pack?.productIds || []).map(id).filter(Boolean);
  return [];
}

const lineActive = (line) => !line?.cancellation?.at;

/** Les accès d'une cliente : une entrée par (vente, formation). `viaPack` dit d'où vient l'accès. */
export async function customerTrainingGrants(customerId) {
  if (!customerId) return [];
  const me = String(customerId);
  const meId = mongoose.isValidObjectId(me) ? new mongoose.Types.ObjectId(me) : customerId;
  const sales = await CommerceSale.find({
    customerId: meId,
    paymentStatus: 'PAID',
    'lines.productSnapshot.kind': { $in: [...TRAINING_KINDS, PACK_KIND] },
  }).sort({ createdAt: -1 }).lean();
  const grants = [];
  for (const sale of sales) {
    for (const line of sale.lines || []) {
      if (!lineActive(line)) continue;
      const kind = line.productSnapshot?.kind;
      for (const productId of trainingIdsOfLine(line)) {
        grants.push({
          sale,
          line,
          productId,
          viaPack: kind === PACK_KIND ? { id: id(line.productId), title: String(line.productSnapshot?.title || 'Pack de formations') } : null,
          viaManual: false,
        });
      }
    }
  }
  /*
    LES ACCÈS OFFERTS PAR L'INSTITUT (TrainingAccessGrant) — après les achats :
    une formation achetée ET offerte reste présentée comme achetée. La « vente »
    et la « ligne » sont reconstituées pour que l'espace formation, le dossier
    final et les vidéos les lisent comme un achat.
  */
  const manual = await TrainingAccessGrant.find({ customerId: meId, active: true }).sort({ grantedAt: -1 }).lean();
  for (const grant of manual) {
    const sale = { _id: grant._id, saleNumber: '', finalizedAt: grant.grantedAt, createdAt: grant.grantedAt, manualGrant: true };
    const line = { _id: grant._id, productId: grant.productId, sessionId: null, productSnapshot: { kind: 'DISTANCE_TRAINING', title: grant.productTitle || 'Formation' } };
    grants.push({ sale, line, productId: id(grant.productId), viaPack: null, viaManual: true });
  }
  return grants;
}

export async function customerOwnsTraining(customerId, productId) {
  if (!customerId || !mongoose.isValidObjectId(productId)) return false;
  const grants = await customerTrainingGrants(customerId);
  return grants.some((grant) => grant.productId === String(productId));
}

/**
 * UNE VIDÉO NE SE LIT QUE SI ON Y A DROIT.
 *
 * Les adresses de lecture étaient servies à quiconque connaissait l'identifiant
 * de la vidéo — et la fiche publique donnait ces identifiants. Désormais :
 *   · une bande-annonce d'une fiche publiée se lit librement ;
 *   · une vidéo de module se lit seulement par une cliente qui a accès à la
 *     formation (achat direct ou pack) ;
 *   · le Manager passe par ses propres routes, authentifiées.
 */
export async function assertVideoAccess({ provider, videoId, customerId }) {
  const field = provider === 'GOOGLE_DRIVE' ? 'googleDriveFileId' : 'streamableShortcode';
  const needle = String(videoId || '').trim();
  // Lettres, chiffres, « - » et « _ » seulement : sinon la recherche ci-dessous se viderait et répondrait « oui » à tout.
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(needle)) throw ApiError.badRequest('Vidéo inconnue', { code: 'VIDEO_ID_INVALID' });
  const trailer = await CommerceProduct.exists({ status: PRODUCT_STATUS.PUBLISHED, [`trailer.${field}`]: needle });
  if (trailer) return;
  // Aussi la forme « lien complet » d'une bande-annonce saisie sans identifiant extrait.
  const trailerUrl = await CommerceProduct.exists({ status: PRODUCT_STATUS.PUBLISHED, 'trailer.sourceUrl': { $regex: `[/=]${needle}/?$` } });
  if (trailerUrl) return;
  if (!customerId) throw new ApiError(401, 'Connectez-vous pour regarder cette vidéo.', { code: 'VIDEO_LOGIN_REQUIRED' });
  const holders = await CommerceProduct.find({ [`modules.videos.${field}`]: needle }).select('_id').lean();
  if (!holders.length) throw ApiError.notFound('Vidéo inconnue');
  const grants = await customerTrainingGrants(customerId);
  const owned = new Set(grants.map((grant) => grant.productId));
  if (!holders.some((holder) => owned.has(String(holder._id)))) {
    throw ApiError.forbidden('Cette vidéo fait partie d’une formation que vous n’avez pas achetée.', { code: 'TRAINING_NOT_OWNED' });
  }
}
