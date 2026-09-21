import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { DomainEvent } from '../models/DomainEvent.model.js';
import { EventActionExecution } from '../models/EventActionExecution.model.js';
import { describeRegistry } from '../utils/domainEventRegistry.js';
import { describeActionRegistry } from '../utils/domainEventActionRegistry.js';
import { retryEventActions } from '../services/events/domainEventDispatcher.service.js';
import { EXECUTION_STATUS } from '../utils/domainEventConstants.js';

/**
 * Observation des événements — DEV UNIQUEMENT, LECTURE SEULE.
 *
 * Aucune route de création : un événement est un fait, il ne se fabrique pas
 * depuis une interface. Aucune route de modification : ni le type ni le payload
 * d'un fait ne se réécrivent. La seule action est un RETRY, et il ne rejoue que
 * ce qui a échoué.
 */

/** Projection sûre d'un événement. Le payload est déjà sûr par construction. */
function serializeEvent(event) {
  return {
    eventId: event.eventId,
    type: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    actor: { type: event.actor?.type, id: event.actor?.id || null, role: event.actor?.role || null },
    payloadSafe: event.payloadSafe || {},
    occurredAt: event.occurredAt,
    retentionClass: event.retentionClass,
    dispatchStatus: event.dispatchStatus,
    dispatchAttempts: event.dispatchAttempts,
    lastDispatchAt: event.lastDispatchAt,
    lastErrorSafe: { code: event.lastErrorSafe?.code || '', message: event.lastErrorSafe?.message || '' },
  };
}

function serializeExecution(x) {
  return {
    id: String(x._id),
    eventId: x.eventId,
    actionId: x.actionId,
    actionType: x.actionType,
    templateId: x.templateId || null,
    recipientResolver: x.recipientResolver || null,
    recipientKey: x.recipientKey,
    status: x.status,
    attempts: x.attempts,
    maxAttempts: x.maxAttempts,
    availableAt: x.availableAt,
    processedAt: x.processedAt,
    providerMessageId: x.providerMessageId || null,
    lastErrorSafe: {
      code: x.lastErrorSafe?.code || '',
      message: x.lastErrorSafe?.message || '',
      retryable: Boolean(x.lastErrorSafe?.retryable),
    },
    // `lockId` n'est JAMAIS exposé : c'est un jeton de contrôle interne.
  };
}

/** GET /dev/domain-events — liste paginée par curseur. */
export const list = asyncHandler(async (req, res) => {
  const { type, entityType, entityId, dispatchStatus, from, to, cursor } = req.query;
  const limit = Math.min(Number(req.query.limit) || 25, 100);

  const filter = {};
  if (type) filter.type = type;
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = entityId;
  if (dispatchStatus) filter.dispatchStatus = dispatchStatus;
  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = new Date(from);
    if (to) filter.occurredAt.$lte = new Date(to);
  }
  // Curseur = `occurredAt` du dernier élément rendu. Tri stable via (occurredAt, _id).
  if (cursor) filter.occurredAt = { ...(filter.occurredAt || {}), $lt: new Date(cursor) };

  const events = await DomainEvent.find(filter).sort({ occurredAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;

  // Compteurs d'actions, en une requête plutôt qu'une par événement.
  const ids = page.map((e) => e.eventId);
  const executions = await EventActionExecution.find({ eventId: { $in: ids } })
    .select('eventId status attempts')
    .lean();
  const byEvent = new Map();
  for (const x of executions) {
    const bucket = byEvent.get(x.eventId) || { total: 0, succeeded: 0, failed: 0, attempts: 0 };
    bucket.total += 1;
    if (x.status === EXECUTION_STATUS.SUCCEEDED || x.status === EXECUTION_STATUS.SKIPPED) bucket.succeeded += 1;
    if (x.status === EXECUTION_STATUS.DEAD_LETTER || x.status === EXECUTION_STATUS.FAILED) bucket.failed += 1;
    bucket.attempts += x.attempts || 0;
    byEvent.set(x.eventId, bucket);
  }

  return ok(res, {
    events: page.map((e) => ({
      ...serializeEvent(e),
      actions: byEvent.get(e.eventId) || { total: 0, succeeded: 0, failed: 0, attempts: 0 },
    })),
    nextCursor: hasMore ? page[page.length - 1].occurredAt : null,
  });
});

/** GET /dev/domain-events/registry — introspection du code-first. */
export const registry = asyncHandler(async (req, res) =>
  ok(res, { events: describeRegistry(), actions: describeActionRegistry() })
);

/** GET /dev/domain-events/:eventId */
export const getOne = asyncHandler(async (req, res) => {
  const event = await DomainEvent.findOne({ eventId: req.params.eventId }).lean();
  if (!event) throw ApiError.notFound('Événement introuvable.');
  const executions = await EventActionExecution.find({ eventId: event.eventId }).sort({ actionId: 1 }).lean();
  return ok(res, { ...serializeEvent(event), executions: executions.map(serializeExecution) });
});

/** GET /dev/domain-events/:eventId/actions */
export const listActions = asyncHandler(async (req, res) => {
  const executions = await EventActionExecution.find({ eventId: req.params.eventId }).sort({ actionId: 1 }).lean();
  return ok(res, executions.map(serializeExecution));
});

/**
 * POST /dev/domain-events/:eventId/retry — relance les exécutions en échec.
 * Ne touche jamais un succès : le rejouer enverrait deux fois le même e-mail.
 */
export const retry = asyncHandler(async (req, res) => {
  const event = await DomainEvent.findOne({ eventId: req.params.eventId }).lean();
  if (!event) throw ApiError.notFound('Événement introuvable.');
  const retried = await retryEventActions(event.eventId);
  const refreshed = await DomainEvent.findOne({ eventId: event.eventId }).lean();
  const executions = await EventActionExecution.find({ eventId: event.eventId }).sort({ actionId: 1 }).lean();
  return ok(res, { retried, ...serializeEvent(refreshed), executions: executions.map(serializeExecution) });
});
