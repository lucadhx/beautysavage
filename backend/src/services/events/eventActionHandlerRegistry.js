import { ACTION_TYPE, EVENT_ERROR_CODES, SINGLE_RECIPIENT_KEY } from '../../utils/domainEventConstants.js';

/**
 * Registre des HANDLERS d'action — le code qui exécute réellement une action.
 *
 * Un handler reçoit `{ event, action, execution }` et renvoie :
 *   { status: 'SUCCEEDED', providerMessageId? }
 *   { status: 'SKIPPED', reason? }
 * ou lève une `ActionHandlerError` portant `retryable`.
 *
 * Il ne doit JAMAIS :
 *  - modifier l'événement ;
 *  - remettre en cause l'opération métier d'origine ;
 *  - journaliser un secret.
 */

export class ActionHandlerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {boolean} retryable Une nouvelle tentative a-t-elle une chance ?
   *   `false` = échec définitif (config manquante, action impossible) → DEAD_LETTER
   *   immédiat, sans épuiser les tentatives pour rien.
   */
  constructor(code, message, retryable = false) {
    super(message);
    this.name = 'ActionHandlerError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Handler neutre. Sert de brique de test du dispatcher (et de socle pour une
 * action « trace seule »). N'a aucun effet de bord.
 */
async function noOpHandler() {
  return { status: 'SUCCEEDED' };
}

/**
 * Envoi d'e-mail — DÉFAUT DE REPLI, remplacé au démarrage.
 *
 * L'implémentation réelle vit dans `services/email/sendEmailHandler.js` et
 * s'enregistre via `registerHandler` au bootstrap. Ce défaut reste en place pour
 * le cas où le module e-mail n'aurait PAS été enregistré (test isolé, script qui
 * ne passe pas par le bootstrap) : il échoue alors franchement plutôt que de
 * laisser croire qu'un e-mail est parti.
 *
 * NON RETRYABLE : réessayer 4 fois un handler absent ne ferait que remplir le
 * journal. DEAD_LETTER immédiat et lisible.
 */
async function sendEmailHandler() {
  throw new ActionHandlerError(
    EVENT_ERROR_CODES.ACTION_HANDLER_NOT_IMPLEMENTED,
    "Le module d'envoi d'e-mail n'est pas enregistré dans ce processus. Aucun e-mail n'a été envoyé.",
    false
  );
}

/** Défauts. Remplaçables via `registerHandler` (cf. ci-dessous). */
const HANDLERS = new Map([
  [ACTION_TYPE.NO_OP, noOpHandler],
  [ACTION_TYPE.SEND_EMAIL, sendEmailHandler],
]);

/**
 * Enregistre l'implémentation d'un type d'action.
 *
 * C'est le point d'entrée prévu pour le lot e-mail : `EmailDeliveryService`
 * s'enregistrera lui-même au démarrage plutôt que d'être importé ici. Ce sens de
 * dépendance évite un cycle (le dispatcher n'a pas à connaître l'e-mail) et garde
 * ce registre sans dépendance métier.
 *
 * Renvoie une fonction de restauration — indispensable aux tests, qui doivent
 * pouvoir remettre le handler d'origine sans laisser fuiter leur stub.
 */
export function registerHandler(actionType, handler) {
  const previous = HANDLERS.get(actionType);
  HANDLERS.set(actionType, handler);
  return () => {
    if (previous) HANDLERS.set(actionType, previous);
    else HANDLERS.delete(actionType);
  };
}

export function hasHandler(actionType) {
  return HANDLERS.has(actionType);
}

export function getHandler(actionType) {
  const handler = HANDLERS.get(actionType);
  if (!handler) {
    throw new ActionHandlerError(
      EVENT_ERROR_CODES.UNKNOWN_ACTION_TYPE,
      `Aucun handler pour l'action « ${actionType} ».`,
      false
    );
  }
  return handler;
}

/**
 * Résolveur de clés de destinataires — REMPLAÇABLE, comme les handlers.
 *
 * Par défaut : une exécution unique `_single`, ce qui convient à toute action
 * sans destinataire (`NO_OP`). Le module e-mail enregistre le sien au bootstrap.
 *
 * Ce sens de dépendance est délibéré : importer `emailRecipientResolvers` ici
 * ferait connaître le métier e-mail au dispatcher, et créerait le cycle que
 * `registerHandler` existe justement pour éviter. Ce registre ne doit dépendre de
 * rien.
 */
let recipientKeyResolver = async () => [SINGLE_RECIPIENT_KEY];

/**
 * Enregistre le résolveur de clés. Renvoie une fonction de restauration — les
 * tests doivent pouvoir retirer leur stub sans le laisser fuiter.
 */
export function registerRecipientKeyResolver(resolver) {
  const previous = recipientKeyResolver;
  recipientKeyResolver = resolver;
  return () => {
    recipientKeyResolver = previous;
  };
}

/**
 * Destinataires d'une action, sous forme de clés STABLES.
 *
 * Une exécution PAR destinataire : sans cela, un succès sur l'un masquerait un
 * échec sur l'autre, et un retry global renverrait à tout le monde.
 *
 * @param {object} action
 * @param {object} event
 * @returns {Promise<string[]>}
 */
export async function resolveRecipientKeys(action, event) {
  return recipientKeyResolver(action, event);
}

export default { getHandler, hasHandler, resolveRecipientKeys };
