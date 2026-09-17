import crypto from 'node:crypto';

import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import FormationSession, {
  buildActiveFormationSessionFilter,
  FORMATION_SESSION_STATUS_ACTIVE,
  FORMATION_SESSION_STATUS_CANCELED_BY_INSTITUTE,
  isInactiveFormationSessionStatus,
  normalizeFormationSessionStatus
} from '../models/FormationSession.js';
import Purchase from '../models/Purchase.js';
import SessionCancellationFlow from '../models/SessionCancellationFlow.js';
import User from '../models/user.js';
import PractitionerProfile from '../models/PractitionerProfile.js';
import {
  createOrRefreshInstituteDecisionFlow,
  createOrRefreshSessionCancellationFlow,
  FLOW_TYPE_SESSION_UPDATED,
  notifySessionCancellationChoiceForFlow
} from '../services/sessionCancellationFlowService.js';
import { triggerNotification } from '../services/notificationService.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------- conflict-detection helpers ----------

function parseTimeToMinutesConflict(time) {
  if (!time) return NaN;
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function timesOverlapConflict(aStart, aEnd, bStart, bEnd) {
  const aS = parseTimeToMinutesConflict(aStart);
  const aE = parseTimeToMinutesConflict(aEnd);
  const bS = parseTimeToMinutesConflict(bStart);
  const bE = parseTimeToMinutesConflict(bEnd);
  if (!Number.isFinite(aS) || !Number.isFinite(aE) || !Number.isFinite(bS) || !Number.isFinite(bE)) return false;
  return bS < aE && bE > aS;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function computeDayIndexForTargetDate(session, targetDate) {
  const sessionStart = new Date(session.startDate);
  sessionStart.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - sessionStart.getTime();
  if (diffMs < 0) return null;
  const dayOffset = Math.round(diffMs / 86400000);
  const dayIndex = dayOffset + 1;
  const durationDays = Math.max(1, Math.floor(Number(session.durationDays) || 1));
  if (dayIndex > durationDays) return null;
  return dayIndex;
}

async function findConflictingSlots({ startDate, durationDays, schedule, excludeSessionId }) {
  const numDays = Math.max(1, Math.floor(Number(durationDays) || 1));
  const conflictsFound = [];

  const queryFilter = {
    status: { $nin: ['canceled_by_institute', 'canceled'] }
  };
  if (excludeSessionId && mongoose.Types.ObjectId.isValid(excludeSessionId)) {
    queryFilter._id = { $ne: new mongoose.Types.ObjectId(String(excludeSessionId)) };
  }

  const existingSessions = await FormationSession.find(queryFilter).lean();

  const formationIds = [...new Set(existingSessions.map(s => s.formationId?.toString()).filter(Boolean))];
  const formations = formationIds.length
    ? await Formation.find({ _id: { $in: formationIds } }, { name: 1 }).lean()
    : [];
  const formationMap = new Map(formations.map(f => [f._id.toString(), f.name || 'Formation']));

  for (let di = 1; di <= numDays; di++) {
    const newEntry = (schedule || []).find(s => s.dayIndex === di);
    if (!newEntry) continue;

    const dateForDay = new Date(startDate);
    dateForDay.setDate(startDate.getDate() + (di - 1));
    dateForDay.setHours(0, 0, 0, 0);

    for (const existing of existingSessions) {
      const existDayIndex = computeDayIndexForTargetDate(existing, dateForDay);
      if (existDayIndex === null) continue;

      const existEntry = (existing.schedule || []).find(s => s.dayIndex === existDayIndex);
      if (!existEntry) continue;

      if (timesOverlapConflict(newEntry.startTime, newEntry.endTime, existEntry.startTime, existEntry.endTime)) {
        conflictsFound.push({
          formationName: formationMap.get(existing.formationId?.toString()) || 'Formation',
          startTime: existEntry.startTime,
          endTime: existEntry.endTime
        });
        break;
      }
    }
    if (conflictsFound.length > 0) break;
  }

  return conflictsFound;
}

// ------------------------------------------------

async function loadPresentielFormation(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const formation = await Formation.findById(id).lean();
  if (!formation || formation.type !== 'presentiel') {
    return null;
  }
  return formation;
}

function getTodayStart() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function normalizeStartDate(value) {
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

function parseSchedule(candidate, durationDays) {
  if (!Array.isArray(candidate)) {
    return { ok: false, error: 'Planning invalide.' };
  }
  if (candidate.length !== durationDays) {
    return {
      ok: false,
      error: `Le planning doit contenir ${durationDays} journee${durationDays > 1 ? 's' : ''}.`
    };
  }

  const seen = new Set();
  const normalized = [];

  for (let index = 0; index < candidate.length; index += 1) {
    const entry = candidate[index] || {};
    const dayIndexCandidate = Number.isFinite(Number(entry.dayIndex))
      ? Number(entry.dayIndex)
      : index + 1;
    const dayIndex = Math.floor(dayIndexCandidate);

    if (dayIndex < 1 || dayIndex > durationDays || seen.has(dayIndex)) {
      return { ok: false, error: 'Chaque jour doit avoir un index unique valide.' };
    }

    const startTime = String(entry.startTime || '').trim();
    const endTime = String(entry.endTime || '').trim();

    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      return { ok: false, error: 'Les horaires doivent suivre le format HH:mm.' };
    }

    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    const startTotal = startHours * 60 + startMinutes;
    const endTotal = endHours * 60 + endMinutes;

    if (startTotal >= endTotal) {
      return { ok: false, error: 'Chaque journee doit demarrer avant de se terminer.' };
    }

    seen.add(dayIndex);
    normalized.push({
      dayIndex,
      startTime,
      endTime
    });
  }

  normalized.sort((a, b) => a.dayIndex - b.dayIndex);
  return { ok: true, schedule: normalized };
}

function formatDurationLabel(durationDays) {
  const days = Number.isFinite(durationDays) ? Math.max(1, Math.floor(durationDays)) : 1;
  return days === 1 ? '1 jour' : `${days} jours`;
}

function hasSessionScheduleChanged(previousSchedule = [], nextSchedule = []) {
  const previous = JSON.stringify(Array.isArray(previousSchedule) ? previousSchedule : []);
  const next = JSON.stringify(Array.isArray(nextSchedule) ? nextSchedule : []);
  return previous !== next;
}

function hasSessionDateOrScheduleChanged(previousSession, nextStartDate, nextSchedule) {
  const previousStart = previousSession?.startDate ? new Date(previousSession.startDate).getTime() : NaN;
  const nextStart = nextStartDate ? new Date(nextStartDate).getTime() : NaN;
  if (previousStart !== nextStart) return true;
  return hasSessionScheduleChanged(previousSession?.schedule, nextSchedule);
}

function buildSessionSnapshotPayload(snapshot = null, fallback = {}) {
  if (!snapshot && !fallback) return null;
  const startDate = snapshot?.startDate || fallback.startDate || null;
  const durationDays = Number.isFinite(Number(snapshot?.durationDays))
    ? Math.max(1, Math.floor(Number(snapshot.durationDays)))
    : Number.isFinite(Number(fallback.durationDays))
      ? Math.max(1, Math.floor(Number(fallback.durationDays)))
      : 1;
  const schedule = Array.isArray(snapshot?.schedule)
    ? snapshot.schedule
    : Array.isArray(fallback.schedule)
      ? fallback.schedule
      : [];
  return {
    startDate,
    durationDays,
    durationLabel: formatDurationLabel(durationDays),
    schedule
  };
}

function buildCanceledClientStatus(decision) {
  const normalized = String(decision || 'pending').trim().toLowerCase();
  if (normalized === 'refund') {
    return { code: 'refunded', label: 'Rembourse' };
  }
  if (normalized === 'reschedule') {
    return { code: 'rescheduled', label: 'Decale' };
  }
  return { code: 'pending', label: 'En attente' };
}

export function buildSessionPayload(doc, { instructorName = null, isCurrentUserInstructor = false } = {}) {
  if (!doc) return null;

  const maxClients = Number(doc.maxClients || 0);
  const reserved = Number(doc.reservedCount || 0);
  const durationDays = Number.isFinite(doc.durationDays) ? Math.max(1, Math.floor(doc.durationDays)) : 1;
  const placesRemaining = Math.max(0, maxClients - reserved);
  const status = normalizeFormationSessionStatus(doc.status);
  const isInactive = isInactiveFormationSessionStatus(status);

  return {
    id: doc._id?.toString(),
    formationId: doc.formationId?.toString(),
    startDate: doc.startDate,
    durationDays,
    durationLabel: formatDurationLabel(durationDays),
    schedule: Array.isArray(doc.schedule) ? doc.schedule : [],
    maxClients,
    reservedCount: reserved,
    placesRemaining,
    isAvailable: !isInactive && reserved < maxClients,
    status,
    isCanceled: isInactive,
    canceledAt: doc.canceledAt || null,
    createdAt: doc.createdAt,
    instructorId: doc.instructorId?.toString() || null,
    instructorName: instructorName || null,
    isCurrentUserInstructor,
    qr: buildSessionQrInfo(doc)
  };
}

// C1 — Construit l'objet QR de présence exposé dans le payload (admin/dev only).
export function buildSessionQrInfo(doc) {
  const token = String(doc?.qrToken || '');
  if (!token) {
    return { hasToken: false, token: null, payload: null, generatedAt: null };
  }
  return {
    hasToken: true,
    token,
    payload: buildSessionQrPayload(doc._id?.toString(), token),
    generatedAt: doc.qrGeneratedAt || null
  };
}

// Format de payload encodé dans le QR. Opaque, sans donnée personnelle.
export function buildSessionQrPayload(sessionId, token) {
  return `BS-SESSION:${sessionId}:${token}`;
}

async function resolveInstructorName(instructorId) {
  if (!instructorId) return null;
  try {
    const profile = await PractitionerProfile.findOne({ userId: instructorId }).select('displayName').lean();
    if (profile?.displayName) return profile.displayName;
    const user = await User.findById(instructorId).select('firstName lastName email').lean();
    if (!user) return null;
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return fullName || user.email || null;
  } catch {
    return null;
  }
}

async function notifyReservedClientsForCanceledSession({ formation, session }) {
  const activePurchases = await Purchase.find({
    itemType: 'formation',
    formationId: formation._id,
    sessionId: session._id,
    participationStatus: { $ne: 'canceled' }
  }).lean();

  if (!activePurchases.length) {
    return {
      reservedClientsCount: 0,
      notifiedClientsCount: 0,
      emailFailuresCount: 0
    };
  }

  const userIds = Array.from(new Set(activePurchases.map(entry => entry.userId?.toString()).filter(Boolean)));
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
  const userMap = new Map(users.map(user => [String(user._id || ''), user]));

  const results = await Promise.allSettled(
    activePurchases.map(async purchase => {
      const user = userMap.get(String(purchase.userId || '')) || null;
      const { flow, token } = await createOrRefreshSessionCancellationFlow({
        session,
        formationId: formation._id,
        userId: purchase.userId,
        clientEmail: String(user?.email || '').trim(),
        purchaseId: purchase._id,
        saleId: String(purchase.saleId || '').trim(),
        formationName: String(formation.name || '').trim()
      });

      const sent = await notifySessionCancellationChoiceForFlow({
        flow,
        token,
        formationTitle: String(formation.name || '').trim(),
        firstName: String(user?.firstName || '').trim(),
        lastName: String(user?.lastName || '').trim(),
        reason: String(session.canceledReason || '').trim()
      });

      if (!sent) {
        console.warn('[FormationSession][DEV] mail annulation session non envoye', {
          sessionId: String(session._id || ''),
          flowId: String(flow?.flowId || ''),
          userId: String(purchase.userId || ''),
          email: String(user?.email || '').trim()
        });
      }

      return sent;
    })
  );

  const notifiedClientsCount = results.filter(
    result => result.status === 'fulfilled' && result.value === true
  ).length;
  const emailFailuresCount = results.length - notifiedClientsCount;

  results.forEach(result => {
    if (result.status === 'rejected') {
      console.error('[FormationSession] echec creation flow annulation session', result.reason);
    }
  });

  return {
    reservedClientsCount: activePurchases.length,
    notifiedClientsCount,
    emailFailuresCount
  };
}

async function notifyReservedClientsForUpdatedSession({
  formation,
  previousSession,
  updatedSession,
  reason = ''
} = {}) {
  const activePurchases = await Purchase.find({
    itemType: 'formation',
    formationId: formation._id,
    sessionId: previousSession._id,
    participationStatus: { $ne: 'canceled' }
  }).lean();

  if (!activePurchases.length) {
    return {
      reservedClientsCount: 0,
      notifiedClientsCount: 0,
      emailFailuresCount: 0
    };
  }

  const userIds = Array.from(new Set(activePurchases.map(entry => entry.userId?.toString()).filter(Boolean)));
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
  const userMap = new Map(users.map(user => [String(user._id || ''), user]));

  const results = await Promise.allSettled(
    activePurchases.map(async purchase => {
      const user = userMap.get(String(purchase.userId || '')) || null;
      const { flow, token } = await createOrRefreshInstituteDecisionFlow({
        flowType: FLOW_TYPE_SESSION_UPDATED,
        session: previousSession,
        updatedSession,
        formationId: formation._id,
        formation,
        userId: purchase.userId,
        clientEmail: String(user?.email || '').trim(),
        purchaseId: purchase._id,
        saleId: String(purchase.saleId || '').trim(),
        reason
      });

      const sent = await notifySessionCancellationChoiceForFlow({
        flow,
        token,
        formationTitle: String(formation.name || '').trim(),
        firstName: String(user?.firstName || '').trim(),
        lastName: String(user?.lastName || '').trim(),
        reason
      });

      if (!sent) {
        console.warn('[FormationSession][DEV] mail modification session non envoye', {
          sessionId: String(updatedSession?._id || ''),
          flowId: String(flow?.flowId || ''),
          userId: String(purchase.userId || ''),
          email: String(user?.email || '').trim()
        });
      }

      return sent;
    })
  );

  const notifiedClientsCount = results.filter(
    result => result.status === 'fulfilled' && result.value === true
  ).length;
  const emailFailuresCount = results.length - notifiedClientsCount;

  results.forEach(result => {
    if (result.status === 'rejected') {
      console.error('[FormationSession] echec creation flow modification session', result.reason);
    }
  });

  return {
    reservedClientsCount: activePurchases.length,
    notifiedClientsCount,
    emailFailuresCount
  };
}

export async function listSessions(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadPresentielFormation(formationId);

    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation presentielle introuvable.' });
    }

    const sessions = await FormationSession.find(buildActiveFormationSessionFilter({ formationId: formation._id }))
      .sort({ startDate: 1 })
      .lean();

    const currentUserId = String(req.sessionUser?._id || '');

    // Batch-résoudre les noms d'instructeurs
    const uniqueInstructorIds = [...new Set(
      sessions.map(s => s.instructorId?.toString()).filter(Boolean)
    )];
    const nameMap = new Map();
    if (uniqueInstructorIds.length) {
      const [profiles, users] = await Promise.all([
        PractitionerProfile.find({ userId: { $in: uniqueInstructorIds } }).select('userId displayName').lean(),
        User.find({ _id: { $in: uniqueInstructorIds } }).select('firstName lastName email').lean()
      ]);
      const profileByUserId = new Map(profiles.map(p => [String(p.userId), p.displayName]));
      const userById = new Map(users.map(u => [String(u._id), u]));
      for (const id of uniqueInstructorIds) {
        const displayName = profileByUserId.get(id);
        if (displayName) { nameMap.set(id, displayName); continue; }
        const user = userById.get(id);
        if (user) {
          const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
          nameMap.set(id, fullName || user.email || null);
        }
      }
    }

    const payloads = sessions.map(session => {
      const iid = session.instructorId?.toString() || null;
      return buildSessionPayload(session, {
        instructorName: iid ? (nameMap.get(iid) || null) : null,
        isCurrentUserInstructor: currentUserId ? iid === currentUserId : false
      });
    });

    return res.json({ ok: true, sessions: payloads, currentUserId: currentUserId || null });
  } catch (error) {
    console.error('Impossible de lister les sessions', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les sessions.' });
  }
}

// C1 — Génère (ou régénère) le QR de présence d'une session présentielle.
// Token opaque, jamais dérivé d'une donnée sensible. Idempotent : si un token existe déjà et
// que `regenerate` n'est pas demandé, on renvoie l'existant.
export async function generateSessionQr(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const sessionId = String(req.params.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ ok: false, error: 'Identifiant de session invalide.' });
    }
    const formation = await loadPresentielFormation(formationId);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation presentielle introuvable.' });
    }
    const session = await FormationSession.findOne({ _id: sessionId, formationId: formation._id });
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    const regenerate = req.body?.regenerate === true;
    if (!session.qrToken || regenerate) {
      session.qrToken = crypto.randomBytes(16).toString('hex');
      session.qrGeneratedAt = new Date();
      await session.save();
    }
    return res.json({ ok: true, qr: buildSessionQrInfo(session.toObject()) });
  } catch (error) {
    console.error('Impossible de generer le QR de session', error);
    return res.status(500).json({ ok: false, error: 'Impossible de generer le QR.' });
  }
}

export async function createSession(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadPresentielFormation(formationId);

    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation presentielle introuvable.' });
    }

    const durationDays = Math.max(1, Math.floor(Number(formation.durationDays) || 1));
    if (durationDays < 1) {
      return res.status(400).json({ ok: false, error: 'La duree de la formation est invalide.' });
    }

    const startDate = normalizeStartDate(req.body?.startDate);
    if (!startDate) {
      return res.status(400).json({ ok: false, error: 'Date de debut invalide.' });
    }

    const today = getTodayStart();
    if (startDate < today) {
      return res.status(400).json({ ok: false, error: 'La date de debut doit etre dans le futur.' });
    }

    const maxClients = Number(req.body?.maxClients);
    if (!Number.isFinite(maxClients) || maxClients < 1) {
      return res.status(400).json({ ok: false, error: 'Capacite invalide.' });
    }

    const scheduleResult = parseSchedule(req.body?.schedule, durationDays);
    if (!scheduleResult.ok) {
      return res.status(400).json({ ok: false, error: scheduleResult.error });
    }

    const conflicts = await findConflictingSlots({
      startDate,
      durationDays,
      schedule: scheduleResult.schedule,
      excludeSessionId: null
    });
    if (conflicts.length > 0) {
      const c = conflicts[0];
      return res.status(409).json({
        ok: false,
        error: `Creneau indisponible — conflit avec ${c.formationName} de ${c.startTime} a ${c.endTime}`,
        conflicts
      });
    }

    const session = new FormationSession({
      formationId: formation._id,
      startDate,
      durationDays,
      schedule: scheduleResult.schedule,
      maxClients: Math.floor(maxClients),
      reservedCount: 0,
      status: FORMATION_SESSION_STATUS_ACTIVE,
      instructorId: req.sessionUser?._id || null
    });

    await session.save();
    const currentUserId = String(req.sessionUser?._id || '');
    const iid = session.instructorId?.toString() || null;
    const instructorName = await resolveInstructorName(iid);
    return res.status(201).json({ ok: true, session: buildSessionPayload(session.toObject(), {
      instructorName,
      isCurrentUserInstructor: currentUserId ? iid === currentUserId : false
    }) });
  } catch (error) {
    console.error('Impossible de creer la session', error);
    return res.status(500).json({ ok: false, error: 'Impossible de creer la session.' });
  }
}

export async function updateSession(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadPresentielFormation(formationId);

    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation presentielle introuvable.' });
    }

    const sessionId = String(req.params.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }

    const session = await FormationSession.findOne(
      buildActiveFormationSessionFilter({ _id: sessionId, formationId: formation._id })
    );

    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }

    const startDate = normalizeStartDate(req.body?.startDate);
    if (!startDate) {
      return res.status(400).json({ ok: false, error: 'Date de debut invalide.' });
    }

    const today = getTodayStart();
    if (startDate < today) {
      return res.status(400).json({ ok: false, error: 'La date de debut doit etre dans le futur.' });
    }

    const maxClients = Number(req.body?.maxClients);
    if (!Number.isFinite(maxClients) || maxClients < 1) {
      return res.status(400).json({ ok: false, error: 'Capacite invalide.' });
    }

    const reservedCount = Math.max(0, Number(session.reservedCount || 0));
    if (Math.floor(maxClients) < reservedCount) {
      return res.status(400).json({
        ok: false,
        error: `La capacite ne peut pas etre inferieure au nombre de places deja reservees (${reservedCount}).`
      });
    }

    const scheduleResult = parseSchedule(req.body?.schedule, session.durationDays);
    if (!scheduleResult.ok) {
      return res.status(400).json({ ok: false, error: scheduleResult.error });
    }

    const updateConflicts = await findConflictingSlots({
      startDate,
      durationDays: session.durationDays,
      schedule: scheduleResult.schedule,
      excludeSessionId: sessionId
    });
    if (updateConflicts.length > 0) {
      const c = updateConflicts[0];
      return res.status(409).json({
        ok: false,
        error: `Creneau indisponible — conflit avec ${c.formationName} de ${c.startTime} a ${c.endTime}`,
        conflicts: updateConflicts
      });
    }

    const previousSession = session.toObject();
    const shouldNotifyUpdatedSession =
      Math.max(0, Number(session.reservedCount || 0)) > 0 &&
      hasSessionDateOrScheduleChanged(previousSession, startDate, scheduleResult.schedule);
    const updatedReason = String(req.body?.reason || req.body?.updateReason || '').trim();

    session.startDate = startDate;
    session.maxClients = Math.floor(maxClients);
    session.schedule = scheduleResult.schedule;
    if (req.sessionUser?._id && !session.instructorId) {
      session.instructorId = req.sessionUser._id;
    }
    await session.save();

    let notificationSummary = null;
    if (shouldNotifyUpdatedSession) {
      notificationSummary = await notifyReservedClientsForUpdatedSession({
        formation,
        previousSession,
        updatedSession: session.toObject(),
        reason: updatedReason
      });
    }

    const currentUserId = String(req.sessionUser?._id || '');
    const iid = session.instructorId?.toString() || null;
    const instructorName = await resolveInstructorName(iid);
    return res.json({
      ok: true,
      session: buildSessionPayload(session.toObject(), {
        instructorName,
        isCurrentUserInstructor: currentUserId ? iid === currentUserId : false
      }),
      sessionUpdatedByInstitute: Boolean(notificationSummary),
      reservedClientsCount: notificationSummary?.reservedClientsCount || 0,
      notifiedClientsCount: notificationSummary?.notifiedClientsCount || 0,
      emailFailuresCount: notificationSummary?.emailFailuresCount || 0
    });
  } catch (error) {
    console.error('Impossible de modifier la session', error);
    return res.status(500).json({ ok: false, error: 'Impossible de modifier la session.' });
  }
}

export async function deleteSession(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadPresentielFormation(formationId);

    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation presentielle introuvable.' });
    }

    const sessionId = String(req.params.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }

    const session = await FormationSession.findOne(
      buildActiveFormationSessionFilter({ _id: sessionId, formationId: formation._id })
    );

    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }

    if (new Date(session.startDate) <= new Date()) {
      return res.status(400).json({ ok: false, error: "Impossible d'annuler une session déjà passée." });
    }

    const reservedClientsCount = Math.max(0, Number(session.reservedCount || 0));
    if (reservedClientsCount > 0) {
      session.status = FORMATION_SESSION_STATUS_CANCELED_BY_INSTITUTE;
      session.canceledAt = new Date();
      await session.save();

      const notificationSummary = await notifyReservedClientsForCanceledSession({
        formation,
        session
      });

      void triggerNotification('formation_session_cancelled', {
        formationName: formation.name || '—',
        sessionDate: session.startDate
          ? new Date(session.startDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : '—',
        link: `/gestion.html?page=formations`,
        linkLabel: 'Voir les formations'
      });

      return res.json({
        ok: true,
        deleted: false,
        canceledByInstitute: true,
        reservedClientsCount,
        notifiedClientsCount: notificationSummary.notifiedClientsCount,
        emailFailuresCount: notificationSummary.emailFailuresCount,
        session: buildSessionPayload(session.toObject())
      });
    }

    await session.deleteOne();
    return res.json({ ok: true, deleted: true, canceledByInstitute: false });
  } catch (error) {
    console.error('Impossible de supprimer la session', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer la session.' });
  }
}

export async function listCanceledSessions(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadPresentielFormation(formationId);

    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation presentielle introuvable.' });
    }

    const flows = await SessionCancellationFlow.find({
      formationId: formation._id,
      flowType: 'session_cancelled'
    })
      .sort({ createdAt: -1, updatedAt: -1 })
      .lean();

    if (!flows.length) {
      return res.json({ ok: true, sessions: [] });
    }

    const userIds = Array.from(new Set(flows.map(flow => String(flow.userId || '')).filter(Boolean)));
    const sessionIds = Array.from(new Set(flows.map(flow => String(flow.sessionId || '')).filter(Boolean)));

    const [users, sessions] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).lean() : [],
      sessionIds.length ? FormationSession.find({ _id: { $in: sessionIds } }).lean() : []
    ]);

    const userMap = new Map(users.map(user => [String(user._id || ''), user]));
    const sessionMap = new Map(sessions.map(session => [String(session._id || ''), session]));
    const grouped = new Map();

    flows.forEach(flow => {
      const sessionId = String(flow.sessionId || '').trim();
      if (!sessionId) return;

      if (!grouped.has(sessionId)) {
        const sessionDoc = sessionMap.get(sessionId) || null;
        const snapshotPayload = buildSessionSnapshotPayload(flow.originalSessionSnapshot, sessionDoc || {});
        grouped.set(sessionId, {
          id: sessionId,
          status: normalizeFormationSessionStatus(sessionDoc?.status || 'canceled_by_institute'),
          canceledAt: sessionDoc?.canceledAt || flow.updatedAt || flow.createdAt || null,
          startDate: snapshotPayload?.startDate || null,
          durationDays: snapshotPayload?.durationDays || 1,
          durationLabel: snapshotPayload?.durationLabel || '1 jour',
          schedule: snapshotPayload?.schedule || [],
          clients: []
        });
      }

      const user = userMap.get(String(flow.userId || '')) || null;
      const clientStatus = buildCanceledClientStatus(flow.decision);
      grouped.get(sessionId).clients.push({
        flowId: String(flow.flowId || '').trim(),
        purchaseId: String(flow.purchaseId || '').trim(),
        userId: String(flow.userId || '').trim(),
        firstName: String(user?.firstName || '').trim(),
        lastName: String(user?.lastName || '').trim(),
        email: String(user?.email || flow.clientEmail || '').trim(),
        status: clientStatus.code,
        statusLabel: clientStatus.label,
        decisionAt: flow.decisionAt || null,
        autoRefundAt: flow.autoRefundAt || null,
        chosenSessionId: String(flow.chosenSessionId || '').trim(),
        refundRequestId: String(flow.refundRequestId || '').trim()
      });
    });

    const payload = Array.from(grouped.values())
      .map(entry => ({
        ...entry,
        clients: entry.clients.sort((left, right) =>
          String(left.lastName || left.email || '').localeCompare(String(right.lastName || right.email || ''), 'fr', {
            sensitivity: 'base'
          })
        )
      }))
      .sort((left, right) => new Date(right.canceledAt || 0).getTime() - new Date(left.canceledAt || 0).getTime());

    return res.json({ ok: true, sessions: payload });
  } catch (error) {
    console.error('Impossible de lire les sessions annulees', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les sessions annulees.' });
  }
}

export async function listSessionsForVitrine(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadPresentielFormation(formationId);

    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation presentielle introuvable.' });
    }

    const today = getTodayStart();
    const sessions = await FormationSession.find(buildActiveFormationSessionFilter({ formationId: formation._id }))
      .lean();

    const upcomingSessions = sessions
      .filter(entry => {
        const startDate = normalizeStartDate(entry?.startDate);
        return Boolean(startDate && startDate >= today);
      })
      .sort((left, right) => {
        const leftStart = normalizeStartDate(left?.startDate);
        const rightStart = normalizeStartDate(right?.startDate);
        if (!leftStart && !rightStart) return 0;
        if (!leftStart) return 1;
        if (!rightStart) return -1;
        return leftStart.getTime() - rightStart.getTime();
      });

    return res.json({ ok: true, sessions: upcomingSessions.map(buildSessionPayload) });
  } catch (error) {
    console.error('Impossible de lister les sessions vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les sessions.' });
  }
}

export async function getSessionConflicts(req, res) {
  try {
    const dateStr = String(req.query.date || '').trim();
    const excludeId = String(req.query.excludeSessionId || '').trim();

    if (!DATE_ONLY_PATTERN.test(dateStr)) {
      return res.status(400).json({ ok: false, error: 'Date invalide (format YYYY-MM-DD attendu).' });
    }

    const targetDate = normalizeStartDate(dateStr);
    if (!targetDate) {
      return res.status(400).json({ ok: false, error: 'Date invalide.' });
    }

    const queryFilter = { status: { $nin: ['canceled_by_institute', 'canceled'] } };
    if (excludeId && mongoose.Types.ObjectId.isValid(excludeId)) {
      queryFilter._id = { $ne: new mongoose.Types.ObjectId(excludeId) };
    }

    const sessions = await FormationSession.find({
      ...queryFilter,
      startDate: { $lte: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59) }
    }).lean();

    const qualifying = [];
    for (const session of sessions) {
      const dayIndex = computeDayIndexForTargetDate(session, targetDate);
      if (dayIndex === null) continue;
      const entry = (session.schedule || []).find(s => s.dayIndex === dayIndex);
      if (!entry) continue;
      qualifying.push({ session, entry });
    }

    const formationIds = [...new Set(qualifying.map(({ session: s }) => s.formationId?.toString()).filter(Boolean))];
    const formations = formationIds.length
      ? await Formation.find({ _id: { $in: formationIds } }, { name: 1 }).lean()
      : [];
    const formationMap = new Map(formations.map(f => [f._id.toString(), f.name || 'Formation']));

    const occupied = qualifying.map(({ session: s, entry }) => ({
      sessionId: s._id.toString(),
      formationName: formationMap.get(s.formationId?.toString()) || 'Formation',
      startTime: entry.startTime,
      endTime: entry.endTime
    }));

    return res.json({ ok: true, occupied });
  } catch (error) {
    console.error('Impossible de charger les conflits de sessions', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger les conflits.' });
  }
}

export async function getConflictsReport(req, res) {
  try {
    const sessions = await FormationSession.find({
      status: { $nin: ['canceled_by_institute', 'canceled'] }
    }).lean();

    if (sessions.length < 2) {
      return res.json({ ok: true, conflicts: [] });
    }

    const formationIds = [...new Set(sessions.map(s => s.formationId?.toString()).filter(Boolean))];
    const formations = formationIds.length
      ? await Formation.find({ _id: { $in: formationIds } }, { name: 1 }).lean()
      : [];
    const formationMap = new Map(formations.map(f => [f._id.toString(), f.name || 'Formation']));

    const conflicts = [];

    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        const s1 = sessions[i];
        const s2 = sessions[j];

        const s1Start = new Date(s1.startDate);
        s1Start.setHours(0, 0, 0, 0);
        const s2Start = new Date(s2.startDate);
        s2Start.setHours(0, 0, 0, 0);

        const s1Dur = Math.max(1, Math.floor(Number(s1.durationDays) || 1));
        const s2Dur = Math.max(1, Math.floor(Number(s2.durationDays) || 1));

        const overlapStartMs = Math.max(s1Start.getTime(), s2Start.getTime());
        const overlapEndMs = Math.min(
          s1Start.getTime() + s1Dur * 86400000,
          s2Start.getTime() + s2Dur * 86400000
        );

        if (overlapStartMs >= overlapEndMs) continue;

        for (let ms = overlapStartMs; ms < overlapEndMs; ms += 86400000) {
          const dateForDay = new Date(ms);
          const s1DayIndex = computeDayIndexForTargetDate(s1, dateForDay);
          const s2DayIndex = computeDayIndexForTargetDate(s2, dateForDay);
          if (s1DayIndex === null || s2DayIndex === null) continue;

          const e1 = (s1.schedule || []).find(e => e.dayIndex === s1DayIndex);
          const e2 = (s2.schedule || []).find(e => e.dayIndex === s2DayIndex);
          if (!e1 || !e2) continue;

          if (!timesOverlapConflict(e1.startTime, e1.endTime, e2.startTime, e2.endTime)) continue;

          const aS = parseTimeToMinutesConflict(e1.startTime);
          const bS = parseTimeToMinutesConflict(e2.startTime);
          const aE = parseTimeToMinutesConflict(e1.endTime);
          const bE = parseTimeToMinutesConflict(e2.endTime);
          const overlapStartMin = Math.max(aS, bS);
          const overlapEndMin = Math.min(aE, bE);
          const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

          conflicts.push({
            date: formatDateKey(dateForDay),
            session1: {
              id: s1._id.toString(),
              formationId: s1.formationId?.toString(),
              formationName: formationMap.get(s1.formationId?.toString()) || 'Formation',
              startTime: e1.startTime,
              endTime: e1.endTime
            },
            session2: {
              id: s2._id.toString(),
              formationId: s2.formationId?.toString(),
              formationName: formationMap.get(s2.formationId?.toString()) || 'Formation',
              startTime: e2.startTime,
              endTime: e2.endTime
            },
            overlap: {
              startTime: fmt(overlapStartMin),
              endTime: fmt(overlapEndMin)
            }
          });
        }
      }
    }

    return res.json({ ok: true, conflicts });
  } catch (error) {
    console.error('Impossible de charger le rapport de conflits', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le rapport.' });
  }
}
