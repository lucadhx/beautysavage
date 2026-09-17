// services/mail/mailEventContextResolver.js
// M3B — Resolver contextuel pour les mails événementiels.
//
// Objectif : permettre à M2 (mailEventDispatchService) de passer un jour de SHADOW à
// RÉEL, en retrouvant le destinataire (client / commerciale / support) à partir d'un
// EventLog — SANS jamais dépendre d'un e-mail brut stocké dans EventLog. On résout via
// les IDs métier (contextId + related) en lisant la DB au moment voulu.
//
// M3B N'ACTIVE PAS les envois : ce module ne fait que résoudre. Les envois directs
// existants restent la source ; le moteur M2 reste en shadow.
//
// PRIVACY : l'e-mail résolu n'est utilisé qu'à l'envoi (jamais ré-écrit dans EventLog).

import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import GiftCard from '../../models/GiftCard.js';
import User from '../../models/user.js';
import { getActiveIdentity } from '../communicationIdentityService.js';

function fullName(first, last) {
  const n = [first, last].filter(Boolean).map((s) => String(s).trim()).filter(Boolean).join(' ');
  return n || null;
}

// Renvoie { contextType, contextId, related, variables } depuis un EventLog (ou payload-like).
function readContext(eventLog = {}) {
  const ctx = eventLog?.payloadSafe?.context || {};
  return {
    contextType: eventLog?.contextType || ctx.contextType || null,
    contextId: eventLog?.contextId != null ? String(eventLog.contextId) : (ctx.contextId != null ? String(ctx.contextId) : null),
    related: ctx.related || {},
    variables: ctx.variables || {}
  };
}

// Cast safe vers ObjectId-string : ServiceBooking/GiftCard/RefundRequest acceptent un _id
// hex de 24 chars. Sinon on tentera une recherche par champ métier.
function looksLikeObjectId(v) {
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
}

async function clientFromUserId(userId) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId).select('email firstName lastName').lean();
    if (!user?.email) return null;
    return { email: String(user.email).toLowerCase(), name: fullName(user.firstName, user.lastName), userId: String(user._id) };
  } catch {
    return null;
  }
}

async function clientFromSaleId(saleId) {
  if (!saleId) return null;
  try {
    const sale = await Sale.findOne({ saleId: String(saleId) }).select('customer userId').lean();
    if (!sale) return null;
    // Snapshot client : Sale.customer.{email,firstName,lastName} (repli plat).
    const cust = sale.customer || sale;
    if (cust?.email) {
      return { email: String(cust.email).toLowerCase(), name: fullName(cust.firstName, cust.lastName), userId: sale.userId ? String(sale.userId) : null };
    }
    return clientFromUserId(sale.userId);
  } catch {
    return null;
  }
}

/**
 * Résout le CLIENT (destinataire) d'un event via ses IDs métier (DB). Renvoie
 * { email, name, userId } ou null. Aucun e-mail n'est lu depuis EventLog.
 */
export async function resolveClientForEvent(eventLog) {
  const { contextType, contextId, related } = readContext(eventLog);

  switch (contextType) {
    case 'sale':
      return (await clientFromSaleId(contextId || related.saleId)) || clientFromUserId(related.clientId || related.userId);

    case 'service_booking': {
      try {
        const booking = looksLikeObjectId(contextId)
          ? await ServiceBooking.findById(contextId).select('clientId saleId').lean()
          : await ServiceBooking.findOne({ bookingId: String(contextId) }).select('clientId saleId').lean();
        if (booking) {
          return (await clientFromUserId(booking.clientId)) || (await clientFromSaleId(booking.saleId));
        }
      } catch { /* fallthrough */ }
      return (await clientFromUserId(related.clientId || related.userId)) || clientFromSaleId(related.saleId);
    }

    case 'refund_request': {
      try {
        const refund = looksLikeObjectId(contextId)
          ? await RefundRequest.findById(contextId).select('userId saleId').lean()
          : null;
        if (refund) {
          return (await clientFromUserId(refund.userId)) || (await clientFromSaleId(refund.saleId));
        }
      } catch { /* fallthrough */ }
      return (await clientFromUserId(related.clientId || related.userId)) || clientFromSaleId(related.saleId);
    }

    case 'gift_card': {
      try {
        const gc = looksLikeObjectId(contextId)
          ? await GiftCard.findById(contextId).select('userId saleId').lean()
          : null;
        if (gc) return (await clientFromUserId(gc.userId)) || (await clientFromSaleId(gc.saleId));
      } catch { /* fallthrough */ }
      return (await clientFromUserId(related.clientId || related.userId)) || clientFromSaleId(related.saleId);
    }

    default:
      return (await clientFromUserId(related.clientId || related.userId)) || clientFromSaleId(related.saleId);
  }
}

/** Résout la COMMERCIALE (identité active institute, M1). Renvoie { email, name, role } ou null. */
export async function resolveCommercialeForEvent(_eventLog) {
  const identity = await getActiveIdentity('commerciale');
  if (!identity?.email) return null;
  return { email: String(identity.email).toLowerCase(), name: identity.displayName || null, role: 'commerciale' };
}

/** Résout le SUPPORT (identité active platform, M1). Renvoie { email, name, role } ou null. */
export async function resolveSupportForEvent(_eventLog) {
  const identity = await getActiveIdentity('support');
  if (!identity?.email) return null;
  return { email: String(identity.email).toLowerCase(), name: identity.displayName || null, role: 'support' };
}

/**
 * Construit un `context` consommable par dispatchMailForEvent (M2) :
 * { contextType, contextId, client: { email, name }, variables }.
 * `client` est résolu best-effort (peut être null si introuvable). Ne déclenche aucun envoi.
 */
export async function resolveMailContextForEvent(eventLog) {
  const { contextType, contextId, variables } = readContext(eventLog);
  const client = await resolveClientForEvent(eventLog);
  return {
    contextType,
    contextId,
    client: client ? { email: client.email, name: client.name || undefined } : null,
    variables: variables || {}
  };
}

export default {
  resolveClientForEvent,
  resolveCommercialeForEvent,
  resolveSupportForEvent,
  resolveMailContextForEvent
};
