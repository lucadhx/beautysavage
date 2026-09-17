import PractitionerProfile from '../models/PractitionerProfile.js';
import PractitionerSchedule from '../models/PractitionerSchedule.js';
import ScheduleException from '../models/ScheduleException.js';
import FormationSession from '../models/FormationSession.js';
import ServiceBooking from '../models/ServiceBooking.js';
import Service from '../models/Service.js';
import User from '../models/user.js';
import {
  computeAvailableSlotsForPractitioner as computeBookableSlotsForPractitioner,
  sortSlotsByStart
} from '../services/serviceAvailabilityService.js';
import { resolveInstitutePractitionerProfile } from '../services/calendar/instituteCalendarContext.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function normalizeDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseScheduleTimeToMinutes(timeStr) {
  const [hours, minutes] = String(timeStr || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function buildInterval(startMin, endMin) {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
    return null;
  }
  return { startMin, endMin };
}

function slotToInterval(slot) {
  const startMin = parseScheduleTimeToMinutes(slot?.startTime);
  const endMin = parseScheduleTimeToMinutes(slot?.endTime);
  return buildInterval(startMin, endMin);
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

function buildAvailabilityIntervalsForDay({ schedule, date, exception } = {}) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return [];
  const daySchedule = Array.isArray(schedule?.weeklySchedule)
    ? schedule.weeklySchedule.find(entry => Number(entry?.dayOfWeek) === normalizedDate.getDay())
    : null;
  const weeklyIntervals = daySchedule?.isWorking
    ? normalizeIntervals((Array.isArray(daySchedule?.slots) ? daySchedule.slots : []).map(slotToInterval))
    : [];

  if (exception?.type === 'block' && exception.isFullDay) {
    return [];
  }

  let availability = weeklyIntervals;
  const exceptionIntervals = extractExceptionIntervals(exception);
  if (exception?.type === 'modify') {
    availability = exceptionIntervals;
  } else if (exception?.type === 'add') {
    availability = normalizeIntervals([...weeklyIntervals, ...exceptionIntervals]);
  } else if (exception?.type === 'block') {
    availability = subtractIntervals(weeklyIntervals, exceptionIntervals);
  }

  return applyLunchBreak(availability, schedule?.lunchBreak);
}

function intervalContains(interval, startMin, endMin) {
  return startMin >= interval.startMin && endMin <= interval.endMin;
}

function buildConflictError(conflicts, message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'BOOKING_CONFLICT';
  error.conflicts = conflicts;
  return error;
}

function serializeBookingConflict(booking) {
  return {
    bookingId: String(booking.bookingId || ''),
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status
  };
}

async function listUpcomingBookings(practitionerId, { fromDate, toDate } = {}) {
  const filter = {
    practitionerId,
    status: { $nin: ['cancelled'] }
  };
  if (fromDate || toDate) {
    filter.startAt = {};
    if (fromDate) filter.startAt.$gte = fromDate;
    if (toDate) filter.startAt.$lte = toDate;
  }
  return ServiceBooking.find(filter)
    .sort({ startAt: 1 })
    .select('bookingId startAt endAt status')
    .lean();
}

async function assertScheduleConflicts(practitionerId, schedule) {
  const fromDate = new Date();
  fromDate.setHours(0, 0, 0, 0);
  const bookings = await listUpcomingBookings(practitionerId, { fromDate });
  if (!bookings.length) return;

  const lastBookingDate = new Date(bookings[bookings.length - 1].startAt);
  lastBookingDate.setHours(23, 59, 59, 999);
  const exceptions = await ScheduleException.find({
    practitionerId,
    date: { $gte: fromDate, $lte: lastBookingDate }
  }).lean();
  const exceptionByDay = new Map(exceptions.map(exception => [toDateStr(exception.date), exception]));

  const conflicts = bookings
    .filter(booking => {
      const bookingDate = new Date(booking.startAt);
      const availability = buildAvailabilityIntervalsForDay({
        schedule,
        date: bookingDate,
        exception: exceptionByDay.get(toDateStr(bookingDate)) || null
      });
      const startMin = bookingDate.getHours() * 60 + bookingDate.getMinutes();
      const endDate = new Date(booking.endAt);
      const endMin = endDate.getHours() * 60 + endDate.getMinutes();
      return !availability.some(interval => intervalContains(interval, startMin, endMin));
    })
    .map(serializeBookingConflict);

  if (conflicts.length) {
    throw buildConflictError(conflicts, 'Ce planning fermerait des créneaux déjà réservés.');
  }
}

async function assertExceptionConflicts(practitionerId, schedule, exception) {
  if (!exception || exception.type === 'add') return;

  const exceptionDate = normalizeDate(`${String(exception.date).slice(0, 10)}T12:00:00`);
  if (!exceptionDate) return;

  const dayStart = new Date(exceptionDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(exceptionDate);
  dayEnd.setHours(23, 59, 59, 999);
  const bookings = await listUpcomingBookings(practitionerId, { fromDate: dayStart, toDate: dayEnd });
  if (!bookings.length) return;

  const availability = buildAvailabilityIntervalsForDay({
    schedule,
    date: exceptionDate,
    exception
  });
  const conflicts = bookings
    .filter(booking => {
      const startDate = new Date(booking.startAt);
      const endDate = new Date(booking.endAt);
      const startMin = startDate.getHours() * 60 + startDate.getMinutes();
      const endMin = endDate.getHours() * 60 + endDate.getMinutes();
      return !availability.some(interval => intervalContains(interval, startMin, endMin));
    })
    .map(serializeBookingConflict);

  if (conflicts.length) {
    throw buildConflictError(conflicts, 'Cette exception entre en conflit avec une réservation existante.');
  }
}

function buildExceptionInput(input = {}) {
  const isFullDay = Boolean(input.isFullDay);
  return {
    practitionerId: input.practitionerId,
    date: String(input.date || '').slice(0, 10),
    type: input.type || 'block',
    isFullDay,
    startTime: isFullDay ? null : (input.startTime || null),
    endTime: isFullDay ? null : (input.endTime || null),
    slots: Array.isArray(input.slots) ? input.slots : [],
    reason: input.reason || ''
  };
}

/**
 * Generate all available time slots for a given day based on weeklySchedule.
 * Returns FullCalendar background event objects.
 */
function buildAvailableEventsForDay(dayStr, weekdayEntry) {
  if (!weekdayEntry || !weekdayEntry.isWorking) return [];
  const slots = Array.isArray(weekdayEntry.slots) ? weekdayEntry.slots : [];
  return slots
    .map((slot, i) => {
      if (!slot.startTime || !slot.endTime) return null;
      return {
        id: `avail-${dayStr}-${i}`,
        title: 'Disponible',
        start: `${dayStr}T${slot.startTime}`,
        end: `${dayStr}T${slot.endTime}`,
        display: 'background',
        backgroundColor: 'rgba(95,79,247,0.12)',
        extendedProps: { type: 'available' }
      };
    })
    .filter(Boolean);
}

/**
 * Iterate days between fromDate and toDate (inclusive), generating available events
 * from the weekly schedule (dayOfWeek 0-6).
 */
function buildAvailableEvents(schedule, fromDate, toDate) {
  if (!schedule || !Array.isArray(schedule.weeklySchedule)) return [];

  const scheduleByDay = {};
  for (const entry of schedule.weeklySchedule) {
    scheduleByDay[entry.dayOfWeek] = entry;
  }

  const events = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    const dow = cursor.getDay();
    const dayStr = toDateStr(cursor);
    const entry = scheduleByDay[dow];
    const dayEvents = buildAvailableEventsForDay(dayStr, entry);
    events.push(...dayEvents);
    cursor.setDate(cursor.getDate() + 1);
  }

  return events;
}

// ─── GET /schedule/:practitionerId ─────────────────────────────────────────

export async function getSchedule(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const { practitionerId } = req.params;
    const schedule = await PractitionerSchedule.findOne({ practitionerId });
    return res.json({ ok: true, schedule: schedule || null });
  } catch (error) {
    console.error('getSchedule error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── PUT /schedule/:practitionerId ─────────────────────────────────────────

export async function saveSchedule(req, res) {
  try {
    const { practitionerId } = req.params;
    const { weeklySchedule, lunchBreak } = req.body;

    if (!Array.isArray(weeklySchedule) || weeklySchedule.length !== 7) {
      return res.status(400).json({
        ok: false,
        error: 'weeklySchedule doit etre un tableau de 7 jours (dayOfWeek 0-6).'
      });
    }

    for (const day of weeklySchedule) {
      const dow = Number(day.dayOfWeek);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        return res.status(400).json({
          ok: false,
          error: `dayOfWeek invalide : ${day.dayOfWeek}. Valeurs attendues : 0-6.`
        });
      }
      if (!Array.isArray(day.slots)) {
        return res.status(400).json({
          ok: false,
          error: `slots doit etre un tableau pour dayOfWeek ${dow}.`
        });
      }
      for (const slot of day.slots) {
        if (!slot.startTime || !slot.endTime) {
          return res.status(400).json({
            ok: false,
            error: `Chaque slot doit avoir startTime et endTime (dayOfWeek ${dow}).`
          });
        }
      }
    }

    const existingSchedule = await PractitionerSchedule.findOne({ practitionerId }).lean();
    const nextSchedule = {
      practitionerId,
      weeklySchedule,
      lunchBreak: lunchBreak !== undefined ? lunchBreak : (existingSchedule?.lunchBreak || null)
    };
    await assertScheduleConflicts(practitionerId, nextSchedule);

    const update = {
      weeklySchedule,
      updatedAt: new Date()
    };
    if (lunchBreak !== undefined) {
      update.lunchBreak = lunchBreak;
    }

    const schedule = await PractitionerSchedule.findOneAndUpdate(
      { practitionerId },
      { $set: update },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, schedule });
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).json({ ok: false, error: error.message, code: error.code, conflicts: error.conflicts || [] });
    }
    console.error('saveSchedule error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── GET /schedule/me ──────────────────────────────────────────────────────

export async function getMySchedule(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const userId = req.sessionUserId;
    const profile = await PractitionerProfile.findOne({ userId }).lean()
      || await resolveInstitutePractitionerProfile();
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Calendrier institut introuvable.' });
    }
    const schedule = await PractitionerSchedule.findOne({ practitionerId: profile._id });
    return res.json({ ok: true, schedule: schedule || null, practitionerId: String(profile._id) });
  } catch (error) {
    console.error('getMySchedule error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── GET /exceptions/:practitionerId ───────────────────────────────────────

export async function getExceptions(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const { practitionerId } = req.params;
    const { from, to } = req.query;

    const filter = { practitionerId };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to) filter.date.$lte = new Date(to);
    }

    const exceptions = await ScheduleException.find(filter).sort({ date: 1 });
    return res.json({ ok: true, exceptions });
  } catch (error) {
    console.error('getExceptions error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── POST /exceptions ──────────────────────────────────────────────────────

export async function createException(req, res) {
  try {
    const { practitionerId, date, type, isFullDay, startTime, endTime, slots, reason } = req.body;
    console.log('[DEBUG createException] body:', JSON.stringify(req.body), 'sessionUserId:', req.sessionUserId);

    if (!practitionerId || !date || !type) {
      return res.status(400).json({
        ok: false,
        error: 'practitionerId, date et type sont requis.'
      });
    }

    const validTypes = ['block', 'add', 'modify'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        ok: false,
        error: `type invalide. Valeurs acceptees : ${validTypes.join(', ')}.`
      });
    }

    const schedule = await PractitionerSchedule.findOne({ practitionerId }).lean();
    const exceptionInput = buildExceptionInput({
      practitionerId,
      date,
      type,
      isFullDay,
      startTime,
      endTime,
      slots,
      reason
    });
    await assertExceptionConflicts(practitionerId, schedule, exceptionInput);

    const exception = await ScheduleException.findOneAndUpdate(
      {
        practitionerId,
        date: new Date(date + 'T00:00:00.000Z')
      },
      {
        $set: exceptionInput
      },
      { upsert: true, new: true }
    );

    return res.json({ ok: true, exception });
  } catch (error) {
    if (error?.status === 409) {
      return res.status(409).json({ ok: false, error: error.message, code: error.code, conflicts: error.conflicts || [] });
    }
    console.error('createException error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── PUT /exceptions/:id ──────────────────────────────────────────────────

export async function updateException(req, res) {
  try {
    const current = await ScheduleException.findById(req.params.id).lean();
    if (!current) return res.status(404).json({ ok: false, error: 'Exception introuvable.' });
    const merged = buildExceptionInput({
      practitionerId: String(current.practitionerId || ''),
      date: req.body?.date || current.date,
      type: req.body?.type || current.type,
      isFullDay: req.body?.isFullDay ?? current.isFullDay,
      startTime: req.body?.startTime ?? current.startTime,
      endTime: req.body?.endTime ?? current.endTime,
      slots: req.body?.slots ?? current.slots,
      reason: req.body?.reason ?? current.reason
    });
    const schedule = await PractitionerSchedule.findOne({ practitionerId: merged.practitionerId }).lean();
    await assertExceptionConflicts(merged.practitionerId, schedule, merged);

    const exc = await ScheduleException.findByIdAndUpdate(
      req.params.id,
      { $set: merged },
      { new: true }
    );
    return res.json({ ok: true, exception: exc });
  } catch (err) {
    if (err?.status === 409) {
      return res.status(409).json({ ok: false, error: err.message, code: err.code, conflicts: err.conflicts || [] });
    }
    console.error('updateException error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── POST /exceptions/batch ────────────────────────────────────────────────

export async function batchUpsertExceptions(req, res) {
  try {
    const { exceptions } = req.body;
    console.log('[DEBUG batchUpsertExceptions] body:', JSON.stringify(req.body), 'sessionUserId:', req.sessionUserId);
    if (!Array.isArray(exceptions) || exceptions.length === 0) {
      return res.status(400).json({ ok: false, error: 'Liste d\'exceptions vide.' });
    }

    const results = [];
    const scheduleCache = new Map();
    for (const exc of exceptions) {
      const { practitionerId, date, type, isFullDay, slots, reason } = exc;
      if (!practitionerId || !date) continue;
      const normalized = buildExceptionInput({
        practitionerId,
        date,
        type,
        isFullDay,
        slots,
        reason
      });
      if (!scheduleCache.has(practitionerId)) {
        scheduleCache.set(practitionerId, await PractitionerSchedule.findOne({ practitionerId }).lean());
      }
      await assertExceptionConflicts(practitionerId, scheduleCache.get(practitionerId), normalized);

      // Normaliser en minuit UTC pour cohérence avec createException (new Date("YYYY-MM-DD") = UTC midnight)
      const dateOnly = new Date(String(date).slice(0, 10) + 'T00:00:00.000Z');

      const filter = { practitionerId, date: dateOnly };
      const update = { $set: normalized };
      const opts = { upsert: true, new: true, runValidators: true };

      const result = await ScheduleException.findOneAndUpdate(filter, update, opts);
      results.push(result);
    }

    return res.json({ ok: true, count: results.length });
  } catch (err) {
    if (err?.status === 409) {
      return res.status(409).json({ ok: false, error: err.message, code: err.code, conflicts: err.conflicts || [] });
    }
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ─── DELETE /exceptions/:id ────────────────────────────────────────────────

export async function deleteException(req, res) {
  try {
    const { id } = req.params;
    const exception = await ScheduleException.findByIdAndDelete(id);
    if (!exception) {
      return res.status(404).json({ ok: false, error: 'Exception introuvable.' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('deleteException error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── GET /calendar-events ──────────────────────────────────────────────────

export async function getCalendarEvents(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const { from, to, practitionerId } = req.query;

    if (!from || !to) {
      return res.status(400).json({ ok: false, error: 'Les parametres from et to sont requis.' });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ ok: false, error: 'Dates from/to invalides.' });
    }

    const events = [];

    // 1. Formation sessions
    const sessions = await FormationSession.find({
      startDate: { $gte: fromDate, $lte: toDate }
    }).populate('formationId', 'name');

    for (const session of sessions) {
      // Compute end date from startDate + durationDays
      const sessionEnd = new Date(session.startDate);
      sessionEnd.setDate(sessionEnd.getDate() + (session.durationDays || 1));

      // Determine start/end times from schedule if available
      let startStr = session.startDate.toISOString();
      let endStr = sessionEnd.toISOString();

      if (Array.isArray(session.schedule) && session.schedule.length > 0) {
        const firstEntry = session.schedule[0];
        if (firstEntry.startTime) {
          const d = new Date(session.startDate);
          const dayStr = toDateStr(d);
          startStr = `${dayStr}T${firstEntry.startTime}`;
        }
        if (firstEntry.endTime) {
          const d = new Date(session.startDate);
          const dayStr = toDateStr(d);
          endStr = `${dayStr}T${firstEntry.endTime}`;
        }
      }

      events.push({
        id: `session-${session._id}`,
        title: `Formation: ${session.formationId?.name || ''}`,
        start: startStr,
        end: endStr,
        type: 'formation',
        backgroundColor: '#5f4ff7',
        borderColor: '#5f4ff7',
        extendedProps: {
          type: 'formation',
          sessionId: session._id,
          formationId: session.formationId?._id || session.formationId,
          formationName: session.formationId?.name || '',
          sessionStatus: session.status || 'active'
        }
      });
    }

    // 2. Practitioner schedule + exceptions
    if (practitionerId) {
      const schedule = await PractitionerSchedule.findOne({ practitionerId });

      // Fetch exceptions first to know which days are overridden
      const exceptions = await ScheduleException.find({
        practitionerId,
        date: { $gte: fromDate, $lte: toDate }
      });

      // Build a set of days that fully override the schedule:
      // - type=modify  : replaces available slots for that day
      // - type=block, isFullDay=true : removes all availability for that day
      const overriddenDays = new Set();
      for (const exc of exceptions) {
        if (exc.type === 'modify' || (exc.type === 'block' && exc.isFullDay)) {
          overriddenDays.add(toDateStr(exc.date));
        }
      }

      // Available slots (background events) — skip overridden days
      if (schedule) {
        const availEvents = buildAvailableEvents(schedule, fromDate, toDate);
        for (const ev of availEvents) {
          const evDay = ev.start.slice(0, 10);
          if (!overriddenDays.has(evDay)) events.push(ev);
        }
      }

      for (const exc of exceptions) {
        const dayStr = toDateStr(exc.date);

        if (exc.type === 'modify') {
          // Remplace les plages du planning type par les slots de l'exception
          for (const slot of (exc.slots || [])) {
            if (!slot.startTime || !slot.endTime) continue;
            events.push({
              id: `avail-mod-${exc._id}-${slot.startTime}`,
              title: 'Disponible',
              start: `${dayStr}T${slot.startTime}`,
              end: `${dayStr}T${slot.endTime}`,
              display: 'background',
              backgroundColor: 'rgba(95,79,247,0.12)',
              extendedProps: { type: 'available' }
            });
          }
          continue;
        }

        // type=block
        if (exc.isFullDay) {
          // Journée bloquée : générer des events sur les plages du planning type pour ce jour
          const dowIndex = exc.date.getDay(); // 0=dim, 6=sam
          const daySchedule = schedule?.weeklySchedule?.find(d => d.dayOfWeek === dowIndex);
          if (daySchedule?.isWorking && daySchedule.slots?.length) {
            for (const slot of daySchedule.slots) {
              events.push({
                id: `block-fullday-${exc._id}-${slot.startTime}`,
                title: 'Bloqué',
                start: `${dayStr}T${slot.startTime}`,
                end: `${dayStr}T${slot.endTime}`,
                display: 'block',
                backgroundColor: 'rgba(30,30,30,0.75)',
                borderColor: 'transparent',
                textColor: '#fff',
                classNames: ['plm-event-unavailable'],
                extendedProps: { type: 'blocked', exceptionId: exc._id.toString() }
              });
            }
          }
          // Si pas de planning type pour ce jour, pas d'event (jour déjà hors planning)
        } else if (exc.startTime && exc.endTime) {
          // Créneau bloqué (plage horaire)
          events.push({
            id: `block-slot-${exc._id}`,
            title: 'Bloqué',
            start: `${dayStr}T${exc.startTime}`,
            end: `${dayStr}T${exc.endTime}`,
            display: 'block',
            backgroundColor: 'rgba(30,30,30,0.75)',
            borderColor: 'transparent',
            textColor: '#fff',
            classNames: ['plm-event-unavailable'],
            extendedProps: { type: 'blocked', exceptionId: exc._id.toString() }
          });
        }
      }
    }

    // 3. Service bookings (only when practitionerId is filtered)
    if (practitionerId) {
      const bookings = await ServiceBooking.find({
        practitionerId,
        startAt: { $gte: fromDate, $lte: toDate },
        status: { $in: ['confirmed', 'completed', 'no_show'] }
      }).populate('serviceId', 'name').populate('clientId', 'firstName lastName email').lean();

      const practitionerProfile = await PractitionerProfile.findById(practitionerId).lean();
      const practitionerColor = '#5f4ff7';

      for (const booking of bookings) {
        events.push({
          id: `booking-${booking._id}`,
          title: `${booking.serviceId?.name || 'Prestation'} — ${booking.clientId?.firstName || ''} ${booking.clientId?.lastName || ''}`.trim(),
          start: booking.startAt.toISOString(),
          end: booking.endAt.toISOString(),
          backgroundColor: practitionerColor,
          borderColor: 'transparent',
          textColor: '#fff',
          classNames: [`plm-event-booking`, `plm-event-booking--${booking.status}`],
          extendedProps: {
            type: 'booking',
            bookingId: booking.bookingId,
            bookingDbId: booking._id.toString(),
            status: booking.status,
            clientName: `${booking.clientId?.firstName || ''} ${booking.clientId?.lastName || ''}`.trim()
          }
        });
      }
    }

    return res.json({ ok: true, events });
  } catch (error) {
    console.error('getCalendarEvents error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── Vitrine availability helpers ──────────────────────────────────────────

function localDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseTimeToMinutes(timeStr) {
  const parts = String(timeStr || '').split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

function minutesToTimeStr(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isSlotOccupied(startMin, endMin, bookings, lunchBreak, formationOccupancies = []) {
  if (lunchBreak?.isActive) {
    const lbStart = parseTimeToMinutes(lunchBreak.startTime);
    const lbEnd = parseTimeToMinutes(lunchBreak.endTime);
    if (lbStart !== null && lbEnd !== null && startMin < lbEnd && endMin > lbStart) return true;
  }
  for (const booking of bookings) {
    const bStart = booking.startAt.getHours() * 60 + booking.startAt.getMinutes();
    const bEnd = booking.endAt.getHours() * 60 + booking.endAt.getMinutes();
    if (startMin < bEnd && endMin > bStart) return true;
  }
  for (const { startMin: fsStart, endMin: fsEnd } of formationOccupancies) {
    if (startMin < fsEnd && endMin > fsStart) return true;
  }
  return false;
}

async function computeSlotsForPractitioner({ practitionerId, dateStr, service, schedule }) {
  const dayOfWeek = new Date(dateStr + 'T12:00:00.000Z').getDay();
  const daySchedule = schedule?.weeklySchedule?.find(d => d.dayOfWeek === dayOfWeek);
  if (!daySchedule?.isWorking || !daySchedule.slots?.length) return [];

  const dateObj = new Date(dateStr + 'T00:00:00.000Z');
  const exc = await ScheduleException.findOne({ practitionerId, date: dateObj }).lean();
  if (exc?.type === 'block' && exc.isFullDay) return [];

  const slots = exc?.type === 'modify' ? (exc.slots || []) : daySchedule.slots;
  if (!slots.length) return [];

  const dayStart = new Date(dateStr + 'T00:00:00.000Z');
  const dayEnd = new Date(dateStr + 'T23:59:59.999Z');
  const bookings = await ServiceBooking.find({
    practitionerId,
    startAt: { $gte: dayStart },
    endAt: { $lte: dayEnd },
    status: { $ne: 'cancelled' }
  }).lean();

  const profile = await PractitionerProfile.findById(practitionerId).lean();
  const granularity = profile?.slotGranularity || 30;
  const duration = service.duration;
  const buffer = service.bufferTime || 0;

  // Sessions de formation ce jour-là pour l'instructeur lié à cette praticienne
  // Comparaison en heure locale (localDateStr) pour éviter le décalage UTC/Paris
  const formationSessionOccupancies = [];
  if (profile?.userId) {
    const { buildActiveFormationSessionFilter } = await import('../models/FormationSession.js');
    const allInstructorSessions = await FormationSession.find(
      buildActiveFormationSessionFilter({ instructorId: profile.userId })
    ).select({ startDate: 1, durationDays: 1, schedule: 1 }).lean();

    for (const fs of allInstructorSessions) {
      const dur = Number(fs.durationDays) || 1;
      for (let i = 0; i < dur; i++) {
        const sessionDay = new Date(fs.startDate);
        sessionDay.setDate(sessionDay.getDate() + i);
        if (localDateStr(sessionDay) === dateStr) {
          const dayIndex = i + 1;
          const entry = (fs.schedule || []).find(s => s.dayIndex === dayIndex);
          if (entry) {
            const [startH, startM] = entry.startTime.split(':').map(Number);
            const [endH, endM] = entry.endTime.split(':').map(Number);
            formationSessionOccupancies.push({
              startMin: startH * 60 + startM,
              endMin: endH * 60 + endM
            });
          }
          break;
        }
      }
    }
  }

  const now = new Date();
  const available = [];
  for (const slot of slots) {
    const slotStartMin = parseTimeToMinutes(slot.startTime);
    const slotEndMin = parseTimeToMinutes(slot.endTime);
    if (slotStartMin === null || slotEndMin === null) continue;
    let current = slotStartMin;
    while (current + duration + buffer <= slotEndMin) {
      const slotEnd = current + duration;
      const slotStartDateTime = new Date(`${dateStr}T${minutesToTimeStr(current)}:00`);
      if (slotStartDateTime <= now) { current += granularity; continue; }
      if (!isSlotOccupied(current, slotEnd + buffer, bookings, schedule.lunchBreak, formationSessionOccupancies)) {
        available.push({
          start: `${dateStr}T${minutesToTimeStr(current)}`,
          end: `${dateStr}T${minutesToTimeStr(slotEnd)}`,
          practitionerId: String(practitionerId)
        });
      }
      current += granularity;
    }
  }
  return available;
}

// ─── GET /api/vitrine/availability/slots ───────────────────────────────────

export async function getAvailableSlots(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    // M11A — disponibilité GLOBALE institut : le `practitionerId` query est LEGACY et IGNORÉ
    // (entité unique). Le contrat API ({ ok, slots[] }) est inchangé.
    const { serviceId, date } = req.query;
    if (!serviceId || !date) {
      return res.status(400).json({ ok: false, error: 'serviceId et date sont requis.' });
    }

    const service = await Service.findById(serviceId).lean();
    if (!service || !service.isActive || !service.isBookable) {
      return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });
    }

    const leadDays = Number(service.bookingLeadDays || 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date + 'T12:00:00.000Z');
    const daysFromToday = (requestedDate.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24);
    if (daysFromToday < leadDays) {
      return res.json({ ok: true, slots: [] });
    }

    // Toujours l'entité institut (offrant la prestation). Aucun filtrage par prestataire.
    const practitioners = await PractitionerProfile.find({
      serviceIds: service._id,
      isActive: true
    }).lean();

    if (!practitioners.length) return res.json({ ok: true, slots: [] });

    const allSlots = [];
    for (const p of practitioners) {
      const schedule = await PractitionerSchedule.findOne({ practitionerId: p._id }).lean();
      if (!schedule) continue;
      const slots = await computeBookableSlotsForPractitioner({
        practitioner: p,
        schedule,
        dateStr: date,
        service
      });
      allSlots.push(...slots);
    }

    return res.json({ ok: true, slots: sortSlotsByStart(allSlots) });
  } catch (error) {
    console.error('getAvailableSlots error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── GET /api/vitrine/availability/days ────────────────────────────────────

export async function getAvailableDays(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const { serviceId, month, year } = req.query;
    if (!serviceId || !month || !year) {
      return res.status(400).json({ ok: false, error: 'serviceId, month et year sont requis.' });
    }

    const service = await Service.findById(serviceId).lean();
    if (!service || !service.isActive || !service.isBookable) {
      return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });
    }

    const m = parseInt(month, 10) - 1;
    const y = parseInt(year, 10);
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);

    const practitioners = await PractitionerProfile.find({
      serviceIds: service._id,
      isActive: true
    }).lean();
    if (!practitioners.length) return res.json({ ok: true, availableDays: [] });

    const practitionerSchedules = [];
    for (const p of practitioners) {
      const schedule = await PractitionerSchedule.findOne({ practitionerId: p._id }).lean();
      if (schedule) practitionerSchedules.push({ practitioner: p, schedule });
    }
    if (!practitionerSchedules.length) return res.json({ ok: true, availableDays: [] });

    const leadDays = Number(service.bookingLeadDays || 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const availableDays = [];
    const cursor = new Date(firstDay);
    while (cursor <= lastDay) {
      const dateStr = toDateStr(cursor);
      const daysFromToday = (cursor.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24);
      if (daysFromToday >= leadDays) {
        let hasSlots = false;
        for (const { practitioner, schedule } of practitionerSchedules) {
          const slots = await computeBookableSlotsForPractitioner({
            practitioner,
            schedule,
            dateStr,
            service
          });
          if (slots.length) { hasSlots = true; break; }
        }
        if (hasSlots) availableDays.push(dateStr);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return res.json({ ok: true, availableDays });
  } catch (error) {
    console.error('getAvailableDays error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
