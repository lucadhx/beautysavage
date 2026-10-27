import mongoose from 'mongoose';
import { AppointmentReminder } from '../models/AppointmentReminder.model.js';
import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { Customer } from '../models/Customer.model.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { effectiveAppointmentReminderConfig, offsetMinutes } from './appointmentReminderConfig.js';
import { logger } from '../utils/logger.js';

/**
 * RAPPELS AVANT RENDEZ-VOUS ET SESSION — la cliente est prévenue avant de venir.
 *
 * Repris de meli_nails, étendu aux FORMATIONS EN PRÉSENTIEL : chaque stagiaire
 * inscrite (vente payée, ligne non remboursée) reçoit les rappels réglés sur
 * la fiche formation, comme une cliente reçoit ceux de sa prestation.
 *
 * À chaque passage du planificateur (toutes les 3 minutes) :
 *
 *   1. les rendez-vous prestation et les places en session À VENIR (30 jours) ;
 *   2. pour chacun, les rappels de sa fiche dont l'heure est arrivée ;
 *   3. un e-mail par cible et par passage — si plusieurs rappels sont dus d'un
 *      coup (serveur arrêté), seul le plus proche part, les autres sont notés
 *      « sautés ».
 *
 * Règles :
 *   · un rappel dont l'heure précède la RÉSERVATION ne part pas : une cliente
 *     qui réserve pour dans 3 heures n'a pas à recevoir « rappel : 24 h avant »
 *     dans la seconde ;
 *   · annulé, passé, déplacé ou remboursé : pas de rappel (garde de pertinence
 *     au moment de l'envoi) ;
 *   · déplacé : les rappels repartent pour la nouvelle date.
 */

const HORIZON_MS = 30 * 86400_000;

/** Les rappels dus pour une cible, du plus éloigné au plus proche. */
export function dueReminders(target, config, now = new Date()) {
  if (!config.enabled) return [];
  const start = new Date(target.startsAt).getTime();
  const bookedAt = new Date(target.createdAt || target.bookedAt || 0).getTime();
  return config.reminders
    .map((r) => ({ offsetMinutes: offsetMinutes(r), dueAt: new Date(start - offsetMinutes(r) * 60_000) }))
    .filter((r) => r.dueAt.getTime() <= now.getTime() && r.dueAt.getTime() >= bookedAt && start > now.getTime())
    .sort((a, b) => b.offsetMinutes - a.offsetMinutes);
}

const lineRefunded = (sale, line) => (sale.partialRefunds || []).some((r) => String(r?.lineId) === String(line._id));

/** Les rendez-vous prestation à venir, sous forme de cibles. */
async function serviceTargets(now) {
  const events = await CalendarEvent.find({
    type: 'SERVICE_BOOKING',
    status: 'SCHEDULED',
    startsAt: { $gt: now, $lte: new Date(now.getTime() + HORIZON_MS) },
    productId: { $ne: null },
    'customerSnapshot.customerId': { $nin: [null, ''] },
  }).select('title productId customerSnapshot startsAt endsAt createdAt paymentSnapshot').lean();
  return events.map((event) => ({
    kind: 'SERVICE',
    targetKey: `event:${event._id}`,
    calendarEventId: event._id,
    productId: event.productId,
    customerId: String(event.customerSnapshot.customerId),
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    bookedAt: event.createdAt,
    balanceDueCents: Number(event.paymentSnapshot?.balanceDueCents || 0),
  }));
}

/** Les places payées en session de formation présentielle à venir. */
async function trainingTargets(now) {
  const horizon = new Date(now.getTime() + HORIZON_MS);
  const products = await CommerceProduct.find({
    kind: 'IN_PERSON_TRAINING',
    sessions: { $elemMatch: { status: { $ne: 'CANCELLED' }, startsAt: { $gt: now, $lte: horizon } } },
  }).select('title sessions').lean();
  const targets = [];
  for (const product of products) {
    for (const session of product.sessions || []) {
      if (session.status === 'CANCELLED' || !(new Date(session.startsAt) > now && new Date(session.startsAt) <= horizon)) continue;
      const sales = await CommerceSale.find({ paymentStatus: 'PAID', status: { $ne: 'REFUNDED' }, 'lines.sessionId': session._id })
        .select('customerId lines partialRefunds createdAt').lean();
      for (const sale of sales) {
        const line = (sale.lines || []).find((l) => String(l.sessionId) === String(session._id));
        if (!line || lineRefunded(sale, line) || !sale.customerId) continue;
        targets.push({
          kind: 'TRAINING',
          targetKey: `session:${session._id}:${sale._id}`,
          sessionId: session._id,
          saleId: sale._id,
          productId: product._id,
          customerId: String(sale.customerId),
          title: product.title,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          bookedAt: sale.createdAt,
          balanceDueCents: Number(line.balanceDueCents || 0),
        });
      }
    }
  }
  return targets;
}

async function record(target, reminder, status, extra = {}) {
  try {
    await AppointmentReminder.create({
      targetKey: target.targetKey,
      kind: target.kind,
      calendarEventId: target.calendarEventId || null,
      sessionId: target.sessionId || null,
      saleId: target.saleId || null,
      customerId: mongoose.isValidObjectId(target.customerId) ? target.customerId : null,
      productId: target.productId || null,
      offsetMinutes: reminder.offsetMinutes,
      appointmentStart: target.startsAt,
      dueAt: reminder.dueAt,
      status,
      ...extra,
    });
    return true;
  } catch (err) {
    // Déjà traité par un passage concurrent : rien à faire.
    if (err?.code === 11000) return false;
    throw err;
  }
}

export async function processAppointmentReminders(now = new Date()) {
  const targets = [...(await serviceTargets(now)), ...(await trainingTargets(now))];
  if (!targets.length) return { scanned: 0, sent: 0, skipped: 0 };

  const products = new Map((await CommerceProduct.find({ _id: { $in: [...new Set(targets.map((t) => String(t.productId)))] } })
    .select('title appointmentReminder status').lean()).map((p) => [String(p._id), p]));

  let sent = 0;
  let skipped = 0;
  for (const target of targets) {
    const product = products.get(String(target.productId));
    if (!product) continue;
    const due = dueReminders(target, effectiveAppointmentReminderConfig(product), now);
    if (!due.length) continue;
    const done = new Set((await AppointmentReminder.find({ targetKey: target.targetKey, appointmentStart: target.startsAt }).select('offsetMinutes').lean())
      .map((r) => r.offsetMinutes));
    const pending = due.filter((r) => !done.has(r.offsetMinutes));
    if (!pending.length) continue;

    // Plusieurs rappels dus à la fois : seul le plus proche part.
    const [closest] = pending.slice(-1);
    for (const r of pending.slice(0, -1)) {
      if (await record(target, r, 'SKIPPED', { lastError: 'Un rappel plus proche partait au même passage.' })) skipped += 1;
    }

    const customer = mongoose.isValidObjectId(target.customerId) ? await Customer.findById(target.customerId).select('email').lean() : null;
    if (!customer?.email) {
      if (await record(target, closest, 'SKIPPED', { lastError: 'Cliente sans adresse e-mail.' })) skipped += 1;
      continue;
    }
    // On réserve le rappel AVANT d'émettre : un passage concurrent ne l'enverra pas une seconde fois.
    if (!(await record(target, closest, 'SENT', { sentAt: now }))) continue;

    const service = target.kind === 'SERVICE';
    const emitted = await emitAndDispatch({
      type: 'appointment.reminder',
      entityType: service ? 'CalendarEvent' : 'CommerceSale',
      entityId: String(service ? target.calendarEventId : target.saleId),
      payloadSafe: {
        kind: target.kind,
        calendarEventId: service ? String(target.calendarEventId) : '',
        slotId: service ? '' : String(target.sessionId),
        saleId: service ? '' : String(target.saleId),
        customerId: target.customerId,
        appointmentTitle: String(target.title || product.title || 'Rendez-vous').slice(0, 180),
        appointmentStart: new Date(target.startsAt).toISOString(),
        appointmentEnd: new Date(target.endsAt).toISOString(),
        balanceDueAmount: Math.max(0, Math.round(target.balanceDueCents)),
        offsetMinutes: closest.offsetMinutes,
        remindedAt: now.toISOString(),
      },
      idempotencyKey: `appointment-reminder:${target.targetKey}:${new Date(target.startsAt).getTime()}:${closest.offsetMinutes}`,
    }).catch((err) => { logger.warn(`[rappel] émission refusée : ${err.message}`); return null; });

    if (!emitted) {
      await AppointmentReminder.updateOne(
        { targetKey: target.targetKey, offsetMinutes: closest.offsetMinutes, appointmentStart: target.startsAt },
        { $set: { status: 'FAILED', lastError: 'Événement refusé' } },
      );
      continue;
    }
    sent += 1;
  }
  if (sent || skipped) logger.info(`[rappel] ${sent} rappel(s) envoyé(s), ${skipped} sauté(s), ${targets.length} rendez-vous / place(s) examiné(s).`);
  return { scanned: targets.length, sent, skipped };
}

/**
 * GARDE DE PERTINENCE — au moment d'envoyer : le rendez-vous (ou la place en
 * session) existe-t-il toujours, à la même heure, et n'est-il pas passé ? Un
 * rendez-vous annulé, une session annulée ou déplacée, une inscription
 * remboursée entre la planification et l'envoi n'appellent pas ce rappel-là.
 */
export async function appointmentReminderStillRelevant(event) {
  const p = event?.payloadSafe || {};
  if (p.kind === 'TRAINING') {
    if (!mongoose.isValidObjectId(p.slotId) || !mongoose.isValidObjectId(p.saleId)) return { relevant: false, reason: 'Session inconnue.' };
    const product = await CommerceProduct.findOne({ 'sessions._id': p.slotId }).select('sessions').lean();
    const session = product?.sessions?.find((s) => String(s._id) === String(p.slotId));
    if (!session || session.status === 'CANCELLED') return { relevant: false, reason: 'Session annulée.' };
    if (new Date(session.startsAt).toISOString() !== p.appointmentStart) return { relevant: false, reason: 'Session déplacée.' };
    if (new Date(session.startsAt).getTime() <= Date.now()) return { relevant: false, reason: 'Session déjà commencée.' };
    const sale = await CommerceSale.findById(p.saleId).select('paymentStatus status lines partialRefunds').lean();
    const line = sale?.lines?.find((l) => String(l.sessionId) === String(p.slotId));
    if (!sale || sale.paymentStatus !== 'PAID' || sale.status === 'REFUNDED' || !line || lineRefunded(sale, line)) return { relevant: false, reason: 'Inscription annulée ou remboursée.' };
    return { relevant: true };
  }
  if (!mongoose.isValidObjectId(p.calendarEventId)) return { relevant: false, reason: 'Rendez-vous inconnu.' };
  const current = await CalendarEvent.findById(p.calendarEventId).select('status startsAt').lean();
  if (!current || current.status !== 'SCHEDULED') return { relevant: false, reason: 'Rendez-vous annulé ou terminé.' };
  if (new Date(current.startsAt).toISOString() !== p.appointmentStart) return { relevant: false, reason: 'Rendez-vous déplacé.' };
  if (new Date(current.startsAt).getTime() <= Date.now()) return { relevant: false, reason: 'Rendez-vous déjà passé.' };
  return { relevant: true };
}
