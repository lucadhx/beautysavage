// constants/eventContextSchema.js
// M3B — Schéma logique standard du CONTEXTE d'un événement métier.
//
// Un contexte est une enveloppe uniforme, SAFE par défaut, attachée aux events et
// réutilisable par : mails, notifications, audit, IA, automatisations, logs, webhooks.
//
// RÈGLES :
//   - jamais de secret / token / mot de passe / code carte cadeau ;
//   - e-mail complet ÉVITÉ par défaut (résolu via DB par un resolver, pas stocké) ;
//   - on préfère des IDs (clientId, saleId…) + resolvers à toute donnée brute ;
//   - `clientName` (PII faible) est toléré dans `variables`, flaggé via `privacy`.
//
// Forme :
// {
//   contextType, contextId,
//   related:  { saleId, bookingId, refundId, commissionPaymentId, giftCardId,
//               clientId, userId, formationId, serviceId, productId, sessionId },
//   actors:   { clientId, adminId, devId, system },
//   variables:{ amount, itemName, clientName, bookingDate, refundAmount, commissionAmount, ... },
//   privacy:  { containsPii: Boolean, piiFields: [] }
// }

export const EVENT_CONTEXT_TYPES = Object.freeze([
  'sale',
  'service_booking',
  'refund_request',
  'commission_payment',
  'gift_card',
  'formation_session',
  'system'
]);

// Clés d'IDs reconnues dans `related`.
export const RELATED_ID_KEYS = Object.freeze([
  'saleId',
  'bookingId',
  'refundId',
  'commissionPaymentId',
  'giftCardId',
  'clientId',
  'userId',
  'formationId',
  'serviceId',
  'productId',
  'sessionId'
]);

// Clés d'acteurs reconnues dans `actors`.
export const ACTOR_KEYS = Object.freeze(['clientId', 'adminId', 'devId', 'system']);

// Champs interdits dans un contexte (sanitize les retire, à tout niveau).
// NB : `clientName` n'est PAS sensible ici (décision documentée — voir rapport 178).
export const EVENT_CONTEXT_SENSITIVE_KEYS = Object.freeze([
  'email',
  'clientEmail',
  'recipient',
  'recipientEmail',
  'secret',
  'client_secret',
  'clientSecret',
  'token',
  'accessToken',
  'trackingToken',
  'password',
  'pwd',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'code',
  'giftCardCode',
  'cardCode',
  'cvv',
  'iban',
  'stripePaymentIntentId',
  'stripeRefundId'
]);

// PII faible autorisée mais signalée dans privacy.piiFields.
export const EVENT_CONTEXT_PII_FIELDS = Object.freeze(['clientName']);

export const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Construit un contexte standard normalisé à partir d'un objet partiel.
 * Garantit la forme (related/actors/variables/privacy) sans introduire de champ sensible.
 * @param {object} [partial]
 * @returns {{contextType:?string, contextId:?string, related:object, actors:object, variables:object, privacy:{containsPii:boolean, piiFields:string[]}}}
 */
export function createEventContext(partial = {}) {
  const p = partial || {};
  return {
    contextType: p.contextType != null ? String(p.contextType) : null,
    contextId: p.contextId != null ? String(p.contextId) : null,
    related: { ...(p.related || {}) },
    actors: { system: true, ...(p.actors || {}) },
    variables: { ...(p.variables || {}) },
    privacy: {
      containsPii: Boolean(p.privacy?.containsPii) || false,
      piiFields: Array.isArray(p.privacy?.piiFields) ? [...p.privacy.piiFields] : []
    }
  };
}

/** True si `type` est un contextType reconnu. */
export function isKnownContextType(type) {
  return EVENT_CONTEXT_TYPES.includes(String(type || ''));
}

export default {
  EVENT_CONTEXT_TYPES,
  RELATED_ID_KEYS,
  ACTOR_KEYS,
  EVENT_CONTEXT_SENSITIVE_KEYS,
  EVENT_CONTEXT_PII_FIELDS,
  EMAIL_RE,
  createEventContext,
  isKnownContextType
};
