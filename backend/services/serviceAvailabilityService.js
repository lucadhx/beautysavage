import mongoose from 'mongoose';

import Service from '../models/Service.js';
import ServiceBooking from '../models/ServiceBooking.js';
import PractitionerProfile from '../models/PractitionerProfile.js';
import PractitionerSchedule from '../models/PractitionerSchedule.js';
import ScheduleException from '../models/ScheduleException.js';
import FormationSession, { buildActiveFormationSessionFilter } from '../models/FormationSession.js';
import BookingSlotLock from '../models/BookingSlotLock.js';
import {
  ACTIVE_SERVICE_BOOKING_STATUSES,
  SERVICE_SLOT_ERROR_CODES
} from '../constants/serviceBooking.js';
import {
  BUSINESS_TIMEZONE,
  isServerAlignedWithBusinessTimezone
} from '../constants/timezone.js';
import { assertServiceOfferBookable } from './offerReadinessService.js';

const MINUTE_IN_MS = 60 * 1000;

// Sprint pré-React A2 — Tous les créneaux de ce service sont construits en heure
// MURALE LOCALE (`new Date(y, m-1, d, h, min)`) et doivent donc être interprétés
// dans le fuseau métier. La garde de démarrage (app.js) force TZ=Europe/Paris hors
// test ; ce module expose le fuseau de référence et avertit (une seule fois) si le
// process tourne sur un fuseau désaligné, signe d'un risque de décalage de créneaux.
let warnedTimezoneMisalignment = false;

/** Fuseau métier dans lequel les créneaux de disponibilité sont calculés. */
export function getAvailabilityTimezone() {
  return BUSINESS_TIMEZONE;
}

function guardAvailabilityTimezone(now = new Date()) {
  if (warnedTimezoneMisalignment) return;
  if (!isServerAlignedWithBusinessTimezone(now)) {
    warnedTimezoneMisalignment = true;
    console.warn(
      `[serviceAvailability] ⚠ Fuseau serveur désaligné de ${BUSINESS_TIMEZONE} — ` +
        'les créneaux calculés risquent d\'être décalés. Configurez TZ=Europe/Paris.'
    );
  }
}

function buildServiceSlotError(code, message, status, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function normalizeDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateStr(date) {
  const source = normalizeDate(date);
  if (!source) return '';
  return `${source.getFullYear()}-${String(source.getMonth() + 1).padStart(2, '0')}-${String(source.getDate()).padStart(2, '0')}`;
}

function formatLocalDateTime(date) {
  const source = normalizeDate(date);
  if (!source) return '';
  return `${localDateStr(source)}T${String(source.getHours()).padStart(2, '0')}:${String(source.getMinutes()).padStart(2, '0')}`;
}

function dateFromLocalDateStr(dateStr, hours = 0, minutes = 0, seconds = 0, ms = 0) {
  const [yearRaw, monthRaw, dayRaw] = String(dateStr || '').split('-').map(Number);
  if (![yearRaw, monthRaw, dayRaw].every(Number.isFinite)) return null;
  return new Date(yearRaw, monthRaw - 1, dayRaw, hours, minutes, seconds, ms);
}

function toExceptionDate(date) {
  const source = normalizeDate(date);
  if (!source) return null;
  return new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
}

function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = String(timeStr || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTimeStr(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildInterval(startMin, endMin) {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
    return null;
  }
  return { startMin, endMin };
}

function normalizeIntervals(rawIntervals = []) {
  const sorted = rawIntervals
    .filter(Boolean)
    .map(interval => buildInterval(Number(interval.startMin), Number(interval.endMin)))
    .filter(Boolean)
    .sort((left, right) => left.startMin - right.startMin || left.endMin - right.endMin);

  if (!sorted.length) return [];

  const merged = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.startMin <= previous.endMin) {
      previous.endMin = Math.max(previous.endMin, current.endMin);
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function slotToInterval(slot) {
  const startMin = parseTimeToMinutes(slot?.startTime);
  const endMin = parseTimeToMinutes(slot?.endTime);
  return buildInterval(startMin, endMin);
}

function extractExceptionIntervals(exception) {
  if (!exception) return [];
  const slots = Array.isArray(exception.slots) ? exception.slots.map(slotToInterval).filter(Boolean) : [];
  if (slots.length) return normalizeIntervals(slots);
  const singleInterval = slotToInterval({
    startTime: exception.startTime,
    endTime: exception.endTime
  });
  return normalizeIntervals(singleInterval ? [singleInterval] : []);
}

function subtractIntervals(baseIntervals, blockedIntervals) {
  if (!baseIntervals.length || !blockedIntervals.length) return baseIntervals;

  let current = baseIntervals;
  for (const blocker of blockedIntervals) {
    const next = [];
    for (const interval of current) {
      if (blocker.endMin <= interval.startMin || blocker.startMin >= interval.endMin) {
        next.push(interval);
        continue;
      }
      if (blocker.startMin > interval.startMin) {
        next.push({
          startMin: interval.startMin,
          endMin: Math.min(blocker.startMin, interval.endMin)
        });
      }
      if (blocker.endMin < interval.endMin) {
        next.push({
          startMin: Math.max(blocker.endMin, interval.startMin),
          endMin: interval.endMin
        });
      }
    }
    current = next.filter(interval => interval.endMin > interval.startMin);
    if (!current.length) break;
  }
  return current;
}

function applyLunchBreak(intervals, lunchBreak) {
  if (!lunchBreak?.isActive) return intervals;
  const lunchInterval = slotToInterval(lunchBreak);
  if (!lunchInterval) return intervals;
  return subtractIntervals(intervals, [lunchInterval]);
}

function buildAvailabilityIntervals({
  schedule,
  dayOfWeek,
  exception
} = {}) {
  const daySchedule = Array.isArray(schedule?.weeklySchedule)
    ? schedule.weeklySchedule.find(entry => Number(entry?.dayOfWeek) === Number(dayOfWeek))
    : null;
  const weeklyIntervals = daySchedule?.isWorking
    ? normalizeIntervals((Array.isArray(daySchedule?.slots) ? daySchedule.slots : []).map(slotToInterval))
    : [];

  if (exception?.type === 'block' && exception.isFullDay) {
    return [];
  }

  let availability = weeklyIntervals;
  if (exception?.type === 'modify') {
    availability = extractExceptionIntervals(exception);
  } else if (exception?.type === 'add') {
    availability = normalizeIntervals([...weeklyIntervals, ...extractExceptionIntervals(exception)]);
  } else if (exception?.type === 'block') {
    availability = subtractIntervals(weeklyIntervals, extractExceptionIntervals(exception));
  }

  return applyLunchBreak(availability, schedule?.lunchBreak);
}

function intervalContains(interval, startMin, endMin) {
  return startMin >= interval.startMin && endMin <= interval.endMin;
}

function overlaps(startMin, endMin, otherStartMin, otherEndMin) {
  return startMin < otherEndMin && endMin > otherStartMin;
}

async function listFormationOccupancies({
  practitionerUserId,
  dateStr,
  session = null
} = {}) {
  if (!practitionerUserId) return [];

  let query = FormationSession.find(
    buildActiveFormationSessionFilter({ instructorId: practitionerUserId })
  ).select({ startDate: 1, durationDays: 1, schedule: 1 });
  if (session) query = query.session(session);

  const sessions = await query.lean();
  const occupancies = [];

  for (const formationSession of sessions) {
    const durationDays = Number(formationSession.durationDays) || 1;
    for (let index = 0; index < durationDays; index += 1) {
      const sessionDay = new Date(formationSession.startDate);
      sessionDay.setDate(sessionDay.getDate() + index);
      if (localDateStr(sessionDay) !== dateStr) continue;

      const entry = (Array.isArray(formationSession.schedule) ? formationSession.schedule : []).find(
        item => Number(item?.dayIndex) === index + 1
      );
      if (!entry) break;

      const startMin = parseTimeToMinutes(entry.startTime);
      const endMin = parseTimeToMinutes(entry.endTime);
      const interval = buildInterval(startMin, endMin);
      if (interval) occupancies.push(interval);
      break;
    }
  }

  return normalizeIntervals(occupancies);
}

async function listActiveBookingIntervalsForDay({
  practitionerId,
  dayStart,
  dayEnd,
  ignoreBookingId = null,
  session = null
} = {}) {
  const query = {
    practitionerId,
    status: { $in: ACTIVE_SERVICE_BOOKING_STATUSES },
    startAt: { $lt: dayEnd },
    endAt: { $gt: dayStart }
  };

  const normalizedIgnoreBookingId = String(ignoreBookingId || '').trim();
  if (normalizedIgnoreBookingId) {
    query.$nor = [{ bookingId: normalizedIgnoreBookingId }];
    if (mongoose.Types.ObjectId.isValid(normalizedIgnoreBookingId)) {
      query.$nor.push({ _id: new mongoose.Types.ObjectId(normalizedIgnoreBookingId) });
    }
  }

  let bookingQuery = ServiceBooking.find(query).select({ startAt: 1, endAt: 1 });
  if (session) bookingQuery = bookingQuery.session(session);

  const bookings = await bookingQuery.lean();
  return bookings
    .map(booking => {
      const start = normalizeDate(booking.startAt);
      const end = normalizeDate(booking.endAt);
      if (!start || !end) return null;
      return {
        startMin: start.getHours() * 60 + start.getMinutes(),
        endMin: end.getHours() * 60 + end.getMinutes()
      };
    })
    .filter(Boolean);
}

function buildSlotCandidate({
  dateStr,
  startMin,
  duration,
  occupiedEndMin,
  practitionerId
}) {
  const startAt = dateFromLocalDateStr(
    dateStr,
    Math.floor(startMin / 60),
    startMin % 60
  );
  const endAt = dateFromLocalDateStr(
    dateStr,
    Math.floor((startMin + duration) / 60),
    (startMin + duration) % 60
  );
  if (!startAt || !endAt) return null;
  return {
    start: `${dateStr}T${minutesToTimeStr(startMin)}`,
    end: `${dateStr}T${minutesToTimeStr(startMin + duration)}`,
    startAt,
    endAt,
    occupiedEndMin,
    practitionerId: String(practitionerId)
  };
}

export async function computeAvailableSlotsForPractitioner({
  practitioner,
  schedule,
  service,
  dateStr,
  ignoreBookingId = null,
  now = new Date(),
  session = null
} = {}) {
  if (!practitioner?._id || !service?._id || !dateStr) return [];

  guardAvailabilityTimezone(now);

  const requestedDate = dateFromLocalDateStr(dateStr, 12, 0, 0, 0);
  if (!requestedDate) return [];

  const exceptionDate = toExceptionDate(requestedDate);
  let exceptionQuery = ScheduleException.findOne({
    practitionerId: practitioner._id,
    date: exceptionDate
  });
  if (session) exceptionQuery = exceptionQuery.session(session);
  const exception = await exceptionQuery.lean();

  const availabilityIntervals = buildAvailabilityIntervals({
    schedule,
    dayOfWeek: requestedDate.getDay(),
    exception
  });
  if (!availabilityIntervals.length) return [];

  const granularity = Number(practitioner.slotGranularity) || 30;
  const duration = Number(service.duration) || 0;
  const buffer = Number(service.bufferTime) || 0;
  if (duration <= 0) return [];

  const dayStart = dateFromLocalDateStr(dateStr, 0, 0, 0, 0);
  const dayEnd = dateFromLocalDateStr(dateStr, 23, 59, 59, 999);
  const [bookingIntervals, formationIntervals] = await Promise.all([
    listActiveBookingIntervalsForDay({
      practitionerId: practitioner._id,
      dayStart,
      dayEnd,
      ignoreBookingId,
      session
    }),
    listFormationOccupancies({
      practitionerUserId: practitioner.userId,
      dateStr,
      session
    })
  ]);

  const candidates = [];
  for (const interval of availabilityIntervals) {
    let current = interval.startMin;
    while (current + duration <= interval.endMin) {
      const occupiedEndMin = current + duration + buffer;
      const candidate = buildSlotCandidate({
        dateStr,
        startMin: current,
        duration,
        occupiedEndMin,
        practitionerId: practitioner._id
      });
      if (!candidate) {
        current += granularity;
        continue;
      }
      if (candidate.startAt <= now) {
        current += granularity;
        continue;
      }
      if (!availabilityIntervals.some(item => intervalContains(item, current, occupiedEndMin))) {
        current += granularity;
        continue;
      }
      const hasBookingConflict = bookingIntervals.some(item =>
        overlaps(current, occupiedEndMin, item.startMin, item.endMin)
      );
      if (hasBookingConflict) {
        current += granularity;
        continue;
      }
      const hasFormationConflict = formationIntervals.some(item =>
        overlaps(current, occupiedEndMin, item.startMin, item.endMin)
      );
      if (hasFormationConflict) {
        current += granularity;
        continue;
      }
      candidates.push(candidate);
      current += granularity;
    }
  }

  return candidates;
}

export async function assertServiceSlotBookable({
  practitionerId,
  serviceId,
  startAt,
  endAt,
  now = new Date(),
  ignoreBookingId = null,
  session = null
} = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(serviceId || ''))) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.SERVICE_NOT_BOOKABLE,
      'Prestation introuvable ou non reservable.',
      404
    );
  }

  if (!mongoose.Types.ObjectId.isValid(String(practitionerId || ''))) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.PRACTITIONER_NOT_FOUND,
      'Praticienne introuvable.',
      404
    );
  }

  const normalizedStartAt = normalizeDate(startAt);
  if (!normalizedStartAt) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.INVALID_START_AT,
      'Date de debut invalide.',
      400
    );
  }

  const normalizedEndAt = normalizeDate(endAt);
  if (!normalizedEndAt) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.INVALID_END_AT,
      'Date de fin invalide.',
      400
    );
  }

  if (normalizedStartAt >= normalizedEndAt) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.INVALID_SLOT_RANGE,
      'Le creneau fourni est invalide.',
      400
    );
  }

  const [service, practitioner, schedule] = await Promise.all([
    Service.findById(serviceId).session(session || null).lean(),
    PractitionerProfile.findById(practitionerId).session(session || null).lean(),
    PractitionerSchedule.findOne({ practitionerId }).session(session || null).lean()
  ]);

  if (!service || !service.isActive || !service.isBookable) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.SERVICE_NOT_BOOKABLE,
      'Prestation introuvable ou non reservable.',
      404
    );
  }

  // Sprint pré-React A7 — bloque les offres en acompte (solde non collectable).
  assertServiceOfferBookable(service);

  if (!practitioner || !practitioner.isActive) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.PRACTITIONER_NOT_FOUND,
      'Praticienne introuvable.',
      404
    );
  }

  if (!Array.isArray(practitioner.serviceIds) || !practitioner.serviceIds.some(id => String(id) === String(service._id))) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.PRACTITIONER_SERVICE_MISMATCH,
      'Cette praticienne ne propose pas cette prestation.',
      400
    );
  }

  const expectedEndAt = new Date(normalizedStartAt.getTime() + Number(service.duration || 0) * MINUTE_IN_MS);
  if (normalizedEndAt.getTime() !== expectedEndAt.getTime()) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.INVALID_SLOT_DURATION,
      'Le creneau fourni est invalide.',
      400,
      { expectedEndAt }
    );
  }

  if (normalizedStartAt <= now) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.SLOT_PAST,
      'Le creneau selectionne est deja passe.',
      409
    );
  }

  const dateStr = localDateStr(normalizedStartAt);
  const availableSlots = await computeAvailableSlotsForPractitioner({
    practitioner,
    schedule,
    service,
    dateStr,
    ignoreBookingId,
    now,
    session
  });

  const matchingSlot = availableSlots.find(
    slot =>
      slot.startAt.getTime() === normalizedStartAt.getTime() &&
      slot.endAt.getTime() === normalizedEndAt.getTime()
  );

  if (!matchingSlot) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.SLOT_UNAVAILABLE,
      'Ce creneau n est plus disponible.',
      409
    );
  }

  return {
    service,
    practitioner,
    schedule,
    startAt: normalizedStartAt,
    endAt: normalizedEndAt,
    slot: matchingSlot
  };
}

function buildBookingSlotLockDocuments({
  practitionerId,
  bookingId,
  startAt,
  occupiedEndAt
}) {
  const locks = [];
  for (let cursor = startAt.getTime(); cursor < occupiedEndAt.getTime(); cursor += MINUTE_IN_MS) {
    locks.push({
      practitionerId,
      bookingId,
      slotStartAt: new Date(cursor)
    });
  }
  return locks;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

export async function releaseServiceBookingSlotLocks({
  bookingId,
  session = null
} = {}) {
  const normalizedBookingId = String(bookingId || '').trim();
  if (!normalizedBookingId) return { deletedCount: 0 };

  let query = BookingSlotLock.deleteMany({ bookingId: normalizedBookingId });
  if (session) query = query.session(session);
  return query;
}

export async function createServiceBookingWithProtection({
  bookingData,
  service,
  now = new Date(),
  ignoreBookingId = null,
  session = null
} = {}) {
  if (!bookingData?.bookingId) {
    throw new Error('bookingId requis pour creer une reservation protegee.');
  }

  const protectedService = service && typeof service === 'object'
    ? service
    : await Service.findById(bookingData.serviceId).session(session || null).lean();

  if (!protectedService) {
    throw buildServiceSlotError(
      SERVICE_SLOT_ERROR_CODES.SERVICE_NOT_BOOKABLE,
      'Prestation introuvable ou non reservable.',
      404
    );
  }

  const validation = await assertServiceSlotBookable({
    practitionerId: bookingData.practitionerId,
    serviceId: bookingData.serviceId,
    startAt: bookingData.startAt,
    endAt: bookingData.endAt,
    now,
    ignoreBookingId,
    session
  });

  const occupiedEndAt = new Date(
    validation.endAt.getTime() + Number(protectedService.bufferTime || 0) * MINUTE_IN_MS
  );
  const lockDocs = buildBookingSlotLockDocuments({
    practitionerId: bookingData.practitionerId,
    bookingId: bookingData.bookingId,
    startAt: validation.startAt,
    occupiedEndAt
  });

  try {
    if (lockDocs.length) {
      await BookingSlotLock.insertMany(lockDocs, {
        ordered: true,
        ...(session ? { session } : {})
      });
    }

    const booking = new ServiceBooking({
      ...bookingData,
      serviceId: validation.service._id,
      practitionerId: validation.practitioner._id,
      startAt: validation.startAt,
      endAt: validation.endAt
    });
    await booking.save(session ? { session } : undefined);
    return { booking, service: validation.service, practitioner: validation.practitioner };
  } catch (error) {
    await releaseServiceBookingSlotLocks({
      bookingId: bookingData.bookingId,
      session
    }).catch(() => {});

    if (isDuplicateKeyError(error)) {
      throw buildServiceSlotError(
        SERVICE_SLOT_ERROR_CODES.SLOT_UNAVAILABLE,
        'Ce creneau n est plus disponible.',
        409
      );
    }
    throw error;
  }
}

/**
 * M11B — Déplacement EN PLACE d'une réservation existante vers un nouveau créneau, avec
 * protection (validation + slot-locks). Conserve le MÊME booking (bookingId/saleId/paiement/
 * statut) : seuls `startAt`/`endAt` changent. Le nouveau créneau est validé en IGNORANT la
 * réservation elle-même (ignoreBookingId). Les anciens verrous sont relâchés puis les nouveaux
 * posés (anti-double-booking via index unique). N'inventoine aucune logique de remboursement.
 *
 * @param {{ bookingId: string, practitionerId: any, newStartAt: any, newEndAt: any,
 *           now?: Date, session?: any }} params
 * @returns {Promise<{ booking: object, service: object, practitioner: object }>}
 */
export async function rescheduleServiceBookingWithProtection({
  bookingId,
  practitionerId,
  newStartAt,
  newEndAt,
  now = new Date(),
  session = null
} = {}) {
  const normalizedBookingId = String(bookingId || '').trim();
  if (!normalizedBookingId) {
    throw buildServiceSlotError('BOOKING_NOT_FOUND', 'Réservation introuvable.', 404);
  }

  let bookingQuery = ServiceBooking.findOne({ bookingId: normalizedBookingId });
  if (session) bookingQuery = bookingQuery.session(session);
  const booking = await bookingQuery;
  if (!booking) {
    throw buildServiceSlotError('BOOKING_NOT_FOUND', 'Réservation introuvable.', 404);
  }
  if (['cancelled', 'completed', 'no_show'].includes(booking.status)) {
    throw buildServiceSlotError('BOOKING_NOT_RESCHEDULABLE', 'Cette réservation ne peut pas être reportée.', 409);
  }

  // Validation GLOBALE du nouveau créneau (en ignorant cette réservation : son propre créneau
  // actuel ne doit pas compter comme un conflit).
  const validation = await assertServiceSlotBookable({
    practitionerId,
    serviceId: booking.serviceId,
    startAt: newStartAt,
    endAt: newEndAt,
    now,
    ignoreBookingId: normalizedBookingId,
    session
  });

  const occupiedEndAt = new Date(
    validation.endAt.getTime() + Number(validation.service.bufferTime || 0) * MINUTE_IN_MS
  );

  // Relâche les anciens verrous PUIS pose les nouveaux. assertServiceSlotBookable a confirmé que
  // le nouveau créneau est libre (hors cette réservation) → le seul détenteur possible des minutes
  // chevauchantes était cette réservation elle-même (cas d'un petit décalage).
  await releaseServiceBookingSlotLocks({ bookingId: normalizedBookingId, session });

  const lockDocs = buildBookingSlotLockDocuments({
    practitionerId,
    bookingId: normalizedBookingId,
    startAt: validation.startAt,
    occupiedEndAt
  });

  try {
    if (lockDocs.length) {
      await BookingSlotLock.insertMany(lockDocs, {
        ordered: true,
        ...(session ? { session } : {})
      });
    }
    booking.startAt = validation.startAt;
    booking.endAt = validation.endAt;
    booking.updatedAt = new Date();
    await booking.save(session ? { session } : undefined);
    return { booking, service: validation.service, practitioner: validation.practitioner };
  } catch (error) {
    await releaseServiceBookingSlotLocks({ bookingId: normalizedBookingId, session }).catch(() => {});
    if (isDuplicateKeyError(error)) {
      throw buildServiceSlotError(
        SERVICE_SLOT_ERROR_CODES.SLOT_UNAVAILABLE,
        'Ce creneau n est plus disponible.',
        409
      );
    }
    throw error;
  }
}

export function sortSlotsByStart(slots = []) {
  return [...slots].sort((left, right) => left.start.localeCompare(right.start));
}

export { localDateStr, formatLocalDateTime, minutesToTimeStr };
