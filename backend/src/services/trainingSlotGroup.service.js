import mongoose from 'mongoose';
import { TrainingSlotGroup } from '../models/TrainingSlotGroup.model.js';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { activeHoldFilter, generatedFormationEvents, sessionBlocks } from './calendar.service.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * CRÉNEAUX PARTAGÉS — plusieurs formations présentielles proposées sur la même
 * date ; la première RÉSERVÉE ET PAYÉE est retenue, les autres sont retirées.
 *
 * Garanties :
 *   · une seule gagnante — l'attribution est une écriture conditionnelle ;
 *   · pendant un paiement, le groupe est retenu pour cette vente seule
 *     (`hold`, même durée que la retenue des places) ;
 *   · un paiement tardif sur une perdante est remboursé intégralement et la
 *     cliente prévenue — jamais deux formations sur le même créneau ;
 *   · le planning reste bloqué pour les prestations, ouvert comme attribué.
 */

const now = () => new Date();
const id = (v) => String(v ?? '');

/* ───────────────────────────── Création ───────────────────────────── */

/**
 * Ce que chevauche le créneau d'une nouvelle session : un rendez-vous ou un
 * blocage (`blocking`, toujours refusé), et/ou des sessions d'AUTRES
 * formations présentielles (`sessions`, proposables en alternative).
 */
export async function inspectSessionSlot(product, days, { ignoreSessionId = null } = {}) {
  const sessions = new Map();
  for (const day of days) {
    const blocking = await CalendarEvent.findOne({
      status: { $ne: 'CANCELLED' },
      startsAt: { $lt: day.endsAt },
      endsAt: { $gt: day.startsAt },
      ...activeHoldFilter(),
    }).lean();
    if (blocking) return { blocking, sessions: [] };
    const generated = await generatedFormationEvents(day.startsAt, day.endsAt);
    for (const event of generated) {
      if (event.status === 'CANCELLED') continue;
      if (ignoreSessionId && id(event.sessionId) === id(ignoreSessionId)) continue;
      if (id(event.productId) === id(product._id)) return { blocking: event, sessions: [] };
      sessions.set(id(event.sessionId), { productId: id(event.productId), sessionId: id(event.sessionId), title: String(event.title).replace(/ · jour \d+\/\d+$/, '') });
    }
  }
  return { blocking: null, sessions: [...sessions.values()] };
}

/** Une session peut-elle rejoindre un créneau partagé ? Sinon, pourquoi. */
export async function assertSessionsCanShare(sessions) {
  let groupId = null;
  for (const s of sessions) {
    const product = await CommerceProduct.findById(s.productId).select('title sessions').lean();
    const session = product?.sessions?.find((x) => id(x._id) === id(s.sessionId));
    if (!session || session.status === 'CANCELLED') continue;
    if (session.slotGroupId) {
      const group = await TrainingSlotGroup.findById(session.slotGroupId).lean();
      if (group?.status === 'ASSIGNED') {
        throw ApiError.conflict(`Ce créneau est déjà attribué à « ${group.winner?.title || product.title} » : il n'accepte plus d'alternative.`, { code: 'SLOT_GROUP_ASSIGNED' });
      }
      if (group?.status === 'OPEN') {
        if (groupId && groupId !== id(group._id)) throw ApiError.conflict('Ce créneau chevauche deux groupes d’alternatives différents : choisissez une autre date.', { code: 'SLOT_GROUP_MIXED' });
        groupId = id(group._id);
        continue;
      }
    }
    if (Number(session.reservedCount || 0) > 0) {
      throw ApiError.conflict(`« ${product.title} » a déjà des inscrites sur ce créneau : il ne peut plus être proposé en alternative.`, { code: 'SLOT_ALREADY_BOOKED' });
    }
  }
  return groupId;
}

function spanOf(blocks) {
  return { startsAt: new Date(Math.min(...blocks.map((b) => b.startsAt.getTime()))), endsAt: new Date(Math.max(...blocks.map((b) => b.endsAt.getTime()))) };
}

/** Regroupe des sessions en un créneau partagé (crée le groupe ou l'agrandit). */
export async function linkSessions(members) {
  const resolved = [];
  const blocks = [];
  let groupId = null;
  for (const m of members) {
    const product = await CommerceProduct.findById(m.productId).select('title sessions').lean();
    const session = product?.sessions?.find((x) => id(x._id) === id(m.sessionId));
    if (!session) continue;
    if (session.slotGroupId) groupId = groupId || id(session.slotGroupId);
    resolved.push({ productId: product._id, sessionId: session._id, title: product.title });
    blocks.push(...sessionBlocks(session));
  }
  if (resolved.length < 2) return null;
  const span = spanOf(blocks);
  let group = groupId ? await TrainingSlotGroup.findById(groupId) : null;
  if (!group || group.status !== 'OPEN') {
    group = new TrainingSlotGroup({ status: 'OPEN', members: [], startsAt: span.startsAt, endsAt: span.endsAt });
  }
  for (const r of resolved) {
    if (!group.members.some((x) => id(x.sessionId) === id(r.sessionId))) group.members.push(r);
  }
  group.startsAt = new Date(Math.min(group.startsAt.getTime(), span.startsAt.getTime()));
  group.endsAt = new Date(Math.max(group.endsAt.getTime(), span.endsAt.getTime()));
  group.history.push({ at: now(), action: 'LINKED', detail: resolved.map((r) => r.title).join(' · ') });
  await group.save();
  for (const r of resolved) {
    await CommerceProduct.updateOne({ _id: r.productId, 'sessions._id': r.sessionId }, { $set: { 'sessions.$.slotGroupId': group._id } });
  }
  return group;
}

/**
 * Une session quitte le groupe (supprimée, ou annulée par l'institut tant que
 * le créneau est encore ouvert). Seule restante : le groupe est dissous.
 */
export async function detachSession(productId, sessionId) {
  const group = await TrainingSlotGroup.findOne({ 'members.sessionId': sessionId });
  if (!group || group.status !== 'OPEN') return null;
  group.members = group.members.filter((m) => id(m.sessionId) !== id(sessionId));
  await CommerceProduct.updateOne({ _id: productId, 'sessions._id': sessionId }, { $set: { 'sessions.$.slotGroupId': null } });
  if (group.members.length <= 1) {
    group.status = 'DISSOLVED';
    group.history.push({ at: now(), action: 'DISSOLVED', detail: 'Une seule formation restante' });
    for (const m of group.members) {
      await CommerceProduct.updateOne({ _id: m.productId, 'sessions._id': m.sessionId }, { $set: { 'sessions.$.slotGroupId': null } });
    }
  } else {
    group.history.push({ at: now(), action: 'DETACHED', detail: id(sessionId) });
  }
  await group.save();
  return group;
}

/* ─────────────────────────── Vente et retenue ─────────────────────────── */

function holdActive(group, at = now()) {
  return Boolean(group?.hold?.saleId && group.hold.expiresAt && new Date(group.hold.expiresAt) > at);
}

/**
 * La session est-elle réservable par cette cliente ? `null` si oui, sinon la
 * raison (code + message), à servir tel quel au site.
 */
export async function sessionBlockedReason(sessionId, customerId = null) {
  const group = await TrainingSlotGroup.findOne({ 'members.sessionId': sessionId }).lean();
  if (!group || group.status === 'DISSOLVED') return null;
  if (group.status === 'ASSIGNED') {
    return id(group.winner?.sessionId) === id(sessionId)
      ? null
      : { code: 'SESSION_SLOT_TAKEN', message: `Cette date a été attribuée à une autre formation (« ${group.winner?.title || 'formation'} »). Choisissez une autre session.` };
  }
  if (holdActive(group) && !(customerId && id(group.hold.customerId) === id(customerId))) {
    return { code: 'SESSION_SLOT_HELD', message: 'Cette date est en cours de réservation pour une autre formation. Revenez dans quelques minutes.', heldUntil: group.hold.expiresAt };
  }
  return null;
}

/** État public des sessions d'une fiche : partagée ? retenue par quelqu'un d'autre ? */
export async function publicSlotStates(sessionIds, customerId = null) {
  if (!sessionIds.length) return new Map();
  const groups = await TrainingSlotGroup.find({ 'members.sessionId': { $in: sessionIds }, status: { $ne: 'DISSOLVED' } }).lean();
  const out = new Map();
  for (const g of groups) {
    for (const m of g.members) {
      if (!sessionIds.some((s) => id(s) === id(m.sessionId))) continue;
      const held = g.status === 'OPEN' && holdActive(g) && !(customerId && id(g.hold.customerId) === id(customerId));
      out.set(id(m.sessionId), {
        shared: g.status === 'OPEN',
        alternatives: g.members.filter((x) => id(x.sessionId) !== id(m.sessionId)).map((x) => x.title),
        heldUntil: held ? g.hold.expiresAt : null,
      });
    }
  }
  return out;
}

/**
 * RETENUE EXCLUSIVE à l'ouverture d'un paiement. Pour chaque ligne de
 * formation dans un groupe ouvert : le groupe est retenu pour cette vente, ou
 * le paiement est refusé (retenu par une autre, déjà attribué, ou deux
 * alternatives du même créneau dans la même commande).
 */
export async function holdGroupsForSale(sale, holdExpiresAt) {
  const lines = (sale.lines || []).filter((l) => l.productSnapshot?.kind === 'IN_PERSON_TRAINING' && l.sessionId);
  const seen = new Map();
  for (const line of lines) {
    const group = await TrainingSlotGroup.findOne({ 'members.sessionId': line.sessionId }).lean();
    if (!group || group.status === 'DISSOLVED') continue;
    const previous = seen.get(id(group._id));
    if (previous && previous !== id(line.sessionId)) {
      throw ApiError.conflict('Deux formations de votre commande sont proposées sur le même créneau : une seule peut avoir lieu. Retirez-en une.', { code: 'SESSION_ALTERNATIVES_IN_CART', lineId: id(line._id) });
    }
    seen.set(id(group._id), id(line.sessionId));
    if (group.status === 'ASSIGNED') {
      if (id(group.winner?.sessionId) === id(line.sessionId)) continue;
      throw ApiError.conflict(`Cette date vient d'être attribuée à une autre formation (« ${group.winner?.title || 'formation'} »). Choisissez une autre session.`, { code: 'SESSION_SLOT_TAKEN', lineId: id(line._id) });
    }
    const at = now();
    const taken = await TrainingSlotGroup.findOneAndUpdate(
      {
        _id: group._id,
        status: 'OPEN',
        $or: [
          { 'hold.saleId': null },
          { 'hold.expiresAt': { $lte: at } },
          { 'hold.saleId': sale._id },
          ...(sale.customerId ? [{ 'hold.customerId': sale.customerId }] : []),
        ],
      },
      { $set: { hold: { saleId: sale._id, customerId: sale.customerId || null, sessionId: line.sessionId, expiresAt: holdExpiresAt } } },
      { new: true },
    );
    if (!taken) {
      const fresh = await TrainingSlotGroup.findById(group._id).lean();
      if (fresh?.status === 'ASSIGNED' && id(fresh.winner?.sessionId) !== id(line.sessionId)) {
        throw ApiError.conflict(`Cette date vient d'être attribuée à une autre formation (« ${fresh.winner?.title || 'formation'} »). Choisissez une autre session.`, { code: 'SESSION_SLOT_TAKEN', lineId: id(line._id) });
      }
      throw ApiError.conflict('Cette date est en cours de réservation pour une autre formation. Revenez dans quelques minutes.', { code: 'SESSION_SLOT_HELD', lineId: id(line._id) });
    }
  }
}

/** Le paiement n'aboutit pas : la retenue du groupe est rendue. */
export async function releaseGroupsForSale(sale) {
  await TrainingSlotGroup.updateMany(
    { 'hold.saleId': sale._id },
    { $set: { hold: { saleId: null, customerId: null, sessionId: null, expiresAt: null } } },
  );
}

/* ─────────────────────────────── Attribution ─────────────────────────────── */

async function cancelLosers(group, winnerSessionId) {
  const { cancelSession } = await import('./formationSessions.service.js');
  const reason = `Créneau attribué à la formation « ${group.winner?.title || 'formation'} »`;
  for (const m of group.members) {
    if (id(m.sessionId) === id(winnerSessionId)) continue;
    const product = await CommerceProduct.findById(m.productId).select('sessions').lean();
    const session = product?.sessions?.find((s) => id(s._id) === id(m.sessionId));
    if (!session || session.status === 'CANCELLED') continue;
    try {
      // Places retenues par des commandes NON payées sur cette alternative : rendues.
      // Si l'une était payée malgré tout, l'encaissement la rembourserait (perdante tardive).
      const pending = await CommerceSale.find({ seatsHeld: true, paymentStatus: { $nin: ['PAID', 'PROCESSING', 'REFUNDED', 'PARTIALLY_REFUNDED'] }, 'lines.sessionId': m.sessionId });
      for (const sale of pending) {
        for (const line of sale.lines || []) {
          if (id(line.sessionId) !== id(m.sessionId)) continue;
          await CommerceProduct.updateOne({ _id: line.productId, 'sessions._id': line.sessionId }, { $inc: { 'sessions.$.reservedCount': -(line.quantity || 1) } });
        }
        if (!(sale.lines || []).some((l) => l.sessionId && id(l.sessionId) !== id(m.sessionId))) { sale.seatsHeld = false; await sale.save(); }
      }
      // Personne n'a pu la payer (retenue exclusive) ; si c'était le cas, elle serait remboursée.
      await cancelSession(m.productId, m.sessionId, { reason, refundMode: 'FULL' }, null);
      await TrainingSlotGroup.updateOne({ _id: group._id, 'members.sessionId': m.sessionId }, { $set: { 'members.$.cancelledByAssignment': true } });
    } catch (err) {
      logger.error(`[créneau partagé] annulation de l'alternative ${m.title} impossible : ${err.message}`);
    }
  }
}

/** Paiement arrivé sur une session déjà perdante : remboursement intégral et e-mail. */
async function refundLateLoser(sale, line, group, issues) {
  if ((sale.partialRefunds || []).some((r) => id(r.lineId) === id(line._id))) return;
  const { refundPart } = await import('./customerAgenda.service.js');
  const amountCents = Number(line.totalCents || 0);
  const reason = `Créneau attribué à une autre formation (« ${group.winner?.title || 'formation'} ») pendant votre paiement : remboursement intégral`;
  const refund = amountCents > 0 ? await refundPart(sale, amountCents, reason) : { stripeCents: 0, giftCents: 0, stripeRefundId: '' };
  sale.partialRefunds = [...(sale.partialRefunds || []), { lineId: id(line._id), at: now(), amountCents, ...refund, reason }];
  const refunded = sale.partialRefunds.reduce((s, r) => s + Number(r.amountCents || 0), 0);
  if (refunded >= Number(sale.totalCents || 0)) { sale.status = 'REFUNDED'; sale.paymentStatus = 'REFUNDED'; }
  sale.markModified('partialRefunds');
  await sale.save();
  const product = await CommerceProduct.findById(line.productId).select('title sessions').lean();
  const session = product?.sessions?.find((s) => id(s._id) === id(line.sessionId));
  await emitAndDispatch({
    type: 'formation.session.cancelled',
    entityType: 'CommerceSale',
    entityId: sale._id,
    payloadSafe: {
      saleId: id(sale._id),
      customerId: id(sale.customerId),
      productId: id(line.productId),
      slotId: id(line.sessionId),
      trainingTitle: String(product?.title || line.productSnapshot?.title || 'Formation').slice(0, 180),
      sessionStart: new Date(session?.startsAt || group.startsAt).toISOString(),
      sessionEnd: new Date(session?.endsAt || group.endsAt).toISOString(),
      reason: 'Cette date venait d’être attribuée à une autre formation. Vous êtes intégralement remboursée : choisissez une autre session sur le site.',
      refundedAmount: Math.max(0, Math.round(amountCents)),
      cancelledAt: now().toISOString(),
    },
    idempotencyKey: `slot-group-late-loser:${sale._id}:${line._id}`,
  });
  if (issues) issues.push(`Session de « ${line.productSnapshot?.title || 'formation'} » : créneau attribué à une autre formation pendant le paiement, ligne remboursée automatiquement`);
}

/**
 * À l'ENCAISSEMENT : la première vente payée sur un groupe ouvert le gagne.
 * Écriture conditionnelle — un seul gagnant, même pour deux paiements
 * simultanés. Les autres sessions sont annulées, l'institut prévenu.
 */
export async function assignGroupsForSale(sale, issues = null) {
  const lines = (sale.lines || []).filter((l) => l.productSnapshot?.kind === 'IN_PERSON_TRAINING' && l.sessionId);
  for (const line of lines) {
    const group = await TrainingSlotGroup.findOne({ 'members.sessionId': line.sessionId }).lean();
    if (!group || group.status === 'DISSOLVED') continue;
    const member = group.members.find((m) => id(m.sessionId) === id(line.sessionId));
    const won = await TrainingSlotGroup.findOneAndUpdate(
      { _id: group._id, status: 'OPEN' },
      {
        $set: {
          status: 'ASSIGNED',
          winner: { productId: line.productId, sessionId: line.sessionId, saleId: sale._id, title: member?.title || line.productSnapshot?.title || '', at: now() },
          hold: { saleId: null, customerId: null, sessionId: null, expiresAt: null },
        },
        $push: { history: { at: now(), action: 'ASSIGNED', detail: `${member?.title || ''} — ${sale.saleNumber || id(sale._id)}` } },
      },
      { new: true },
    );
    if (won) {
      await cancelLosers(won, line.sessionId);
      await emitAndDispatch({
        type: 'formation.slot_group.assigned',
        entityType: 'CommerceSale',
        entityId: sale._id,
        payloadSafe: {
          saleId: id(sale._id),
          groupId: id(won._id),
          winnerTitle: String(won.winner.title || '').slice(0, 180),
          withdrawnTitles: won.members.filter((m) => id(m.sessionId) !== id(line.sessionId)).map((m) => String(m.title).slice(0, 180)),
          slotStart: new Date(won.startsAt).toISOString(),
          slotEnd: new Date(won.endsAt).toISOString(),
          assignedAt: now().toISOString(),
        },
        idempotencyKey: `slot-group-assigned:${won._id}`,
      });
      continue;
    }
    const fresh = await TrainingSlotGroup.findById(group._id).lean();
    if (fresh?.status === 'ASSIGNED' && id(fresh.winner?.sessionId) !== id(line.sessionId)) {
      await refundLateLoser(sale, line, fresh, issues);
    }
  }
}

/* ───────────────────────────── Manager ───────────────────────────── */

export async function describeSlotGroup(sessionId) {
  const group = await TrainingSlotGroup.findOne({ 'members.sessionId': sessionId, status: { $ne: 'DISSOLVED' } }).lean();
  if (!group) return null;
  const members = [];
  for (const m of group.members) {
    const product = await CommerceProduct.findById(m.productId).select('title sessions').lean();
    const session = product?.sessions?.find((s) => id(s._id) === id(m.sessionId));
    members.push({
      productId: id(m.productId),
      sessionId: id(m.sessionId),
      title: product?.title || m.title,
      status: session?.status || 'CANCELLED',
      reservedCount: Number(session?.reservedCount || 0),
      capacity: Number(session?.capacity || 0),
      winner: id(group.winner?.sessionId) === id(m.sessionId),
      cancelledByAssignment: Boolean(m.cancelledByAssignment),
    });
  }
  const winner = members.find((m) => m.winner);
  return {
    id: id(group._id),
    status: group.status,
    startsAt: group.startsAt,
    endsAt: group.endsAt,
    members,
    winner: group.winner?.sessionId ? { title: group.winner.title, at: group.winner.at } : null,
    heldUntil: holdActive(group) ? group.hold.expiresAt : null,
    canReopen: group.status === 'ASSIGNED' && Boolean(winner) && (winner.status === 'CANCELLED' || winner.reservedCount === 0),
  };
}

/**
 * ROUVRIR — la gagnante n'a plus d'inscrite (annulée, remboursée) : les
 * alternatives retirées par l'attribution reviennent en vente. Jamais
 * automatique : c'est l'institut qui décide.
 */
export async function reopenSlotGroup(groupId) {
  if (!mongoose.isValidObjectId(groupId)) throw ApiError.notFound('Créneau partagé introuvable');
  const group = await TrainingSlotGroup.findById(groupId);
  if (!group) throw ApiError.notFound('Créneau partagé introuvable');
  const described = await describeSlotGroup(group.members[0]?.sessionId);
  if (!described?.canReopen) throw ApiError.conflict('La formation retenue a encore des inscrites : le créneau ne peut pas être rouvert.', { code: 'SLOT_GROUP_NOT_REOPENABLE' });
  // Le créneau doit être resté libre de tout rendez-vous ou blocage posé depuis.
  const days = [];
  for (const m of group.members) {
    if (!m.cancelledByAssignment) continue;
    const product = await CommerceProduct.findById(m.productId).select('sessions').lean();
    const session = product?.sessions?.find((s) => id(s._id) === id(m.sessionId));
    if (session) days.push(...sessionBlocks(session));
  }
  for (const day of days) {
    const blocking = await CalendarEvent.findOne({ status: { $ne: 'CANCELLED' }, startsAt: { $lt: day.endsAt }, endsAt: { $gt: day.startsAt }, ...activeHoldFilter() }).lean();
    if (blocking) throw ApiError.conflict(`Un rendez-vous occupe désormais ce créneau (« ${blocking.title} ») : impossible de rouvrir les alternatives.`, { code: 'SLOT_GROUP_REOPEN_BLOCKED' });
  }
  let reopened = 0;
  for (const m of group.members) {
    if (!m.cancelledByAssignment) continue;
    await CommerceProduct.updateOne({ _id: m.productId, 'sessions._id': m.sessionId }, { $set: { 'sessions.$.status': 'ACTIVE', 'sessions.$.cancellationReason': '' } });
    m.cancelledByAssignment = false;
    reopened += 1;
  }
  group.status = 'OPEN';
  group.winner = { productId: null, sessionId: null, saleId: null, title: '', at: null };
  group.hold = { saleId: null, customerId: null, sessionId: null, expiresAt: null };
  group.history.push({ at: now(), action: 'REOPENED', detail: `${reopened} formation(s) remise(s) en vente` });
  await group.save();
  return { reopened, group: await describeSlotGroup(group.members[0]?.sessionId) };
}

export async function slotGroupIdsForSessions(sessionIds) {
  const groups = await TrainingSlotGroup.find({ 'members.sessionId': { $in: sessionIds }, status: { $ne: 'DISSOLVED' } }).select('status members hold').lean();
  const out = new Map();
  for (const g of groups) for (const m of g.members) out.set(id(m.sessionId), { groupId: id(g._id), status: g.status, held: holdActive(g) });
  return out;
}

