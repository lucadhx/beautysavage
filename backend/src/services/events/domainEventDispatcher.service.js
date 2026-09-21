import crypto from 'node:crypto';
import { DomainEvent } from '../../models/DomainEvent.model.js';
import { EventActionExecution } from '../../models/EventActionExecution.model.js';
import { logger } from '../../utils/logger.js';
import {
  EVENT_DISPATCH_STATUS,
  EXECUTION_STATUS,
  CLAIMABLE_STATUSES,
  TERMINAL_STATUSES,
  EVENT_ERROR_CODES,
  LOCK_TTL_MS,
  retryPolicy,
  nextBackoffMs,
} from '../../utils/domainEventConstants.js';
import { actionsForEvent } from '../../utils/domainEventActionRegistry.js';
import { safeErrorMessage } from '../../utils/eventPayloadSafety.js';
import { getHandler, resolveRecipientKeys, ActionHandlerError } from './eventActionHandlerRegistry.js';
import { isStillRelevant } from './actionRelevance.js';

/**
 * Dispatcher d'actions d'événements.
 *
 * ─── MODE D'EXÉCUTION : EMBARQUÉ, DANS LE PROCESSUS API ──────────────────────
 *
 * Il n'existe aucune infrastructure de worker dans ce dépôt (ni file, ni cron, ni
 * scheduler ; la reconciliation est un script lancé à la main). On reste sur ce
 * modèle plutôt que d'introduire une dépendance :
 *
 *  1. l'événement est PERSISTÉ d'abord ;
 *  2. le dispatch est tenté immédiatement, en ligne (option A) ;
 *  3. `processPendingEventActions()` rattrape tout ce qui reste — appelée au
 *     démarrage, et disponible en script (`npm run events:process`).
 *
 * LIMITES ASSUMÉES d'un worker embarqué mono-processus :
 *  - si le processus meurt pendant un handler, l'exécution reste `PROCESSING`
 *    jusqu'à EXPIRATION DE SON VERROU (60 s), après quoi le passage suivant la
 *    reprend. Rien n'est perdu, mais rien n'est instantané non plus ;
 *  - sans passage périodique, un `FAILED` retryable attend le prochain démarrage
 *    ou le prochain appel du script. Il n'y a PAS de minuterie interne : en
 *    ajouter une ferait tourner du travail de fond invisible dans chaque instance ;
 *  - en cluster (PM2 en mode `cluster`), plusieurs instances traiteraient la même
 *    file. C'est SÛR — le verrou atomique et l'index unique le garantissent — mais
 *    le déploiement documenté est `fork` (une instance).
 */

const DEFAULT_BATCH_SIZE = 25;

/**
 * Crée les exécutions manquantes d'un événement. IDEMPOTENT : l'index unique
 * (eventId, actionId, recipientKey) tranche, on ignore les doublons (11000).
 * Relancer le dispatch d'un même événement n'ajoute donc jamais rien.
 */
export async function materializeExecutions(event) {
  const actions = actionsForEvent(event.type);
  const created = [];

  for (const action of actions) {
    const recipientKeys = await resolveRecipientKeys(action, event);
    const policy = retryPolicy(action.actionType);

    for (const recipientKey of recipientKeys) {
      try {
        const doc = await EventActionExecution.create({
          eventId: event.eventId,
          eventType: event.type,
          actionId: action.actionId,
          actionType: action.actionType,
          templateId: action.templateId || null,
          recipientResolver: action.recipientResolver || null,
          recipientKey,
          // Une action désactivée n'est pas « oubliée » : elle est tracée SKIPPED.
          // Le journal montre qu'on n'a délibérément rien fait, plutôt qu'un trou.
          status: action.enabled ? EXECUTION_STATUS.PENDING : EXECUTION_STATUS.SKIPPED,
          processedAt: action.enabled ? null : new Date(),
          maxAttempts: policy.maxAttempts,
          availableAt: new Date(),
          lastErrorSafe: action.enabled
            ? { code: '', message: '', retryable: false }
            : { code: 'ACTION_DISABLED', message: 'Action désactivée dans le registre.', retryable: false },
        });
        created.push(doc);
      } catch (err) {
        if (err.code !== 11000) throw err; // déjà matérialisée : c'est le but
      }
    }
  }
  return created;
}

/**
 * Prise ATOMIQUE d'une exécution. La condition et l'écriture sont dans le MÊME
 * `findOneAndUpdate` : deux processus concurrents ne peuvent pas gagner ensemble
 * — MongoDB sérialise l'écriture sur le document.
 *
 * Éligible = statut prenable + `availableAt` échu + (aucun verrou ou verrou expiré).
 * Le verrou expiré est la reprise après crash : le propriétaire précédent est mort,
 * son travail est réattribué.
 */
export async function claimExecution(executionId, now = new Date()) {
  const lockId = crypto.randomUUID();
  return EventActionExecution.findOneAndUpdate(
    {
      _id: executionId,
      status: { $in: CLAIMABLE_STATUSES },
      availableAt: { $lte: now },
      $or: [{ lockExpiresAt: null }, { lockExpiresAt: { $lte: now } }],
    },
    {
      $set: {
        status: EXECUTION_STATUS.PROCESSING,
        lockId,
        lockExpiresAt: new Date(now.getTime() + LOCK_TTL_MS),
        processingStartedAt: now,
      },
      $inc: { attempts: 1 },
    },
    { new: true }
  );
}

/**
 * Écrit le résultat, à condition de TOUJOURS détenir le verrou.
 *
 * Le filtre sur `lockId` est la garde essentielle : un processus lent dont le
 * verrou a expiré (et dont le travail a été repris par un autre) ne doit pas
 * écraser le résultat du nouveau propriétaire avec le sien, périmé.
 *
 * @returns {Promise<boolean>} false si le verrou a été perdu (écriture refusée).
 */
async function finalize(execution, update) {
  const result = await EventActionExecution.findOneAndUpdate(
    { _id: execution._id, lockId: execution.lockId },
    { $set: { ...update, lockId: null, lockExpiresAt: null } },
    { new: true }
  );
  if (!result) {
    logger.warn(`Verrou perdu sur l'exécution ${execution._id} — résultat ignoré (travail périmé).`);
    return false;
  }
  return true;
}

/** Exécute UNE exécution déjà prise (statut PROCESSING, verrou détenu). */
async function runClaimed(event, execution) {
  const actions = actionsForEvent(event.type);
  const action = actions.find((a) => a.actionId === execution.actionId);

  // L'action a disparu du registre depuis la matérialisation (déploiement) :
  // rien à exécuter, et rien à réessayer.
  if (!action) {
    await finalize(execution, {
      status: EXECUTION_STATUS.SKIPPED,
      processedAt: new Date(),
      lastErrorSafe: {
        code: 'ACTION_REMOVED',
        message: "L'action n'existe plus dans le registre.",
        retryable: false,
      },
    });
    return;
  }

  if (!action.enabled) {
    await finalize(execution, {
      status: EXECUTION_STATUS.SKIPPED,
      processedAt: new Date(),
      lastErrorSafe: { code: 'ACTION_DISABLED', message: 'Action désactivée dans le registre.', retryable: false },
    });
    return;
  }

  /**
   * LA CONDITION MÉTIER EST REVALIDÉE ICI, ET NON À LA MATÉRIALISATION.
   *
   * ══ POURQUOI SI TARD ══════════════════════════════════════════════════════
   *
   * Parce qu'entre la décision d'envoyer et l'envoi, il peut s'écouler des
   * minutes — le temps d'un backoff après un fournisseur momentanément
   * injoignable. Vérifier au moment de créer l'action ne dirait rien de ce qui
   * s'est passé depuis.
   *
   * Le cas exact : une relance d'impayé attend sa seconde tentative, le client
   * paie entre-temps, et le worker envoie « vous n'avez toujours pas payé » à
   * quelqu'un qui vient de régler. L'événement, lui, reste vrai — la tentative
   * A ÉTÉ refusée. C'est la CONSÉQUENCE qui a cessé d'être justifiée.
   *
   * Placée après les gardes de registre et avant le handler : on ne consulte le
   * métier que pour une action qu'on s'apprêtait réellement à exécuter.
   */
  const pertinence = await isStillRelevant(event);
  if (!pertinence.relevant) {
    await finalize(execution, {
      status: EXECUTION_STATUS.OBSOLETE,
      processedAt: new Date(),
      lastErrorSafe: {
        code: 'NO_LONGER_RELEVANT',
        message: safeErrorMessage(pertinence.reason || ''),
        retryable: false,
      },
    });
    logger.info(
      `[events] action ${execution.actionId} devenue sans objet — ${pertinence.reason}. Aucun envoi.`,
    );
    return;
  }

  try {
    const handler = getHandler(action.actionType);
    const result = await handler({ event, action, execution });

    if (result?.status === EXECUTION_STATUS.SKIPPED) {
      await finalize(execution, {
        status: EXECUTION_STATUS.SKIPPED,
        processedAt: new Date(),
        lastErrorSafe: { code: 'SKIPPED', message: safeErrorMessage(result.reason || ''), retryable: false },
      });
      return;
    }

    await finalize(execution, {
      status: EXECUTION_STATUS.SUCCEEDED,
      processedAt: new Date(),
      providerMessageId: result?.providerMessageId || null,
      lastErrorSafe: { code: '', message: '', retryable: false },
    });
  } catch (err) {
    const retryable = err instanceof ActionHandlerError ? err.retryable : true;
    const code = err instanceof ActionHandlerError ? err.code : EVENT_ERROR_CODES.HANDLER_ERROR;
    // Jamais l'objet d'erreur : seulement un code stable et un message borné.
    const message = safeErrorMessage(err?.message || '');
    const attempts = execution.attempts; // déjà incrémenté par la prise
    const exhausted = attempts >= execution.maxAttempts;

    // Non retryable -> DEAD_LETTER TOUT DE SUITE : réessayer 4 fois un handler
    // inexistant ou une configuration manquante ne ferait que remplir le journal.
    if (!retryable || exhausted) {
      await finalize(execution, {
        status: EXECUTION_STATUS.DEAD_LETTER,
        processedAt: new Date(),
        lastErrorSafe: { code, message, retryable },
      });
      return;
    }

    const delay = nextBackoffMs(action.actionType, attempts);
    await finalize(execution, {
      status: EXECUTION_STATUS.FAILED,
      availableAt: new Date(Date.now() + delay),
      lastErrorSafe: { code, message, retryable: true },
    });
  }
}

/**
 * Statut global d'un événement, DÉRIVÉ de ses exécutions.
 *
 *  - aucune action        -> DISPATCHED (rien à faire est un succès)
 *  - tout SUCCEEDED/SKIPPED -> DISPATCHED
 *  - au moins un succès ET au moins un échec TERMINAL -> PARTIAL_FAILURE
 *  - tout terminal en échec -> FAILED
 *  - il reste du travail   -> DISPATCHING (jamais FAILED sur un échec retryable :
 *    une tentative est encore prévue, conclure serait mentir)
 */
export function computeDispatchStatus(executions) {
  if (executions.length === 0) return EVENT_DISPATCH_STATUS.DISPATCHED;

  const isTerminal = (e) => TERMINAL_STATUSES.includes(e.status);
  if (!executions.every(isTerminal)) return EVENT_DISPATCH_STATUS.DISPATCHING;

  const succeeded = executions.filter(
    (e) => e.status === EXECUTION_STATUS.SUCCEEDED || e.status === EXECUTION_STATUS.SKIPPED
  ).length;
  const dead = executions.filter((e) => e.status === EXECUTION_STATUS.DEAD_LETTER).length;

  if (dead === 0) return EVENT_DISPATCH_STATUS.DISPATCHED;
  if (succeeded === 0) return EVENT_DISPATCH_STATUS.FAILED;
  return EVENT_DISPATCH_STATUS.PARTIAL_FAILURE;
}

/** Recalcule et enregistre le statut global d'un événement. */
export async function refreshEventStatus(eventId) {
  const executions = await EventActionExecution.find({ eventId }).lean();
  const status = computeDispatchStatus(executions);
  const dead = executions.filter((e) => e.status === EXECUTION_STATUS.DEAD_LETTER);
  await DomainEvent.updateOne(
    { eventId },
    {
      $set: {
        dispatchStatus: status,
        lastDispatchAt: new Date(),
        lastErrorSafe: dead.length
          ? { code: dead[0].lastErrorSafe?.code || '', message: dead[0].lastErrorSafe?.message || '' }
          : { code: '', message: '' },
      },
    }
  );
  return status;
}

/**
 * Dispatch d'un événement : matérialise ses actions, exécute celles qui sont
 * éligibles, met à jour le statut global. Ne lève jamais pour un échec d'action —
 * un échec est une DONNÉE (le journal le porte), pas une exception.
 */
export async function dispatchEvent(eventId) {
  const event = await DomainEvent.findOne({ eventId });
  if (!event) return null;

  await DomainEvent.updateOne(
    { eventId },
    { $set: { dispatchStatus: EVENT_DISPATCH_STATUS.DISPATCHING }, $inc: { dispatchAttempts: 1 } }
  );

  await materializeExecutions(event);

  const pending = await EventActionExecution.find({
    eventId,
    status: { $in: CLAIMABLE_STATUSES },
    availableAt: { $lte: new Date() },
  });

  for (const candidate of pending) {
    const claimed = await claimExecution(candidate._id);
    if (!claimed) continue; // pris par un autre passage : très bien
    await runClaimed(event, claimed);
  }

  return refreshEventStatus(eventId);
}

/**
 * Reprise : traite les exécutions éligibles, tous événements confondus.
 *
 * Utilisable au démarrage, depuis un script, depuis les tests, et plus tard depuis
 * un worker externe. Reprend aussi les exécutions abandonnées (verrou expiré) —
 * c'est le mécanisme de reprise après crash.
 *
 * @returns {Promise<{claimed:number, processed:number}>}
 */
export async function processPendingEventActions({ batchSize = DEFAULT_BATCH_SIZE, now = new Date() } = {}) {
  const candidates = await EventActionExecution.find({
    status: { $in: [...CLAIMABLE_STATUSES, EXECUTION_STATUS.PROCESSING] },
    availableAt: { $lte: now },
    $or: [{ lockExpiresAt: null }, { lockExpiresAt: { $lte: now } }],
  })
    .sort({ availableAt: 1 })
    .limit(batchSize)
    .lean();

  let processed = 0;
  const touchedEvents = new Set();

  for (const candidate of candidates) {
    // Une exécution PROCESSING au verrou expiré est un travail abandonné. On la
    // rend prenable avant de la reprendre — sans toucher à `attempts`, que la
    // prise incrémentera.
    if (candidate.status === EXECUTION_STATUS.PROCESSING) {
      const reclaimed = await EventActionExecution.findOneAndUpdate(
        {
          _id: candidate._id,
          status: EXECUTION_STATUS.PROCESSING,
          $or: [{ lockExpiresAt: null }, { lockExpiresAt: { $lte: now } }],
        },
        { $set: { status: EXECUTION_STATUS.FAILED, lockId: null, lockExpiresAt: null } }
      );
      if (!reclaimed) continue; // repris entre-temps
      logger.warn(`Exécution ${candidate._id} abandonnée (verrou expiré) — reprise.`);
    }

    const event = await DomainEvent.findOne({ eventId: candidate.eventId });
    if (!event) continue;

    const claimed = await claimExecution(candidate._id, now);
    if (!claimed) continue;

    await runClaimed(event, claimed);
    processed += 1;
    touchedEvents.add(candidate.eventId);
  }

  for (const eventId of touchedEvents) await refreshEventStatus(eventId);
  return { claimed: candidates.length, processed };
}

/**
 * Relance manuelle (route DEV). Ne rend prenables que les exécutions réellement
 * en échec — jamais un succès, jamais un SKIPPED : rejouer un succès enverrait
 * deux fois le même e-mail.
 *
 * `attempts` est remis à zéro : c'est une décision humaine explicite, pas une
 * tentative automatique de plus.
 */
export async function retryEventActions(eventId) {
  const result = await EventActionExecution.updateMany(
    { eventId, status: { $in: [EXECUTION_STATUS.FAILED, EXECUTION_STATUS.DEAD_LETTER] } },
    {
      $set: {
        status: EXECUTION_STATUS.PENDING,
        availableAt: new Date(),
        attempts: 0,
        lockId: null,
        lockExpiresAt: null,
      },
    }
  );
  if (result.modifiedCount > 0) await dispatchEvent(eventId);
  return result.modifiedCount;
}

export default {
  dispatchEvent,
  processPendingEventActions,
  retryEventActions,
  materializeExecutions,
  computeDispatchStatus,
  refreshEventStatus,
  claimExecution,
};
