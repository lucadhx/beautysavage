// constants/eventCatalog.js
// Frozen catalog of backend domain events (Phase 3/4A — observability/audit only).
// V1: events are PUBLISHED + LOGGED. No automatic triggers, no no-code automation,
// no side effects (no email/notification triggered by an event).
//
// Each entry: { name, domain, version, description, payload: [minimal SAFE keys] }.
// `payload` lists the SAFE keys an emitter is expected to provide. A payload must
// NEVER contain: full email, secret, token, gift-card password, banking data, or a
// full Stripe payload.

export const EVENT_CATALOG = Object.freeze({
  // --- sale ---
  'sale.created': { domain: 'sale', version: 1, description: 'A sale was persisted', payload: ['saleId'] },
  'sale.finalized': { domain: 'sale', version: 1, description: 'A sale was finalized (persisted via the central finalizer)', payload: ['saleId', 'totalAmount', 'itemCount', 'hasStripePayment'] },
  'sale.zero_payment_finalized': { domain: 'sale', version: 1, description: 'A 0€ checkout was finalized without Stripe', payload: ['saleId', 'zeroPayment'] },
  'sale.email_sent': { domain: 'sale', version: 1, description: 'The sale confirmation email was sent', payload: ['saleId', 'sendLogId'] },

  // --- booking (service) ---
  'booking.created': { domain: 'booking', version: 1, description: 'A service booking was created', payload: ['bookingId', 'serviceId', 'status'] },
  'booking.confirmed': { domain: 'booking', version: 1, description: 'A service booking was confirmed', payload: ['bookingId', 'serviceId', 'status'] },
  'booking.reminded': { domain: 'booking', version: 1, description: 'A booking reminder was sent', payload: ['bookingId'] },
  'booking.cancelled': { domain: 'booking', version: 1, description: 'A booking was cancelled', payload: ['bookingId', 'serviceId'] },
  'booking.no_show': { domain: 'booking', version: 1, description: 'A booking was marked no-show', payload: ['bookingId'] },
  'booking.no_show_marked': { domain: 'booking', version: 1, description: 'A booking was explicitly marked no-show by staff', payload: ['bookingId'] },
  'booking.client_suspended': { domain: 'booking', version: 1, description: 'A client was suspended after repeated no-shows', payload: ['userId'] },
  'booking.pending_payment_expired': { domain: 'booking', version: 1, description: 'A pending-payment booking expired (legacy/unused — bookings are created confirmed)', payload: ['bookingId'] },
  // P1-9 — codes émis en production mais jusqu'ici absents du catalogue (warning UNKNOWN).
  'booking.balance_paid_on_site': { domain: 'booking', version: 1, description: 'A booking on-site balance was collected', payload: ['bookingId', 'serviceId', 'status'] },
  'booking.rescheduled': { domain: 'booking', version: 1, description: 'A booking was rescheduled in place', payload: ['bookingId', 'serviceId', 'status'] },

  // --- refund ---
  'refund.requested': { domain: 'refund', version: 1, description: 'A refund was requested', payload: ['refundId', 'saleId', 'itemType', 'status'] },
  'refund.execution_started': { domain: 'refund', version: 1, description: 'A refund execution started', payload: ['refundId'] },
  'refund.succeeded': { domain: 'refund', version: 1, description: 'A refund succeeded (confirmed)', payload: ['refundId', 'saleId', 'status'] },
  'refund.confirmed': { domain: 'refund', version: 1, description: 'A refund was confirmed (alias of succeeded)', payload: ['refundId'] },
  'refund.failed': { domain: 'refund', version: 1, description: 'A refund failed', payload: ['refundId'] },
  'refund.recovered': { domain: 'refund', version: 1, description: 'A blocked refund was recovered by the recovery job', payload: ['refundId'] },

  // --- gift_card ---
  'gift_card.created': { domain: 'gift_card', version: 1, description: 'A gift card was created', payload: ['giftCardId'] },
  'gift_card.used': { domain: 'gift_card', version: 1, description: 'A gift card was used (debited)', payload: ['giftCardId'] },
  'gift_card.recredited': { domain: 'gift_card', version: 1, description: 'A gift card portion was re-credited (refund)', payload: ['saleId', 'amountEur', 'cardCount'] },
  // M13 — cartes cadeaux manuelles (institut, paiement sur place) + débit manuel + achat en ligne.
  'gift_card.online_created': { domain: 'gift_card', version: 1, description: 'A gift card was created via the online checkout', payload: ['giftCardId'] },
  'gift_card.manual_created': { domain: 'gift_card', version: 1, description: 'A gift card was created manually by the institute (paid on site)', payload: ['giftCardId', 'creationMode', 'paymentMode'] },
  'gift_card.manual_debited': { domain: 'gift_card', version: 1, description: 'A gift card was debited manually by the institute', payload: ['giftCardId', 'amountEur'] },
  // P1-9 — recovery job (recrédit carte cadeau après remboursement).
  'gift_card.recredit_failed': { domain: 'gift_card', version: 1, description: 'A gift card re-credit failed (recovery)', payload: ['saleId', 'amountEur', 'cardCount'] },
  'gift_card.recredit_recovered': { domain: 'gift_card', version: 1, description: 'A failed gift card re-credit was recovered', payload: ['saleId', 'amountEur', 'cardCount'] },
  // LOT2 — reset PIN + renvoi (nouveau code généré, ancien invalidé).
  'gift_card.pin_reset_and_resent': { domain: 'gift_card', version: 1, description: 'A gift card PIN was reset and the card re-sent', payload: ['giftCardId', 'pinVersion'] },

  // --- commission ---
  'commission.available': { domain: 'commission', version: 1, description: 'A commission became payable', payload: ['commissionPaymentId', 'month', 'year'] },
  'commission.reminder_sent': { domain: 'commission', version: 1, description: 'A commission reminder was sent', payload: ['commissionPaymentId', 'daysLeft'] },
  'commission.paid': { domain: 'commission', version: 1, description: 'A commission was paid', payload: ['commissionPaymentId'] },
  // P1-9 — ajustements/annulations de commission émis lors d'un remboursement (refundService).
  'commission.adjusted': { domain: 'commission', version: 1, description: 'A commission was adjusted after a refund', payload: ['commissionPaymentId', 'status'] },
  'commission.reversal_required': { domain: 'commission', version: 1, description: 'A commission reversal is required after a refund', payload: ['commissionPaymentId', 'status'] },
  'commission.cancelled': { domain: 'commission', version: 1, description: 'A commission was cancelled', payload: ['commissionPaymentId', 'status'] },

  // --- formation (sessions) ---
  'formation.session_cancelled': { domain: 'formation', version: 1, description: 'A formation session was cancelled', payload: ['sessionId', 'formationId'] },
  'formation.session_updated': { domain: 'formation', version: 1, description: 'A formation session was updated/rescheduled', payload: ['sessionId', 'formationId'] },
  'formation.session_reminded': { domain: 'formation', version: 1, description: 'A formation session reminder was sent', payload: ['sessionId', 'formationId'] },
  'formation.certificate_available': { domain: 'formation', version: 1, description: 'A formation certificate became available', payload: ['formationId', 'clientId'] },
  // C2 — Learning events.
  'formation.started': { domain: 'formation', version: 1, description: 'A client started a distanciel formation', payload: ['formationId', 'clientId'] },
  'lesson.completed': { domain: 'formation', version: 1, description: 'A client completed a lesson', payload: ['formationId', 'lessonId', 'clientId'] },
  'formation.completed': { domain: 'formation', version: 1, description: 'A client completed a formation', payload: ['formationId', 'clientId'] },
  'formation.attendance_validated': { domain: 'formation', version: 1, description: 'Presence validated for a session participant', payload: ['sessionId', 'formationId', 'clientId'] },
  'presence.confirmed': { domain: 'formation', version: 1, description: 'Presence confirmed (mail/notif)', payload: ['sessionId', 'formationId', 'clientId'] },
  // FORMATION-EVALUATION — cycle d'évaluation + certification.
  'training.evaluation.submitted': { domain: 'formation', version: 1, description: 'A client submitted an evaluation attempt', payload: ['formationId', 'clientId', 'attemptId'] },
  'training.evaluation.accepted': { domain: 'formation', version: 1, description: 'An evaluation attempt was accepted by the institute', payload: ['formationId', 'clientId', 'attemptId'] },
  'training.evaluation.refused': { domain: 'formation', version: 1, description: 'An evaluation attempt was refused by the institute', payload: ['formationId', 'clientId', 'attemptId'] },
  'training.certificate.generated': { domain: 'formation', version: 1, description: 'A training certificate (diploma) was generated', payload: ['formationId', 'clientId', 'certificateNumber'] },
  'training.certificate.sent': { domain: 'formation', version: 1, description: 'A training certificate was emailed to the client', payload: ['formationId', 'clientId', 'certificateNumber'] },

  // --- email (driven by SendLog) ---
  'email.queued': { domain: 'email', version: 1, description: 'An email was queued', payload: ['sendLogId', 'provider', 'templateKey', 'status'] },
  'email.sent': { domain: 'email', version: 1, description: 'An email was accepted by the provider', payload: ['sendLogId', 'provider', 'templateKey', 'status'] },
  'email.failed': { domain: 'email', version: 1, description: 'An email failed to send', payload: ['sendLogId', 'provider', 'templateKey', 'status', 'errorCode'] },
  'email.delivered': { domain: 'email', version: 1, description: 'An email was delivered (provider webhook)', payload: ['sendLogId', 'provider', 'templateKey', 'status'] },
  'email.opened': { domain: 'email', version: 1, description: 'An email was opened (provider webhook)', payload: ['sendLogId', 'provider', 'templateKey', 'status'] },
  'email.bounced': { domain: 'email', version: 1, description: 'An email bounced (provider webhook)', payload: ['sendLogId', 'provider', 'templateKey', 'status'] },

  // --- job (schedulers) ---
  'job.started': { domain: 'job', version: 1, description: 'A scheduled job started', payload: ['jobName'] },
  'job.succeeded': { domain: 'job', version: 1, description: 'A scheduled job succeeded', payload: ['jobName'] },
  'job.failed': { domain: 'job', version: 1, description: 'A scheduled job failed', payload: ['jobName', 'errorCode'] }
});

export function getEventDefinition(name) {
  return EVENT_CATALOG[name] || null;
}

export function isKnownEvent(name) {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOG, name);
}

export default EVENT_CATALOG;
