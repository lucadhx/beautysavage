import mongoose from 'mongoose';
import { BookingSchedule } from '../models/BookingSchedule.model.js';
import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { Cart } from '../models/Cart.model.js';
import { CommerceProduct, PRODUCT_STATUS } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { ApiError } from '../utils/ApiError.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { emitAppointmentBooked, ensureCustomerForBooking } from './commerceCustomer.service.js';
import { bookingDurationMinutes } from './bookingDuration.js';
import { loadSequence, sequenceMinutes, sequenceSegments } from './bookingSequence.js';
import { withCalendarLock } from './calendarLock.js';

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
  if (endsAt <= startsAt) throw ApiError.badRequest('La fin doit être après le début');
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

/**
 * Les plages réelles d'une session : un bloc par jour. Une session d'avant
 * (sans `days`) n'a qu'un bloc, de son début à sa fin.
 */
export function sessionBlocks(session) {
  const days = (session?.days || []).filter((d) => d?.startsAt && d?.endsAt);
  if (days.length) return days.map((d) => ({ startsAt: new Date(d.startsAt), endsAt: new Date(d.endsAt) }));
  return session?.startsAt && session?.endsAt ? [{ startsAt: new Date(session.startsAt), endsAt: new Date(session.endsAt) }] : [];
}

/** Identifiant d'événement d'une session (préfixe commun à tous ses jours). */
export function sessionEventId(productId, sessionId) {
  return `${productId}:${sessionId}`;
}

function sameSession(eventId, ignoreId) {
  return Boolean(ignoreId) && (eventId === ignoreId || String(eventId).startsWith(`${ignoreId}:`));
}

async function generatedFormationEvents(from, to) {
  const products = await CommerceProduct.find({
    kind: 'IN_PERSON_TRAINING',
    'sessions.startsAt': { $lt: to },
    'sessions.endsAt': { $gt: from },
  }).lean();
  return products.flatMap((product) => (product.sessions || [])
    .filter((session) => session.startsAt && session.endsAt && new Date(session.startsAt) < to && new Date(session.endsAt) > from)
    .flatMap((session) => {
      const blocks = sessionBlocks(session);
      return blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block.startsAt < to && block.endsAt > from)
        .map(({ block, index }) => ({
          id: blocks.length > 1 ? `${sessionEventId(product._id, session._id)}:${index + 1}` : sessionEventId(product._id, session._id),
          type: 'FORMATION_SESSION',
          title: blocks.length > 1 ? `${product.title} · jour ${index + 1}/${blocks.length}` : product.title,
          productId: String(product._id),
          saleId: null,
          lineId: '',
          customerSnapshot: {},
          startsAt: block.startsAt,
          endsAt: block.endsAt,
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
          source: { generatedFrom: 'commerceProduct.sessions', sessionId: String(session._id), dayIndex: index + 1, dayCount: blocks.length },
          capacity: session.capacity || 0,
          reservedCount: session.reservedCount || 0,
          sessionId: String(session._id),
          dayIndex: index + 1,
          dayCount: blocks.length,
          location: product.training?.location || '',
        }));
    }));
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
    ...activeHoldFilter(),
  }).sort({ startsAt: 1 }).lean();
  const generated = await generatedFormationEvents(from, to);
  return [...stored.map(publicEvent), ...generated].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function minutesOf(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * L'HEURE DE L'INSTITUT, PAS CELLE DU SERVEUR.
 *
 * Les horaires d'ouverture (« 09:00 - 12:00 ») sont des heures de PARIS. Le
 * calcul utilisait l'heure locale du processus : juste sur le poste de
 * développement, fausse sur le serveur (UTC), où le premier créneau d'un matin
 * tombait à 11 h, heure de Paris, et le dernier après la fermeture. Tout est
 * désormais calculé dans le fuseau du planning (`schedule.timezone`).
 */
function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Heure murale (jour du calendrier + minutes depuis minuit) dans `timeZone` -> instant UTC. */
export function zonedWallTime(year, month, day, minutes, timeZone) {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let instant = guess;
  // Deux passes : la seconde corrige un changement d'heure (été / hiver) le jour même.
  for (let pass = 0; pass < 2; pass += 1) {
    const p = zonedParts(new Date(instant), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant;
    instant = guess - offset;
  }
  return new Date(instant);
}

/**
 * LA DURÉE À CHERCHER. Quand la vitrine nomme la prestation (et ses options),
 * c'est la fiche qui fait foi — la même règle que l'ajout au panier et le
 * paiement (`bookingDuration.js`). Le nombre de minutes envoyé par le
 * navigateur n'est qu'un repli pour les appels qui ne nomment rien.
 */
async function availabilityDuration(query) {
  if (query.productId && mongoose.isValidObjectId(query.productId)) {
    const product = await CommerceProduct.findOne({ _id: query.productId, status: PRODUCT_STATUS.PUBLISHED })
      .select('durationMinutes options').lean();
    if (product) return bookingDurationMinutes(product, query.optionKeys || query.options || '');
  }
  return Math.max(5, Number(query.durationMinutes || 60));
}

/**
 * LES AUTRES PRESTATIONS DU PANIER DE LA CLIENTE. Elles ne sont pas encore au
 * planning (rien n'est payé), mais elles ne peuvent pas avoir lieu en même temps
 * que la ligne dont elle choisit l'heure. Sans elles, le calendrier proposait
 * l'heure même de sa pédicure pour l'option de cette pédicure.
 */
async function cartBusy(customerId, cartLineId, cartGroupId) {
  if (!customerId || (!cartLineId && !cartGroupId)) return [];
  const cart = await Cart.findOne({ customerId }).select('lines._id lines.bookingSnapshot').lean();
  // La ligne (ou l'enchaînement) dont on choisit l'heure ne se bloque pas elle-même.
  const self = (line) => String(line._id) === String(cartLineId || '')
    || (cartGroupId && String(line.bookingSnapshot?.groupId || '') === String(cartGroupId));
  return (cart?.lines || [])
    .filter((line) => !self(line) && line.bookingSnapshot?.startsAt && line.bookingSnapshot?.endsAt)
    .map((line) => ({ startsAt: new Date(line.bookingSnapshot.startsAt), endsAt: new Date(line.bookingSnapshot.endsAt) }));
}

export async function listAvailability(query = {}, { customerId = null } = {}) {
  const from = asDate(query.from || new Date(), 'Date de debut');
  const to = asDate(query.to || new Date(Date.now() + 14 * 86400_000), 'Date de fin');
  assertRange(from, to);
  // Plusieurs prestations à la suite : la durée cherchée est leur somme.
  const sequence = query.sequence ? await loadSequence(query.sequence) : null;
  const durationMinutes = sequence ? sequenceMinutes(sequence) : await availabilityDuration(query);
  const bufferAfterMinutes = Math.max(0, Number(query.bufferAfterMinutes || 0));
  const schedule = await getSchedule();
  const timeZone = schedule.timezone || 'Europe/Paris';
  const step = Math.max(5, Number(schedule.slotStepMinutes || 15));
  /*
    Une journée de marge AVANT la fenêtre : un rendez-vous qui finit pile à
    son début (« ajouter juste après » cherche à partir de 12:25, fin du
    rendez-vous) n'y déborde pas, et son heure de fin — LE départ cherché —
    disparaissait des heures proposées.
  */
  const events = await listEvents({ from: new Date(from.getTime() - 86400_000).toISOString(), to: to.toISOString() });
  // Sa PROPRE retenue (paiement quitté puis repris) ne ferme pas le créneau à
  // la cliente qui l'a posée : elle doit pouvoir réessayer. Pour toute autre
  // personne, le créneau reste pris jusqu'à l'échéance de la retenue.
  const owner = customerId ? String(customerId) : null;
  const busy = events.filter((event) => event.status !== 'CANCELLED')
    .filter((event) => !(owner && event.status === 'HELD' && String(event.customerSnapshot?.customerId || '') === owner))
    .map((event) => ({ startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) }))
    .concat(await cartBusy(owner, query.cartLineId, query.cartGroupId));

  /*
    LA FIN D'UN RENDEZ-VOUS EST UNE HEURE DE DÉPART. La grille part de
    l'ouverture, de `step` en `step` : un soin de 40 min commencé à 14:00 finit
    à 14:40, hors grille — le suivant ne pouvait démarrer qu'à 14:45, cinq
    minutes de trou imposées. Chaque fin de rendez-vous du jour rejoint donc les
    heures proposées.
  */
  const endsByDay = new Map();
  for (const event of busy) {
    const p = zonedParts(event.endsAt, timeZone);
    const key = `${p.year}-${p.month}-${p.day}`;
    endsByDay.set(key, [...(endsByDay.get(key) || []), p.hour * 60 + p.minute]);
  }

  const slots = [];
  const first = zonedParts(from, timeZone);
  const days = Math.ceil((to.getTime() - from.getTime()) / 86400_000) + 1;
  for (let offset = 0; offset <= days; offset += 1) {
    // Le jour du CALENDRIER de l'institut, calculé sans fuseau pour ne jamais sauter un jour.
    const calendarDay = new Date(Date.UTC(first.year, first.month - 1, first.day + offset));
    const [year, month, day] = [calendarDay.getUTCFullYear(), calendarDay.getUTCMonth() + 1, calendarDay.getUTCDate()];
    const weekday = calendarDay.getUTCDay() || 7;
    const dayRule = (schedule.weeklyHours || []).find((rule) => rule.weekday === weekday);
    if (!dayRule?.enabled) continue;
    const dayEnds = endsByDay.get(`${year}-${month}-${day}`) || [];
    for (const range of dayRule.ranges || []) {
      const startMinute = minutesOf(range.start);
      const endMinute = minutesOf(range.end);
      const grid = [];
      for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += step) grid.push(minute);
      const candidates = [...new Set([...grid, ...dayEnds.filter((m) => m > startMinute && m + durationMinutes <= endMinute)])]
        .sort((a, b) => a - b);
      for (const minute of candidates) {
        const startsAt = zonedWallTime(year, month, day, minute, timeZone);
        const endsAt = new Date(startsAt.getTime() + (durationMinutes + bufferAfterMinutes) * 60_000);
        if (startsAt < from || endsAt > to) continue;
        const overlap = busy.some((event) => startsAt < event.endsAt && endsAt > event.startsAt);
        if (!overlap) {
          slots.push({
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000).toISOString(),
            reservableEndsAt: endsAt.toISOString(),
            durationMinutes,
            // Enchaînement : l'heure de chaque prestation, l'une après l'autre.
            ...(sequence ? {
              segments: sequenceSegments(startsAt, sequence).map((s) => ({
                productId: s.productId, title: s.title, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), durationMinutes: s.durationMinutes,
              })),
            } : {}),
          });
        }
      }
    }
  }
  return slots;
}

/**
 * Un créneau RETENU (paiement en cours) occupe le planning jusqu'à son
 * échéance ; passé celle-ci il n'existe plus, même avant le ménage.
 */
export function activeHoldFilter(now = new Date()) {
  return { $or: [{ status: { $ne: 'HELD' } }, { holdExpiresAt: { $gt: now } }] };
}

export async function assertNoOverlap({ startsAt, endsAt, ignoreId = null, ignoreProductId = null, ignoreSaleId = null, ignoreHoldsOf = null }) {
  const query = {
    status: { $ne: 'CANCELLED' },
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
    ...activeHoldFilter(),
  };
  // Les retenues de CETTE cliente ne la bloquent pas : elle reprend un
  // paiement qu'elle avait quitté (la nouvelle commande remplacera la retenue).
  if (ignoreHoldsOf) query.$nor = [{ status: 'HELD', 'customerSnapshot.customerId': String(ignoreHoldsOf) }];
  // La retenue de CETTE vente ne gêne pas sa propre confirmation.
  if (ignoreSaleId) query['source.saleId'] = { $ne: String(ignoreSaleId) };
  if (ignoreId && mongoose.isValidObjectId(ignoreId)) query._id = { $ne: ignoreId };
  const conflict = await CalendarEvent.findOne(query).lean();
  if (conflict) {
    throw ApiError.conflict('Ce créneau chevauche déjà un événement du calendrier', {
      code: 'CALENDAR_OVERLAP',
      // L'échéance d'une retenue : la vitrine peut dire « se libère au plus tard à … ».
      conflict: publicEvent(conflict, { holdExpiresAt: conflict.holdExpiresAt || null }),
    });
  }
  const generated = await generatedFormationEvents(startsAt, endsAt);
  const ignoredProduct = ignoreProductId ? String(ignoreProductId) : null;
  const generatedConflict = generated.find((event) => (
    event.status !== 'CANCELLED'
    && !sameSession(event.id, ignoreId)
    && (!ignoredProduct || String(event.productId) !== ignoredProduct)
  ));
  if (generatedConflict) {
    throw ApiError.conflict('Ce créneau chevauche déjà une session de formation', {
      code: 'CALENDAR_OVERLAP',
      conflict: generatedConflict,
    });
  }
}

export async function createEvent(payload) {
  // Vérifier puis écrire sous verrou ; l'e-mail de confirmation part une fois le verrou rendu.
  const { event, accountCreated } = await withCalendarLock(() => createEventLocked(payload));
  await emitAppointmentBooked(event, { origin: 'MANAGER' });
  return publicEvent(event.toObject(), { customerAccountCreated: accountCreated });
}

async function createEventLocked(payload) {
  const startsAt = asDate(payload.startsAt, 'Debut');
  /*
    Réservation d'une prestation sans heure de fin : le créneau court sur la
    durée de la fiche prestation, à partir de l'heure choisie.
  */
  if (!payload.endsAt && payload.productId && (payload.type || 'MANUAL_BLOCK') === 'SERVICE_BOOKING') {
    const product = await CommerceProduct.findById(payload.productId).select('durationMinutes').lean();
    const minutes = Math.max(5, Number(product?.durationMinutes || 60));
    payload = { ...payload, endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString() };
  }
  const endsAt = asDate(payload.endsAt, 'Fin');
  assertRange(startsAt, endsAt);
  await assertNoOverlap({ startsAt, endsAt });
  const type = payload.type || 'MANUAL_BLOCK';
  const totalCents = Number(payload.paymentSnapshot?.totalCents || 0);
  const paidCents = Number(payload.paymentSnapshot?.paidCents || payload.paymentSnapshot?.depositCents || 0);

  /**
   * RÉSERVATION MANUELLE : l'adresse saisie désigne un compte client, créé
   * s'il n'existe pas. C'est ce qui donne un propriétaire au rendez-vous — son
   * espace client, sa confirmation, et plus tard son message d'annulation.
   */
  const snapshot = { ...(payload.customerSnapshot || {}) };
  let accountCreated = false;
  if (type === 'SERVICE_BOOKING' && snapshot.email) {
    const { customer, created } = await ensureCustomerForBooking({
      email: snapshot.email,
      name: snapshot.name,
      phone: snapshot.phone,
    });
    if (customer) {
      accountCreated = created;
      snapshot.customerId = String(customer._id);
      snapshot.email = customer.email;
      snapshot.name = snapshot.name || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email;
      snapshot.phone = snapshot.phone || customer.phone || '';
    }
  }

  const event = await CalendarEvent.create({
    type,
    title: payload.title || (type === 'MANUAL_BLOCK' ? 'Blocage manuel' : 'Rendez-vous'),
    productId: payload.productId || null,
    saleId: payload.saleId || null,
    lineId: payload.lineId || '',
    customerSnapshot: snapshot,
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
  return { event, accountCreated };
}

/**
 * LA FICHE D'UNE SESSION DE FORMATION — ce que l'institut doit savoir en
 * cliquant dessus dans le planning : qui vient, combien de places restent, où.
 *
 * Les inscrites sont les lignes PAYÉES qui visent cette session précise ; le
 * compteur de la fiche formation n'est affiché qu'à côté, pour que l'écart
 * éventuel (inscription saisie à la main) reste visible au lieu d'être masqué.
 */
export async function getFormationSession(productId, sessionId) {
  if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(sessionId)) {
    throw ApiError.badRequest('Session de formation invalide');
  }
  const product = await CommerceProduct.findById(productId).lean();
  const session = product?.sessions?.find((item) => String(item._id) === String(sessionId));
  if (!product || !session) throw ApiError.notFound('Session de formation introuvable');

  const sales = await CommerceSale.find({
    paymentStatus: 'PAID',
    lines: { $elemMatch: { productId: product._id, sessionId: session._id } },
  })
    .populate('customerId', 'email firstName lastName phone')
    .sort({ finalizedAt: 1, createdAt: 1 })
    .lean();

  const participants = sales.flatMap((sale) => (sale.lines || [])
    .filter((line) => String(line.productId) === String(product._id) && String(line.sessionId) === String(session._id))
    .map((line) => {
      const customer = sale.customerId && typeof sale.customerId === 'object' ? sale.customerId : null;
      return {
        customerId: customer ? String(customer._id) : String(sale.customerId || ''),
        name: customer ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email : 'Cliente',
        email: customer?.email || '',
        phone: customer?.phone || '',
        seats: Number(line.quantity || 1),
        paidCents: Number(line.totalCents || 0),
        // Inscription à acompte : le prix de la formation et le solde restant.
        totalCents: Number(line.fullTotalCents ?? line.totalCents ?? 0),
        balanceDueCents: Number(line.balanceDueCents || 0),
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
        registeredAt: sale.finalizedAt || sale.createdAt,
      };
    }));

  const seatsTaken = participants.reduce((sum, row) => sum + row.seats, 0);
  return {
    product: {
      id: String(product._id),
      title: product.title,
      kind: product.kind,
      priceCents: product.price?.amountCents || 0,
      location: product.training?.location || '',
      durationDays: product.training?.durationDays || null,
      formalities: product.training?.formalities || '',
    },
    session: {
      id: String(session._id),
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      capacity: Number(session.capacity || 0),
      reservedCount: Number(session.reservedCount || 0),
      cancellationReason: session.cancellationReason || '',
    },
    participants,
    seatsTaken,
    seatsLeft: Math.max(0, Number(session.capacity || 0) - Math.max(seatsTaken, Number(session.reservedCount || 0))),
    revenueCents: participants.reduce((sum, row) => sum + row.paidCents, 0),
    balanceDueCents: participants.reduce((sum, row) => sum + row.balanceDueCents, 0),
  };
}

export async function updateEvent(id, payload) {
  return withCalendarLock(() => updateEventLocked(id, payload));
}

async function updateEventLocked(id, payload) {
  const event = await CalendarEvent.findById(id);
  if (!event) throw ApiError.notFound('Événement introuvable');
  const startsAt = payload.startsAt ? asDate(payload.startsAt, 'Debut') : event.startsAt;
  const endsAt = payload.endsAt ? asDate(payload.endsAt, 'Fin') : event.endsAt;
  assertRange(startsAt, endsAt);
  if (event.status !== 'CANCELLED') await assertNoOverlap({ startsAt, endsAt, ignoreId: id });
  event.title = payload.title ?? event.title;
  event.startsAt = startsAt;
  event.endsAt = endsAt;
  if (payload.productId !== undefined) event.productId = payload.productId || null;
  // Fusion, pas remplacement : le lien au compte client (`customerId`) reste.
  if (payload.customerSnapshot) event.customerSnapshot = { ...(event.customerSnapshot || {}), ...payload.customerSnapshot };
  event.markModified('customerSnapshot');
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
  if (!event) throw ApiError.notFound('Événement introuvable');
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
  if (!event) throw ApiError.notFound('Événement introuvable');
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
