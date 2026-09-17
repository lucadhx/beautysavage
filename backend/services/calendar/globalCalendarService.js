// services/calendar/globalCalendarService.js
// M10 — Calendrier GLOBAL de l'institut (type Planity). Abstraction unique `CalendarItem`
// regroupant : réservations prestations (service_booking), sessions de formation présentielle
// (formation_session) et créneaux bloqués (blocked_slot). GLOBAL : aucune notion de
// prestataire/praticienne — on lit TOUT, toutes entités confondues.
//
// SAFE : champs d'affichage uniquement (nom client, jamais d'e-mail/secret ; pas de payload).
import ServiceBooking from '../../models/ServiceBooking.js';
import Service from '../../models/Service.js';
import Formation from '../../models/Formation.js';
import FormationSession, {
  buildActiveFormationSessionFilter,
  isInactiveFormationSessionStatus
} from '../../models/FormationSession.js';
import ScheduleException from '../../models/ScheduleException.js';
import User from '../../models/user.js';

export const CALENDAR_ITEM_TYPES = Object.freeze(['service_booking', 'formation_session', 'blocked_slot']);

function roundCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function safeClientName(client) {
  if (!client) return null;
  const name = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  return name || null; // jamais d'e-mail
}

function buildLocalDateTime(baseDate, dayOffset, timeStr) {
  const d = new Date(baseDate);
  if (Number.isNaN(d.getTime())) return null;
  const [h, m] = String(timeStr || '00:00').split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

/**
 * Mappe une réservation prestation → CalendarItem. `service`/`client` optionnels (déjà chargés).
 */
export function mapServiceBookingToCalendarItem(booking, { service = null, client = null } = {}) {
  if (!booking) return null;
  const isDeposit = booking.paymentType === 'deposit';
  const amountPaidOnline = isDeposit
    ? roundCents(booking.depositAmount)
    : (booking.paymentType === 'free' ? 0 : roundCents(booking.totalSoldAmount || booking.totalPrice));
  const balanceDueAmount = roundCents(booking.balanceDueAmount);
  const refundStatus = booking.paymentStatus === 'refunded'
    ? 'refunded'
    : (booking.status === 'cancelled' ? 'cancelled' : null);
  const canCancel = !['cancelled', 'completed', 'no_show'].includes(booking.status);
  const canMarkBalancePaid =
    booking.paymentType === 'deposit' &&
    booking.balanceSettlementMode === 'pay_on_site' &&
    balanceDueAmount > 0 &&
    booking.paymentStatus !== 'paid';

  return {
    id: booking.bookingId,
    type: 'service_booking',
    title: service?.name || 'Prestation',
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    client: { name: safeClientName(client) },
    participant: null,
    paymentStatus: booking.paymentStatus || null,
    paymentType: booking.paymentType || null,
    refundStatus,
    totalAmount: roundCents(booking.totalSoldAmount || booking.totalPrice),
    depositAmount: roundCents(booking.depositAmount),
    amountPaidOnline,
    balanceDueAmount,
    balanceSettlementMode: booking.balanceSettlementMode || null,
    actionLinks: {
      detail: true,
      cancel: canCancel,
      markBalancePaid: canMarkBalancePaid,
      // M11B — report admin GLOBAL disponible (POST /api/gestion/bookings/:id/reschedule) tant que
      // la réservation n'est pas terminée/annulée/no-show.
      reschedule: canCancel
    },
    sourceModel: 'ServiceBooking',
    sourceId: String(booking._id || '')
  };
}

/**
 * Mappe une session de formation présentielle → un CalendarItem PAR jour planifié.
 * Renvoie un tableau (vide si rien d'exploitable).
 */
export function mapFormationSessionToCalendarItem(session, { formationName = null } = {}) {
  if (!session?.startDate || !Array.isArray(session.schedule) || !session.schedule.length) return [];
  const durationDays = Number(session.durationDays) || 1;
  const maxClients = Number(session.maxClients) || 0;
  const reservedCount = Number(session.reservedCount) || 0;
  const placesLeft = Math.max(0, maxClients - reservedCount);
  const status = session.status || 'active';

  const items = [];
  for (let i = 0; i < durationDays; i += 1) {
    const entry = session.schedule.find((s) => Number(s?.dayIndex) === i + 1);
    if (!entry) continue;
    const startAt = buildLocalDateTime(session.startDate, i, entry.startTime);
    const endAt = buildLocalDateTime(session.startDate, i, entry.endTime);
    if (!startAt || !endAt) continue;
    items.push({
      id: `${session._id}-d${i + 1}`,
      type: 'formation_session',
      title: `Formation : ${formationName || ''}`.trim(),
      startAt,
      endAt,
      status,
      client: null,
      participant: { reservedCount, maxClients, placesLeft },
      paymentStatus: null,
      paymentType: null,
      refundStatus: null,
      totalAmount: null,
      depositAmount: null,
      amountPaidOnline: null,
      balanceDueAmount: null,
      balanceSettlementMode: null,
      actionLinks: { detail: false, cancel: false, markBalancePaid: false, reschedule: false },
      sourceModel: 'FormationSession',
      sourceId: String(session._id || '')
    });
  }
  return items;
}

function mapBlockedExceptionToCalendarItems(exception) {
  if (!exception || exception.type !== 'block') return [];
  const day = new Date(exception.date);
  if (Number.isNaN(day.getTime())) return [];
  const slots = Array.isArray(exception.slots) && exception.slots.length
    ? exception.slots
    : (exception.startTime && exception.endTime ? [{ startTime: exception.startTime, endTime: exception.endTime }] : []);
  if (exception.isFullDay || !slots.length) {
    return [{
      id: `blocked-${exception._id}`,
      type: 'blocked_slot',
      title: exception.reason || 'Indisponible',
      startAt: buildLocalDateTime(day, 0, '00:00'),
      endAt: buildLocalDateTime(day, 0, '23:59'),
      status: 'blocked',
      client: null, participant: null, paymentStatus: null, paymentType: null, refundStatus: null,
      totalAmount: null, depositAmount: null, amountPaidOnline: null, balanceDueAmount: null, balanceSettlementMode: null,
      actionLinks: { detail: false, cancel: false, markBalancePaid: false, reschedule: false },
      sourceModel: 'ScheduleException', sourceId: String(exception._id || '')
    }];
  }
  return slots.map((slot, idx) => ({
    id: `blocked-${exception._id}-${idx}`,
    type: 'blocked_slot',
    title: exception.reason || 'Indisponible',
    startAt: buildLocalDateTime(day, 0, slot.startTime),
    endAt: buildLocalDateTime(day, 0, slot.endTime),
    status: 'blocked',
    client: null, participant: null, paymentStatus: null, paymentType: null, refundStatus: null,
    totalAmount: null, depositAmount: null, amountPaidOnline: null, balanceDueAmount: null, balanceSettlementMode: null,
    actionLinks: { detail: false, cancel: false, markBalancePaid: false, reschedule: false },
    sourceModel: 'ScheduleException', sourceId: String(exception._id || '')
  }));
}

// ─── Liste globale ──────────────────────────────────────────────────────────────

const DEFAULT_BOOKING_STATUSES = ['confirmed', 'completed', 'no_show', 'cancelled'];

/**
 * Liste GLOBALE des items du calendrier institut sur une fenêtre [startDate, endDate].
 * @param {{ startDate: Date|string, endDate: Date|string, status?: string, type?: string }} params
 * @returns {Promise<Array>}
 */
export async function listGlobalCalendarItems({ startDate, endDate, status = null, type = null } = {}) {
  const from = new Date(startDate);
  const to = new Date(endDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw Object.assign(new Error('startDate et endDate valides requis.'), { status: 400 });
  }

  const wantType = (t) => !type || type === t;
  const items = [];

  // 1. Réservations prestations (GLOBAL — aucun filtre practitionerId).
  if (wantType('service_booking')) {
    const statuses = status ? [status] : DEFAULT_BOOKING_STATUSES;
    const bookings = await ServiceBooking.find({
      startAt: { $lt: to },
      endAt: { $gt: from },
      status: { $in: statuses }
    }).sort({ startAt: 1 }).lean();

    const serviceIds = [...new Set(bookings.map((b) => String(b.serviceId)).filter(Boolean))];
    const clientIds = [...new Set(bookings.map((b) => String(b.clientId)).filter(Boolean))];
    const [services, clients] = await Promise.all([
      serviceIds.length ? Service.find({ _id: { $in: serviceIds } }).select('name').lean() : [],
      clientIds.length ? User.find({ _id: { $in: clientIds } }).select('firstName lastName').lean() : []
    ]);
    const serviceMap = new Map(services.map((s) => [String(s._id), s]));
    const clientMap = new Map(clients.map((c) => [String(c._id), c]));

    for (const booking of bookings) {
      const item = mapServiceBookingToCalendarItem(booking, {
        service: serviceMap.get(String(booking.serviceId)) || null,
        client: clientMap.get(String(booking.clientId)) || null
      });
      if (item) items.push(item);
    }
  }

  // 2. Sessions de formation présentielle (GLOBAL).
  if (wantType('formation_session')) {
    const sessionFilter = status === 'active'
      ? buildActiveFormationSessionFilter({})
      : {};
    const sessions = await FormationSession.find(sessionFilter)
      .select('formationId startDate durationDays schedule maxClients reservedCount status')
      .lean();

    const formationIds = [...new Set(sessions.map((s) => String(s.formationId)).filter(Boolean))];
    const formations = formationIds.length
      ? await Formation.find({ _id: { $in: formationIds } }).select('name type').lean()
      : [];
    const formationMap = new Map(formations.map((f) => [String(f._id), f]));

    for (const session of sessions) {
      const formation = formationMap.get(String(session.formationId));
      // Présentielles uniquement (les distancielles n'ont pas de créneau physique).
      if (formation && formation.type && formation.type !== 'presentiel') continue;
      if (status && status !== 'active' && session.status !== status) continue;
      const sessionItems = mapFormationSessionToCalendarItem(session, { formationName: formation?.name || '' });
      for (const it of sessionItems) {
        const s = new Date(it.startAt);
        if (s >= from && s < to) items.push(it);
      }
    }
  }

  // 3. Créneaux bloqués (exceptions de planning de l'institut).
  if (wantType('blocked_slot')) {
    const exceptions = await ScheduleException.find({
      type: 'block',
      date: { $gte: new Date(from.getFullYear(), from.getMonth(), from.getDate()), $lte: to }
    }).lean();
    for (const exc of exceptions) {
      for (const it of mapBlockedExceptionToCalendarItems(exc)) {
        if (it.startAt && it.endAt) items.push(it);
      }
    }
  }

  items.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  return items;
}

export { isInactiveFormationSessionStatus };

export default {
  CALENDAR_ITEM_TYPES,
  listGlobalCalendarItems,
  mapServiceBookingToCalendarItem,
  mapFormationSessionToCalendarItem
};
