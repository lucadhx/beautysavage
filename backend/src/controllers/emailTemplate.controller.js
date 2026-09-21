// LES MODÈLES D'E-MAIL VUS PAR LE MANAGER — LECTURE SEULE.
//
// docs/architecture/EMAIL_TEMPLATE_AUTHORITY.md.
//
// ── CE QUI A DISPARU, ET POURQUOI (L12.1) ───────────────────────────────────
//
// Ce contrôleur exposait `PUT /:templateId` et `POST /:templateId/versions/:v/
// restore`, plus un aperçu rendu localement. Ils écrivaient dans une base de
// modèles propre au projet, que RIEN n'expédiait : le contenu réellement
// envoyé vient du Panel depuis le lot L8.4C. L'audit a montré la conséquence —
// sept modèles sur quatorze divergeaient, et l'écran affichait le mauvais avec
// la même assurance que le bon.
//
// Toutes les lectures traversent désormais le pont. La page du Manager montre
// donc EXACTEMENT ce que le Panel résoudrait à l'envoi, ou dit pourquoi elle ne
// peut pas le montrer.
//
// ── POURQUOI AUCUN CACHE LOCAL DE CONTENU ───────────────────────────────────
//
// Parce qu'un cache de contenu redeviendrait une copie, donc une chose capable
// de diverger, donc une seconde autorité de fait — celle qu'on retire. Le
// Panel injoignable produit une erreur explicite, pas un affichage périmé :
// « je ne sais pas » est une réponse honnête, « voici ce qui partait hier » ne
// l'est pas.

import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  getProjectionEntry,
  listProjection,
  previewProjection,
  projectionReadiness,
  sendProjectionTest,
} from '../services/email/emailTemplateContract.service.js';
import { describeDeclaredTemplates } from '../utils/projectEmailTemplateUsage.js';
import { EmailDelivery } from '../models/EmailDelivery.model.js';
import { serializeDelivery } from '../services/email/emailDelivery.service.js';

/**
 * Un Panel injoignable n'est pas une erreur du projet : le dire ainsi évite
 * qu'un exploitant cherche la panne dans son propre écran.
 */
function relayBridgeError(err) {
  const code = String(err?.code ?? '');
  if (code.startsWith('BRIDGE_') || code === 'PANEL_UNREACHABLE') {
    return ApiError.serviceUnavailable(
      'La plateforme qui administre les modèles d’e-mail n’est pas joignable pour l’instant. '
      + 'Les templates sont administrés depuis L.Y Solution — ce projet n’en conserve aucune copie.',
      { code: 'TEMPLATE_AUTHORITY_UNREACHABLE' },
    );
  }
  return err;
}

export const list = asyncHandler(async (req, res) => {
  try {
    ok(res, await listProjection());
  } catch (err) {
    throw relayBridgeError(err);
  }
});

/**
 * CE QUE CE PROJET DÉCLARE CONSOMMER — sa seule autorité en la matière.
 *
 * Distinct de la liste ci-dessus : celle-ci vient du Panel et dit ce qui est
 * SERVI ; celle-là vient du code et dit ce qui est DEMANDÉ. Les confronter est
 * exactement ce qui permet de comprendre un « modèle non déclaré ».
 */
export const usage = asyncHandler(async (req, res) => {
  ok(res, describeDeclaredTemplates());
});

export const getOne = asyncHandler(async (req, res) => {
  try {
    ok(res, await getProjectionEntry(req.params.templateId));
  } catch (err) {
    throw relayBridgeError(err);
  }
});

export const preview = asyncHandler(async (req, res) => {
  try {
    ok(res, await previewProjection(req.params.templateId));
  } catch (err) {
    throw relayBridgeError(err);
  }
});

export const readiness = asyncHandler(async (req, res) => {
  try {
    ok(res, await projectionReadiness(req.params.templateId));
  } catch (err) {
    throw relayBridgeError(err);
  }
});

/**
 * L'ENVOI DE TEST — exécuté par le PANEL, avec l'autorité du Panel.
 *
 * Il empruntait auparavant le chemin d'envoi du projet avec des variables de
 * démonstration locales. Le contenu partait déjà du Panel, mais les valeurs
 * d'exemple venaient d'un registre local qui pouvait ne plus correspondre au
 * vocabulaire réel. Le test éprouve désormais exactement la chaîne qu'un envoi
 * métier emprunte, avec les exemples de celui qui possède le modèle.
 */
export const testSend = asyncHandler(async (req, res) => {
  const recipientEmail = String(req.body?.recipientEmail ?? '').trim().toLowerCase();
  if (!recipientEmail) {
    throw ApiError.badRequest('Une adresse destinataire est requise pour un envoi de test.');
  }
  try {
    ok(res, await sendProjectionTest(req.params.templateId, recipientEmail));
  } catch (err) {
    throw relayBridgeError(err);
  }
});

/**
 * LES LIVRAISONS D'UN MODÈLE — la seule lecture qui reste LOCALE, et à raison.
 *
 * Le suivi des envois appartient au projet : ce sont SES messages, vers SES
 * destinataires. Seul le CONTENU appartenait au Panel.
 */
export const deliveries = asyncHandler(async (req, res) => {
  const docs = await EmailDelivery.find({ templateId: req.params.templateId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  ok(res, docs.map(serializeDelivery));
});

export default { list, usage, getOne, preview, readiness, testSend, deliveries };
