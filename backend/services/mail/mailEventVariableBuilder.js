// services/mail/mailEventVariableBuilder.js
// M3C — Parité des variables entre l'envoi DIRECT (legacy) et l'envoi ÉVÉNEMENTIEL (M2).
//
// Reconstruit, depuis un EventLog + la DB, EXACTEMENT les mêmes variables de template que
// le dispatcher direct correspondant (réutilise buildCommonMailVars), afin que la bascule
// shadow→active ne change pas le contenu de l'e-mail (seul l'expéditeur passe en rôle M1).
//
// Renvoie { client: { email, name } | null, variables: {...}, templateKey } ou null si le
// contexte est insuffisant. Aucun secret, aucune donnée sensible inutile.

import RefundRequest from '../../models/RefundRequest.js';
import User from '../../models/user.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import SiteIdentity from '../../models/SiteIdentity.js';
import { resolveFrontendUrl } from '../system/frontendUrl.js';
import { buildCommonMailVars } from './mailDomainDispatchers.js';

function looksLikeObjectId(v) {
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
}
function fullName(first, last) {
  const n = [first, last].filter(Boolean).map((s) => String(s).trim()).filter(Boolean).join(' ');
  return n || null;
}
function eur2(amount) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount || 0));
}
function readCtx(eventLog = {}) {
  const ctx = eventLog?.payloadSafe?.context || {};
  return {
    contextId: eventLog?.contextId != null ? String(eventLog.contextId) : (ctx.contextId != null ? String(ctx.contextId) : null),
    related: ctx.related || {}
  };
}
async function resolveSiteName() {
  try {
    const identity = await SiteIdentity.findOne({ key: 'global' }).lean();
    return String(identity?.siteName || '').trim() || 'Beauty Savage';
  } catch {
    return 'Beauty Savage';
  }
}

/**
 * refund.succeeded — parité avec refundExecutionService.sendRefundConfirmedEmailInternal.
 * Choisit la variante refund_confirmed / refund_confirmed_service.
 */
export async function buildRefundSucceededVariables(eventLog) {
  const { contextId, related } = readCtx(eventLog);
  const refundId = contextId || related.refundId || null;
  if (!refundId) return null;

  let refund = null;
  try {
    refund = looksLikeObjectId(String(refundId))
      ? await RefundRequest.findById(refundId).lean()
      : await RefundRequest.findOne({ refundId: String(refundId) }).lean();
  } catch {
    refund = null;
  }
  if (!refund) return null;

  const user = refund.userId ? await User.findById(refund.userId).select('email firstName lastName').lean() : null;
  const email = String(user?.email || '').trim().toLowerCase();
  const client = email ? { email, name: fullName(user?.firstName, user?.lastName) || undefined } : null;

  const siteName = await resolveSiteName();
  const trackingUrl = refund.trackingToken
    ? resolveFrontendUrl('refund-tracking', { token: refund.trackingToken })
    : '';
  const refundedAt = refund.refundedAt ? new Date(refund.refundedAt).toLocaleString('fr-FR') : '';
  const isService = refund.itemType === 'service';

  if (isService) {
    let serviceName = '';
    let bookingDateStr = '';
    let bookingTimeStr = '';
    let practitionerName = '';
    try {
      const booking = await ServiceBooking.findOne({ saleId: String(refund.saleId || '') })
        .populate('serviceId')
        .populate('practitionerId', 'displayName')
        .lean();
      serviceName = booking?.serviceId?.name || '';
      practitionerName = booking?.practitionerId?.displayName || '';
      const startAt = booking?.startAt ? new Date(booking.startAt) : null;
      bookingDateStr = startAt ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
      bookingTimeStr = startAt ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    } catch {
      /* best-effort */
    }
    const refundAmountStr = Number(refund.amount || 0) > 0 ? `${eur2(refund.amount)} €` : '';
    const variables = buildCommonMailVars({
      siteName,
      firstName: String(user?.firstName || '').trim(),
      lastName: String(user?.lastName || '').trim(),
      serviceName,
      bookingDate: bookingDateStr,
      bookingTime: bookingTimeStr,
      practitionerName,
      refundAmount: refundAmountStr,
      refundDateTime: refundedAt,
      refundId: String(refund.refundId || '').trim(),
      trackingUrl
    });
    return { client, variables, templateKey: 'refund_confirmed_service' };
  }

  // Variante formation/produit (refund_confirmed).
  const formationTitle = String(refund?.meta?.formationTitle || '').trim();
  const giftCardNote = refund.giftCardRecredited && Number(refund.giftCardRecreditAmount || 0) > 0
    ? `${eur2(refund.giftCardRecreditAmount)} EUR ont également été recrédités sur votre carte cadeau.`
    : '';
  const variables = buildCommonMailVars({
    siteName,
    firstName: String(user?.firstName || '').trim(),
    lastName: String(user?.lastName || '').trim(),
    formationName: formationTitle,
    refundAmount: Number(refund.amount || 0),
    refundId: String(refund.refundId || '').trim(),
    refundedAtFormatted: refundedAt,
    giftCardBalance: giftCardNote,
    trackingUrl,
    itemDetail: formationTitle,
    serviceName: '',
    bookingDate: '',
    bookingTime: ''
  });
  return { client, variables, templateKey: 'refund_confirmed' };
}

/**
 * booking.confirmed — parité avec sendBookingConfirmedEmail (fourni pour les tests / futur ;
 * NON activé en M3C, voir rapport 179/180).
 */
export async function buildBookingConfirmedVariables(eventLog) {
  const { contextId, related } = readCtx(eventLog);
  const bookingRef = contextId || related.bookingId || null;
  if (!bookingRef) return null;

  let booking = null;
  try {
    booking = looksLikeObjectId(String(bookingRef))
      ? await ServiceBooking.findById(bookingRef).populate('serviceId').populate('practitionerId', 'displayName').populate('clientId', 'email firstName lastName').lean()
      : await ServiceBooking.findOne({ bookingId: String(bookingRef) }).populate('serviceId').populate('practitionerId', 'displayName').populate('clientId', 'email firstName lastName').lean();
  } catch {
    booking = null;
  }
  if (!booking) return null;

  const clientDoc = booking.clientId || {};
  const email = String(clientDoc.email || '').trim().toLowerCase();
  const client = email ? { email, name: fullName(clientDoc.firstName, clientDoc.lastName) || undefined } : null;
  const startAt = booking.startAt ? new Date(booking.startAt) : null;
  const bookingDate = startAt ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const bookingTime = startAt ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

  // Parité stricte avec le direct legacy sendBookingConfirmedEmail (mailDomainDispatchers).
  const isDeposit = booking.paymentType === 'deposit';
  const depositAmount = isDeposit && booking.depositAmount != null ? `${Number(booking.depositAmount).toFixed(2)} €` : '';
  const remainingAmount = isDeposit && booking.totalPrice != null && booking.depositAmount != null
    ? `${(Number(booking.totalPrice) - Number(booking.depositAmount)).toFixed(2)} €`
    : '';

  const variables = {
    firstname: clientDoc.firstName || '',
    lastname: clientDoc.lastName || '',
    sitename: 'Beauty Savage',
    servicename: booking.serviceId?.name || 'Prestation',
    bookingdate: bookingDate,
    bookingtime: bookingTime,
    bookingdatetime: bookingDate && bookingTime ? `${bookingDate} à ${bookingTime}` : '',
    practitionername: booking.practitionerId?.displayName || '',
    cancellationdays: String(booking.cancellationPolicySnapshot?.cancellationDays ?? 7),
    timelabel: '', // confirmation (≠ rappel) → pas de "demain/dans X"
    bookingid: booking.bookingId || '',
    paymenttype: isDeposit ? 'Acompte' : 'Paiement complet',
    depositamount: depositAmount,
    remainingamount: remainingAmount
  };
  return { client, variables, templateKey: 'booking_confirmed' };
}

/**
 * Dispatcher : renvoie les variables/template/client pour la règle active correspondante,
 * ou null si l'event n'est pas pris en charge par un builder de parité.
 */
export async function buildMailVariablesForRule(rule, eventLog) {
  switch (rule?.eventName) {
    case 'refund.succeeded':
      return buildRefundSucceededVariables(eventLog);
    case 'booking.confirmed':
      return buildBookingConfirmedVariables(eventLog);
    default:
      return null;
  }
}

export default {
  buildRefundSucceededVariables,
  buildBookingConfirmedVariables,
  buildMailVariablesForRule
};
