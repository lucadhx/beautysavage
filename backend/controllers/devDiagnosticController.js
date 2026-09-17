// controllers/devDiagnosticController.js
// Dev-only diagnostics. Read-only views over observability data.
// PRIVACY: returns SendLog rows which contain NO email, token, or secret
// (recipient is a SHA-256 hash; no credentials are ever stored on SendLog).

import SendLog from '../models/SendLog.js';
import EventLog from '../models/EventLog.js';
import WebhookFailureLog from '../models/WebhookFailureLog.js';

const SAFE_FIELDS = [
  'channel', 'provider', 'templateKey', 'recipientHash', 'status',
  'providerMessageId', 'subject', 'contextType', 'contextId', 'metadata',
  'queuedAt', 'sentAt', 'deliveredAt', 'openedAt', 'bouncedAt',
  'errorCode', 'errorMessageSafe', 'createdAt', 'updatedAt'
].join(' ');

export async function getSendLogs(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    const filter = {};
    if (req.query?.status) filter.status = String(req.query.status);
    // M3E — filtres additionnels (additif, contrat inchangé).
    if (req.query?.templateKey) filter.templateKey = String(req.query.templateKey);
    if (req.query?.contextType) filter.contextType = String(req.query.contextType);
    if (req.query?.contextId) filter.contextId = String(req.query.contextId);
    const dateFrom = req.query?.dateFrom ? new Date(req.query.dateFrom) : null;
    const dateTo = req.query?.dateTo ? new Date(req.query.dateTo) : null;
    if ((dateFrom && !Number.isNaN(dateFrom.getTime())) || (dateTo && !Number.isNaN(dateTo.getTime()))) {
      filter.createdAt = {};
      if (dateFrom && !Number.isNaN(dateFrom.getTime())) filter.createdAt.$gte = dateFrom;
      if (dateTo && !Number.isNaN(dateTo.getTime())) filter.createdAt.$lte = dateTo;
    }
    const logs = await SendLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(SAFE_FIELDS)
      .lean();
    return res.json({ ok: true, count: logs.length, logs });
  } catch (error) {
    console.error('[devDiagnostic] getSendLogs error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

const EVENT_SAFE_FIELDS = [
  'eventName', 'domain', 'version', 'actorType', 'source',
  'contextType', 'contextId', 'payloadSafe', 'traceId', 'emittedAt', 'createdAt'
].join(' ');

export async function getEvents(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    const filter = {};
    if (req.query?.eventName) filter.eventName = String(req.query.eventName);
    if (req.query?.domain) filter.domain = String(req.query.domain);
    if (req.query?.contextType) filter.contextType = String(req.query.contextType);
    const events = await EventLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(EVENT_SAFE_FIELDS)
      .lean();
    return res.json({ ok: true, count: events.length, events });
  } catch (error) {
    console.error('[devDiagnostic] getEvents error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// A6 — Pannes webhook (Stripe). Vue read-only dev. Aucune donnée sensible :
// errorMessageSafe est tronqué/neutre, seuls des identifiants techniques sont stockés.
const WEBHOOK_FAILURE_SAFE_FIELDS = [
  'provider', 'webhookType', 'eventType', 'failureStage', 'errorCode',
  'errorMessageSafe', 'stripeEventId', 'paymentIntentId', 'status', 'retryable',
  'createdAt'
].join(' ');

export async function getWebhookFailures(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    const filter = {};
    if (req.query?.provider) filter.provider = String(req.query.provider);
    if (req.query?.status) filter.status = String(req.query.status);
    if (req.query?.paymentIntentId) filter.paymentIntentId = String(req.query.paymentIntentId);
    const failures = await WebhookFailureLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(WEBHOOK_FAILURE_SAFE_FIELDS)
      .lean();
    return res.json({ ok: true, count: failures.length, failures });
  } catch (error) {
    console.error('[devDiagnostic] getWebhookFailures error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export default getSendLogs;
