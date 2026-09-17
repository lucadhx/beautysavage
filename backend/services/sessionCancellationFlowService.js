import crypto from 'node:crypto';
import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import FormationSession, {
  buildActiveFormationSessionFilter,
  isInactiveFormationSessionStatus
} from '../models/FormationSession.js';
import Purchase from '../models/Purchase.js';
import RefundRequest from '../models/RefundRequest.js';
import Sale from '../models/Sale.js';
import Service from '../models/Service.js';
import ServiceBooking from '../models/ServiceBooking.js';
import SessionCancellationFlow from '../models/SessionCancellationFlow.js';
import SiteIdentity from '../models/SiteIdentity.js';
import User from '../models/user.js';
import PractitionerProfile from '../models/PractitionerProfile.js';
import {
  buildRefundId,
  ensureRefundCommissionProvision,
  REFUND_REASON_SESSION_CANCELED_BY_INSTITUTE,
  resolveSaleAcceptedText,
  resolveSaleForFormationPurchase
} from './refundService.js';
import { triggerRefundExecution } from './refundExecutionService.js';
import {
  applyRefundExecutionCap,
  createRefundRequestOnce,
  findActiveRefundRequestForSaleItem
} from './refundRequestService.js';
import { createCompensationGiftCard } from './giftCardService.js';
import { createGlobalServiceBooking } from './calendar/globalAvailabilityService.js';
import { getPresentielWaiverExpectation } from '../utils/consumerWaiver.js';
import { resolveFrontendUrl } from './system/frontendUrl.js';
import {
  sendFormationDeletedChoiceEmail,
  sendServiceCancellationChoiceEmail,
  sendBookingConfirmedEmail,
  sendServiceRescheduledAdminEmail,
  sendSessionCancelledChoiceEmail,
  sendSessionUpdatedChoiceEmail
} from './mailService.js';
import { triggerNotification } from './notificationService.js';
import { isActiveRefundRequestStatus } from '../constants/refundRequest.js';
import { emitBookingEvent } from './businessEventService.js';
import { isMailRoleResolverEnabled } from '../constants/mailDispatchRules.js';

export const SESSION_CANCELLATION_TOKEN_TTL_DAYS = 7;
export const FLOW_DECISION_PENDING = 'pending';
export const FLOW_DECISION_REFUND = 'refund';
export const FLOW_DECISION_RESCHEDULE = 'reschedule';
export const FLOW_DECISION_CONFIRM = 'confirm';
export const FLOW_DECISION_GIFT_CARD = 'gift_card';
export const FLOW_TYPE_SESSION_CANCELLED = 'session_cancelled';
export const FLOW_TYPE_SESSION_UPDATED = 'session_updated';
export const FLOW_TYPE_FORMATION_DELETED = 'formation_deleted';
export const FLOW_TYPE_SERVICE_BOOKING_CANCELLED = 'service_booking_cancelled';
export const SESSION_CANCELLATION_PAGE_SLUG = 'session-cancel-decision';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REFUND_REASON_SESSION_UPDATED_BY_INSTITUTE = 'session_updated_by_institute';
const REFUND_REASON_FORMATION_DELETED_BY_INSTITUTE = 'formation_deleted_by_institute';
const REFUND_REASON_SERVICE_BOOKING_CANCELLED_BY_INSTITUTE = 'service_booking_cancelled_by_institute';

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function localDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isSessionCanceledStatus(value) {
  return isInactiveFormationSessionStatus(value);
}

function buildActiveSessionQuery(base = {}) {
  return buildActiveFormationSessionFilter(base);
}

function getTodayStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function normalizeSessionStartDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATE_ONLY_PATTERN.test(trimmed)) {
      const [yearRaw, monthRaw, dayRaw] = trimmed.split('-');
      const year = Number(yearRaw);
      const month = Number(monthRaw);
      const day = Number(dayRaw);
      const dateFromParts = new Date(year, month - 1, day);
      if (Number.isNaN(dateFromParts.getTime())) return null;
      dateFromParts.setHours(0, 0, 0, 0);
      return dateFromParts;
    }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function normalizeFlowId(value) {
  return String(value || '').trim();
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function normalizeCurrentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function buildFlowRefundReason(flowType) {
  if (flowType === FLOW_TYPE_FORMATION_DELETED) return REFUND_REASON_FORMATION_DELETED_BY_INSTITUTE;
  if (flowType === FLOW_TYPE_SESSION_UPDATED) return REFUND_REASON_SESSION_UPDATED_BY_INSTITUTE;
  if (flowType === FLOW_TYPE_SERVICE_BOOKING_CANCELLED) return REFUND_REASON_SERVICE_BOOKING_CANCELLED_BY_INSTITUTE;
  return REFUND_REASON_SESSION_CANCELED_BY_INSTITUTE;
}

function buildFlowStatusAfterRefund(triggeredBy) {
  return triggeredBy === 'auto' ? 'auto_refunded' : 'refunded';
}

function buildFormationSnapshot(formationDoc = null) {
  const parsedRefundDays = Number(formationDoc?.refundDays);
  return {
    name: sanitizeText(formationDoc?.name),
    coverImage: sanitizeText(formationDoc?.coverImage),
    type: sanitizeText(formationDoc?.type) || 'presentiel',
    price: roundToCents(formationDoc?.price || 0),
    refundDays: Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : 7
  };
}

export function buildSessionCancellationFlowId() {
  const suffix = crypto.randomUUID().split('-')[0];
  return `SCF-${Date.now()}-${suffix}`;
}

export function hashSessionCancellationToken(value) {
  return crypto.createHash('sha256').update(String(value || '').trim()).digest('hex');
}

export function createSessionCancellationTokenPair() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashSessionCancellationToken(token)
  };
}

export function buildTokenExpiryDate(referenceDate = new Date()) {
  return new Date(new Date(referenceDate).getTime() + SESSION_CANCELLATION_TOKEN_TTL_DAYS * DAY_IN_MS);
}

export function buildAutoRefundDate(referenceDate = new Date()) {
  return buildTokenExpiryDate(referenceDate);
}

export function buildSessionSnapshot(sessionDoc = null) {
  if (!sessionDoc) {
    return {
      startDate: null,
      durationDays: 1,
      schedule: [],
      timezone: 'Europe/Paris'
    };
  }
  const schedule = Array.isArray(sessionDoc?.schedule)
    ? sessionDoc.schedule
        .map(entry => ({
          dayIndex: Number(entry?.dayIndex) || 1,
          startTime: sanitizeText(entry?.startTime),
          endTime: sanitizeText(entry?.endTime)
        }))
        .filter(entry => entry.startTime && entry.endTime)
        .sort((a, b) => a.dayIndex - b.dayIndex)
    : [];
  const startDate = sessionDoc?.startDate ? new Date(sessionDoc.startDate) : null;
  return {
    startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate : null,
    durationDays: Number.isFinite(Number(sessionDoc?.durationDays))
      ? Math.max(1, Math.floor(Number(sessionDoc.durationDays)))
      : 1,
    schedule,
    timezone: 'Europe/Paris'
  };
}

function formatDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatSessionDateSummary(snapshot = null) {
  const startDate = snapshot?.startDate ? new Date(snapshot.startDate) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return 'Date de session indisponible';
  const durationDays = Number.isFinite(Number(snapshot?.durationDays))
    ? Math.max(1, Math.floor(Number(snapshot.durationDays)))
    : 1;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays - 1);

  const schedule = Array.isArray(snapshot?.schedule) ? snapshot.schedule : [];
  const startTime = sanitizeText(schedule.find(entry => Number(entry?.dayIndex) === 1)?.startTime) || '09:00';
  const lastDayIndex = durationDays;
  const endTime =
    sanitizeText(schedule.find(entry => Number(entry?.dayIndex) === lastDayIndex)?.endTime) || '17:00';

  const startDateTime = new Date(startDate);
  const [startHours, startMinutes] = startTime.split(':').map(Number);
  startDateTime.setHours(Number.isFinite(startHours) ? startHours : 9, Number.isFinite(startMinutes) ? startMinutes : 0, 0, 0);

  const endDateTime = new Date(endDate);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  endDateTime.setHours(Number.isFinite(endHours) ? endHours : 17, Number.isFinite(endMinutes) ? endMinutes : 0, 0, 0);

  return `du ${formatDateTime(startDateTime)} au ${formatDateTime(endDateTime)}`;
}

export function formatSessionDateLabel(snapshot = null) {
  const startDate = snapshot?.startDate ? new Date(snapshot.startDate) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return 'Date de session indisponible';
  const durationDays = Number.isFinite(Number(snapshot?.durationDays))
    ? Math.max(1, Math.floor(Number(snapshot.durationDays)))
    : 1;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays - 1);
  const formatOptions = { day: '2-digit', month: 'long', year: 'numeric' };
  const startLabel = startDate.toLocaleDateString('fr-FR', formatOptions);
  if (durationDays === 1) return `le ${startLabel}`;
  const endLabel = endDate.toLocaleDateString('fr-FR', formatOptions);
  return `du ${startLabel} au ${endLabel}`;
}

export function formatSessionTimeLabel(snapshot = null) {
  const schedule = Array.isArray(snapshot?.schedule) ? snapshot.schedule : [];
  if (!schedule.length) return 'Horaires communiques ulterieurement';
  const normalized = schedule
    .map(entry => ({
      dayIndex: Number(entry?.dayIndex) || 1,
      startTime: sanitizeText(entry?.startTime),
      endTime: sanitizeText(entry?.endTime)
    }))
    .filter(entry => entry.startTime && entry.endTime)
    .sort((left, right) => left.dayIndex - right.dayIndex);
  if (!normalized.length) return 'Horaires communiques ulterieurement';
  const firstRange = `${normalized[0].startTime} - ${normalized[0].endTime}`;
  const sameRangeForAll = normalized.every(
    entry => `${entry.startTime} - ${entry.endTime}` === firstRange
  );
  if (sameRangeForAll) return firstRange;
  return normalized
    .map(entry => `Jour ${entry.dayIndex}: ${entry.startTime} - ${entry.endTime}`)
    .join(' | ');
}

export function buildSessionCancellationActionUrl({ flowId, token } = {}) {
  const normalizedFlowId = normalizeFlowId(flowId);
  const normalizedToken = String(token || '').trim();
  if (!normalizedFlowId || !normalizedToken) return '';
  // RX-GO — flag-aware : Vanilla (page slug) tant que REACT_OFFICIAL_FRONTEND=OFF ; /app/decision quand ON.
  return resolveFrontendUrl('session-cancel-decision', { flowId: normalizedFlowId, token: normalizedToken });
}

export async function resolveSiteName() {
  try {
    const identity = await SiteIdentity.findOne({ key: 'global' }).lean();
    const siteName = sanitizeText(identity?.siteName);
    return siteName || 'Beauty Savage';
  } catch (_error) {
    return 'Beauty Savage';
  }
}

function pushFlowAudit(flow, type, meta = {}) {
  flow.audit = Array.isArray(flow.audit) ? flow.audit : [];
  flow.audit.push({
    type: sanitizeText(type) || 'event',
    at: new Date(),
    meta: meta && typeof meta === 'object' ? meta : {}
  });
}

async function resolveFlowPurchase(flow) {
  if (flow.purchaseId && mongoose.Types.ObjectId.isValid(flow.purchaseId)) {
    const byId = await Purchase.findById(flow.purchaseId);
    if (byId) return byId;
  }
  return Purchase.findOne({
    userId: flow.userId,
    itemType: 'formation',
    formationId: flow.formationId
  }).sort({ createdAt: -1 });
}

async function resolveFlowSaleAndAmount(flow) {
  const preferredSaleId = sanitizeText(flow.saleId);
  const resolved = await resolveSaleForFormationPurchase({
    userId: flow.userId,
    formationId: flow.formationId,
    preferredSaleId
  });
  return {
    sale: resolved.sale || null,
    amount: roundToCents(resolved.amount || 0)
  };
}

function sanitizeRenunciationText(value) {
  const text = sanitizeText(value);
  return text || null;
}

async function markPurchaseDecision(purchaseId, payload = {}) {
  if (!purchaseId || !mongoose.Types.ObjectId.isValid(purchaseId)) return;
  await Purchase.findByIdAndUpdate(purchaseId, payload).catch(() => {});
}

async function markSaleDecision(saleDoc, payload = {}) {
  if (!saleDoc?._id) return;
  await Sale.updateOne({ _id: saleDoc._id }, { $set: payload }).catch(() => {});
}

function buildSaleDecisionPayload({
  flow,
  status,
  reason = '',
  extra = {}
} = {}) {
  return {
    instituteDecision: {
      flowId: sanitizeText(flow?.flowId),
      flowType: sanitizeText(flow?.flowType),
      status: sanitizeText(status),
      reason: sanitizeText(reason || flow?.reason),
      updatedAt: new Date()
    },
    ...extra
  };
}

async function decrementSessionReservationIfNeeded({
  purchase,
  sessionId
} = {}) {
  if (
    !purchase ||
    String(purchase?.participationStatus || 'active').trim().toLowerCase() === 'canceled' ||
    !sessionId
  ) {
    return;
  }
  if (String(purchase.sessionId || '') !== String(sessionId || '')) {
    return;
  }
  await FormationSession.findOneAndUpdate(
    { _id: sessionId, reservedCount: { $gt: 0 } },
    { $inc: { reservedCount: -1 } }
  ).catch(() => {});
}

export async function createOrRefreshInstituteDecisionFlow({
  flowType = FLOW_TYPE_SESSION_CANCELLED,
  session = null,
  updatedSession = null,
  formationId = null,
  formation = null,
  userId,
  clientEmail = '',
  purchaseId = null,
  saleId = '',
  referenceDate = new Date(),
  reason = '',
  // Service-specific params
  serviceId = null,
  bookingId = null,
  serviceSnapshot = null,
  bookingSnapshot = null
} = {}) {
  const isServiceFlow = sanitizeText(flowType) === FLOW_TYPE_SERVICE_BOOKING_CANCELLED;
  if (!userId) {
    throw new Error('Impossible de creer le flow institut.');
  }
  if (!isServiceFlow && !formationId) {
    throw new Error('Impossible de creer le flow institut.');
  }

  const now = new Date(referenceDate);
  const { token, tokenHash } = createSessionCancellationTokenPair();
  const tokenExpiresAt = buildTokenExpiryDate(now);
  const autoRefundAt = buildAutoRefundDate(now);
  const normalizedFlowType = sanitizeText(flowType) || FLOW_TYPE_SESSION_CANCELLED;
  const originalSessionSnapshot = buildSessionSnapshot(session);
  const nextSessionSnapshot = updatedSession ? buildSessionSnapshot(updatedSession) : null;
  const formationSnapshot = buildFormationSnapshot(formation);

  let pendingQuery;
  if (isServiceFlow) {
    pendingQuery = {
      flowType: normalizedFlowType,
      userId,
      decision: FLOW_DECISION_PENDING,
      usedAt: null
    };
    if (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) {
      pendingQuery.serviceId = serviceId;
    }
    if (bookingId) {
      pendingQuery.bookingId = sanitizeText(bookingId);
    }
  } else {
    pendingQuery = {
      flowType: normalizedFlowType,
      formationId,
      userId,
      decision: FLOW_DECISION_PENDING,
      usedAt: null
    };
    if (session?._id && mongoose.Types.ObjectId.isValid(session._id)) {
      pendingQuery.sessionId = session._id;
    } else {
      pendingQuery.sessionId = null;
    }
    if (purchaseId && mongoose.Types.ObjectId.isValid(purchaseId)) {
      pendingQuery.purchaseId = purchaseId;
    }
  }

  let flow = await SessionCancellationFlow.findOne(pendingQuery);
  if (!flow) {
    const newFlowData = {
      flowId: buildSessionCancellationFlowId(),
      tokenHash,
      tokenCreatedAt: now,
      tokenExpiresAt,
      autoRefundAt,
      flowType: normalizedFlowType,
      saleId: sanitizeText(saleId),
      userId,
      clientEmail: sanitizeText(clientEmail),
      reason: sanitizeText(reason),
      audit: []
    };
    if (isServiceFlow) {
      newFlowData.serviceId = serviceId && mongoose.Types.ObjectId.isValid(serviceId) ? serviceId : null;
      newFlowData.bookingId = sanitizeText(bookingId) || null;
      newFlowData.serviceSnapshot = serviceSnapshot || null;
      newFlowData.bookingSnapshot = bookingSnapshot || null;
      newFlowData.formationId = null;
    } else {
      newFlowData.formationId = formationId;
      newFlowData.sessionId = session?._id || null;
      newFlowData.purchaseId = purchaseId && mongoose.Types.ObjectId.isValid(purchaseId) ? purchaseId : null;
      newFlowData.originalSessionSnapshot = originalSessionSnapshot;
      newFlowData.updatedSessionSnapshot = nextSessionSnapshot;
      newFlowData.formationSnapshot = formationSnapshot;
    }
    flow = new SessionCancellationFlow(newFlowData);
  } else {
    flow.tokenHash = tokenHash;
    flow.tokenCreatedAt = now;
    flow.tokenExpiresAt = tokenExpiresAt;
    flow.autoRefundAt = autoRefundAt;
    flow.flowType = normalizedFlowType;
    flow.saleId = sanitizeText(saleId || flow.saleId);
    flow.clientEmail = sanitizeText(clientEmail || flow.clientEmail);
    flow.reason = sanitizeText(reason);
    flow.usedAt = null;
    flow.decision = FLOW_DECISION_PENDING;
    flow.decisionAt = null;
    flow.giftCardId = null;
    flow.acceptedCgv = false;
    flow.renunciationTextAccepted = null;
    flow.refundRequestId = '';
    if (isServiceFlow) {
      flow.serviceSnapshot = serviceSnapshot || flow.serviceSnapshot;
      flow.bookingSnapshot = bookingSnapshot || flow.bookingSnapshot;
    } else {
      flow.sessionId = session?._id || null;
      flow.purchaseId =
        purchaseId && mongoose.Types.ObjectId.isValid(purchaseId) ? purchaseId : flow.purchaseId || null;
      flow.originalSessionSnapshot = originalSessionSnapshot;
      flow.updatedSessionSnapshot = nextSessionSnapshot;
      flow.formationSnapshot = formationSnapshot;
      flow.chosenSessionId = null;
      flow.chosenSessionSnapshot = null;
    }
  }

  pushFlowAudit(flow, 'link_issued', {
    flowType: normalizedFlowType,
    formationName: isServiceFlow
      ? sanitizeText(serviceSnapshot?.name)
      : formationSnapshot.name,
    reason: flow.reason
  });
  await flow.save();

  return {
    flow,
    token,
    actionUrl: buildSessionCancellationActionUrl({ flowId: flow.flowId, token })
  };
}

export async function createOrRefreshSessionCancellationFlow({
  session,
  formationId,
  userId,
  clientEmail = '',
  purchaseId = null,
  saleId = '',
  referenceDate = new Date(),
  formationName = '',
  reason = ''
} = {}) {
  return createOrRefreshInstituteDecisionFlow({
    flowType: FLOW_TYPE_SESSION_CANCELLED,
    session,
    formationId,
    formation: {
      _id: formationId,
      name: formationName,
      type: 'presentiel'
    },
    userId,
    clientEmail,
    purchaseId,
    saleId,
    referenceDate,
    reason
  });
}

export async function createOrRefreshServiceCancellationFlow({
  booking,
  serviceId,
  userId,
  clientEmail,
  saleId,
  serviceDoc = null,
  referenceDate = new Date()
} = {}) {
  const snap = serviceDoc
    ? {
        name: sanitizeText(serviceDoc.name),
        slug: sanitizeText(serviceDoc.slug),
        duration: Number(serviceDoc.duration) || 0,
        cancellationDays: Number(serviceDoc.cancellationDays) || 7,
        isActive: Boolean(serviceDoc.isActive),
        isBookable: Boolean(serviceDoc.isBookable),
        allowClientChoosePractitioner: Boolean(serviceDoc.allowClientChoosePractitioner ?? true)
      }
    : null;

  const bookingSnap = booking
    ? {
        startAt: booking.startAt || null,
        endAt: booking.endAt || null,
        totalPrice: Number(booking.totalPrice) || 0,
        practitionerId: booking.practitionerId || null,
        selectedOptions: Array.isArray(booking.selectedOptions) ? booking.selectedOptions : []
      }
    : null;

  return createOrRefreshInstituteDecisionFlow({
    flowType: FLOW_TYPE_SERVICE_BOOKING_CANCELLED,
    serviceId,
    bookingId: sanitizeText(booking?.bookingId),
    userId,
    clientEmail,
    saleId,
    referenceDate,
    serviceSnapshot: snap,
    bookingSnapshot: bookingSnap
  });
}

export async function notifyInstituteDecisionChoiceForFlow({
  flow,
  token,
  formationTitle = '',
  firstName = '',
  lastName = ''
} = {}) {
  if (!flow) return false;
  const actionUrl = buildSessionCancellationActionUrl({
    flowId: flow.flowId,
    token
  });
  if (!actionUrl) return false;

  const siteName = await resolveSiteName();
  const { sale, amount } = await resolveFlowSaleAndAmount(flow);
  const resolvedFormationTitle =
    sanitizeText(formationTitle) ||
    sanitizeText(flow?.formationSnapshot?.name) ||
    'Formation';
  const reason = sanitizeText(flow.reason);

  if (flow.flowType === FLOW_TYPE_FORMATION_DELETED) {
    return sendFormationDeletedChoiceEmail({
      toEmail: sanitizeText(flow.clientEmail),
      siteName,
      firstName,
      lastName,
      clientEmail: sanitizeText(flow.clientEmail),
      formationTitle: resolvedFormationTitle,
      amountPaid: amount,
      saleId: sanitizeText(sale?.saleId || flow.saleId),
      actionUrl,
      reason
    });
  }

  if (flow.flowType === FLOW_TYPE_SESSION_UPDATED) {
    return sendSessionUpdatedChoiceEmail({
      toEmail: sanitizeText(flow.clientEmail),
      siteName,
      firstName,
      lastName,
      clientEmail: sanitizeText(flow.clientEmail),
      formationTitle: resolvedFormationTitle,
      sessionDateLabel: formatSessionDateLabel(flow.updatedSessionSnapshot || flow.originalSessionSnapshot),
      sessionTimeLabel: formatSessionTimeLabel(flow.updatedSessionSnapshot || flow.originalSessionSnapshot),
      saleId: sanitizeText(sale?.saleId || flow.saleId),
      actionUrl,
      reason
    });
  }

  return sendSessionCancelledChoiceEmail({
    toEmail: sanitizeText(flow.clientEmail),
    siteName,
    firstName,
    lastName,
    formationTitle: resolvedFormationTitle,
    sessionDateLabel: formatSessionDateLabel(flow.originalSessionSnapshot),
    sessionTimeLabel: formatSessionTimeLabel(flow.originalSessionSnapshot),
    actionUrl,
    reason,
    year: new Date().getFullYear()
  });
}

export async function notifySessionCancellationChoiceForFlow({
  flow,
  token,
  formationTitle = '',
  firstName = '',
  lastName = '',
  reason = ''
} = {}) {
  if (flow && reason && !flow.reason) {
    flow.reason = reason;
  }
  return notifyInstituteDecisionChoiceForFlow({
    flow,
    token,
    formationTitle,
    firstName,
    lastName
  });
}

export async function notifyServiceCancellationChoiceForFlow({
  flow,
  token,
  serviceName = '',
  firstName = '',
  bookingDate = '',
  bookingTime = '',
  autoRefundDays = 7
} = {}) {
  if (!flow) return false;
  const actionUrl = buildSessionCancellationActionUrl({ flowId: flow.flowId, token });
  if (!actionUrl) return false;
  const siteName = await resolveSiteName();
  try {
    return await sendServiceCancellationChoiceEmail({
      toEmail: sanitizeText(flow.clientEmail),
      siteName,
      firstName,
      serviceName,
      bookingDate,
      bookingTime,
      actionUrl,
      autoRefundDays
    });
  } catch (error) {
    console.error('[sessionCancellationFlowService] notifyServiceCancellationChoiceForFlow', error);
    return false;
  }
}

function getFlowTokenState(flowDoc, token) {
  if (!flowDoc) {
    return { ok: false, code: 'FLOW_NOT_FOUND', error: 'Lien introuvable.' };
  }
  const provided = String(token || '').trim();
  if (!provided) {
    return { ok: false, code: 'FLOW_TOKEN_REQUIRED', error: 'Token manquant.' };
  }
  const incomingHash = hashSessionCancellationToken(provided);
  if (incomingHash !== String(flowDoc.tokenHash || '').trim()) {
    return { ok: false, code: 'FLOW_TOKEN_INVALID', error: 'Lien invalide.' };
  }
  const nowMs = Date.now();
  const expiresMs = new Date(flowDoc.tokenExpiresAt || 0).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return { ok: false, code: 'FLOW_TOKEN_EXPIRED', error: 'Lien expire ou deja utilise.' };
  }
  if (flowDoc.usedAt || sanitizeText(flowDoc.decision) !== FLOW_DECISION_PENDING) {
    return { ok: false, code: 'FLOW_ALREADY_USED', error: 'Lien expire ou deja utilise.' };
  }
  return { ok: true };
}

export async function loadValidatedFlowForClient({
  flowId,
  token
} = {}) {
  const normalizedFlowId = normalizeFlowId(flowId);
  if (!normalizedFlowId) {
    return { ok: false, status: 400, code: 'FLOW_ID_REQUIRED', error: 'Lien invalide.' };
  }
  const flow = await SessionCancellationFlow.findOne({ flowId: normalizedFlowId });
  if (!flow) {
    return { ok: false, status: 404, code: 'FLOW_NOT_FOUND', error: 'Lien introuvable.' };
  }
  const tokenState = getFlowTokenState(flow, token);
  if (!tokenState.ok) {
    const status = tokenState.code === 'FLOW_TOKEN_INVALID' ? 403 : 409;
    return { ok: false, status, code: tokenState.code, error: tokenState.error };
  }
  return { ok: true, flow };
}

export async function applyFlowRefundDecision({
  flow,
  clientIp = '0.0.0.0',
  triggeredBy = 'client'
} = {}) {
  const now = new Date();
  if (!flow) {
    throw Object.assign(new Error('Flow introuvable.'), { status: 404 });
  }
  if (sanitizeText(flow.decision) !== FLOW_DECISION_PENDING || flow.usedAt) {
    throw Object.assign(new Error('Ce lien a deja ete utilise.'), { status: 409 });
  }

  // ── Service booking flow: different refund path ──────────────────────────
  if (sanitizeText(flow.flowType) === FLOW_TYPE_SERVICE_BOOKING_CANCELLED) {
    return applyServiceFlowRefundDecision({ flow, clientIp, triggeredBy, now });
  }

  // ── Formation/session flow ────────────────────────────────────────────────
  const purchase = await resolveFlowPurchase(flow);
  let refundRequest = null;
  let refundExecutionError = null;
  const existingRefundRequestId = sanitizeText(flow.refundRequestId);
  if (existingRefundRequestId) {
    const refundById = await RefundRequest.findOne({ refundId: existingRefundRequestId });
    if (refundById && isActiveRefundRequestStatus(refundById.status)) {
      refundRequest = refundById;
    }
  }

  const { sale, amount } = await resolveFlowSaleAndAmount(flow);
  if (!sale) {
    throw Object.assign(new Error('Vente introuvable pour enregistrer le remboursement.'), {
      status: 409
    });
  }

  const refundReason = buildFlowRefundReason(flow.flowType);
  if (!refundRequest) {
    refundRequest = await findActiveRefundRequestForSaleItem({
      saleId: sanitizeText(sale.saleId),
      itemId: flow.formationId,
      itemType: 'formation'
    });
  }

  if (!refundRequest) {
    const refundPayload = {
      refundId: buildRefundId(),
      saleId: sanitizeText(sale.saleId),
      userId: flow.userId,
      itemId: flow.formationId,
      itemType: 'formation',
      formationId: flow.formationId,
      amount,
      currency: 'EUR',
      status: 'requested',
      requestedAt: now,
      processedAt: null,
      reason: refundReason,
      clientIp: sanitizeText(clientIp) || '0.0.0.0',
      purchaseAcceptedText: resolveSaleAcceptedText(sale),
      sessionStartAt:
        flow.updatedSessionSnapshot?.startDate ||
        flow.originalSessionSnapshot?.startDate ||
        null,
      eligibleRefund: true,
      meta: {
        notes: triggeredBy === 'auto' ? 'auto-refund-j+7' : '',
        formationTitle: sanitizeText(flow?.formationSnapshot?.name),
        saleCreatedAt: sale.createdAt || null
      }
    };
    await applyRefundExecutionCap({
      refundRequest: refundPayload,
      sale,
      logPrefix: '[applyFlowRefundDecision]'
    });
    const creation = await createRefundRequestOnce(refundPayload);
    refundRequest = creation.refundRequest;
    if (creation.created) {
      try {
        await ensureRefundCommissionProvision(refundRequest);
      } catch (error) {
        await RefundRequest.deleteOne({ _id: refundRequest._id }).catch(() => {});
        throw error;
      }
    }
  }

  const refundRequestStatus = normalizeCurrentStatus(refundRequest?.status);
  if (refundRequestStatus === 'requested' || refundRequestStatus === 'pending') {
    try {
      const execution = await triggerRefundExecution(refundRequest, sale);
      if (execution?.refund) {
        refundRequest = execution.refund;
      }
    } catch (triggerError) {
      refundExecutionError = triggerError;
      console.error('[applyFlowRefundDecision] triggerRefundExecution failed', {
        flowId: sanitizeText(flow?.flowId),
        refundId: sanitizeText(refundRequest?.refundId),
        saleId: sanitizeText(sale?.saleId),
        error: triggerError
      });
    }
  }

  if (purchase) {
    await markPurchaseDecision(purchase._id, {
      participationStatus: 'canceled',
      canceledAt: now,
      cancellationReason: refundReason,
      cancellationEligibleRefund: true,
      cancellationSessionStartAt:
        flow.updatedSessionSnapshot?.startDate || flow.originalSessionSnapshot?.startDate || null,
      refundRequestId: sanitizeText(refundRequest.refundId),
      saleId: sanitizeText(sale.saleId || flow.saleId),
      instituteDecisionFlowId: sanitizeText(flow.flowId),
      instituteDecisionType: sanitizeText(flow.flowType),
      instituteDecisionStatus: buildFlowStatusAfterRefund(triggeredBy)
    });
    await decrementSessionReservationIfNeeded({
      purchase,
      sessionId: flow.sessionId
    });
  }

  await markSaleDecision(
    sale,
    buildSaleDecisionPayload({
      flow,
      status: buildFlowStatusAfterRefund(triggeredBy),
      reason: refundReason,
      extra: {
        refundRequestId: sanitizeText(refundRequest.refundId),
        refundStatus: sanitizeText(refundRequest.status),
        refundAmount: amount
      }
    })
  );

  flow.saleId = sanitizeText(sale.saleId || flow.saleId);
  flow.refundRequestId = sanitizeText(refundRequest.refundId);
  flow.decision = refundExecutionError ? FLOW_DECISION_PENDING : FLOW_DECISION_REFUND;
  flow.usedAt = refundExecutionError ? null : now;
  flow.decisionAt = refundExecutionError ? null : now;
  flow.acceptedCgv = Boolean(sale.accepted_cgv);
  flow.renunciationTextPrevious = sanitizeRenunciationText(resolveSaleAcceptedText(sale));
  flow.renunciationTextAccepted = null;
  if (refundExecutionError) {
    pushFlowAudit(flow, 'decision_refund_retryable', {
      triggeredBy,
      refundId: flow.refundRequestId,
      amount,
      error: sanitizeText(refundExecutionError?.message || 'triggerRefundExecution failed')
    });
  } else {
    pushFlowAudit(flow, 'decision_refund', {
      triggeredBy,
      refundId: flow.refundRequestId,
      amount
    });
  }
  await flow.save();

  return { flow, refundRequest, sale, amount };
}

async function applyServiceFlowRefundDecision({ flow, clientIp, triggeredBy, now }) {
  const refundReason = REFUND_REASON_SERVICE_BOOKING_CANCELLED_BY_INSTITUTE;

  let refundRequest = null;
  let refundExecutionError = null;
  const existingRefundRequestId = sanitizeText(flow.refundRequestId);
  if (existingRefundRequestId) {
    const refundById = await RefundRequest.findOne({ refundId: existingRefundRequestId });
    if (refundById && isActiveRefundRequestStatus(refundById.status)) {
      refundRequest = refundById;
    }
  }

  // Find sale directly by saleId
  const saleId = sanitizeText(flow.saleId);
  const sale = saleId ? await Sale.findOne({ saleId }).lean() : null;
  if (!sale) {
    throw Object.assign(new Error('Vente introuvable pour enregistrer le remboursement.'), {
      status: 409
    });
  }
  const amount = roundToCents(Number(sale.totalAmount) || 0);

  if (!refundRequest) {
    refundRequest = await findActiveRefundRequestForSaleItem({
      saleId,
      itemId: flow.serviceId,
      itemType: 'service'
    });
  }

  if (!refundRequest) {
    const refundPayload = {
      refundId: buildRefundId(),
      saleId,
      userId: flow.userId,
      itemId: flow.serviceId || null,
      itemType: 'service',
      amount,
      currency: 'EUR',
      status: 'requested',
      requestedAt: now,
      processedAt: null,
      reason: refundReason,
      clientIp: sanitizeText(clientIp) || '0.0.0.0',
      eligibleRefund: true,
      sessionStartAt: flow.bookingSnapshot?.startAt || null,
      meta: {
        notes: triggeredBy === 'auto' ? 'auto-refund-j+7' : '',
        formationTitle: sanitizeText(flow?.serviceSnapshot?.name),
        saleCreatedAt: sale.createdAt || null
      }
    };
    await applyRefundExecutionCap({
      refundRequest: refundPayload,
      sale,
      logPrefix: '[applyServiceFlowRefundDecision]'
    });
    const creation = await createRefundRequestOnce(refundPayload);
    refundRequest = creation.refundRequest;
    if (creation.created) {
      try {
        await ensureRefundCommissionProvision(refundRequest);
      } catch (error) {
        await RefundRequest.deleteOne({ _id: refundRequest._id }).catch(() => {});
        throw error;
      }
    }
  }

  const refundRequestStatus = normalizeCurrentStatus(refundRequest?.status);
  if (refundRequestStatus === 'requested' || refundRequestStatus === 'pending') {
    try {
      const execution = await triggerRefundExecution(refundRequest, sale);
      if (execution?.refund) {
        refundRequest = execution.refund;
      }
    } catch (triggerError) {
      refundExecutionError = triggerError;
      console.error('[applyServiceFlowRefundDecision] triggerRefundExecution failed', {
        flowId: sanitizeText(flow?.flowId),
        refundId: sanitizeText(refundRequest?.refundId),
        saleId,
        error: triggerError
      });
    }
  }

  // Mark ServiceBooking as refunded (it should already be cancelled by admin)
  if (sanitizeText(flow.bookingId)) {
    await ServiceBooking.findOneAndUpdate(
      { bookingId: sanitizeText(flow.bookingId) },
      { paymentStatus: 'refunded' }
    ).catch(() => {});
  }

  await markSaleDecision(
    sale,
    buildSaleDecisionPayload({
      flow,
      status: buildFlowStatusAfterRefund(triggeredBy),
      reason: refundReason,
      extra: {
        refundRequestId: sanitizeText(refundRequest.refundId),
        refundStatus: sanitizeText(refundRequest.status),
        refundAmount: amount
      }
    })
  );

  flow.saleId = saleId;
  flow.refundRequestId = sanitizeText(refundRequest.refundId);
  flow.decision = refundExecutionError ? FLOW_DECISION_PENDING : FLOW_DECISION_REFUND;
  flow.usedAt = refundExecutionError ? null : now;
  flow.decisionAt = refundExecutionError ? null : now;
  if (refundExecutionError) {
    pushFlowAudit(flow, 'decision_refund_retryable', {
      triggeredBy,
      refundId: flow.refundRequestId,
      amount,
      error: sanitizeText(refundExecutionError?.message || 'triggerRefundExecution failed')
    });
  } else {
    pushFlowAudit(flow, 'decision_refund', {
      triggeredBy,
      refundId: flow.refundRequestId,
      amount
    });
  }
  await flow.save();

  return { flow, refundRequest, sale, amount };
}

export async function listAvailableSessionsForReschedule({
  formationId,
  excludedSessionId = null
} = {}) {
  if (!formationId) return [];
  // Partie 8 — vérifier que la formation existe et est active
  const formation = formationId && mongoose.Types.ObjectId.isValid(String(formationId))
    ? await Formation.findById(formationId).select('isActive').lean()
    : null;
  if (!formation || formation.isActive === false) return [];

  const today = getTodayStart();
  const query = buildActiveSessionQuery({ formationId });
  if (excludedSessionId && mongoose.Types.ObjectId.isValid(excludedSessionId)) {
    query._id = { $ne: excludedSessionId };
  }
  const sessions = await FormationSession.find(query).lean();
  return sessions
    .filter(session => {
      const startDate = normalizeSessionStartDate(session?.startDate);
      return Boolean(startDate) && startDate >= today;
    })
    .sort((left, right) => {
      const leftStart = normalizeSessionStartDate(left?.startDate);
      const rightStart = normalizeSessionStartDate(right?.startDate);
      if (!leftStart && !rightStart) return 0;
      if (!leftStart) return 1;
      if (!rightStart) return -1;
      return leftStart.getTime() - rightStart.getTime();
    });
}

export async function listAvailableSlotsForServiceReschedule({ serviceId } = {}) {
  if (!serviceId) return { available: false, reason: 'service_unavailable', service: null };
  const service = await Service.findById(serviceId)
    .select('isActive isBookable name slug duration cancellationDays allowClientChoosePractitioner')
    .lean();
  if (!service || !service.isActive || !service.isBookable) {
    return { available: false, reason: 'service_unavailable', service: service || null };
  }
  return {
    available: true,
    reason: null,
    service: {
      id: String(service._id),
      name: sanitizeText(service.name),
      slug: sanitizeText(service.slug),
      duration: Number(service.duration) || 0,
      allowClientChoosePractitioner: Boolean(service.allowClientChoosePractitioner ?? true)
    }
  };
}

export async function applyFlowServiceRescheduleDecision({
  flow,
  chosenSlotStart,
  chosenSlotEnd,
  practitionerId
} = {}) {
  const now = new Date();
  if (!flow) {
    throw Object.assign(new Error('Flow introuvable.'), { status: 404 });
  }
  if (sanitizeText(flow.decision) !== FLOW_DECISION_PENDING || flow.usedAt) {
    throw Object.assign(new Error('Ce lien a deja ete utilise.'), { status: 409 });
  }
  if (sanitizeText(flow.flowType) !== FLOW_TYPE_SERVICE_BOOKING_CANCELLED) {
    throw Object.assign(new Error('Action non disponible pour ce type de flow.'), { status: 409 });
  }

  const service = await Service.findById(flow.serviceId).lean();
  if (!service || !service.isActive || !service.isBookable) {
    throw Object.assign(new Error('Cette prestation n\'est plus disponible à la réservation.'), { status: 409 });
  }

  const startDate = new Date(chosenSlotStart);
  const endDate = new Date(chosenSlotEnd);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw Object.assign(new Error('Créneau invalide.'), { status: 400 });
  }
  if (startDate <= now) {
    throw Object.assign(new Error('Le créneau sélectionné est déjà passé.'), { status: 409 });
  }

  // M11B — entité institut unique : un `practitionerId` legacy (payload ou snapshot) est conservé
  // pour les notifications/e-mails mais N'EST PLUS utilisé pour valider/créer le booking. La
  // disponibilité, le verrou anti-double-booking et la validation sont GLOBAUX (institut).
  const resolvedPractitionerId = practitionerId || flow.bookingSnapshot?.practitionerId;

  // Build BookingId
  const crypto = await import('node:crypto');
  const bookingIdSuffix = crypto.default.randomUUID().split('-')[0];
  const newBookingId = `BKG-${Date.now()}-${bookingIdSuffix}`;

  // Création GLOBALE : createGlobalServiceBooking résout l'institut, valide la disponibilité et pose
  // les slot-locks globaux (SLOT_UNAVAILABLE 409 si conflit). practitionerId legacy ignoré/écrasé.
  const { booking: newBooking } = await createGlobalServiceBooking({
    bookingData: {
      bookingId: newBookingId,
      serviceId: flow.serviceId,
      practitionerId: resolvedPractitionerId, // legacy — ignoré/écrasé par l'institut
      clientId: flow.userId,
      startAt: startDate,
      endAt: endDate,
      selectedOptions: Array.isArray(flow.bookingSnapshot?.selectedOptions)
        ? flow.bookingSnapshot.selectedOptions
        : [],
      totalPrice: Number(flow.bookingSnapshot?.totalPrice) || 0,
      depositAmount: 0,
      paymentType: 'free',
      paymentStatus: 'paid',
      status: 'confirmed',
      saleId: sanitizeText(flow.saleId) || null
    },
    now
  });

  flow.decision = FLOW_DECISION_RESCHEDULE;
  flow.usedAt = now;
  flow.decisionAt = now;
  pushFlowAudit(flow, 'decision_reschedule_service', {
    newBookingId,
    chosenSlotStart: startDate.toISOString()
  });
  await flow.save();

  // M3D — Aligne le report de créneau avec le moteur événementiel : on émet TOUJOURS
  // booking.confirmed (le checkout l'émettait déjà ; le report ne l'émettait pas). Quand
  // MAIL_ROLE_RESOLVER_ENABLED=true, le subscriber mail envoie l'e-mail booking_confirmed
  // (commerciale→client). L'e-mail direct legacy n'est conservé que flag=false (rollback,
  // anti-doublon). contextId = nouveau booking._id → confirmation distincte de l'originale.
  try {
    await emitBookingEvent('booking.confirmed', newBooking);
  } catch (eventErr) {
    console.error('[ServiceReschedule] booking.confirmed emit failed:', eventErr?.message || eventErr);
  }

  // Email de confirmation direct (legacy) — gaté par le flag, non bloquant.
  if (!isMailRoleResolverEnabled()) {
    try {
      const [client, practitioner] = await Promise.all([
        User.findById(flow.userId).select('email firstName lastName').lean(),
        resolvedPractitionerId
          ? PractitionerProfile.findById(resolvedPractitionerId).select('displayName').lean()
          : Promise.resolve(null)
      ]);
      if (client?.email) {
        await sendBookingConfirmedEmail({
          booking: {
            ...newBooking.toObject(),
            serviceId: service,
            practitionerId: practitioner,
            clientId: client
          }
        });
      }
    } catch (emailErr) {
      console.error('[ServiceReschedule] Email confirmation failed:', emailErr.message);
    }
  }

  // Notification praticienne — non bloquant
  try {
    if (resolvedPractitionerId) {
      const practitionerProfile = await PractitionerProfile.findById(resolvedPractitionerId)
        .select('displayName userId').lean();
      const practitionerUser = practitionerProfile?.userId
        ? await User.findById(practitionerProfile.userId).select('email firstName').lean()
        : null;
      const clientForAdmin = await User.findById(flow.userId)
        .select('email firstName lastName').lean();

      const oldStart = flow.bookingSnapshot?.startAt
        ? new Date(flow.bookingSnapshot.startAt)
        : null;

      if (practitionerUser?.email && oldStart) {
        const clientName = `${clientForAdmin?.firstName || ''} ${clientForAdmin?.lastName || ''}`.trim()
          || clientForAdmin?.email || '';
        await sendServiceRescheduledAdminEmail({
          practitionerEmail: practitionerUser.email,
          practitionerFirstName: practitionerUser.firstName || '',
          clientName,
          clientEmail: clientForAdmin?.email || '',
          serviceName: flow.serviceSnapshot?.name || '',
          oldBookingDate: oldStart.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          oldBookingTime: oldStart.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          newBookingDate: startDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          newBookingTime: startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        });
      }
    }
  } catch (err) {
    console.error('[ServiceReschedule] Admin email failed:', err.message);
  }

  // Notification reschedule
  try {
    const clientForNotif = await User.findById(flow.userId).select('firstName lastName email').lean();
    const clientName = `${clientForNotif?.firstName || ''} ${clientForNotif?.lastName || ''}`.trim()
      || clientForNotif?.email || '—';
    void triggerNotification('booking_rescheduled_client', {
      clientName,
      serviceName: flow.serviceSnapshot?.name || '—',
      newBookingDate: startDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      userId: resolvedPractitionerId ? String(resolvedPractitionerId) : '',
      link: '/gestion.html?page=planning',
      linkLabel: 'Voir le planning'
    });
  } catch {}

  return { flow, newBooking };
}

function normalizeDecisionText(value) {
  return sanitizeText(value);
}

export async function applyFlowRescheduleDecision({
  flow,
  chosenSessionId,
  acceptedCgv,
  renunciationText
} = {}) {
  const now = new Date();
  if (!flow) {
    throw Object.assign(new Error('Flow introuvable.'), { status: 404 });
  }
  if (sanitizeText(flow.decision) !== FLOW_DECISION_PENDING || flow.usedAt) {
    throw Object.assign(new Error('Ce lien a deja ete utilise.'), { status: 409 });
  }
  if (flow.flowType === FLOW_TYPE_FORMATION_DELETED) {
    throw Object.assign(new Error('Aucun report possible pour cette formation.'), { status: 409 });
  }
  if (!acceptedCgv) {
    throw Object.assign(new Error('Veuillez accepter les CGV pour continuer.'), { status: 400 });
  }
  if (!mongoose.Types.ObjectId.isValid(chosenSessionId)) {
    throw Object.assign(new Error('Session séléctionnée invalide.'), { status: 400 });
  }
  if (String(chosenSessionId) === String(flow.sessionId || '')) {
    throw Object.assign(new Error('Selectionnez une nouvelle session.'), { status: 400 });
  }

  const targetSession = await FormationSession.findOne({
    ...buildActiveSessionQuery({
      _id: chosenSessionId,
      formationId: flow.formationId
    })
  });
  if (!targetSession || isSessionCanceledStatus(targetSession.status)) {
    throw Object.assign(new Error('Session sélectionnée introuvable.'), { status: 404 });
  }

  const targetSessionStartDate = normalizeSessionStartDate(targetSession.startDate);
  if (!targetSessionStartDate || targetSessionStartDate < getTodayStart()) {
    throw Object.assign(new Error('Session sélectionnées indisponible.'), { status: 409 });
  }
  if (Number(targetSession.reservedCount || 0) >= Number(targetSession.maxClients || 0)) {
    throw Object.assign(new Error('Session complete.'), { status: 409 });
  }

  const formation = flow?.formationId
    ? await Formation.findById(flow.formationId).select({ refundDays: 1 }).lean()
    : null;
  const expectation = getPresentielWaiverExpectation({
    dateAchat: now,
    dateFormation: targetSession.startDate,
    refundDays: formation?.refundDays ?? flow?.formationSnapshot?.refundDays
  });
  const normalizedRenunciationText = normalizeDecisionText(renunciationText);
  const expectedText = expectation.required ? normalizeDecisionText(expectation.text) : '';
  if (expectation.required && normalizedRenunciationText !== expectedText) {
    throw Object.assign(
      new Error('Veuillez accepter la renonciation requise pour cette session.'),
      { status: 400 }
    );
  }
  if (!expectation.required && normalizedRenunciationText) {
    throw Object.assign(new Error('Aucune renonciation n est requise pour cette session.'), {
      status: 400
    });
  }

  const purchase = await resolveFlowPurchase(flow);
  if (!purchase) {
    throw Object.assign(new Error('Achat introuvable.'), { status: 404 });
  }

  let reservedTargetSession = null;
  try {
    reservedTargetSession = await FormationSession.findOneAndUpdate(
      buildActiveSessionQuery({
        _id: targetSession._id,
        reservedCount: { $lt: targetSession.maxClients }
      }),
      { $inc: { reservedCount: 1 } },
      { new: true }
    );
    if (!reservedTargetSession) {
      throw Object.assign(new Error('Session complete.'), { status: 409 });
    }

    await decrementSessionReservationIfNeeded({
      purchase,
      sessionId: flow.sessionId
    });

    await markPurchaseDecision(purchase._id, {
      sessionId: reservedTargetSession._id,
      participationStatus: 'active',
      canceledAt: null,
      cancellationReason: '',
      cancellationEligibleRefund: false,
      cancellationSessionStartAt: null,
      instituteDecisionFlowId: sanitizeText(flow.flowId),
      instituteDecisionType: sanitizeText(flow.flowType),
      instituteDecisionStatus: 'rescheduled'
    });

    const { sale } = await resolveFlowSaleAndAmount(flow);
    let previousRenunciation = null;
    if (sale) {
      previousRenunciation = sanitizeRenunciationText(resolveSaleAcceptedText(sale));
      const previousSessionStartAt =
        flow.originalSessionSnapshot?.startDate || sale.date_session || sale.date_formation || null;
      await markSaleDecision(
        sale,
        buildSaleDecisionPayload({
          flow,
          status: 'rescheduled',
          reason: flow.reason,
          extra: {
            accepted_cgv: true,
            date_formation: reservedTargetSession.startDate,
            date_session: reservedTargetSession.startDate,
            date_achat: now,
            renonciation_text: expectation.required ? expectedText : null,
            consumerWaiverAcceptedText: expectation.required ? expectedText : null,
            consumerWaiverAcceptedAt: expectation.required ? now : null,
            rescheduleInfo: {
              previousSessionId: flow.sessionId || null,
              nextSessionId: reservedTargetSession._id,
              previousSessionStartAt,
              nextSessionStartAt: reservedTargetSession.startDate || null,
              confirmedSessionStartAt: null,
              updatedAt: now
            }
          }
        })
      );
      flow.saleId = sanitizeText(sale.saleId || flow.saleId);
    }

    flow.decision = FLOW_DECISION_RESCHEDULE;
    flow.usedAt = now;
    flow.decisionAt = now;
    flow.chosenSessionId = reservedTargetSession._id;
    flow.chosenSessionSnapshot = buildSessionSnapshot(reservedTargetSession.toObject());
    flow.acceptedCgv = true;
    flow.renunciationTextPrevious = previousRenunciation;
    flow.renunciationTextAccepted = expectation.required ? expectedText : null;
    pushFlowAudit(flow, 'decision_reschedule', {
      chosenSessionId: String(reservedTargetSession._id),
      expectedRenunciation: expectation.required
    });
    await flow.save();

    return {
      flow,
      targetSession: reservedTargetSession,
      expectedRenunciationText: expectation.required ? expectedText : null
    };
  } catch (error) {
    if (reservedTargetSession?._id) {
      await FormationSession.findOneAndUpdate(
        { _id: reservedTargetSession._id, reservedCount: { $gt: 0 } },
        { $inc: { reservedCount: -1 } }
      ).catch(() => {});
    }
    throw error;
  }
}

export async function applyFlowConfirmDecision({
  flow
} = {}) {
  const now = new Date();
  if (!flow) {
    throw Object.assign(new Error('Flow introuvable.'), { status: 404 });
  }
  if (sanitizeText(flow.decision) !== FLOW_DECISION_PENDING || flow.usedAt) {
    throw Object.assign(new Error('Ce lien a deja ete utilise.'), { status: 409 });
  }
  if (flow.flowType !== FLOW_TYPE_SESSION_UPDATED) {
    throw Object.assign(new Error('Confirmation indisponible pour ce lien.'), { status: 409 });
  }

  const purchase = await resolveFlowPurchase(flow);
  if (!purchase) {
    throw Object.assign(new Error('Achat introuvable.'), { status: 404 });
  }

  await markPurchaseDecision(purchase._id, {
    participationStatus: 'active',
    canceledAt: null,
    cancellationReason: '',
    cancellationEligibleRefund: false,
    cancellationSessionStartAt: null,
    instituteDecisionFlowId: sanitizeText(flow.flowId),
    instituteDecisionType: sanitizeText(flow.flowType),
    instituteDecisionStatus: 'confirmed'
  });

  const { sale } = await resolveFlowSaleAndAmount(flow);
  if (sale) {
    await markSaleDecision(
      sale,
      buildSaleDecisionPayload({
        flow,
        status: 'confirmed',
        reason: flow.reason,
        extra: {
          date_formation:
            flow.updatedSessionSnapshot?.startDate ||
            flow.originalSessionSnapshot?.startDate ||
            sale.date_formation ||
            null,
          rescheduleInfo: {
            previousSessionId: flow.sessionId || null,
            nextSessionId: flow.sessionId || null,
            previousSessionStartAt: flow.originalSessionSnapshot?.startDate || null,
            nextSessionStartAt:
              flow.updatedSessionSnapshot?.startDate || flow.originalSessionSnapshot?.startDate || null,
            confirmedSessionStartAt:
              flow.updatedSessionSnapshot?.startDate || flow.originalSessionSnapshot?.startDate || null,
            updatedAt: now
          }
        }
      })
    );
    flow.saleId = sanitizeText(sale.saleId || flow.saleId);
  }

  flow.decision = FLOW_DECISION_CONFIRM;
  flow.usedAt = now;
  flow.decisionAt = now;
  flow.chosenSessionId = flow.sessionId || null;
  flow.chosenSessionSnapshot = flow.updatedSessionSnapshot || flow.originalSessionSnapshot || null;
  flow.acceptedCgv = Boolean(sale?.accepted_cgv);
  flow.renunciationTextPrevious = sanitizeRenunciationText(resolveSaleAcceptedText(sale));
  flow.renunciationTextAccepted = sanitizeRenunciationText(resolveSaleAcceptedText(sale));
  pushFlowAudit(flow, 'decision_confirm', {
    sessionId: String(flow.sessionId || '')
  });
  await flow.save();

  return {
    flow,
    sale,
    confirmedSessionSnapshot: flow.updatedSessionSnapshot || flow.originalSessionSnapshot
  };
}

export async function applyFlowGiftCardDecision({
  flow
} = {}) {
  const now = new Date();
  if (!flow) {
    throw Object.assign(new Error('Flow introuvable.'), { status: 404 });
  }
  if (sanitizeText(flow.decision) !== FLOW_DECISION_PENDING || flow.usedAt) {
    throw Object.assign(new Error('Ce lien a deja ete utilise.'), { status: 409 });
  }
  if (flow.flowType !== FLOW_TYPE_FORMATION_DELETED) {
    throw Object.assign(new Error('Carte cadeau indisponible pour ce lien.'), { status: 409 });
  }

  const purchase = await resolveFlowPurchase(flow);
  const { sale, amount } = await resolveFlowSaleAndAmount(flow);
  if (!sale) {
    throw Object.assign(new Error('Vente introuvable pour creer la carte cadeau.'), {
      status: 409
    });
  }

  const { giftCard, password } = await createCompensationGiftCard({
    userId: flow.userId,
    amount,
    saleId: sanitizeText(sale.saleId)
  });

  if (purchase) {
    await markPurchaseDecision(purchase._id, {
      participationStatus: 'canceled',
      canceledAt: now,
      cancellationReason: REFUND_REASON_FORMATION_DELETED_BY_INSTITUTE,
      cancellationEligibleRefund: true,
      cancellationSessionStartAt: flow.originalSessionSnapshot?.startDate || null,
      instituteDecisionFlowId: sanitizeText(flow.flowId),
      instituteDecisionType: sanitizeText(flow.flowType),
      instituteDecisionStatus: 'gift_card',
      giftCardId: giftCard._id,
      giftCardAmount: amount
    });
  }

  await markSaleDecision(
    sale,
    buildSaleDecisionPayload({
      flow,
      status: 'gift_card',
      reason: REFUND_REASON_FORMATION_DELETED_BY_INSTITUTE,
      extra: {
        giftCardCompensation: {
          giftCardId: giftCard._id,
          code: sanitizeText(giftCard.code),
          amount,
          balance: roundToCents(giftCard.balance || amount),
          createdAt: now
        }
      }
    })
  );

  flow.saleId = sanitizeText(sale.saleId || flow.saleId);
  flow.giftCardId = giftCard._id;
  flow.decision = FLOW_DECISION_GIFT_CARD;
  flow.usedAt = now;
  flow.decisionAt = now;
  flow.acceptedCgv = Boolean(sale.accepted_cgv);
  flow.renunciationTextPrevious = sanitizeRenunciationText(resolveSaleAcceptedText(sale));
  flow.renunciationTextAccepted = null;
  pushFlowAudit(flow, 'decision_gift_card', {
    giftCardId: String(giftCard._id || ''),
    code: sanitizeText(giftCard.code),
    amount
  });
  await flow.save();

  return {
    flow,
    sale,
    amount,
    giftCard,
    giftCardPassword: password
  };
}

export async function getFlowDecisionContext(flow) {
  const isServiceFlow = sanitizeText(flow?.flowType) === FLOW_TYPE_SERVICE_BOOKING_CANCELLED;

  if (isServiceFlow) {
    const user = flow?.userId ? await User.findById(flow.userId).lean() : null;
    const service = flow?.serviceId && mongoose.Types.ObjectId.isValid(flow.serviceId)
      ? await Service.findById(flow.serviceId).select('isActive isBookable name slug duration allowClientChoosePractitioner').lean()
      : null;
    return {
      formation: null,
      user,
      currentSession: null,
      availableSessions: [],
      service,
      serviceAvailable: Boolean(service?.isActive && service?.isBookable)
    };
  }

  const formation =
    flow?.formationId && mongoose.Types.ObjectId.isValid(flow.formationId)
      ? await Formation.findById(flow.formationId).lean()
      : null;
  const user = flow?.userId ? await User.findById(flow.userId).lean() : null;
  const currentSession =
    flow?.sessionId && mongoose.Types.ObjectId.isValid(flow.sessionId)
      ? await FormationSession.findById(flow.sessionId).lean()
      : null;
  const availableSessions =
    flow?.flowType === FLOW_TYPE_FORMATION_DELETED
      ? []
      : await listAvailableSessionsForReschedule({
          formationId: flow?.formationId,
          excludedSessionId: flow?.sessionId
        });
  return {
    formation,
    user,
    currentSession,
    availableSessions,
    service: null,
    serviceAvailable: false
  };
}
