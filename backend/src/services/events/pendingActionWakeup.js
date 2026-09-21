/**
 * RÉVEILLER CE QUI ATTENDAIT UNE DONNÉE QUI VIENT D'ARRIVER.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Un message de confirmation d'encaissement refuse de partir tant que la
 * facture du prestataire n'est pas parvenue : son bouton « Voir ma facture »
 * mènerait à une liste vide, à l'instant précis où l'on confirme un débit.
 * L'exécution se déclare donc REJOUABLE, et l'ordonnanceur la reprend à 30 s,
 * 2 min, 10 min.
 *
 * Sauf qu'il n'y a pas d'ordonnanceur. Le dispatcher de ce dépôt est embarqué
 * et l'assume : « sans passage périodique, un FAILED retryable attend le
 * prochain démarrage ou le prochain appel du script. Il n'y a PAS de minuterie
 * interne : en ajouter une ferait tourner du travail de fond invisible dans
 * chaque instance. »
 *
 * Cette limite est un CHOIX, et il est bon. Mais il laissait la confirmation
 * d'un paiement client attendre un redémarrage — ce qui n'est pas acceptable
 * pour le seul message qu'on doive à quelqu'un qui vient d'être débité.
 *
 * ══ ON N'AJOUTE PAS DE MINUTERIE : ON ÉCOUTE L'ARRIVÉE ══════════════════════
 *
 * Ce que le message attendait n'est pas un DÉLAI, c'est un FAIT — la facture.
 * Et ce fait arrive par un webhook, c'est-à-dire par un événement qu'on traite
 * déjà. Il n'y a donc rien à sonder : au moment où la donnée manquante entre,
 * on rend les exécutions qui l'attendaient immédiatement éligibles, et on passe.
 *
 * C'est la même doctrine que la convergence des revenus côté Panel : on ne
 * balaie pas en boucle, on reprend quand la preuve arrive.
 *
 * ══ CE MODULE NE RÉVEILLE QUE CE QUI L'A DEMANDÉ ════════════════════════════
 *
 * Trois filtres, et aucun n'est décoratif :
 *
 *   · `status: FAILED` — jamais une exécution en cours, jamais une réussie ;
 *   · `lastErrorSafe.retryable === true` — l'exécution a DÉCLARÉ qu'un nouvel
 *     essai avait un sens. Un DEAD_LETTER, lui, a déjà conclu que non, et le
 *     réveiller reviendrait à ignorer ce verdict ;
 *   · les événements de CE contrat — la facture qui vient d'arriver ne dit
 *     rien de ce qu'attendent les autres.
 *
 * Rejouer reste sûr de toute façon : l'index unique `(eventId, actionId,
 * recipientKey)` et la clé d'idempotence de la livraison interdisent le second
 * envoi. Ce module accélère une reprise, il ne la rend pas possible.
 */
import { DomainEvent } from '../../models/DomainEvent.model.js';
import { EventActionExecution } from '../../models/EventActionExecution.model.js';
import { EXECUTION_STATUS } from '../../utils/domainEventConstants.js';
import { logger } from '../../utils/logger.js';

/**
 * REND ÉLIGIBLES, PUIS REPREND, les envois en attente d'un contrat.
 *
 * NE LÈVE JAMAIS : l'appelant est un webhook, et une exception y produirait une
 * 500 — donc un rejeu du prestataire en boucle sur un paiement déjà encaissé.
 *
 * @param {string|object} contractId
 * @returns {Promise<{awakened:number, processed:number}>}
 */
export async function wakePendingActionsForContract(contractId) {
  const rien = { awakened: 0, processed: 0 };
  if (!contractId) return rien;

  try {
    const evenements = await DomainEvent
      .find({ entityType: 'Contract', entityId: String(contractId) })
      .select('eventId')
      .lean();
    if (evenements.length === 0) return rien;

    const reveil = await EventActionExecution.updateMany(
      {
        eventId: { $in: evenements.map((e) => e.eventId) },
        status: EXECUTION_STATUS.FAILED,
        'lastErrorSafe.retryable': true,
      },
      { $set: { availableAt: new Date() } },
    );

    const reveilles = reveil.modifiedCount ?? 0;
    if (reveilles === 0) return rien;

    logger.info(
      `[events] ${reveilles} envoi(s) en attente réveillé(s) pour le contrat ${contractId} : `
      + 'la donnée qu’ils attendaient vient d’arriver.',
    );

    /**
     * L'IMPORT EST TARDIF, ET C'EST VOULU.
     *
     * Le dispatcher importe les gestionnaires d'action, qui importent le module
     * e-mail, qui importe la facturation. Un import en tête de fichier fermerait
     * ce cycle et ferait échouer le chargement du webhook — pas l'envoi, le
     * CHARGEMENT — pour une dépendance qui n'est utile qu'ici.
     */
    const { processPendingEventActions } = await import('./domainEventDispatcher.service.js');
    const { processed } = await processPendingEventActions();
    return { awakened: reveilles, processed: processed ?? 0 };
  } catch (err) {
    logger.warn(
      `[events] réveil des envois en attente impossible pour ${contractId} — `
      + `${err?.message ?? 'erreur inconnue'}. Ils repartiront au prochain démarrage.`,
    );
    return rien;
  }
}

export default { wakePendingActionsForContract };
