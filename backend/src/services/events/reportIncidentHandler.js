// LE HANDLER QUI RAPPORTE UN INCIDENT AU CONTROL PLANE (L12.1).
//
// docs/architecture/EMAIL_TEMPLATE_AUTHORITY.md §« Incident plateforme ».
//
// ── CE QU'IL REMPLACE ───────────────────────────────────────────────────────
//
// `platform.incident.raised` était branché sur une action `SEND_EMAIL` avec le
// modèle `PLATFORM_INCIDENT_DEV_ALERT`. Ce modèle est une communication de
// L.Y Solution vers l'équipe technique : il est de portée PANEL, et un projet
// ne peut pas demander une portée PANEL. L'alerte échouait donc à chaque fois,
// en silence, dans une livraison que personne ne relisait.
//
// Ce handler ne nomme aucun modèle, aucun destinataire, aucun sujet. Il pousse
// des FAITS. Le Panel décide du reste.
//
// ── POURQUOI IL PASSE PAR LA FILE, ET NON PAR UNE CAPACITÉ ──────────────────
//
// Une capacité est un appel synchrone : elle échoue quand le Panel est
// injoignable. Or l'indisponibilité du Panel est justement l'une des familles
// d'incidents qu'on veut remonter — la plus probable, même. Une alerte perdue
// exactement au moment où elle compte n'est pas une alerte.
//
// La file durable du pont rejoue à la reconnexion, déduplique par `writeId` et
// converge sur l'`entityId` dérivé des faits : un incident reste rapporté une
// fois, mais il est rapporté.

import { ACTION_TYPE, EVENT_ERROR_CODES } from '../../utils/domainEventConstants.js';
import { ActionHandlerError, registerHandler } from './eventActionHandlerRegistry.js';
/**
 * LE NOTIFIEUR, JAMAIS LE PONT (règle d'exclusivité des ponts).
 *
 * Ce handler est du MÉTIER : il annonce un fait. `syncTriggers`, qui vit DANS
 * le pont, écoute et le rapporte. Importer la file ici ferait connaître le
 * transport à un handler d'événement — exactement ce que la règle empêche, et
 * exactement ce qu'un lot pressé finirait par contourner.
 */
import { notifyFactReported } from '../../utils/syncNotifier.js';

/**
 * Traduit un événement de domaine en rapport d'incident.
 *
 * Le payload de l'événement est DÉJÀ sûr (le registre le valide à l'émission :
 * `kind` est une énumération fermée, l'erreur est un couple code/message
 * borné). On ne le réécrit donc pas — on le transporte.
 */
export async function handleReportIncident({ event }) {
  const payload = event?.payloadSafe ?? {};

  if (!payload.kind || !payload.component) {
    /**
     * NON REJOUABLE, et c'est délibéré : un événement sans nature ni composant
     * ne décrit aucun incident. Le réessayer quatre fois produirait quatre
     * échecs identiques avant le même DEAD_LETTER, avec un journal plus long et
     * pas une information de plus.
     */
    throw new ActionHandlerError(
      EVENT_ERROR_CODES.INVALID_PAYLOAD,
      'Incident sans nature ni composant : rien à rapporter.',
      false,
    );
  }

  const pris = notifyFactReported('PLATFORM_INCIDENT', {
    incident: {
      kind: payload.kind,
      component: payload.component,
      environment: payload.environment,
      occurrences: payload.occurrences,
      firstSeenAt: payload.firstSeenAt,
      error: payload.error ?? { code: '', message: '' },
    },
    eventId: event?.eventId ?? null,
  });

  if (!pris) {
    /**
     * REJOUABLE : personne n'écoute encore (démarrage, migration, seed). Ce
     * n'est pas une erreur de l'incident, c'est un problème de moment — et la
     * reprise périodique des actions en attente le retentera.
     *
     * Le déclarer réussi serait pire que de le rejouer : l'incident serait
     * perdu en silence, et c'est précisément la panne qu'on essaie de faire
     * remonter.
     */
    throw new ActionHandlerError(
      EVENT_ERROR_CODES.ACTION_HANDLER_NOT_IMPLEMENTED,
      'Le pont n’est pas branché : l’incident n’a pas encore pu être rapporté.',
      true,
    );
  }

  return {
    reported: true,
    /** Ce que le projet SAIT : il a rapporté. Il ne sait pas si un e-mail part. */
    decidedBy: 'CONTROL_PLANE',
  };
}

/** Branche le handler. Rend la fonction de débranchement, comme ses voisins. */
export function registerReportIncidentHandler() {
  return registerHandler(ACTION_TYPE.REPORT_INCIDENT, handleReportIncident);
}

export default { handleReportIncident, registerReportIncidentHandler };
