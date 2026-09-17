// services/mail/mailSupervisionMapper.js
// M3E — Mappers DTO "safe" pour la supervision mail (MailEventDelivery + SendLog).
// AUCUN e-mail complet, AUCUN secret, AUCUN payload brut. Le recipientHash (SHA-256) et le
// providerMessageId sont safe. Le `mode` (active/shadow) est dérivé des règles de dispatch.

import { getMailDispatchRule } from '../../constants/mailDispatchRules.js';

// Statuts considérés comme des "erreurs" (pour lastErrorCode + stats d'échecs).
export const MAIL_DELIVERY_ERROR_STATUSES = [
  'failed',
  'identity_missing',
  'client_missing',
  'skipped_template_missing'
];

// Statuts "shadow / inhibé" (n'ont pas réellement envoyé).
export const MAIL_DELIVERY_SHADOW_STATUSES = [
  'shadow',
  'skipped_duplicate_direct_sender',
  'skipped_rule_disabled'
];

// Templates plateforme/compte masqués à l'admin (vue manager = institut/client seulement).
export const ADMIN_HIDDEN_TEMPLATE_KEYS = [
  'password_reset',
  'email_confirmation_code',
  'commission_invoice',
  'commission_available',
  'commission_reminder',
  'commission_last_day',
  'site_suspended',
  'site_reactivated',
  'site_maintenance_start',
  'site_maintenance_end'
];

// Audience métier d'une livraison : 'admin' (institut/client) ou 'dev' (plateforme/technique).
export function deliveryTargetAudience({ fromRole, toRole } = {}) {
  if (fromRole === 'commerciale' || toRole === 'client') return 'admin';
  return 'dev';
}

// Extrait senderRole/recipientRole des tags SendLog (`from:<role>`, `to:<role>`).
export function rolesFromTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  let senderRole = null;
  let recipientRole = null;
  for (const t of list) {
    const s = String(t || '');
    if (s.startsWith('from:')) senderRole = s.slice(5) || null;
    else if (s.startsWith('to:')) recipientRole = s.slice(3) || null;
  }
  return { senderRole, recipientRole };
}

/**
 * MailEventDelivery → DTO safe.
 * @param {object} doc lean MailEventDelivery
 * @param {{ sendLog?: object|null }} [extra] SendLog corrélé (détail uniquement)
 */
export function mapMailDelivery(doc, { sendLog = null } = {}) {
  if (!doc) return null;
  const rule = getMailDispatchRule(doc.eventName);
  const isError = MAIL_DELIVERY_ERROR_STATUSES.includes(doc.status);
  return {
    id: String(doc._id),
    eventName: doc.eventName || null,
    templateKey: doc.templateKey || null,
    mode: rule?.mode || (rule ? (rule.directSenderExists ? 'shadow' : 'active') : null),
    status: doc.status || null,
    fromRole: doc.fromRole || null,
    toRole: doc.toRole || null,
    contextType: doc.contextType || null,
    contextId: doc.contextId || null,
    targetAudience: deliveryTargetAudience(doc),
    attempts: 1, // V1 : une entrée ledger par (event, contexte, template) — pas de retry tracké
    lastErrorCode: isError ? doc.status : null,
    lastErrorMessageSafe: doc.detailSafe || '',
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    sendLogId: doc.sendLogId || null,
    // Champs SendLog corrélés (détail) — safe uniquement.
    provider: sendLog?.provider || null,
    providerMessageId: sendLog?.providerMessageId || null,
    recipientHash: sendLog?.recipientHash || null,
    senderRole: doc.fromRole || null,
    recipientRole: doc.toRole || null
  };
}

/** SendLog → DTO safe (jamais d'e-mail, jamais de secret/payload). */
export function mapSendLog(doc) {
  if (!doc) return null;
  const { senderRole, recipientRole } = rolesFromTags(doc.metadata?.tags);
  return {
    id: String(doc._id),
    channel: doc.channel || 'email',
    provider: doc.provider || null,
    templateKey: doc.templateKey || null,
    status: doc.status || null,
    providerMessageId: doc.providerMessageId || '',
    recipientHash: doc.recipientHash || '',
    subject: doc.subject || '',
    contextType: doc.contextType || null,
    contextId: doc.contextId || null,
    senderRole,
    recipientRole,
    tags: Array.isArray(doc.metadata?.tags) ? doc.metadata.tags : [],
    queuedAt: doc.queuedAt || null,
    sentAt: doc.sentAt || null,
    deliveredAt: doc.deliveredAt || null,
    openedAt: doc.openedAt || null,
    bouncedAt: doc.bouncedAt || null,
    errorCode: doc.errorCode || '',
    lastErrorMessageSafe: doc.errorMessageSafe || '',
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  };
}

export default { mapMailDelivery, mapSendLog, deliveryTargetAudience, rolesFromTags };
