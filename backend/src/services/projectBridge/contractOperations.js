/**
 * OPÉRATIONS CONTRACTUELLES INVOCABLES PAR LE PANEL.
 *
 * ── LA RÈGLE, ET ELLE NE SE NÉGOCIE PAS ─────────────────────────────────────
 * Le Panel ne résilie rien. Il DEMANDE. Le projet reste l'autorité : c'est lui
 * qui connaît son abonnement Stripe, ses transitions autorisées, son
 * environnement. Une résiliation appliquée depuis le Panel dans sa propre
 * projection serait un mensonge — la projection dirait « résilié » pendant que
 * le contrat, lui, continuerait de courir.
 *
 * Ces opérations n'écrivent donc rien vers le Panel. Elles exécutent la
 * transition ici, et la projection CONTRACT repart d'elle-même par l'outbox
 * — le chemin normal, celui qui vaut pour toute modification.
 *
 * ── TEST / PROD ─────────────────────────────────────────────────────────────
 * `requestCancellation` applique déjà la règle : en PROD, résiliation EN FIN
 * DE PÉRIODE ; en TEST, résiliation immédiate pour rejouer un cycle sans
 * attendre un mois. Le catalogue le reflète honnêtement — `contract.cancel_now`
 * n'est PUBLIÉE qu'en TEST. Un Panel ne peut donc pas l'invoquer en production,
 * même en forgeant la requête : elle n'existe pas dans le catalogue, et
 * l'invocation est refusée avant toute écriture.
 */
import { config } from '../../config/env.js';
import logger from '../../utils/logger.js';
import { CONTRACT_STATUS } from '../../utils/contractConstants.js';
import Contract from '../../models/Contract.model.js';
import { SiteStatus } from '../../models/SiteStatus.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { requestCancellation } from '../contract.service.js';
import { setContractProtection } from '../siteEnforcement.service.js';
import { bridgeError, BRIDGE_ERROR_CODES } from '../panelBridge/bridgeErrors.js';

/**
 * Invocations déjà traitées, par `invocationId`.
 *
 * Le contrat impose l'idempotence : une relivraison — réseau incertain, Panel
 * qui réessaie — ne doit pas résilier deux fois. La mémoire suffit ici : une
 * invocation rejouée après redémarrage retomberait de toute façon sur un
 * contrat qui n'est plus ACTIVE, et serait refusée par la machine à états.
 */
const invocations = new Map();
const INVOCATION_MEMORY = 500;

export const CONTRACT_OPERATIONS = Object.freeze({
  CANCEL_AT_PERIOD_END: 'contract.cancel_at_period_end',
  CANCEL_NOW: 'contract.cancel_now',
  /**
   * PROTECTION CONTRACTUELLE — le Panel demande, le projet applique.
   *
   * Elle ne dépend d'AUCUN contrat : c'est précisément quand il n'y en a pas
   * qu'on veut pouvoir l'activer. Elle est donc toujours disponible, là où les
   * résiliations exigent un contrat vivant.
   */
  SET_PROTECTION: 'contract.set_protection',
});

/** Le contrat vivant, ou `null`. Même règle que la projection : ACTIVE d'abord. */
async function livingContract() {
  return Contract.findOne({
    status: CONTRACT_STATUS.ACTIVE,
    archived: { $ne: true },
  }).sort({ updatedAt: -1 });
}

/**
 * IDENTIFIANTS des opérations publiées — sans toucher à la base.
 *
 * Le manifeste est un DESCRIPTEUR : il doit pouvoir se construire même quand
 * la base est indisponible, sinon un projet en difficulté cesserait aussi de
 * savoir se décrire. La disponibilité, elle, exige de regarder les contrats et
 * vit donc dans `describeContractOperations`.
 */
export function listOperationIds() {
  const ids = [CONTRACT_OPERATIONS.CANCEL_AT_PERIOD_END, CONTRACT_OPERATIONS.SET_PROTECTION];
  if (config.isTest) ids.push(CONTRACT_OPERATIONS.CANCEL_NOW);
  return ids;
}

/**
 * Catalogue FERMÉ. Ce que le Panel n'y lit pas n'existe pas pour lui.
 *
 * `available: false` plutôt qu'une entrée absente quand il n'y a pas de
 * contrat vivant : le Panel doit pouvoir dire « aucun contrat à résilier »
 * au lieu de laisser croire à une panne du pont.
 */
export async function describeContractOperations() {
  // Base indisponible : on publie quand même le catalogue, en annonçant
  // l'indisponibilité. Un descripteur qui expire parce que Mongo tousse
  // transformerait une panne de base en panne de pont.
  let available = false;
  try {
    available = Boolean(await livingContract());
  } catch {
    available = false;
  }

  /**
   * L'état de la protection — et, du même coup, la DISPONIBILITÉ de son réglage.
   *
   * `null` signifie que la fiche du site n'a pas pu être lue (base indisponible).
   * Régler la protection exige précisément cette lecture : annoncer l'opération
   * disponible dans ce cas ferait promettre au catalogue une action qui échouera.
   * Un catalogue est une information — elle doit être vraie.
   */
  const contractProtection = await describeContractProtection();

  const operations = [
    {
      id: CONTRACT_OPERATIONS.CANCEL_AT_PERIOD_END,
      label: 'Programmer la résiliation',
      description: 'Le contrat reste actif jusqu’à son échéance, puis prend fin.',
      available,
      environment: config.env,
      effect: 'CANCEL_AT_PERIOD_END',
    },
    {
      // Disponible SANS contrat — un site qui n'en a aucun est exactement celui
      // qu'on veut pouvoir protéger, et la lier à `available` rendrait le
      // réglage inaccessible dans le seul cas où il change quelque chose.
      // Mais pas disponible sans BASE : c'est elle qui porte le réglage.
      id: CONTRACT_OPERATIONS.SET_PROTECTION,
      label: 'Protection contractuelle',
      description:
        'Détermine si l’absence de contrat actif suspend le site. N’affecte aucune autre cause de suspension.',
      available: contractProtection !== null,
      environment: config.env,
      effect: 'SET_CONTRACT_PROTECTION',
    },
  ];

  // Résiliation IMMÉDIATE : réservée aux environnements de recette. En
  // production, elle couperait un service payé sans préavis — ce n'est pas
  // une décision d'interface.
  if (config.isTest) {
    operations.push({
      id: CONTRACT_OPERATIONS.CANCEL_NOW,
      label: 'Résilier immédiatement',
      description: 'Met fin au contrat de test sur-le-champ, sans attendre l’échéance.',
      available,
      environment: config.env,
      effect: 'ENDED',
    });
  }

  return { operations, contractProtection };
}

/**
 * L'ÉTAT COURANT DE LA PROTECTION — lu, jamais déduit.
 *
 * ── POURQUOI IL VOYAGE AVEC LE CATALOGUE ────────────────────────────────────
 * La projection CONTRACT est un TOMBSTONE quand le projet n'a aucun contrat :
 * y loger ce réglage l'effacerait précisément dans le cas où il décide de
 * tout. Le catalogue, lui, est relu à chaque affichage de la fiche, en direct
 * et depuis le projet — il rend donc l'état réel, jamais une photographie
 * périmée. Le Panel affiche ce qu'il lit ici ; il n'en garde aucune copie
 * qu'il pourrait faire diverger.
 *
 * Base indisponible → `null` : « je ne sais pas » est une réponse, « désactivé »
 * en serait une fausse, et l'écran afficherait un interrupteur qui ment.
 */
async function describeContractProtection() {
  try {
    const site = await getSingleton(SiteStatus);
    return {
      enabled: Boolean(site.contractProtectionEnabled),
      siteStatus: site.status,
      suspensionSource: site.suspensionSource,
      // Le site est-il suspendu POUR CETTE CAUSE ? L'écran peut ainsi dire
      // « suspendu par la protection » sans recalculer la règle de son côté.
      suspendedByProtection: site.suspensionSource === 'CONTRACT',
    };
  } catch {
    return null;
  }
}

function remember(invocationId, result) {
  invocations.set(invocationId, result);
  if (invocations.size > INVOCATION_MEMORY) {
    invocations.delete(invocations.keys().next().value);
  }
  return result;
}

/**
 * Exécute une opération contractuelle.
 *
 * @param {string} operationId
 * @param {{invocationId: string, params?: object}} invocation
 */
export async function invokeContractOperation(operationId, { invocationId, params = {} } = {}) {
  if (invocationId && invocations.has(invocationId)) return invocations.get(invocationId);

  const known = Object.values(CONTRACT_OPERATIONS).includes(operationId);
  if (!known) {
    throw bridgeError(
      BRIDGE_ERROR_CODES.OPERATION_UNKNOWN,
      `Opération inconnue du catalogue : ${operationId}.`,
    );
  }
  // La garde de production est ICI aussi, pas seulement dans le catalogue :
  // un catalogue est une information, une garde est une décision.
  if (operationId === CONTRACT_OPERATIONS.CANCEL_NOW && !config.isTest) {
    throw bridgeError(
      BRIDGE_ERROR_CODES.OPERATION_FAILED,
      'La résiliation immédiate n’est pas autorisée hors environnement de test.',
    );
  }

  /**
   * PROTECTION CONTRACTUELLE — traitée AVANT l'exigence d'un contrat vivant.
   *
   * C'est tout l'objet du réglage : décider si l'absence de contrat suspend le
   * site. Le soumettre à « il faut un contrat actif » le rendrait impossible à
   * activer dans le seul cas où il produit un effet.
   */
  if (operationId === CONTRACT_OPERATIONS.SET_PROTECTION) {
    if (typeof params.enabled !== 'boolean') {
      throw bridgeError(
        BRIDGE_ERROR_CODES.OPERATION_FAILED,
        'Le paramètre « enabled » (booléen) est requis pour régler la protection contractuelle.',
      );
    }
    const site = await setContractProtection({
      enabled: params.enabled,
      actor: { _id: null, role: 'DEV', origin: 'PANEL' },
    });
    logger.info(
      `[bridge] protection contractuelle réglée par le Panel : ${params.enabled ? 'ACTIVÉE' : 'DÉSACTIVÉE'} `
      + `(site ${site.status}, source ${site.suspensionSource}).`,
    );
    const result = {
      operationId,
      invocationId: invocationId ?? null,
      status: 'SUCCEEDED',
      // On rend l'état CONSTATÉ après réconciliation, pas la valeur demandée :
      // c'est ce qui permet au Panel d'afficher la conséquence réelle plutôt
      // que de supposer qu'elle a eu lieu.
      contractProtection: {
        enabled: Boolean(site.contractProtectionEnabled),
        siteStatus: site.status,
        suspensionSource: site.suspensionSource,
        suspendedByProtection: site.suspensionSource === 'CONTRACT',
      },
      environment: config.env,
    };
    return invocationId ? remember(invocationId, result) : result;
  }

  const contract = await livingContract();
  if (!contract) {
    throw bridgeError(
      BRIDGE_ERROR_CODES.OPERATION_FAILED,
      'Aucun contrat actif à résilier.',
    );
  }

  const avant = contract.status;
  try {
    // L'acteur est le PANEL : `requestCancellation` journalise déjà l'audit
    // contractuel local, et le Panel tient le sien de son côté.
    await requestCancellation(contract, { _id: null, role: 'DEV', origin: 'PANEL' });
  } catch (err) {
    throw bridgeError(
      BRIDGE_ERROR_CODES.OPERATION_FAILED,
      err?.message || 'La résiliation a échoué côté projet.',
    );
  }

  const apres = (await Contract.findById(contract._id).lean())?.status ?? avant;
  logger.info(
    `[bridge] résiliation demandée par le Panel (${operationId}) : ${avant} -> ${apres}.`,
  );

  const result = {
    operationId,
    invocationId: invocationId ?? null,
    status: 'SUCCEEDED',
    contract: {
      id: String(contract._id),
      reference: contract.reference || null,
      previousStatus: avant,
      newStatus: apres,
      endsAt: contract.stripe?.subscription?.currentPeriodEnd
        ? new Date(contract.stripe.subscription.currentPeriodEnd).toISOString()
        : null,
    },
    reason: typeof params.reason === 'string' ? params.reason.slice(0, 500) : null,
    environment: config.env,
  };
  return invocationId ? remember(invocationId, result) : result;
}

/** Remise à zéro (tests). */
export function resetContractOperations() {
  invocations.clear();
}

export default {
  CONTRACT_OPERATIONS,
  listOperationIds,
  describeContractOperations,
  invokeContractOperation,
  resetContractOperations,
};
