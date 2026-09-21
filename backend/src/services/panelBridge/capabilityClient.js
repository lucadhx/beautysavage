/**
 * DEMANDER UNE CAPACITÉ AU PANEL — la seule porte ouverte au métier.
 *
 * ══ POURQUOI CE FICHIER EXISTE ══════════════════════════════════════════════
 *
 * `bridge-conformity` interdit au métier d'importer le module de pont : états,
 * outbox, appairage, ordonnanceur, transport. La règle est bonne — un
 * contrôleur qui manipule l'état du pont finit par le piloter.
 *
 * Elle admet déjà UNE exception : `bridgeContract.js`, parce que c'est le
 * VOCABULAIRE partagé, pas le mécanisme. Invoquer une capacité relève de la
 * même nature : c'est utiliser le CONTRAT (« je demande un verbe, le Panel
 * décide de tout le reste »), et non toucher au fonctionnement du pont.
 *
 * D'où cette façade, volontairement minuscule : une fonction, aucune option,
 * aucun état. Elle ne donne accès ni à l'appairage, ni à la file, ni au
 * transport — seulement au droit de demander.
 *
 * ══ CE QU'ELLE NE FAIT PAS ══════════════════════════════════════════════════
 *
 * Elle ne réessaie pas, ne met pas en file, ne dégrade pas. Une capacité est
 * demandée par une action métier qui attend une réponse ; la mettre en file
 * reviendrait à répondre « peut-être, plus tard » à un appelant qui doit
 * décider maintenant.
 */
import { getPanelBridge } from './bridgeRuntime.js';
import { describePairing } from './pairingStore.js';
import { bridgeError, BRIDGE_ERROR_CODES } from './bridgeErrors.js';

/**
 * Le Panel peut-il être sollicité ? (appairé, et parlant un contrat qui
 * connaît les capacités.)
 */
export function capabilitiesAvailable() {
  try {
    const bridge = getPanelBridge();
    return Boolean(bridge && typeof bridge.invokeCapability === 'function');
  } catch {
    return false;
  }
}

/**
 * Demande une capacité. LÈVE — voir `PanelBridge.invokeCapability`.
 *
 * @param {string} code   par exemple `dns.record.ensure`
 * @param {object} input  entrée métier, dont `operationId`
 */
/**
 * LE PANEL SAIT-IL LIRE UN CHAMP APPARU EN 1.<mineure> ?
 *
 * Même nature que `capabilitiesAvailable` : une question sur ce que
 * l'interlocuteur sait faire, sans rien révéler du transport. Elle est ici, et
 * non dans le métier, parce que la réponse appartient au pont.
 *
 * `false` tant qu'aucune réponse n'a été reçue — fail closed. Un champ retenu
 * un cycle de plus ne coûte rien ; un message refusé en bloc rend un projet
 * sain silencieux.
 */
export function panelSpeaks(mineureMinimale) {
  try {
    const bridge = getPanelBridge();
    return typeof bridge?.panelSpeaks === 'function' && bridge.panelSpeaks(mineureMinimale);
  } catch {
    return false;
  }
}

export async function invokeCapability(code, input = {}) {
  let bridge = null;
  try {
    bridge = getPanelBridge();
  } catch {
    bridge = null;
  }
  if (!bridge || typeof bridge.invokeCapability !== 'function') {
    throw bridgeError(
      BRIDGE_ERROR_CODES.NOT_PAIRED,
      'Aucun Panel appairé : aucune capacité ne peut être demandée.',
    );
  }
  return bridge.invokeCapability(code, input);
}

/**
 * Le secret de VÉRIFICATION de ce projet (L6.3A).
 *
 * Exposé ICI, à côté des capacités, et non par un accès direct au runtime du
 * pont : un composant métier ne doit connaître qu'une seule porte vers le
 * Panel. C'est cette règle qui permet de savoir, en lisant une liste
 * d'imports, tout ce qu'un service peut demander au Panel.
 */
export async function fetchWebhookVerificationSecret(provider) {
  let bridge = null;
  try {
    bridge = getPanelBridge();
  } catch {
    bridge = null;
  }
  if (!bridge || typeof bridge.fetchWebhookVerificationSecret !== 'function') {
    throw bridgeError(
      BRIDGE_ERROR_CODES.NOT_PAIRED,
      'Aucun Panel appairé : aucun secret de vérification ne peut être demandé.',
    );
  }
  return bridge.fetchWebhookVerificationSecret(provider);
}

/**
 * L'ADRESSE DU PANEL APPAIRÉ (L12.B) — pour le parcours de connexion fédérée.
 *
 * ── POURQUOI PASSER PAR ICI, ET NON PAR `describePairing()` ────────────────
 *
 * Parce que la règle de conformité du pont est bonne, et qu'elle vaut aussi
 * quand elle dérange : le métier ne connaît qu'UNE porte vers le Panel, et
 * cette porte est ce fichier. Importer `pairingStore` depuis un service
 * d'authentification donnerait à ce service l'accès à l'appairage entier —
 * jeton compris.
 *
 * On ne rend donc que l'URL. Elle n'est pas un secret : le Manager l'affiche
 * déjà dans l'écran « Aide », et le navigateur du développeur devra y aller.
 *
 * `null` quand le projet n'est pas appairé : la fédération est alors
 * impossible, et le dire franchement vaut mieux que de composer une URL vide.
 */
export function panelUrlForFederation() {
  try {
    const description = describePairing();
    return description?.paired ? String(description.panelUrl || '') || null : null;
  } catch {
    return null;
  }
}

/**
 * L'ORIGINE PUBLIQUE DU PANEL, TELLE QU'IL L'A DÉCLARÉE — ou `null`.
 *
 * Même porte, même raison que ci-dessus : la fédération a besoin de savoir où
 * envoyer un NAVIGATEUR, ce qui n'est pas la même question que « où le pont
 * appelle-t-il ». Elle passe donc par ici, et n'accède pas à l'appairage.
 *
 * `null` a un sens précis : le Panel n'a rien déclaré. L'appelant décide alors
 * s'il déduit, et le dit — il ne complète pas en silence.
 */
export function panelFrontendUrlForFederation() {
  try {
    const description = describePairing();
    return description?.paired ? String(description.panelFrontendUrl || '') || null : null;
  } catch {
    return null;
  }
}

/**
 * NOTRE IDENTIFIANT DE PROJET — l'audience que les assertions doivent viser.
 *
 * ── POURQUOI IL VIENT DE L'APPAIRAGE, ET DE NULLE PART AILLEURS ────────────
 *
 * C'est le `projectId` que le Panel nous a attribué au bootstrap. Le lire
 * d'une variable d'environnement ou d'un fichier de configuration ferait de
 * l'audience une valeur qu'un exploitant peut se tromper en recopiant — et une
 * audience mal recopiée accepterait les assertions d'un autre projet.
 *
 * Bénéfice de bord : un projet DUPLIQUÉ reçoit son propre identifiant à son
 * propre appairage, et refuse donc les assertions de son modèle sans qu'on ait
 * quoi que ce soit à reconfigurer.
 */
export function projectIdForFederation() {
  try {
    const description = describePairing();
    return description?.paired ? String(description.projectId || '') || null : null;
  } catch {
    return null;
  }
}

/**
 * L'IDENTITÉ FÉDÉRÉE EST-ELLE ENCORE VALABLE ? (L12.B)
 *
 * ── CE QUE CET APPEL PERMET, ET POURQUOI IL EXISTE ────────────────────────
 *
 * Une assertion vit trois minutes ; la session qu'elle ouvre vit plus
 * longtemps. Entre les deux, le compte peut être désactivé, son accès retiré,
 * l'appairage révoqué. Sans ce verbe, la seule façon de couper une session
 * fédérée serait d'éditer la base de CE projet à la main — exactement ce que
 * la fédération existe pour éviter.
 *
 * Le Panel décide ; nous ne faisons que demander. Il ne nous dit pas POURQUOI
 * il refuse : « inconnu », « désactivé » et « sans accès ici » sont
 * indistinguables, et notre réaction est la même dans les trois cas.
 */
export async function introspectFederatedPrincipal(input = {}) {
  let bridge = null;
  try {
    bridge = getPanelBridge();
  } catch {
    bridge = null;
  }
  if (!bridge || typeof bridge.introspectFederatedPrincipal !== 'function') {
    throw bridgeError(
      BRIDGE_ERROR_CODES.NOT_PAIRED,
      'Aucun Panel appairé : aucune identité fédérée ne peut être vérifiée.',
    );
  }
  return bridge.introspectFederatedPrincipal(input);
}

export default {
  invokeCapability,
  capabilitiesAvailable,
  panelSpeaks,
  fetchWebhookVerificationSecret,
  introspectFederatedPrincipal,
  panelUrlForFederation,
  panelFrontendUrlForFederation,
  projectIdForFederation,
};
