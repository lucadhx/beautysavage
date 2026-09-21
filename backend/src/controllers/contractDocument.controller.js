import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Contract } from '../models/Contract.model.js';
import { streamDocument } from '../services/contractDocument.service.js';
import { findAdminContract } from '../services/contract.service.js';
import {
  resolveProjectMediaAuthority, relayToProjectAuthority,
} from '../services/media/projectMediaAuthority.js';
import { ROLES } from '../utils/constants.js';

/**
 * Téléchargement sécurisé des PDF de contrat (original / signé). Endpoint
 * AUTHENTIFIÉ + contrôle d'accès + streaming (jamais de chemin public direct).
 * DEV : tous les contrats. ADMIN : uniquement SON contrat (le contrat activable/
 * vivant), jamais un contrat arbitraire.
 */
async function loadWithAccess(req) {
  const contract = await Contract.findById(req.params.id);
  if (!contract) throw ApiError.notFound('Contrat introuvable.');
  if (req.user.role !== ROLES.DEV) {
    const mine = await findAdminContract();
    if (!mine || String(mine._id) !== String(contract._id)) throw ApiError.forbidden();
  }
  return contract;
}

/**
 * LE PDF D'UN CONTRAT VIT LÀ OÙ VIVENT LES MÉDIAS DU PROJET — pas ailleurs.
 *
 * ══ LE DÉFAUT QUE CE RELAIS FERME ═══════════════════════════════════════════
 *
 * Les documents de contrat s'écrivaient sur le DISQUE de l'instance qui
 * recevait l'import. Un PDF déposé depuis un poste de développement n'existait
 * que sur ce poste ; le Manager déployé ne l'avait jamais vu, et l'éditeur de
 * zones y ouvrait un document introuvable. Inversement, un PDF déposé sur le
 * déployé restait invisible en local.
 *
 * Deux disques, deux vérités — exactement le défaut que les médias IMAGE
 * avaient déjà résolu, et par un moyen qu'il suffisait d'appliquer ici.
 *
 * ══ LA MÊME RÈGLE QUE LES IMAGES, SANS EN INVENTER UNE SECONDE ══════════════
 *
 * Le backend DÉPLOYÉ du projet est l'autorité ; toute autre instance RELAIE et
 * ne conserve rien. Il n'y a qu'un seul dossier, donc rien à synchroniser,
 * rien à dupliquer, et aucune fenêtre pendant laquelle deux copies divergent.
 *
 * On réutilise `projectMediaAuthority` tel quel : une politique de conflit
 * propre aux PDF serait une seconde doctrine à tenir, pour un besoin identique.
 *
 * ══ CE QUI NE CHANGE PAS ════════════════════════════════════════════════════
 *
 * Le contrôle d'accès reste ICI, avant toute décision de relais : un ADMIN ne
 * lit que SON contrat, et cela se vérifie sur l'instance qui reçoit l'appel.
 * Le relais reporte le jeton de l'appelant, et l'autorité revérifie de son
 * côté — la garde n'est pas déplacée, elle est appliquée deux fois.
 */
async function servirDocument(req, res, variante) {
  const contract = await loadWithAccess(req);

  const { isAuthority, authority } = await resolveProjectMediaAuthority();
  if (isAuthority || !authority) {
    await streamDocument(res, contract, variante);
    return;
  }

  const amont = await relayToProjectAuthority(authority, req.originalUrl, {
    method: 'GET',
    headers: req.headers.authorization ? { authorization: req.headers.authorization } : {},
  }).catch(() => null);

  /**
   * AUCUN REPLI SUR LE DISQUE LOCAL. Se rabattre ici servirait une copie
   * périmée — ou pire, un document d'un autre état du contrat — en donnant
   * l'impression que tout va bien. Le relais échoue, la lecture échoue.
   */
  if (!amont || !amont.ok) {
    throw ApiError.badRequest(
      'Le stockage documentaire du projet est injoignable : le PDF ne peut pas être lu. '
      + 'Aucun document local n’a été servi — un contrat n’existe qu’à un seul endroit.',
      { code: 'PROJECT_DOCUMENT_AUTHORITY_UNREACHABLE' },
    );
  }

  /**
   * LES EN-TÊTES QUI FONT QU'UN VISIONNEUR FONCTIONNE. `content-type` pour que
   * PDF.js accepte le flux, `content-length` et `accept-ranges` pour qu'il
   * puisse demander des plages sur un document de plusieurs pages, et
   * `content-disposition` tel quel — `inline`, jamais forcé en pièce jointe.
   */
  for (const entete of ['content-type', 'content-length', 'content-disposition', 'accept-ranges', 'content-range']) {
    const valeur = amont.headers.get(entete);
    if (valeur) res.setHeader(entete, valeur);
  }
  res.status(amont.status);

  const buffer = Buffer.from(await amont.arrayBuffer());
  res.end(buffer);
}

export const downloadOriginal = asyncHandler(async (req, res) => {
  await servirDocument(req, res, 'original');
});

export const downloadSigned = asyncHandler(async (req, res) => {
  await servirDocument(req, res, 'signed');
});

/**
 * LA PREUVE D'AUDIT — même porte, même garde, pièce différente.
 *
 * Elle passe par `servirDocument` comme les deux autres : même contrôle
 * d'accès, même relais vers l'autorité documentaire, même refus de se rabattre
 * sur une copie locale. Lui écrire un chemin à part aurait créé une seconde
 * porte à garder — et une porte qu'on oublie de garder.
 */
export const downloadCertificate = asyncHandler(async (req, res) => {
  await servirDocument(req, res, 'certificate');
});
