// LA PROJECTION DES MODÈLES — une façade de VOCABULAIRE, pas de mécanisme.
//
// ── POURQUOI CE FICHIER EXISTE, ET PAS UN IMPORT DIRECT ─────────────────────
//
// L'architecture des ponts interdit à tout composant métier d'importer le
// module de pont : le transport, l'appairage, la file et l'ordonnanceur ne
// doivent avoir aucun appelant hors de `services/panelBridge/`. La règle est
// vérifiée par `bridge-conformity.test.js`, et elle a une raison — un métier
// qui connaît le transport finit par en dépendre, puis par le contourner.
//
// Deux exceptions existent déjà, et elles ont exactement la même nature :
// `bridgeContract.js` (le vocabulaire des entités) et `capabilityClient.js`
// (« je demande un verbe, le Panel décide du reste »). Celui-ci est la
// troisième : « je LIS ce que le Panel sert à ce projet ».
//
// Il n'expose que des fonctions, aucun état, et aucun accès au transport : le
// métier apprend qu'il n'est pas appairé par un code d'erreur stable, jamais en
// interrogeant l'appairage.
//
// ── POURQUOI CETTE FAÇADE EST EN LECTURE SEULE, DÉFINITIVEMENT ──────────────
//
// Le contenu des modèles appartient au Panel. Ajouter ici un verbe d'écriture
// rouvrirait, en une ligne, la seconde autorité que le lot L12.1 a supprimée —
// et la rouvrirait à l'endroit le plus discret du code. Il n'y en a pas, et il
// ne doit pas y en avoir.

import { getPanelBridge } from './bridgeRuntime.js';
import { bridgeError, BRIDGE_ERROR_CODES } from './bridgeErrors.js';

const METHODES = Object.freeze([
  'listEmailTemplates',
  'getEmailTemplate',
  'previewEmailTemplate',
  'emailTemplateReadiness',
  'sendEmailTemplateTest',
]);

function pont(methode) {
  let instance = null;
  try {
    instance = getPanelBridge();
  } catch {
    instance = null;
  }
  if (!instance || typeof instance[methode] !== 'function') {
    throw bridgeError(
      BRIDGE_ERROR_CODES.NOT_PAIRED,
      'Aucun Panel appairé : les modèles d’e-mail ne peuvent pas être consultés. '
      + 'Ce projet ne détient plus de copie locale — c’est délibéré.',
    );
  }
  return instance;
}

/** Le pont peut-il répondre ? Sert aux écrans à distinguer « vide » d'« injoignable ». */
export function templateProjectionAvailable() {
  try {
    const instance = getPanelBridge();
    return METHODES.every((m) => typeof instance?.[m] === 'function');
  } catch {
    return false;
  }
}

export async function fetchTemplateProjection() {
  return pont('listEmailTemplates').listEmailTemplates();
}

export async function fetchTemplate(templateCode) {
  return pont('getEmailTemplate').getEmailTemplate(templateCode);
}

export async function fetchTemplatePreview(templateCode) {
  return pont('previewEmailTemplate').previewEmailTemplate(templateCode);
}

export async function fetchTemplateReadiness(templateCode) {
  return pont('emailTemplateReadiness').emailTemplateReadiness(templateCode);
}

export async function requestTemplateTestSend(templateCode, recipientEmail) {
  return pont('sendEmailTemplateTest').sendEmailTemplateTest(templateCode, recipientEmail);
}

export default {
  fetchTemplate,
  fetchTemplatePreview,
  fetchTemplateProjection,
  fetchTemplateReadiness,
  requestTemplateTestSend,
  templateProjectionAvailable,
};
