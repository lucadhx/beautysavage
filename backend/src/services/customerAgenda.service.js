import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { GiftCard } from '../models/GiftCard.model.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { cancelEvent, sessionBlocks } from './calendar.service.js';
import { cancellationTerms } from './commercePaymentRules.js';
import { refundInstitutePayment } from './instituteStripe.service.js';

/**
 * L'AGENDA DE LA CLIENTE — ses rendez-vous de prestation et ses sessions de
 * formation en présentiel, avec ce qu'il reste à régler sur place et les
 * conditions d'annulation de CHAQUE fiche (onglet Réservation du Manager).
 *
 * Annuler : le créneau est libéré, et le remboursement prévu par la fiche
 * (à temps / tardif) part aussitôt — sur la carte bancaire d'abord, le reste
 * recrédité sur les cartes cadeaux utilisées.
 */

const SOON_MS = 48 * 3_600_000;

function serviceItem(event, product, now) {
  const paid = Number(event.paymentSnapshot?.paidCents || 0);
  return {
    id: String(event._id),
    kind: 'SERVICE',
    title: event.title,
    productSlug: product?.slug || '',
    coverUrl: product?.coverUrl || product?.gallery?.[0] || '',
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    days: [{ startsAt: event.startsAt, endsAt: event.endsAt }],
    status: event.status,
    soon: new Date(event.startsAt) - now <= SOON_MS && new Date(event.startsAt) > now,
    totalCents: Number(event.paymentSnapshot?.totalCents || 0),
    paidCents: paid,
    balanceDueCents: Number(event.paymentSnapshot?.balanceDueCents || 0),
    saleId: event.saleId ? String(event.saleId) : null,
    terms: cancellationTerms(product, event.startsAt, event.saleId ? paid : 0, now),
    location: '',
    // Prestations réservées à la suite : l'espace client les montre ensemble.
    bookingGroupId: event.source?.bookingGroupId || '',
  };
}

function trainingItem(sale, line, product, now) {
  const session = (product?.sessions || []).find((s) => String(s._id) === String(line.sessionId));
  if (!session) return null;
  const days = sessionBlocks(session);
  const startsAt = days[0]?.startsAt || session.startsAt;
  const endsAt = days[days.length - 1]?.endsAt || session.endsAt;
  const paid = Number(line.totalCents || 0);
  return {
    id: `session:${sale._id}:${line._id}`,
    kind: 'IN_PERSON_TRAINING',
    title: line.productSnapshot?.title || product?.title || 'Formation',
    productSlug: product?.slug || '',
    coverUrl: product?.coverUrl || product?.gallery?.[0] || '',
    startsAt,
    endsAt,
    days,
    status: line.cancellation ? 'CANCELLED' : session.status === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED',
    soon: new Date(startsAt) - now <= SOON_MS && new Date(startsAt) > now,
    totalCents: Number(line.fullTotalCents ?? line.totalCents ?? 0),
    paidCents: paid,
    balanceDueCents: Number(line.balanceDueCents || 0),
    saleId: String(sale._id),
    terms: cancellationTerms(product, startsAt, paid, now),
    location: product?.training?.location || '',
  };
}

export async function listCustomerAppointments(customerId, now = new Date()) {
  const id = String(customerId);
  const [events, sales] = await Promise.all([
    CalendarEvent.find({ 'customerSnapshot.customerId': id, type: 'SERVICE_BOOKING', status: { $ne: 'HELD' } }).sort({ startsAt: 1 }).lean(),
    CommerceSale.find({ customerId, paymentStatus: 'PAID', 'lines.sessionId': { $ne: null } }).lean(),
  ]);
  const productIds = [...new Set([
    ...events.map((e) => String(e.productId || '')).filter(Boolean),
    ...sales.flatMap((s) => s.lines.filter((l) => l.sessionId).map((l) => String(l.productId))),
  ])];
  const products = new Map((await CommerceProduct.find({ _id: { $in: productIds } }).lean()).map((p) => [String(p._id), p]));
  const items = [
    ...events.map((e) => serviceItem(e, products.get(String(e.productId)), now)),
    ...sales.flatMap((s) => s.lines
      .filter((l) => l.sessionId && l.productSnapshot?.kind === 'IN_PERSON_TRAINING')
      .map((l) => trainingItem(s, l, products.get(String(l.productId)), now))
      .filter(Boolean)),
  ].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const upcoming = items.filter((i) => i.status !== 'CANCELLED' && new Date(i.endsAt) >= now);
  const past = items.filter((i) => i.status === 'CANCELLED' || new Date(i.endsAt) < now).reverse().slice(0, 20);
  return {
    upcoming,
    past,
    balanceDueCents: upcoming.reduce((s, i) => s + i.balanceDueCents, 0),
    next: upcoming[0] || null,
  };
}

/** Rembourse `amountCents` d'une vente : carte bancaire d'abord, le reste sur les cartes cadeaux utilisées. */
export async function refundPart(sale, amountCents, reason) {
  if (amountCents <= 0) return { stripeCents: 0, giftCents: 0, stripeRefundId: '' };
  const alreadyStripe = (sale.partialRefunds || []).reduce((s, r) => s + Number(r.stripeCents || 0), 0);
  const stripeRoom = sale.stripe?.paymentIntentId && sale.stripe.paymentIntentId !== 'gift_card_only'
    ? Math.max(0, Number(sale.stripeAmountCents || 0) - alreadyStripe)
    : 0;
  const stripeCents = Math.min(amountCents, stripeRoom);
  let stripeRefundId = '';
  if (stripeCents > 0) {
    const refund = await refundInstitutePayment({ paymentIntentId: sale.stripe.paymentIntentId, amountCents: stripeCents, reason, saleId: `${sale._id}:${Date.now()}` });
    stripeRefundId = refund.id || '';
  }
  let giftCents = amountCents - stripeCents;
  const credited = giftCents;
  for (const allocation of sale.giftCardAllocations || []) {
    if (giftCents <= 0) break;
    const card = await GiftCard.findById(allocation.giftCardId);
    if (!card) continue;
    const part = Math.min(giftCents, Number(allocation.amountCents || 0));
    if (part <= 0) continue;
    const before = card.balanceCents;
    card.balanceCents = before + part;
    card.status = 'ACTIVE';
    card.ledger.push({ type: 'CREDIT', amountCents: part, balanceBeforeCents: before, balanceAfterCents: card.balanceCents, source: 'CUSTOMER_CANCELLATION', reason, actorCustomerId: sale.customerId, idempotencyKey: `cancel:${sale._id}:${Date.now()}:${card._id}` });
    await card.save();
    giftCents -= part;
  }
  return { stripeCents, giftCents: credited - giftCents, stripeRefundId };
}

export async function cancelCustomerAppointment(customerId, appointmentId, now = new Date()) {
  const id = String(appointmentId || '');
  if (id.startsWith('session:')) {
    const [, saleId, lineId] = id.split(':');
    const sale = await CommerceSale.findOne({ _id: saleId, customerId });
    const line = sale?.lines?.id(lineId);
    if (!sale || !line || line.cancellation) throw ApiError.notFound('Session introuvable ou déjà annulée');
    const product = await CommerceProduct.findById(line.productId);
    const session = product?.sessions?.id(line.sessionId);
    if (!session) throw ApiError.notFound('Session introuvable');
    const startsAt = sessionBlocks(session)[0]?.startsAt || session.startsAt;
    const terms = cancellationTerms(product, startsAt, line.totalCents, now);
    if (!terms.cancellable) throw ApiError.conflict('Cette session a déjà commencé : elle ne peut plus être annulée en ligne.');
    const reason = `Annulation par la cliente — ${line.productSnapshot?.title || 'formation'}`;
    const refund = await refundPart(sale, terms.refundCents, reason);
    line.cancellation = { at: now, refundCents: terms.refundCents, percent: terms.percent, onTime: terms.onTime, ...refund };
    sale.partialRefunds = [...(sale.partialRefunds || []), { lineId: String(line._id), at: now, amountCents: terms.refundCents, ...refund }];
    sale.markModified('lines');
    await sale.save();
    session.reservedCount = Math.max(0, Number(session.reservedCount || 0) - Number(line.quantity || 1));
    await product.save();
    return { cancelled: true, refundCents: terms.refundCents, percent: terms.percent, onTime: terms.onTime };
  }

  const event = await CalendarEvent.findOne({ _id: id, 'customerSnapshot.customerId': String(customerId) });
  if (!event || event.status === 'CANCELLED') throw ApiError.notFound('Rendez-vous introuvable ou déjà annulé');
  const product = event.productId ? await CommerceProduct.findById(event.productId).lean() : null;
  const sale = event.saleId ? await CommerceSale.findOne({ _id: event.saleId, customerId }) : null;
  const paid = sale ? Number(event.paymentSnapshot?.paidCents || 0) : 0;
  const terms = cancellationTerms(product, event.startsAt, paid, now);
  if (!terms.cancellable) throw ApiError.conflict('Ce rendez-vous est passé : il ne peut plus être annulé en ligne.');
  const reason = `Annulation par la cliente — ${event.title}`;
  let refund = { stripeCents: 0, giftCents: 0, stripeRefundId: '' };
  if (sale && terms.refundCents > 0) {
    refund = await refundPart(sale, terms.refundCents, reason);
    const line = sale.lines?.id(event.lineId);
    if (line) line.cancellation = { at: now, refundCents: terms.refundCents, percent: terms.percent, onTime: terms.onTime, ...refund };
    sale.partialRefunds = [...(sale.partialRefunds || []), { lineId: String(event.lineId || ''), eventId: String(event._id), at: now, amountCents: terms.refundCents, ...refund }];
    sale.markModified('lines');
    await sale.save();
  }
  await cancelEvent(event._id, { reason, refundedCents: terms.refundCents });
  logger.info(`[agenda] ${event.title} annulé par la cliente — remboursé ${terms.refundCents} c (${terms.percent} %).`);
  return { cancelled: true, refundCents: terms.refundCents, percent: terms.percent, onTime: terms.onTime };
}
