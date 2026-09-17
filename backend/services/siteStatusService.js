import crypto from 'node:crypto';

import SiteStatus from '../models/SiteStatus.js';
import User from '../models/user.js';
import {
  sendSiteSuspendedEmail,
  sendSiteReactivatedEmail,
  sendSiteMaintenanceStartEmail,
  sendSiteMaintenanceEndEmail
} from './mailService.js';

const SITE_STATUS_KEY = 'global';
const SITE_STATUS_CACHE_TTL_MS = 1500;
const SITE_STATUSES = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  MAINTENANCE: 'maintenance'
});

export const ADMIN_SUSPENDED_MESSAGE =
  "Le site est suspendu, l'acces administrateur est impossible jusqu'a reactivation.";
export const MAINTENANCE_BLOCKED_MESSAGE =
  'Le site est en maintenance, vous pourrez bientôt y accéder.';

let siteStatusCache = null;
let siteStatusCacheAt = 0;

function invalidateSiteStatusCache() {
  siteStatusCache = null;
  siteStatusCacheAt = 0;
}

function normalizeReason(value) {
  return String(value || '').trim();
}

function normalizeEta(value) {
  return String(value || '').trim();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStatus(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === SITE_STATUSES.SUSPENDED) return SITE_STATUSES.SUSPENDED;
  if (candidate === SITE_STATUSES.MAINTENANCE) return SITE_STATUSES.MAINTENANCE;
  return SITE_STATUSES.ACTIVE;
}

function getDisplayName(user) {
  const firstName = String(user?.firstName || '').trim();
  const lastName = String(user?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || '';
}

function mapUserSnapshot(user) {
  if (!user) return null;
  return {
    id: user._id?.toString() || user.id?.toString() || null,
    email: String(user.email || '').trim() || '',
    role: String(user.role || '').trim() || '',
    name: getDisplayName(user)
  };
}

function mapHistoryEntry(entry) {
  const actor = mapUserSnapshot(entry?.byUserId);
  const status = normalizeStatus(entry?.status);
  const date = entry?.date || entry?.startedAt || null;
  return {
    status,
    reason: normalizeReason(entry?.reason),
    eta: normalizeEta(entry?.eta),
    date,
    startedAt: entry?.startedAt || date,
    endedAt: entry?.endedAt || null,
    byUserId: actor?.id || null,
    byUser: actor
  };
}

function mapStatusDocument(doc) {
  const actor = mapUserSnapshot(doc?.updatedBy);
  const status = normalizeStatus(doc?.currentStatus);
  const maintenanceStartedAt =
    status === SITE_STATUSES.MAINTENANCE
      ? doc?.maintenanceStartedAt || doc?.updatedAt || null
      : null;
  return {
    status,
    updatedAt: doc?.updatedAt || null,
    updatedBy: actor,
    updatedById: actor?.id || null,
    reason: normalizeReason(doc?.reason),
    eta: normalizeEta(doc?.eta),
    maintenanceStartedAt,
    maintenanceEndedAt: doc?.maintenanceEndedAt || null
  };
}

function formatEmailDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function ensureSiteStatusDocument({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (
    !forceRefresh &&
    siteStatusCache &&
    now - siteStatusCacheAt < SITE_STATUS_CACHE_TTL_MS
  ) {
    return siteStatusCache;
  }

  let doc = await SiteStatus.findOne({ key: SITE_STATUS_KEY })
    .populate('updatedBy', 'email firstName lastName role')
    .populate('history.byUserId', 'email firstName lastName role');

  if (!doc) {
    doc = await SiteStatus.create({
      key: SITE_STATUS_KEY,
      currentStatus: SITE_STATUSES.ACTIVE,
      updatedAt: new Date(),
      updatedBy: null,
      reason: '',
      eta: '',
      maintenanceStartedAt: null,
      maintenanceEndedAt: null,
      history: []
    });
    doc = await SiteStatus.findById(doc._id)
      .populate('updatedBy', 'email firstName lastName role')
      .populate('history.byUserId', 'email firstName lastName role');
  }

  siteStatusCache = doc;
  siteStatusCacheAt = now;
  return doc;
}

async function collectAdminEmails() {
  const admins = await User.find({ role: 'admin' }).select('email').lean();
  const seen = new Set();
  const emails = [];
  for (const admin of admins) {
    const email = String(admin?.email || '').trim();
    const lower = email.toLowerCase();
    if (!email || seen.has(lower)) continue;
    seen.add(lower);
    emails.push(email);
  }
  return emails;
}

async function invalidateAllAdminSessions() {
  const randomHash = crypto.randomBytes(32).toString('hex');
  await User.updateMany(
    { role: 'admin' },
    { $set: { sessionTokenHash: randomHash } }
  );
}

async function invalidateAllNonDevSessions() {
  const randomHash = crypto.randomBytes(32).toString('hex');
  await User.updateMany(
    { role: { $ne: 'dev' } },
    { $set: { sessionTokenHash: randomHash } }
  );
}

async function sendStatusEmails({
  event,
  reason = '',
  eta = '',
  when,
  startedAt
}) {
  const recipients = await collectAdminEmails();
  if (!recipients.length) return;
  const date = formatEmailDate(when);

  if (event === 'suspended') {
    await sendSiteSuspendedEmail({
      toEmails: recipients,
      reason,
      date
    });
    return;
  }

  if (event === 'reactivated') {
    await sendSiteReactivatedEmail({
      toEmails: recipients,
      date
    });
    return;
  }

  if (event === 'maintenance-start') {
    await sendSiteMaintenanceStartEmail({
      toEmails: recipients,
      reason,
      eta,
      date,
      startedAt: formatEmailDate(startedAt || when)
    });
    return;
  }

  if (event === 'maintenance-end') {
    await sendSiteMaintenanceEndEmail({
      toEmails: recipients,
      reason,
      eta,
      date,
      startedAt: formatEmailDate(startedAt || when)
    });
  }
}

function pushHistoryEntry(
  doc,
  {
    status,
    reason = '',
    eta = '',
    date,
    startedAt = null,
    endedAt = null,
    byUserId = null
  }
) {
  doc.history = Array.isArray(doc.history) ? doc.history : [];
  doc.history.push({
    status: normalizeStatus(status),
    reason: normalizeReason(reason),
    eta: normalizeEta(eta),
    date: date || new Date(),
    startedAt,
    endedAt,
    byUserId: byUserId || null
  });
}

async function saveStatusDocument(doc) {
  await doc.save();
  invalidateSiteStatusCache();
}

export async function getStatus() {
  const doc = await ensureSiteStatusDocument();
  return mapStatusDocument(doc);
}

export async function isSiteSuspended() {
  const status = await getStatus();
  return status.status === SITE_STATUSES.SUSPENDED;
}

export async function isSiteInMaintenance() {
  const status = await getStatus();
  return status.status === SITE_STATUSES.MAINTENANCE;
}

export function isRoleAllowedDuringMaintenance(role) {
  return normalizeRole(role) === 'dev';
}

export async function isUserBlockedByMaintenance(user) {
  if (!(await isSiteInMaintenance())) return false;
  return !isRoleAllowedDuringMaintenance(user?.role);
}

export async function suspend({ reason, byUserId = null } = {}) {
  const normalizedReason = normalizeReason(reason);
  if (!normalizedReason) {
    const error = new Error('Le motif de suspension est requis.');
    error.status = 400;
    throw error;
  }

  const doc = await ensureSiteStatusDocument({ forceRefresh: true });
  const now = new Date();
  doc.currentStatus = SITE_STATUSES.SUSPENDED;
  doc.updatedAt = now;
  doc.updatedBy = byUserId || null;
  doc.reason = normalizedReason;
  doc.eta = '';
  doc.maintenanceStartedAt = null;
  doc.maintenanceEndedAt = null;
  pushHistoryEntry(doc, {
    status: SITE_STATUSES.SUSPENDED,
    reason: normalizedReason,
    eta: '',
    date: now,
    startedAt: now,
    endedAt: null,
    byUserId
  });
  await saveStatusDocument(doc);

  try {
    await invalidateAllAdminSessions();
  } catch (error) {
    console.error('[siteStatusService] impossible d invalider les sessions admin', error);
  }
  try {
    await sendStatusEmails({
      event: 'suspended',
      reason: normalizedReason,
      when: now
    });
  } catch (error) {
    console.error('[siteStatusService] impossible d envoyer le mail de suspension', error);
  }
  return getStatus();
}

export async function startMaintenance({ reason, eta, byUserId = null } = {}) {
  const normalizedReason = normalizeReason(reason);
  const normalizedEta = normalizeEta(eta);
  if (!normalizedReason) {
    const error = new Error('Le motif de maintenance est requis.');
    error.status = 400;
    throw error;
  }
  if (!normalizedEta) {
    const error = new Error("La dur?e estim?e est requise pour la maintenance.");
    error.status = 400;
    throw error;
  }

  const doc = await ensureSiteStatusDocument({ forceRefresh: true });
  const now = new Date();
  doc.currentStatus = SITE_STATUSES.MAINTENANCE;
  doc.updatedAt = now;
  doc.updatedBy = byUserId || null;
  doc.reason = normalizedReason;
  doc.eta = normalizedEta;
  doc.maintenanceStartedAt = now;
  doc.maintenanceEndedAt = null;
  pushHistoryEntry(doc, {
    status: SITE_STATUSES.MAINTENANCE,
    reason: normalizedReason,
    eta: normalizedEta,
    date: now,
    startedAt: now,
    endedAt: null,
    byUserId
  });
  await saveStatusDocument(doc);

  try {
    await invalidateAllNonDevSessions();
  } catch (error) {
    console.error('[siteStatusService] impossible d invalider les sessions non dev', error);
  }
  try {
    await sendStatusEmails({
      event: 'maintenance-start',
      reason: normalizedReason,
      eta: normalizedEta,
      when: now,
      startedAt: now
    });
  } catch (error) {
    console.error('[siteStatusService] impossible d envoyer le mail de début maintenance', error);
  }

  return getStatus();
}

async function finishMaintenance({ byUserId = null, existingDoc = null } = {}) {
  const doc = existingDoc || (await ensureSiteStatusDocument({ forceRefresh: true }));
  const previousReason = normalizeReason(doc?.reason);
  const previousEta = normalizeEta(doc?.eta);
  const startedAt = doc?.maintenanceStartedAt || doc?.updatedAt || new Date();
  const now = new Date();

  doc.currentStatus = SITE_STATUSES.ACTIVE;
  doc.updatedAt = now;
  doc.updatedBy = byUserId || null;
  doc.reason = '';
  doc.eta = '';
  doc.maintenanceEndedAt = now;
  pushHistoryEntry(doc, {
    status: SITE_STATUSES.ACTIVE,
    reason: previousReason,
    eta: previousEta,
    date: now,
    startedAt,
    endedAt: now,
    byUserId
  });
  await saveStatusDocument(doc);

  try {
    await sendStatusEmails({
      event: 'maintenance-end',
      reason: previousReason,
      eta: previousEta,
      when: now,
      startedAt
    });
  } catch (error) {
    console.error('[siteStatusService] impossible d envoyer le mail de fin maintenance', error);
  }
  return getStatus();
}

export async function endMaintenance({ byUserId = null } = {}) {
  const doc = await ensureSiteStatusDocument({ forceRefresh: true });
  if (normalizeStatus(doc?.currentStatus) !== SITE_STATUSES.MAINTENANCE) {
    return getStatus();
  }
  return finishMaintenance({ byUserId, existingDoc: doc });
}

export async function reactivate({ byUserId = null } = {}) {
  const doc = await ensureSiteStatusDocument({ forceRefresh: true });
  const previousStatus = normalizeStatus(doc?.currentStatus);

  if (previousStatus === SITE_STATUSES.MAINTENANCE) {
    return finishMaintenance({ byUserId, existingDoc: doc });
  }

  const now = new Date();
  doc.currentStatus = SITE_STATUSES.ACTIVE;
  doc.updatedAt = now;
  doc.updatedBy = byUserId || null;
  doc.reason = '';
  doc.eta = '';
  doc.maintenanceStartedAt = null;
  doc.maintenanceEndedAt = null;
  pushHistoryEntry(doc, {
    status: SITE_STATUSES.ACTIVE,
    reason: '',
    eta: '',
    date: now,
    startedAt: null,
    endedAt: null,
    byUserId
  });
  await saveStatusDocument(doc);

  if (previousStatus === SITE_STATUSES.SUSPENDED) {
    try {
      await sendStatusEmails({
        event: 'reactivated',
        when: now
      });
    } catch (error) {
      console.error('[siteStatusService] impossible d envoyer le mail de reactivation', error);
    }
  }

  return getStatus();
}

export async function listHistory() {
  const doc = await ensureSiteStatusDocument();
  const entries = Array.isArray(doc?.history) ? doc.history : [];
  return entries
    .map(mapHistoryEntry)
    .sort((left, right) => {
      const leftTs = new Date(left?.date || 0).getTime();
      const rightTs = new Date(right?.date || 0).getTime();
      return rightTs - leftTs;
    });
}
