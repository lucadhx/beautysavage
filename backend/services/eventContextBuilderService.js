// services/eventContextBuilderService.js
// M3B — Event Context Builder.
//
// Produit un CONTEXTE STANDARD (constants/eventContextSchema.js) à partir d'un document
// métier. Safe par défaut : aucun e-mail/secret/token n'est jamais inclus dans le
// contexte (les e-mails sont résolus via DB au moment de l'envoi — voir
// mailEventContextResolver). Compatible EventLog (attaché au payload, puis re-redacté
// par eventBusService). Réutilisable par mails / notifications / IA.

import {
  createEventContext,
  EVENT_CONTEXT_SENSITIVE_KEYS,
  EVENT_CONTEXT_PII_FIELDS,
  EMAIL_RE
} from '../constants/eventContextSchema.js';

const SENSITIVE_SET = new Set(EVENT_CONTEXT_SENSITIVE_KEYS.map((k) => k.toLowerCase()));

function idStr(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v._id != null ? String(v._id) : null;
  return String(v);
}
function numberOrNull(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}
function isoOrNull(d) {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function fullName(first, last) {
  const n = [first, last].filter(Boolean).map((s) => String(s).trim()).filter(Boolean).join(' ');
  return n || null;
}
// Retire les clés null/undefined d'un objet plat.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Normalise n'importe quelle entrée vers la forme standard (sans rien supprimer de safe).
 */
export function normalizeEventContext(input = {}) {
  return createEventContext(input || {});
}

/**
 * Sanitize PROFOND : retire toute clé sensible (e-mail/secret/token/…) et toute valeur
 * string ressemblant à un e-mail, à tous les niveaux ; recalcule privacy (containsPii/piiFields).
 */
export function sanitizeEventContext(input = {}) {
  const ctx = createEventContext(input || {});

  const clean = (value) => {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(clean);
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_SET.has(String(k).toLowerCase())) continue; // drop sensitive key
        const cleaned = clean(v);
        if (typeof cleaned === 'string' && EMAIL_RE.test(cleaned)) continue; // drop email value
        out[k] = cleaned;
      }
      return out;
    }
    if (typeof value === 'string' && EMAIL_RE.test(value)) return null;
    return value;
  };

  const related = clean(ctx.related) || {};
  const actors = clean(ctx.actors) || { system: true };
  const variables = clean(ctx.variables) || {};

  // Recalcule le flag PII à partir des variables réellement présentes.
  const piiFields = EVENT_CONTEXT_PII_FIELDS.filter(
    (f) => variables[f] !== undefined && variables[f] !== null
  );

  return {
    contextType: ctx.contextType,
    contextId: ctx.contextId,
    related,
    actors: { system: true, ...actors },
    variables,
    privacy: { containsPii: piiFields.length > 0, piiFields }
  };
}

// ─── Builders par domaine ─────────────────────────────────────────────────────

/** sale.* — Sale (avec snapshot client {firstName,lastName,email} ; email NON inclus). */
export function buildSaleEventContext(sale) {
  if (!sale) return sanitizeEventContext({ contextType: 'sale' });
  const items = Array.isArray(sale.items) ? sale.items : [];
  const formationId = idStr(items.find((it) => it?.formationId)?.formationId);
  const itemName = items.find((it) => it?.name || it?.itemName)?.name || items[0]?.itemName || null;
  // Snapshot client : Sale.customer.{firstName,lastName} (avec repli plat). E-mail jamais inclus.
  const cust = sale.customer || sale;
  return sanitizeEventContext({
    contextType: 'sale',
    contextId: sale.saleId || idStr(sale._id),
    related: compact({
      saleId: sale.saleId || idStr(sale._id),
      clientId: idStr(sale.userId),
      userId: idStr(sale.userId),
      formationId
    }),
    actors: compact({ clientId: idStr(sale.userId), system: true }),
    variables: compact({
      amount: numberOrNull(sale.totalAmount),
      itemCount: items.length || null,
      itemName,
      clientName: fullName(cust.firstName, cust.lastName)
    })
  });
}

/** booking.* — ServiceBooking. */
export function buildBookingEventContext(booking) {
  if (!booking) return sanitizeEventContext({ contextType: 'service_booking' });
  return sanitizeEventContext({
    contextType: 'service_booking',
    contextId: booking.bookingId || idStr(booking._id),
    related: compact({
      bookingId: booking.bookingId || idStr(booking._id),
      serviceId: idStr(booking.serviceId),
      saleId: booking.saleId || null,
      clientId: idStr(booking.clientId),
      userId: idStr(booking.clientId)
    }),
    actors: compact({ clientId: idStr(booking.clientId), system: true }),
    variables: compact({
      amount: numberOrNull(booking.totalPrice),
      bookingDate: isoOrNull(booking.startAt),
      status: booking.status || null
    })
  });
}

/** refund.* — RefundRequest. */
export function buildRefundEventContext(refundRequest) {
  if (!refundRequest) return sanitizeEventContext({ contextType: 'refund_request' });
  return sanitizeEventContext({
    contextType: 'refund_request',
    contextId: idStr(refundRequest._id),
    related: compact({
      refundId: idStr(refundRequest._id),
      saleId: refundRequest.saleId ? String(refundRequest.saleId) : null,
      formationId: idStr(refundRequest.formationId),
      clientId: idStr(refundRequest.userId),
      userId: idStr(refundRequest.userId)
    }),
    actors: compact({ clientId: idStr(refundRequest.userId), system: true }),
    variables: compact({
      refundAmount: numberOrNull(refundRequest.amount),
      itemName: refundRequest.itemType || null,
      status: refundRequest.status || null
    })
  });
}

/** commission.* — CommissionPayment (institut↔plateforme : pas de client). */
export function buildCommissionEventContext(commissionPayment) {
  if (!commissionPayment) return sanitizeEventContext({ contextType: 'commission_payment' });
  return sanitizeEventContext({
    contextType: 'commission_payment',
    contextId: idStr(commissionPayment._id),
    related: compact({ commissionPaymentId: idStr(commissionPayment._id) }),
    actors: { system: true },
    variables: compact({
      commissionAmount: numberOrNull(commissionPayment.netAmountDue ?? commissionPayment.amount),
      month: commissionPayment.month ?? null,
      year: commissionPayment.year ?? null,
      status: commissionPayment.status || null
    })
  });
}

/** gift_card.* — GiftCard ou transaction de recrédit. */
export function buildGiftCardEventContext(giftCardOrTransaction) {
  const gc = giftCardOrTransaction || {};
  return sanitizeEventContext({
    contextType: 'gift_card',
    contextId: idStr(gc._id) || (gc.giftCardId ? String(gc.giftCardId) : null),
    related: compact({
      giftCardId: idStr(gc._id) || (gc.giftCardId ? String(gc.giftCardId) : null),
      saleId: gc.saleId ? String(gc.saleId) : null,
      clientId: idStr(gc.userId),
      userId: idStr(gc.userId)
    }),
    actors: compact({ clientId: idStr(gc.userId), system: true }),
    variables: compact({ amount: numberOrNull(gc.amount ?? gc.amountEur) })
  });
}

/**
 * system / fallback — input libre normalisé + sanitizé. Utilisé pour jobs, formations, etc.
 */
export function buildSystemEventContext(input = {}) {
  return sanitizeEventContext({
    contextType: input.contextType || 'system',
    contextId: input.contextId != null ? String(input.contextId) : null,
    related: input.related || {},
    actors: { system: true, ...(input.actors || {}) },
    variables: input.variables || {}
  });
}

export default {
  normalizeEventContext,
  sanitizeEventContext,
  buildSaleEventContext,
  buildBookingEventContext,
  buildRefundEventContext,
  buildCommissionEventContext,
  buildGiftCardEventContext,
  buildSystemEventContext
};
