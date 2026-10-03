import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { GiftCard } from '../models/GiftCard.model.js';
import { RefundRequest } from '../models/RefundRequest.model.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { assertNoOverlap, minutesOf, sessionBlocks, sessionEventId, zonedWallTime } from './calendar.service.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { refundInstitutePayment } from './instituteStripe.service.js';

/**
 * LES SESSIONS D'UNE FORMATION PRÉSENTIELLE — leurs propres opérations.
 *
 * Elles ne passent plus par l'enregistrement de la fiche : une session peut
 * avoir des inscrites, et la déplacer ou l'annuler n'est pas « modifier un
 * champ ». Chaque opération sait qui est concerné, prévient chacune, et —
 * pour une annulation — rembourse ce qui a été payé.
 */

function asDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw ApiError.badRequest(`${label} invalide`);
  return date;
}

async function loadSession(productId, sessionId) {
  if (!mongoose.isValidObjectId(productId) || !mongoose.isValidObjectId(sessionId)) {
    throw ApiError.badRequest('Session de formation invalide');
  }
  const product = await CommerceProduct.findById(productId);
  if (!product || product.kind !== 'IN_PERSON_TRAINING') throw ApiError.notFound('Formation presentielle introuvable');
  const session = product.sessions.id(sessionId);
  if (!session) throw ApiError.notFound('Session introuvable');
  return { product, session };
}

/** Les lignes PAYÉES qui visent cette session, avec leur vente. */
async function sessionLines(product, session) {
  const sales = await CommerceSale.find({
    paymentStatus: 'PAID',
    lines: { $elemMatch: { productId: product._id, sessionId: session._id } },
  });
  return sales.flatMap((sale) => sale.lines
    .filter((line) => String(line.productId) === String(product._id) && String(line.sessionId) === String(session._id))
    .map((line) => ({ sale, line })));
}

const TIME_ZONE = 'Europe/Paris';
const DEFAULT_DAY_HOURS = { start: '09:00', end: '17:00' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * LE MODÈLE D'HORAIRES DE LA FORMATION — un créneau par jour de formation.
 *
 * « Durée (jours) » de la fiche donne le nombre de jours ; l'onglet
 * « Horaires » règle chaque jour (`training.dayHours[i]`). Un jour sans
 * horaire propre reprend celui du jour précédent, et le premier 9:00-17:00.
 */
export function formationDayTemplate(product) {
  const count = Math.min(14, Math.max(1, Math.round(Number(product?.training?.durationDays) || 1)));
  const saved = Array.isArray(product?.training?.dayHours) ? product.training.dayHours : [];
  const days = [];
  for (let i = 0; i < count; i += 1) {
    const own = saved[i];
    const valid = own && HHMM.test(own.start) && HHMM.test(own.end) && minutesOf(own.end) > minutesOf(own.start);
    days.push(valid ? { start: own.start, end: own.end } : (days[i - 1] || DEFAULT_DAY_HOURS));
  }
  return days;
}

function dayLabel(date) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: '2-digit' }).format(date);
}

/**
 * LES JOURS D'UNE SESSION, à partir de ce que le Manager envoie :
 *   - `days` : les plages exactes (jour 1, jour 2…), déjà calculées ;
 *   - `day`  : la date du JOUR 1 (AAAA-MM-JJ) → les jours suivants
 *              s'enchaînent, aux horaires du modèle de la fiche ;
 *   - `startsAt` / `endsAt` : l'ancienne forme, une seule plage.
 */
function buildSessionDays(product, payload = {}) {
  if (Array.isArray(payload.days) && payload.days.length) {
    const days = payload.days.map((d, i) => ({ startsAt: asDate(d.startsAt, `Debut du jour ${i + 1}`), endsAt: asDate(d.endsAt, `Fin du jour ${i + 1}`) }))
      .sort((a, b) => a.startsAt - b.startsAt);
    days.forEach((d, i) => {
      if (d.endsAt <= d.startsAt) throw ApiError.badRequest(`Jour ${i + 1} : la fin doit etre apres le debut`);
      if (i > 0 && d.startsAt < days[i - 1].endsAt) throw ApiError.badRequest(`Jour ${i + 1} : chevauche le jour ${i}`);
    });
    return days;
  }
  const dayText = payload.day || (payload.startsAt && !payload.endsAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(asDate(payload.startsAt, 'Debut'))
    : null);
  if (dayText) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayText));
    if (!match) throw ApiError.badRequest('Jour 1 invalide');
    const [year, month, day] = match.slice(1).map(Number);
    return formationDayTemplate(product).map((hours, i) => {
      const calendarDay = new Date(Date.UTC(year, month - 1, day + i));
      const [y, m, d] = [calendarDay.getUTCFullYear(), calendarDay.getUTCMonth() + 1, calendarDay.getUTCDate()];
      return {
        startsAt: zonedWallTime(y, m, d, minutesOf(hours.start), TIME_ZONE),
        endsAt: zonedWallTime(y, m, d, minutesOf(hours.end), TIME_ZONE),
      };
    });
  }
  const startsAt = asDate(payload.startsAt, 'Debut');
  const endsAt = asDate(payload.endsAt, 'Fin');
  if (endsAt <= startsAt) throw ApiError.badRequest('La fin doit etre apres le debut');
  return [{ startsAt, endsAt }];
}

/**
 * Chaque JOUR de la session est libre : ni rendez-vous, ni autre session —
 * de cette formation comme des autres. Un conflit dit quel jour coince.
 */
async function assertSlotFree(product, days, ignoreSessionId = null) {
  const ignoreId = ignoreSessionId ? sessionEventId(product._id, ignoreSessionId) : null;
  for (let i = 0; i < days.length; i += 1) {
    try {
      await assertNoOverlap({ startsAt: days[i].startsAt, endsAt: days[i].endsAt, ignoreId });
    } catch (err) {
      if (days.length > 1 && err?.message) err.message = `Jour ${i + 1} (${dayLabel(days[i].startsAt)}) : ${err.message}`;
      throw err;
    }
  }
}

export async function createSession(productId, payload = {}) {
  const product = await CommerceProduct.findById(productId);
  if (!product || product.kind !== 'IN_PERSON_TRAINING') throw ApiError.notFound('Formation presentielle introuvable');
  const days = buildSessionDays(product, payload);
  await assertSlotFree(product, days);
  const capacity = Math.max(1, Math.round(Number(payload.capacity || 6)));
  product.sessions.push({
    startsAt: days[0].startsAt,
    endsAt: days.at(-1).endsAt,
    days: days.length > 1 ? days : [],
    capacity,
    reservedCount: 0,
    status: 'ACTIVE',
  });
  await product.save();
  return product.sessions.at(-1);
}

/**
 * MODIFIER une session : horaires, capacité, statut d'ouverture.
 *
 * Un DÉPLACEMENT d'une session qui a des inscrites les prévient, chacune, de
 * la nouvelle date (`formation.session.rescheduled`). La capacité ne descend
 * jamais sous le nombre de places déjà vendues.
 */
export async function updateSession(productId, sessionId, payload = {}) {
  const { product, session } = await loadSession(productId, sessionId);
  if (session.status === 'CANCELLED') throw ApiError.conflict('Session annulee : elle ne peut plus etre modifiee');
  const lines = await sessionLines(product, session);
  const seats = lines.reduce((sum, { line }) => sum + Number(line.quantity || 1), 0);
  const previous = { startsAt: session.startsAt, endsAt: session.endsAt };

  const wantsMove = Boolean(payload.day || (Array.isArray(payload.days) && payload.days.length) || payload.startsAt || payload.endsAt);
  const days = wantsMove
    ? buildSessionDays(product, payload.startsAt && !payload.endsAt && !payload.day && !payload.days
      ? { startsAt: payload.startsAt, endsAt: session.endsAt }
      : payload)
    : sessionBlocks(session);
  const startsAt = days[0].startsAt;
  const endsAt = days.at(-1).endsAt;
  const before = sessionBlocks(session).map((d) => `${d.startsAt.getTime()}-${d.endsAt.getTime()}`).join('|');
  const moved = before !== days.map((d) => `${d.startsAt.getTime()}-${d.endsAt.getTime()}`).join('|');
  if (moved) await assertSlotFree(product, days, session._id);

  if (payload.capacity !== undefined) {
    const capacity = Math.round(Number(payload.capacity));
    if (!Number.isFinite(capacity) || capacity < 1) throw ApiError.badRequest('Capacite invalide');
    if (capacity < Math.max(seats, session.reservedCount || 0)) {
      throw ApiError.conflict(`Capacite inferieure aux ${Math.max(seats, session.reservedCount || 0)} place(s) deja reservee(s)`);
    }
    session.capacity = capacity;
  }
  if (payload.status && ['ACTIVE', 'FULL', 'BLOCKED'].includes(payload.status)) session.status = payload.status;
  session.startsAt = startsAt;
  session.endsAt = endsAt;
  session.days = days.length > 1 ? days : [];
  product.markModified('sessions');
  await product.save();

  let notified = 0;
  if (moved) {
    for (const { sale, line } of lines) {
      await emitAndDispatch({
        type: 'formation.session.rescheduled',
        entityType: 'CommerceSale',
        entityId: sale._id,
        payloadSafe: {
          saleId: String(sale._id),
          customerId: String(sale.customerId),
          productId: String(product._id),
          slotId: String(session._id),
          trainingTitle: String(product.title).slice(0, 180),
          location: String(product.training?.location || '').slice(0, 180),
          previousStart: new Date(previous.startsAt).toISOString(),
          previousEnd: new Date(previous.endsAt).toISOString(),
          newStart: startsAt.toISOString(),
          newEnd: endsAt.toISOString(),
          ...(payload.message ? { message: String(payload.message).slice(0, 600) } : {}),
          rescheduledAt: new Date().toISOString(),
        },
        idempotencyKey: `formation-session-rescheduled:${session._id}:${line._id}:${startsAt.getTime()}`,
      });
      notified += 1;
    }
  }
  return { session, moved, participantsNotified: notified };
}

/**
 * Rembourse UNE ligne : d'abord la part payée par carte bancaire (Stripe
 * Institut), puis le reste en recréditant la ou les cartes cadeaux utilisées.
 * Chaque remboursement laisse une demande REMBOURSÉE, visible dans la page
 * Remboursements — l'institut garde la trace de ce qui a été rendu.
 */
async function refundLine(sale, line, { reason, userId }) {
  const amount = Number(line.totalCents || 0);
  if (amount <= 0) return 0;
  const alreadyRefunded = (await RefundRequest.find({ saleId: sale._id, status: 'REFUNDED' }).lean())
    .reduce((sum, r) => sum + Number(r.refundedAmountCents || 0), 0);
  const stripePaid = Math.max(0, Number(sale.stripeAmountCents || 0) - alreadyRefunded);
  const stripePart = Math.min(amount, stripePaid);
  let refundedStripe = 0;
  let stripeRefundId = '';
  if (stripePart > 0 && sale.stripe?.paymentIntentId && sale.stripe.paymentIntentId !== 'gift_card_only') {
    const refund = await refundInstitutePayment({ paymentIntentId: sale.stripe.paymentIntentId, amountCents: stripePart, reason, saleId: sale._id });
    stripeRefundId = refund?.id || '';
    refundedStripe = stripePart;
  }
  let remaining = amount - refundedStripe;
  let recredited = 0;
  for (const allocation of sale.giftCardAllocations || []) {
    if (remaining <= 0) break;
    const card = await GiftCard.findById(allocation.giftCardId);
    if (!card) continue;
    const credit = Math.min(remaining, Number(allocation.amountCents || 0));
    if (credit <= 0) continue;
    const before = card.balanceCents;
    card.balanceCents = before + credit;
    card.status = 'ACTIVE';
    card.ledger.push({
      type: 'CREDIT',
      amountCents: credit,
      balanceBeforeCents: before,
      balanceAfterCents: card.balanceCents,
      source: 'SESSION_CANCELLED',
      reason: `Annulation de session - ${sale.saleNumber}`,
      actorUserId: userId,
      idempotencyKey: `session-cancel:${sale._id}:${line._id}:${card._id}`,
    });
    await card.save();
    remaining -= credit;
    recredited += credit;
  }
  const refunded = refundedStripe + recredited;
  await RefundRequest.create({
    customerId: sale.customerId,
    saleId: sale._id,
    lineId: line._id,
    status: 'REFUNDED',
    requestedAmountCents: amount,
    eligibleAmountCents: amount,
    refundedAmountCents: refunded,
    reason,
    managerComment: `Session annulee par l'institut.${stripeRefundId ? ` Remboursement Stripe ${stripeRefundId}.` : ''}${recredited ? ` Carte cadeau recreditee de ${(recredited / 100).toFixed(2)} EUR.` : ''}`,
    paymentAllocationSnapshot: { stripeCents: refundedStripe, giftCardCents: recredited, currency: 'EUR' },
    idempotencyKey: `session-cancel:${sale._id}:${line._id}:${crypto.randomUUID()}`,
    actions: [{ action: 'REFUNDED', byUser: userId, comment: reason }],
  });
  return refunded;
}

/**
 * ANNULER une session. Ses inscrites sont prévenues une à une
 * (`formation.session.cancelled`) avec, selon le choix de l'institut, le
 * remboursement intégral de leur place ou aucun remboursement (report hors
 * plateforme, avoir négocié…). La session reste visible, barrée, pour
 * l'historique.
 */
export async function cancelSession(productId, sessionId, payload = {}, userId = null) {
  const { product, session } = await loadSession(productId, sessionId);
  if (session.status === 'CANCELLED') throw ApiError.conflict('Session deja annulee');
  const reason = String(payload.reason || '').trim();
  if (!reason) throw ApiError.badRequest('Un motif est obligatoire : il est transmis aux inscrites');
  const refundMode = payload.refundMode === 'NONE' ? 'NONE' : 'FULL';
  const lines = await sessionLines(product, session);

  session.status = 'CANCELLED';
  session.cancellationReason = reason;
  product.markModified('sessions');
  await product.save();

  const results = [];
  for (const { sale, line } of lines) {
    let refunded = 0;
    let refundError = '';
    if (refundMode === 'FULL') {
      try {
        refunded = await refundLine(sale, line, { reason, userId });
      } catch (err) {
        refundError = err instanceof Error ? err.message : 'Remboursement impossible';
        logger.error('[formation-session] remboursement en echec', { saleId: String(sale._id), error: refundError });
      }
    }
    await emitAndDispatch({
      type: 'formation.session.cancelled',
      entityType: 'CommerceSale',
      entityId: sale._id,
      payloadSafe: {
        saleId: String(sale._id),
        customerId: String(sale.customerId),
        productId: String(product._id),
        slotId: String(session._id),
        trainingTitle: String(product.title).slice(0, 180),
        sessionStart: new Date(session.startsAt).toISOString(),
        sessionEnd: new Date(session.endsAt).toISOString(),
        reason: reason.slice(0, 600),
        refundedAmount: Math.max(0, Math.round(refunded)),
        cancelledAt: new Date().toISOString(),
      },
      idempotencyKey: `formation-session-cancelled:${session._id}:${line._id}`,
    });
    results.push({ saleNumber: sale.saleNumber, customerId: String(sale.customerId), refundedCents: refunded, refundError });
  }
  return { session, refundMode, participants: results };
}

/** Supprimer n'est permis que pour une session SANS inscrite — sinon, on l'annule. */
export async function deleteSession(productId, sessionId) {
  const { product, session } = await loadSession(productId, sessionId);
  const lines = await sessionLines(product, session);
  if (lines.length > 0 || Number(session.reservedCount || 0) > 0) {
    throw ApiError.conflict('Cette session a des inscrites : annulez-la pour les prevenir et les rembourser');
  }
  session.deleteOne();
  await product.save();
  return { deleted: true };
}

export default { createSession, updateSession, cancelSession, deleteSession };
