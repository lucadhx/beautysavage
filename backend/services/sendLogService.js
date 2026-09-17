// services/sendLogService.js
// Helpers around the SendLog model. All write operations are DEFENSIVE: a logging
// failure must NEVER break the email flow (fire-and-forget callers), so every DB
// op is wrapped and swallowed with a safe warning (no secret, no email).

import crypto from 'node:crypto';
import SendLog from '../models/SendLog.js';
import { emitEvent } from './eventBusService.js';

// Best-effort: derive a business contextType from the email template key/tag.
// Explicit context (passed by a sender) always wins over this.
const CONTEXT_TYPE_BY_PREFIX = [
  [/^vente$/, 'sale'],
  [/^booking|^no_show|^service_booking/, 'service_booking'],
  [/^refund/, 'refund_request'],
  [/^commission/, 'commission_payment'],
  [/^gift_card/, 'gift_card'],
  [/^session|^formation/, 'formation_session'],
  [/^password_reset|^email_confirmation/, 'user'],
  [/^site_|^maintenance/, 'system']
];

function deriveContextType(templateKey) {
  const k = String(templateKey || '');
  for (const [re, type] of CONTEXT_TYPE_BY_PREFIX) {
    if (re.test(k)) return type;
  }
  return null;
}

// SendLog status -> domain email event.
const EVENT_BY_STATUS = {
  delivered: 'email.delivered',
  opened: 'email.opened',
  bounced: 'email.bounced'
};

// Emit a safe email.* event from a SendLog. Never throws (defensive).
async function emitSendLogEvent(log, eventName, extra = {}) {
  if (!log || !eventName) return;
  try {
    await emitEvent(
      eventName,
      {
        sendLogId: String(log._id),
        provider: log.provider,
        templateKey: log.templateKey,
        contextType: log.contextType || null,
        contextId: log.contextId || null,
        status: log.status,
        ...extra
      },
      { source: 'sendLogService', actorType: 'system', contextType: log.contextType || null, contextId: log.contextId || null }
    );
  } catch (err) {
    console.warn('[sendLog] event emit failed:', err?.message || err);
  }
}

/** SHA-256 of the lowercased/trimmed email. Never returns or stores the email. */
export function hashRecipient(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return '';
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function deriveTemplateKey(tags) {
  if (!Array.isArray(tags)) return '';
  const specific = tags.find(t => t && t !== 'transactional');
  return specific || tags[0] || '';
}

function firstRecipientEmail(payload) {
  const to = payload?.to;
  if (Array.isArray(to) && to.length) return to[0]?.email || '';
  if (typeof to === 'string') return to;
  return '';
}

/**
 * Create a SendLog in 'queued' status from a Brevo payload.
 * @returns {Promise<import('mongoose').Document|null>} the log, or null on failure
 */
export async function createQueuedSendLog(payload, { contextType = null, contextId = null } = {}) {
  const templateKey = deriveTemplateKey(payload?.tags);
  const resolvedContextType = contextType || deriveContextType(templateKey);
  let log = null;
  try {
    log = await SendLog.create({
      channel: 'email',
      provider: 'brevo',
      templateKey,
      recipientHash: hashRecipient(firstRecipientEmail(payload)),
      status: 'queued',
      subject: String(payload?.subject || '').slice(0, 300),
      contextType: resolvedContextType,
      contextId: contextId != null ? String(contextId) : null,
      metadata: { tags: Array.isArray(payload?.tags) ? payload.tags : [] },
      queuedAt: new Date()
    });
  } catch (err) {
    console.warn('[sendLog] could not create queued log:', err?.message || err);
    return null;
  }
  await emitSendLogEvent(log, 'email.queued');
  return log;
}

export async function markSendLogSent(log, { providerMessageId = '' } = {}) {
  if (!log) return;
  try {
    log.status = 'sent';
    log.sentAt = new Date();
    if (providerMessageId) log.providerMessageId = providerMessageId;
    await log.save();
  } catch (err) {
    console.warn('[sendLog] could not mark sent:', err?.message || err);
    return;
  }
  await emitSendLogEvent(log, 'email.sent');
}

export async function markSendLogFailed(log, { errorCode = 'error', errorMessageSafe = '' } = {}) {
  if (!log) return;
  try {
    log.status = 'failed';
    log.errorCode = String(errorCode || 'error');
    log.errorMessageSafe = String(errorMessageSafe || '').slice(0, 300);
    await log.save();
  } catch (err) {
    console.warn('[sendLog] could not mark failed:', err?.message || err);
    return;
  }
  await emitSendLogEvent(log, 'email.failed', { errorCode: log.errorCode });
}

// Brevo transactional event -> SendLog status/timestamp.
const BREVO_EVENT_MAP = {
  delivered: { status: 'delivered', field: 'deliveredAt' },
  opened: { status: 'opened', field: 'openedAt' },
  unique_opened: { status: 'opened', field: 'openedAt' },
  uniqueOpened: { status: 'opened', field: 'openedAt' },
  hard_bounce: { status: 'bounced', field: 'bouncedAt' },
  hardBounce: { status: 'bounced', field: 'bouncedAt' },
  soft_bounce: { status: 'bounced', field: 'bouncedAt' },
  softBounce: { status: 'bounced', field: 'bouncedAt' }
};

export function isSupportedBrevoEvent(event) {
  return Boolean(BREVO_EVENT_MAP[String(event || '')]);
}

/**
 * Apply a Brevo engagement event to the matching SendLog (by providerMessageId).
 * @returns {Promise<{matched: boolean, reason?: string, status?: string}>}
 */
export async function applyBrevoEvent({ event, messageId } = {}) {
  const mapping = BREVO_EVENT_MAP[String(event || '')];
  if (!mapping) return { matched: false, reason: 'unsupported_event' };

  const id = String(messageId || '').trim();
  if (!id) return { matched: false, reason: 'missing_message_id' };

  const log = await SendLog.findOne({ providerMessageId: id });
  if (!log) return { matched: false, reason: 'no_sendlog' };

  log[mapping.field] = new Date();
  // V1: simple status progression (no strict out-of-order reconciliation).
  log.status = mapping.status;
  await log.save();
  await emitSendLogEvent(log, EVENT_BY_STATUS[mapping.status]);
  return { matched: true, status: mapping.status };
}
