// services/mail/mailSupervisionService.js
// M3E — Supervision (lecture seule) du moteur mail M2 : MailEventDelivery + SendLog.
// Deux vues : roleView='dev' (tout, safe) et roleView='admin' (institut/client uniquement).
// Ne modifie JAMAIS d'envoi ; aucune écriture ; aucun e-mail/secret exposé.

import mongoose from 'mongoose';
import MailEventDelivery, { MAIL_EVENT_DELIVERY_STATUSES } from '../../models/MailEventDelivery.js';
import SendLog, { SEND_LOG_STATUSES } from '../../models/SendLog.js';
import { getMailDispatchRule } from '../../constants/mailDispatchRules.js';
import {
  mapMailDelivery,
  mapSendLog,
  ADMIN_HIDDEN_TEMPLATE_KEYS,
  MAIL_DELIVERY_ERROR_STATUSES,
  MAIL_DELIVERY_SHADOW_STATUSES
} from './mailSupervisionMapper.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MAIL_ROLES = ['support', 'commerciale', 'client'];
const KNOWN_CONTEXT_TYPES = ['sale', 'service_booking', 'refund_request', 'commission_payment', 'gift_card', 'formation_session', 'user', 'system'];

function clampLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

// Date valide → Date ; sinon null (ignorée, jamais de throw).
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// N'applique un filtre string que si la valeur est non vide ; enums vérifiées (sinon ignorées).
function applyCommonFilters(filter, f = {}, { statuses }) {
  if (f.status && (!statuses || statuses.includes(String(f.status)))) filter.status = String(f.status);
  if (f.eventName) filter.eventName = String(f.eventName);
  if (f.templateKey) filter.templateKey = String(f.templateKey);
  if (f.fromRole && MAIL_ROLES.includes(String(f.fromRole))) filter.fromRole = String(f.fromRole);
  if (f.toRole && MAIL_ROLES.includes(String(f.toRole))) filter.toRole = String(f.toRole);
  if (f.contextType && KNOWN_CONTEXT_TYPES.includes(String(f.contextType))) filter.contextType = String(f.contextType);
  if (f.contextId) filter.contextId = String(f.contextId);
  const from = parseDate(f.dateFrom);
  const to = parseDate(f.dateTo);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  return filter;
}

// Clause d'audience admin pour MailEventDelivery : institut/client uniquement.
function adminDeliveryAudienceClause() {
  return { $or: [{ fromRole: 'commerciale' }, { toRole: 'client' }] };
}
// Clause d'audience admin pour SendLog : exclut les templates plateforme/compte.
function adminSendLogAudienceClause() {
  return { templateKey: { $nin: ADMIN_HIDDEN_TEMPLATE_KEYS } };
}

function buildDeliveryFilter(roleView, f = {}) {
  const filter = applyCommonFilters({}, f, { statuses: MAIL_EVENT_DELIVERY_STATUSES });
  if (roleView !== 'dev') {
    const audience = adminDeliveryAudienceClause();
    return Object.keys(filter).length ? { $and: [audience, filter] } : audience;
  }
  return filter;
}

function buildSendLogFilter(roleView, f = {}) {
  // SendLog n'a pas fromRole/toRole en colonnes → on ignore ces filtres ici.
  const filter = applyCommonFilters({}, { ...f, fromRole: undefined, toRole: undefined, eventName: undefined }, { statuses: SEND_LOG_STATUSES });
  if (roleView !== 'dev') {
    const audience = adminSendLogAudienceClause();
    return Object.keys(filter).length ? { $and: [audience, filter] } : audience;
  }
  return filter;
}

// ─── Listes ───────────────────────────────────────────────────────────────────

export async function listMailEventDeliveries({ roleView = 'admin', limit, ...filters } = {}) {
  const lim = clampLimit(limit);
  const query = buildDeliveryFilter(roleView, filters);
  const docs = await MailEventDelivery.find(query).sort({ createdAt: -1 }).limit(lim).lean();
  return { count: docs.length, limit: lim, items: docs.map((d) => mapMailDelivery(d)) };
}

export async function getMailEventDeliveryDetail(id, { roleView = 'admin' } = {}) {
  if (!mongoose.isValidObjectId(String(id))) return null;
  const doc = await MailEventDelivery.findById(id).lean();
  if (!doc) return null;
  // Contrôle d'audience : un admin ne voit pas une livraison plateforme (dev-only).
  if (roleView !== 'dev') {
    const okAudience = doc.fromRole === 'commerciale' || doc.toRole === 'client';
    if (!okAudience) return null;
  }
  // Corrélation SendLog best-effort : par sendLogId, sinon par (contextType, contextId, templateKey).
  let sendLog = null;
  try {
    if (doc.sendLogId && mongoose.isValidObjectId(String(doc.sendLogId))) {
      sendLog = await SendLog.findById(doc.sendLogId).lean();
    }
    if (!sendLog && doc.contextId) {
      sendLog = await SendLog.findOne({ contextType: doc.contextType || null, contextId: String(doc.contextId), templateKey: doc.templateKey || '' })
        .sort({ createdAt: -1 })
        .lean();
    }
  } catch {
    sendLog = null;
  }
  return mapMailDelivery(doc, { sendLog });
}

export async function listSendLogsForSupervision({ roleView = 'admin', limit, ...filters } = {}) {
  const lim = clampLimit(limit);
  const query = buildSendLogFilter(roleView, filters);
  const docs = await SendLog.find(query).sort({ createdAt: -1 }).limit(lim).lean();
  return { count: docs.length, limit: lim, items: docs.map((d) => mapSendLog(d)) };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function groupCounts(rows) {
  const out = {};
  for (const r of rows) out[r._id ?? '(none)'] = r.count;
  return out;
}

export async function getMailSupervisionStats({ roleView = 'admin', dateFrom, dateTo } = {}) {
  const base = buildDeliveryFilter(roleView, { dateFrom, dateTo });
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, byStatusRows, byTemplateRows, byEventRows, last24h, failuresLast24h] = await Promise.all([
    MailEventDelivery.countDocuments(base),
    MailEventDelivery.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    MailEventDelivery.aggregate([{ $match: base }, { $group: { _id: '$templateKey', count: { $sum: 1 } } }]),
    MailEventDelivery.aggregate([{ $match: base }, { $group: { _id: '$eventName', count: { $sum: 1 } } }]),
    MailEventDelivery.countDocuments({ $and: [base, { createdAt: { $gte: since24h } }] }),
    MailEventDelivery.countDocuments({ $and: [base, { status: { $in: MAIL_DELIVERY_ERROR_STATUSES }, createdAt: { $gte: since24h } }] })
  ]);

  // shadow vs active : dérivé du mode de la règle par eventName (fallback statut).
  let shadowCount = 0;
  let activeCount = 0;
  for (const row of byEventRows) {
    const rule = getMailDispatchRule(row._id);
    const mode = rule?.mode || (rule ? (rule.directSenderExists ? 'shadow' : 'active') : null);
    if (mode === 'active') activeCount += row.count;
    else if (mode === 'shadow') shadowCount += row.count;
  }

  return {
    roleView: roleView === 'dev' ? 'dev' : 'admin',
    total,
    byStatus: groupCounts(byStatusRows),
    byTemplate: groupCounts(byTemplateRows),
    byEvent: groupCounts(byEventRows),
    last24h,
    failuresLast24h,
    shadowCount,
    activeCount
  };
}

export async function getSendLogSupervisionStats({ roleView = 'admin', dateFrom, dateTo } = {}) {
  const base = buildSendLogFilter(roleView, { dateFrom, dateTo });
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [total, byStatusRows, byTemplateRows, last24h, failuresLast24h] = await Promise.all([
    SendLog.countDocuments(base),
    SendLog.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    SendLog.aggregate([{ $match: base }, { $group: { _id: '$templateKey', count: { $sum: 1 } } }]),
    SendLog.countDocuments({ $and: [base, { createdAt: { $gte: since24h } }] }),
    SendLog.countDocuments({ $and: [base, { status: { $in: ['failed', 'bounced'] }, createdAt: { $gte: since24h } }] })
  ]);
  return {
    roleView: roleView === 'dev' ? 'dev' : 'admin',
    total,
    byStatus: groupCounts(byStatusRows),
    byTemplate: groupCounts(byTemplateRows),
    last24h,
    failuresLast24h
  };
}

export { MAX_LIMIT, MAIL_DELIVERY_SHADOW_STATUSES };
export default {
  listMailEventDeliveries,
  getMailEventDeliveryDetail,
  getMailSupervisionStats,
  listSendLogsForSupervision,
  getSendLogSupervisionStats
};
