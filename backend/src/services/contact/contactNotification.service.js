import { DomainEvent } from '../../models/DomainEvent.model.js';
import { EventActionExecution } from '../../models/EventActionExecution.model.js';
import { EmailDelivery } from '../../models/EmailDelivery.model.js';
import { EXECUTION_STATUS } from '../../utils/domainEventConstants.js';
import { DELIVERY_STATUS } from '../../utils/emailTemplateConstants.js';

/**
 * État RÉEL de la notification d'une demande de contact.
 *
 * ═══ POURQUOI CE SERVICE EXISTE ══════════════════════════════════════════════
 *
 * La question « les administrateurs ont-ils été prévenus ? » n'a pas de réponse
 * dans `ContactSubmission` : la demande ne sait rien de sa notification, et c'est
 * voulu — un échec d'e-mail ne doit pas pouvoir salir la demande elle-même.
 *
 * La réponse se reconstruit donc en traversant trois collections :
 *
 *   ContactSubmission.submissionId
 *     └─ DomainEvent (entityId = submissionId, type = contact.submitted)
 *         └─ EventActionExecution[] (une PAR administrateur)
 *             └─ EmailDelivery (par actionExecutionId)
 *
 * ═══ « ACCEPTÉ » N'EST PAS « REÇU » ══════════════════════════════════════════
 *
 * Ce service ne renvoie JAMAIS « délivré » sur la foi d'un `SENT` : `SENT`
 * signifie que Brevo a accepté l'envoi. Seul un webhook (lot ultérieur) peut
 * affirmer une réception, et il n'existe pas. Le champ `delivered` reste donc à
 * zéro tant que rien ne l'alimente — plutôt que d'être déduit, ce qui serait un
 * mensonge. Voir EMAIL_DELIVERY.md §2.
 */

/** Statut synthétique d'une notification, du point de vue d'un humain. */
export const NOTIFICATION_STATUS = Object.freeze({
  /** Aucun événement : l'émission a échoué (fenêtre de crash) ou est en cours. */
  NONE: 'NONE',
  PENDING: 'PENDING',
  /** Tous les destinataires : Brevo a accepté. */
  SENT: 'SENT',
  /** Une partie acceptée, une partie en échec terminal. */
  PARTIAL: 'PARTIAL',
  /** Tout en échec terminal. */
  FAILED: 'FAILED',
  /** Rien à envoyer (action désactivée, destinataire disparu). */
  SKIPPED: 'SKIPPED',
});

/**
 * Agrège l'état de notification de plusieurs demandes EN LOT.
 *
 * En lot et non une par une : la liste du Manager afficherait sinon une requête
 * par ligne (N+1). Ici, trois requêtes quelle que soit la taille de la page.
 *
 * @param {string[]} submissionIds
 * @returns {Promise<Map<string, object>>} submissionId -> résumé
 */
export async function notificationSummaries(submissionIds) {
  const out = new Map();
  if (!submissionIds.length) return out;

  const events = await DomainEvent.find({
    type: 'contact.submitted',
    entityId: { $in: submissionIds },
  })
    .select('eventId entityId dispatchStatus')
    .lean();

  // Aucune notification pour les demandes sans événement : l'émission a échoué
  // (best-effort, cf. DOMAIN_EVENTS.md §4). On le DIT plutôt que de laisser un
  // blanc que le lecteur prendrait pour « pas encore parti ».
  for (const id of submissionIds) {
    out.set(id, { status: NOTIFICATION_STATUS.NONE, eventId: null, counts: emptyCounts(), total: 0 });
  }
  if (!events.length) return out;

  const executions = await EventActionExecution.find({
    eventId: { $in: events.map((e) => e.eventId) },
    actionId: 'notify-admins-contact-submitted',
  })
    .select('eventId status')
    .lean();

  const byEvent = new Map();
  for (const x of executions) {
    if (!byEvent.has(x.eventId)) byEvent.set(x.eventId, []);
    byEvent.get(x.eventId).push(x);
  }

  for (const event of events) {
    const execs = byEvent.get(event.eventId) || [];
    out.set(event.entityId, {
      status: summarize(execs),
      eventId: event.eventId,
      counts: countStatuses(execs),
      total: execs.length,
    });
  }
  return out;
}

function emptyCounts() {
  return { sent: 0, failed: 0, pending: 0, skipped: 0 };
}

function countStatuses(execs) {
  const c = emptyCounts();
  for (const x of execs) {
    if (x.status === EXECUTION_STATUS.SUCCEEDED) c.sent += 1;
    else if (x.status === EXECUTION_STATUS.DEAD_LETTER) c.failed += 1;
    else if (x.status === EXECUTION_STATUS.SKIPPED) c.skipped += 1;
    else c.pending += 1; // PENDING, PROCESSING, FAILED (retry prévu)
  }
  return c;
}

/**
 * Statut synthétique.
 *
 * `FAILED` (retryable) compte comme EN ATTENTE, pas comme un échec : une
 * tentative est encore prévue, conclure serait mentir. Même règle que
 * `computeDispatchStatus` du dispatcher — les deux doivent dire la même chose.
 */
function summarize(execs) {
  if (!execs.length) return NOTIFICATION_STATUS.NONE;
  const c = countStatuses(execs);
  if (c.pending > 0) return NOTIFICATION_STATUS.PENDING;
  if (c.failed === 0 && c.sent > 0) return NOTIFICATION_STATUS.SENT;
  if (c.sent === 0 && c.failed > 0) return NOTIFICATION_STATUS.FAILED;
  if (c.sent > 0 && c.failed > 0) return NOTIFICATION_STATUS.PARTIAL;
  return NOTIFICATION_STATUS.SKIPPED;
}

/**
 * Détail complet pour UNE demande : chaque destinataire, son exécution, sa
 * livraison. Adresses MASQUÉES — le journal n'en connaît pas d'autres.
 */
export async function notificationDetail(submissionId) {
  const event = await DomainEvent.findOne({ type: 'contact.submitted', entityId: submissionId })
    .select('eventId dispatchStatus occurredAt lastErrorSafe')
    .lean();

  if (!event) {
    return {
      status: NOTIFICATION_STATUS.NONE,
      eventId: null,
      dispatchStatus: null,
      counts: emptyCounts(),
      total: 0,
      recipients: [],
    };
  }

  const executions = await EventActionExecution.find({
    eventId: event.eventId,
    actionId: 'notify-admins-contact-submitted',
  })
    .sort({ createdAt: 1 })
    .lean();

  const deliveries = await EmailDelivery.find({
    actionExecutionId: { $in: executions.map((x) => String(x._id)) },
  }).lean();
  const byExecution = new Map(deliveries.map((d) => [d.actionExecutionId, d]));

  return {
    status: summarize(executions),
    eventId: event.eventId,
    dispatchStatus: event.dispatchStatus,
    occurredAt: event.occurredAt,
    counts: countStatuses(executions),
    total: executions.length,
    recipients: executions.map((x) => {
      const d = byExecution.get(String(x._id));
      return {
        executionId: String(x._id),
        executionStatus: x.status,
        attempts: x.attempts,
        maxAttempts: x.maxAttempts,
        availableAt: x.availableAt,
        /** Connue seulement une fois la livraison créée (donc après readiness). */
        recipientEmailMasked: d?.recipientEmailMasked || null,
        /** JAMAIS `DELIVERED` sans webhook — voir l'en-tête. */
        deliveryStatus: d?.status || null,
        providerMessageId: d?.providerMessageId || null,
        sentAt: d?.sentAt || null,
        lastErrorSafe: {
          code: x.lastErrorSafe?.code || d?.lastErrorSafe?.code || '',
          message: x.lastErrorSafe?.message || d?.lastErrorSafe?.message || '',
          retryable: Boolean(x.lastErrorSafe?.retryable),
        },
      };
    }),
  };
}

/** Le lot n'écrit jamais DELIVERED : garde-fou de cohérence, utilisé par les tests. */
export function assertNoDeliveredWithoutWebhook(recipients) {
  return !recipients.some((r) => r.deliveryStatus === DELIVERY_STATUS.DELIVERED);
}

export default { notificationSummaries, notificationDetail, NOTIFICATION_STATUS };
