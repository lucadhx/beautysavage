import mongoose from 'mongoose';
import { BookingSchedule } from '../models/BookingSchedule.model.js';
import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { ApiError } from '../utils/ApiError.js';
import { emitAndDispatch } from './events/domainEvent.service.js';

const DEFAULT_WEEKLY = [
  { weekday: 1, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  { weekday: 2, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  { weekday: 3, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  { weekday: 4, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  { weekday: 5, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
  { weekday: 6, enabled: true, ranges: [{ start: '09:00', end: '13:00' }] },
  { weekday: 7, enabled: false, ranges: [] },
];

function asDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw ApiError.badRequest(`${label} invalide`);
  return date;
}

function assertRange(startsAt, endsAt) {
  if (endsAt <= startsAt) throw ApiError.badRequest('La fin doit etre apres le debut');
}

function publicEvent(event, extra = {}) {
  return {
    id: String(event._id ?? event.id),
    type: event.type,
    title: event.title,
    productId: event.productId ? String(event.productId) : null,
    saleId: event.saleId ? String(event.saleId) : null,
    lineId: event.lineId || '',
    customerSnapshot: event.customerSnapshot || {},
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone || 'Europe/Paris',
    status: event.status,
    paymentSnapshot: event.paymentSnapshot || {},
    notes: event.notes || '',
    cancellation: event.cancellation || {},
    source: event.source || {},
    ...extra,
  };
}

async function generatedFormationEvents(from, to) {
  const products = await CommerceProduct.find({
    kind: 'IN_PERSON_TRAINING',
    'sessions.startsAt': { $lt: to },
    'sessions.endsAt': { $gt: from },
  }).lean();
  return products.flatMap((product) => (product.sessions || [])
    .filter((session) => session.startsAt && session.endsAt && new Date(session.startsAt) < to && new Date(session.endsAt) > from)
    .map((session) => ({
      id: `${product._id}:${session._id}`,
      type: 'FORMATION_SESSION',
      title: product.title,
      productId: String(product._id),
      saleId: null,
      lineId: '',
      customerSnapshot: {},
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      timezone: 'Europe/Paris',
      status: session.status === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED',
      paymentSnapshot: {
        totalCents: product.price?.amountCents || 0,
        paidCents: 0,
        depositCents: 0,
        balanceDueCents: product.price?.amountCents || 0,
        currency: 'EUR',
      },
      notes: `${session.reservedCount || 0}/${session.capacity || 0} inscrit(s)`,
      cancellation: { reason: session.cancellationReason || '' },
      source: { generatedFrom: 'commerceProduct.sessions', sessionId: String(session._id) },
      capacity: session.capacity || 0,
      reservedCount: session.reservedCount || 0,
    })));
}

export async function getSchedule() {
  return BookingSchedule.findOneAndUpdate(
    { singleton: 'global' },
    { $setOnInsert: { singleton: 'global', timezone: 'Europe/Paris', slotStepMinutes: 15, weeklyHours: DEFAULT_WEEKLY } },
    { new: true, upsert: true }
  ).lean();
}

export async function saveSchedule(payload) {
  const weeklyHours = Array.isArray(payload.weeklyHours) ? payload.weeklyHours : DEFAULT_WEEKLY;
  const exceptions = Array.isArray(payload.exceptions) ? payload.exceptions : [];
  return BookingSchedule.findOneAndUpdate(
    { singleton: 'global' },
    {
      $set: {
        timezone: payload.timezone || 'Europe/Paris',
        slotStepMinutes: Number(payload.slotStepMinutes || 15),
        weeklyHours,
        exceptions,
        reminders: Array.isArray(payload.reminders) ? payload.reminders : [],
        noShowPolicy: payload.noShowPolicy || {},
      },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();
}

export async function listEvents(query = {}) {
  const from = asDate(query.from || new Date(Date.now() - 7 * 86400_000), 'Date de debut');
  const to = asDate(query.to || new Date(Date.now() + 30 * 86400_000), 'Date de fin');
  assertRange(from, to);
  const stored = await CalendarEvent.find({
    startsAt: { $lt: to },
    endsAt: { $gt: from },
  }).sort({ startsAt: 1 }).lean();
  const generated = await generatedFormationEvents(from, to);
  return [...stored.map(publicEvent), ...generated].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

function minutesOf(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function setMinutesOfDay(day, minutes) {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

export async function listAvailability(query = {}) {
  const from = asDate(query.from || new Date(), 'Date de debut');
  const to = asDate(query.to || new Date(Date.now() + 14 * 86400_000), 'Date de fin');
  assertRange(from, to);
  const durationMinutes = Math.max(5, Number(query.durationMinutes || 60));
  const bufferAfterMinutes = Math.max(0, Number(query.bufferAfterMinutes || 0));
  const schedule = await getSchedule();
  const step = Math.max(5, Number(schedule.slotStepMinutes || 15));
  const events = await listEvents({ from: from.toISOString(), to: to.toISOString() });
  const busy = events.filter((event) => event.status !== 'CANCELLED')
    .map((event) => ({ startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) }));

  const slots = [];
  for (let cursor = new Date(from); cursor < to; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay() || 7;
    const dayRule = (schedule.weeklyHours || []).find((day) => day.weekday === weekday);
    if (!dayRule?.enabled) continue;
    for (const range of dayRule.ranges || []) {
      const startMinute = minutesOf(range.start);
      const endMinute = minutesOf(range.end);
      for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += step) {
        const startsAt = setMinutesOfDay(cursor, minute);
        const endsAt = new Date(startsAt.getTime() + (durationMinutes + bufferAfterMinutes) * 60_000);
        if (startsAt < from || endsAt > to) continue;
        const overlap = busy.some((event) => startsAt < event.endsAt && endsAt > event.startsAt);
        if (!overlap) {
          slots.push({
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000).toISOString(),
            reservableEndsAt: endsAt.toISOString(),
            durationMinutes,
          });
        }
      }
    }
  }
  return slots;
}

export async function assertNoOverlap({ startsAt, endsAt, ignoreId = null, ignoreProductId = null }) {
  const query = {
    status: { $ne: 'CANCELLED' },
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
  };
  if (ignoreId && mongoose.isValidObjectId(ignoreId)) query._id = { $ne: ignoreId };
  const conflict = await CalendarEvent.findOne(query).lean();
  if (conflict) {
    throw ApiError.conflict('Ce creneau chevauche deja un evenement du calendrier', {
      code: 'CALENDAR_OVERLAP',
      conflict: publicEvent(conflict),
    });
  }
  const generated = await generatedFormationEvents(startsAt, endsAt);
  const ignoredProduct = ignoreProductId ? String(ignoreProductId) : null;
  const generatedConflict = generated.find((event) => (
    event.status !== 'CANCELLED'
    && (!ignoreId || event.id !== ignoreId)
    && (!ignoredProduct || String(event.productId) !== ignoredProduct)
  ));
  if (generatedConflict) {
    throw ApiError.conflict('Ce creneau chevauche deja une session de formation', {
      code: 'CALENDAR_OVERLAP',
      conflict: generatedConflict,
    });
  }
}

export async function createEvent(payload) {
  const startsAt = asDate(payload.startsAt, 'Debut');
  const endsAt = asDate(payload.endsAt, 'Fin');
  assertRange(startsAt, endsAt);
  await assertNoOverlap({ startsAt, endsAt });
  const totalCents = Number(payload.paymentSnapshot?.totalCents || 0);
  const paidCents = Number(payload.paymentSnapshot?.paidCents || payload.paymentSnapshot?.depositCents || 0);
  const event = await CalendarEvent.create({
    type: payload.type || 'MANUAL_BLOCK',
    title: payload.title || (payload.type === 'MANUAL_BLOCK' ? 'Blocage manuel' : 'Rendez-vous'),
    productId: payload.productId || null,
    saleId: payload.saleId || null,
    lineId: payload.lineId || '',
    customerSnapshot: payload.customerSnapshot || {},
    startsAt,
    endsAt,
    status: payload.status || 'SCHEDULED',
    paymentSnapshot: {
      totalCents,
      paidCents,
      depositCents: Number(payload.paymentSnapshot?.depositCents || paidCents || 0),
      balanceDueCents: Math.max(0, totalCents - paidCents),
      balancePaidCents: Number(payload.paymentSnapshot?.balancePaidCents || 0),
      currency: 'EUR',
      balancePaymentMethod: payload.paymentSnapshot?.balancePaymentMethod || '',
    },
    notes: payload.notes || '',
    source: payload.source || {},
  });
  return publicEvent(event.toObject());
}

export async function updateEvent(id, payload) {
  const event = await CalendarEvent.findById(id);
  if (!event) throw ApiError.notFound('Evenement introuvable');
  const startsAt = payload.startsAt ? asDate(payload.startsAt, 'Debut') : event.startsAt;
  const endsAt = payload.endsAt ? asDate(payload.endsAt, 'Fin') : event.endsAt;
  assertRange(startsAt, endsAt);
  if (event.status !== 'CANCELLED') await assertNoOverlap({ startsAt, endsAt, ignoreId: id });
  event.title = payload.title ?? event.title;
  event.startsAt = startsAt;
  event.endsAt = endsAt;
  event.customerSnapshot = payload.customerSnapshot ?? event.customerSnapshot;
  event.notes = payload.notes ?? event.notes;
  if (payload.paymentSnapshot) {
    const totalCents = Number(payload.paymentSnapshot.totalCents ?? event.paymentSnapshot.totalCents ?? 0);
    const paidCents = Number(payload.paymentSnapshot.paidCents ?? event.paymentSnapshot.paidCents ?? 0);
    event.paymentSnapshot = {
      ...event.paymentSnapshot,
      ...payload.paymentSnapshot,
      totalCents,
      paidCents,
      balanceDueCents: Math.max(0, totalCents - paidCents - Number(payload.paymentSnapshot.balancePaidCents || event.paymentSnapshot.balancePaidCents || 0)),
    };
  }
  await event.save();
  return publicEvent(event.toObject());
}

export async function cancelEvent(id, payload = {}) {
  const event = await CalendarEvent.findById(id);
  if (!event) throw ApiError.notFound('Evenement introuvable');
  event.status = 'CANCELLED';
  event.cancellation = {
    reason: String(payload.reason || '').trim(),
    cancelledAt: new Date(),
    refundedCents: Number(payload.refundedCents || event.cancellation?.refundedCents || 0),
    refundedAt: payload.refundedCents ? new Date() : event.cancellation?.refundedAt || null,
  };
  await event.save();
  const customerId = event.customerSnapshot?.customerId || event.customerSnapshot?.id || event.customerId || null;
  if (customerId) {
    await emitAndDispatch({
      type: 'appointment.cancelled',
      entityType: 'CalendarEvent',
      entityId: event._id,
      payloadSafe: {
        calendarEventId: String(event._id),
        customerId: String(customerId),
        appointmentTitle: event.title || 'Rendez-vous',
        appointmentStart: event.startsAt.toISOString(),
        appointmentEnd: event.endsAt.toISOString(),
        refundedAmount: Number(event.cancellation.refundedCents || 0),
        reason: event.cancellation.reason || '',
        cancelledAt: event.cancellation.cancelledAt.toISOString(),
      },
      idempotencyKey: `appointment-cancelled:${event._id}:${event.cancellation.cancelledAt.getTime()}`,
    });
  }
  return publicEvent(event.toObject());
}

export async function recordBalancePayment(id, payload = {}) {
  const event = await CalendarEvent.findById(id);
  if (!event) throw ApiError.notFound('Evenement introuvable');
  const amount = Number(payload.amountCents || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw ApiError.badRequest('Montant invalide');
  const balancePaidCents = Number(event.paymentSnapshot.balancePaidCents || 0) + amount;
  const paidCents = Number(event.paymentSnapshot.paidCents || 0) + amount;
  event.paymentSnapshot.balancePaidCents = balancePaidCents;
  event.paymentSnapshot.paidCents = paidCents;
  event.paymentSnapshot.balanceDueCents = Math.max(0, Number(event.paymentSnapshot.totalCents || 0) - paidCents);
  event.paymentSnapshot.balancePaymentMethod = String(payload.method || event.paymentSnapshot.balancePaymentMethod || 'ON_SITE');
  await event.save();
  return publicEvent(event.toObject());
}
