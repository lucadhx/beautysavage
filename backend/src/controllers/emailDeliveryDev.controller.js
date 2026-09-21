import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { EmailDelivery } from '../models/EmailDelivery.model.js';
import { EmailDeliveryEvent } from '../models/EmailDeliveryEvent.model.js';
import { BrevoWebhookEvent } from '../models/BrevoWebhookEvent.model.js';
import { serializeDelivery } from '../services/email/emailDelivery.service.js';

/**
 * Consultation DEV du suivi réel des livraisons — LECTURE SEULE.
 *
 * Aucune de ces routes ne renvoie : secret webhook, adresse complète, payload brut,
 * HTML, variables, en-têtes, `idempotencyKey` ni `recipientHash` (clés internes).
 * Les filtres passent par des schémas `.strict()` (cf. validator).
 */

/** Échappe les métacaractères regex d'une recherche utilisateur. */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Constructeurs de filtres (PURS, exportés pour test) ──────────────────────

export function buildDeliveryFilter(query = {}) {
  const filter = {};
  if (query.providerMode) filter.providerMode = query.providerMode;
  if (query.status) filter.status = query.status;
  if (query.eventType) filter.lastEventType = query.eventType;
  if (query.templateId) filter.templateId = query.templateId;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { providerMessageId: rx },
      { recipientEmailMasked: rx },
      { subjectSnapshot: rx },
    ];
  }
  return filter;
}

export function buildWebhookEventFilter(query = {}) {
  const filter = { provider: 'BREVO' };
  if (query.providerMode) filter.providerMode = query.providerMode;
  if (query.eventType) filter.normalizedEventType = query.eventType;
  if (query.processingStatus) filter.processingStatus = query.processingStatus;
  if (typeof query.matched === 'boolean') filter.matched = query.matched;
  if (query.from || query.to) {
    filter.receivedAt = {};
    if (query.from) filter.receivedAt.$gte = new Date(query.from);
    if (query.to) filter.receivedAt.$lte = new Date(query.to);
  }
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ providerMessageId: rx }, { recipientEmailMasked: rx }];
  }
  return filter;
}

// ── Sérialisations SÛRES ─────────────────────────────────────────────────────

/** Un abrégé de messageId : assez pour retrouver dans Brevo, sans l'exposer entier. */
function shortMessageId(id) {
  if (!id) return null;
  const s = String(id);
  return s.length <= 18 ? s : `${s.slice(0, 10)}…${s.slice(-6)}`;
}

export function serializeTimelineEvent(e) {
  return {
    webhookEventId: e.webhookEventId,
    type: e.type,
    occurredAt: e.occurredAt || null,
    receivedAt: e.receivedAt || null,
    statusBefore: e.statusBefore || null,
    statusAfter: e.statusAfter || null,
    diagnosticSafe: { code: e.diagnosticSafe?.code || '', message: e.diagnosticSafe?.message || '' },
  };
}

export function serializeWebhookEvent(e) {
  return {
    webhookEventId: e.webhookEventId,
    providerMode: e.providerMode,
    providerMessageIdShort: shortMessageId(e.providerMessageId),
    eventType: e.eventType,
    normalizedEventType: e.normalizedEventType || null,
    recipientEmailMasked: e.recipientEmailMasked || '',
    occurredAt: e.occurredAt || null,
    receivedAt: e.receivedAt || null,
    deliveryId: e.deliveryId || null,
    matched: Boolean(e.matched),
    processingStatus: e.processingStatus,
    rawPayloadSafe: e.rawPayloadSafe || {},
    lastErrorSafe: { code: e.lastErrorSafe?.code || '', message: e.lastErrorSafe?.message || '' },
    // JAMAIS : idempotencyKey, recipientHash.
  };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/** GET /dev/email-deliveries — liste paginée par curseur (createdAt). */
export const listDeliveries = asyncHandler(async (req, res) => {
  const filter = buildDeliveryFilter(req.query);
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  if (req.query.cursor) filter.createdAt = { ...(filter.createdAt || {}), $lt: new Date(req.query.cursor) };

  const rows = await EmailDelivery.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return ok(res, {
    deliveries: page.map(serializeDelivery),
    nextCursor: hasMore ? page[page.length - 1].createdAt : null,
  });
});

/** GET /dev/email-deliveries/:deliveryId — détail + timeline. */
export const getDelivery = asyncHandler(async (req, res) => {
  const doc = await EmailDelivery.findOne({ deliveryId: req.params.deliveryId }).lean();
  if (!doc) throw ApiError.notFound('Livraison introuvable.');
  const events = await EmailDeliveryEvent.find({ deliveryId: doc.deliveryId })
    .sort({ occurredAt: 1, createdAt: 1 })
    .lean();
  return ok(res, { ...serializeDelivery(doc), timeline: events.map(serializeTimelineEvent) });
});

/** GET /dev/email-deliveries/:deliveryId/events — timeline seule. */
export const listDeliveryEvents = asyncHandler(async (req, res) => {
  const doc = await EmailDelivery.findOne({ deliveryId: req.params.deliveryId }).select('deliveryId').lean();
  if (!doc) throw ApiError.notFound('Livraison introuvable.');
  const events = await EmailDeliveryEvent.find({ deliveryId: doc.deliveryId })
    .sort({ occurredAt: 1, createdAt: 1 })
    .lean();
  return ok(res, events.map(serializeTimelineEvent));
});

/** GET /dev/brevo-webhook-events — journal fournisseur, paginé par curseur (receivedAt). */
export const listWebhookEvents = asyncHandler(async (req, res) => {
  const filter = buildWebhookEventFilter(req.query);
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  if (req.query.cursor) filter.receivedAt = { ...(filter.receivedAt || {}), $lt: new Date(req.query.cursor) };

  const rows = await BrevoWebhookEvent.find(filter).sort({ receivedAt: -1, _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return ok(res, {
    events: page.map(serializeWebhookEvent),
    nextCursor: hasMore ? page[page.length - 1].receivedAt : null,
  });
});

/** GET /dev/brevo-webhook-events/:webhookEventId */
export const getWebhookEvent = asyncHandler(async (req, res) => {
  const e = await BrevoWebhookEvent.findOne({ webhookEventId: req.params.webhookEventId }).lean();
  if (!e) throw ApiError.notFound('Événement webhook introuvable.');
  return ok(res, serializeWebhookEvent(e));
});
