import mongoose from 'mongoose';
import { ReviewRequest, ReviewRequestState } from '../models/ReviewRequest.model.js';
import { Review } from '../models/Review.model.js';
import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { Customer } from '../models/Customer.model.js';
import { TrainingSubmission } from '../models/TrainingSubmission.model.js';
import { sessionBlocks } from './calendar.service.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import { effectiveReviewRequestConfig, stepMs } from './reviewRequestConfig.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * DEMANDES D'AVIS — de la prestation terminée à l'avis reçu.
 *
 *   1. DÉTECTION   rendez-vous passés, sessions présentielles finies, formations
 *                  à distance validées → une demande, avec ses envois figés.
 *   2. ENVOI       à échéance, UN e-mail par cliente et par passage, même si
 *                  plusieurs prestations sont dues (enchaînement) ; les
 *                  relances suivent, chacune après l'envoi précédent.
 *   3. AVIS        reçu → la demande et ses sœurs du même produit s'arrêtent.
 *
 * Règles d'arrêt (affichées dans le Manager) : aucune demande ne part si la
 * cliente a DÉJÀ laissé un avis sur ce produit ; les relances cessent dès que
 * son avis est reçu.
 */

export const COMMENT_MAX = 1000;
const DISCOVERY_WINDOW_MS = 60 * 86400_000;
const PAID = ['PAID', 'PARTIALLY_REFUNDED'];
const REVIEWABLE_KINDS = ['SERVICE', 'IN_PERSON_TRAINING', 'DISTANCE_TRAINING'];

/* ───────────────────────────── Détection ───────────────────────────── */

async function discoverySince(now) {
  const state = await ReviewRequestState.findOneAndUpdate(
    { singleton: 'global' },
    { $setOnInsert: { discoverySince: now } },
    { new: true, upsert: true },
  ).lean();
  return state.discoverySince;
}

/**
 * Crée la demande d'une prestation vécue, si la fiche le prévoit. Idempotent :
 * la clé (cliente, source) est unique, un second passage ne change rien.
 */
export async function ensureReviewRequest({ customerId, product, sourceKey, completedAt, saleId = null, title = '', origin = 'AUTO', sendNow = false, now = new Date() }) {
  if (!customerId || !product || !REVIEWABLE_KINDS.includes(product.kind)) return null;
  if (product.status && product.status !== 'PUBLISHED') return null;
  const config = effectiveReviewRequestConfig(product);
  if (!config.enabled) return null;
  const steps = [config.delay, ...config.reminders];
  const first = sendNow ? now : new Date(new Date(completedAt).getTime() + stepMs(config.delay));
  try {
    const result = await ReviewRequest.updateOne(
      { customerId, sourceKey },
      {
        $setOnInsert: {
          customerId,
          productId: product._id,
          productKind: product.kind,
          title: title || product.title || '',
          sourceKey,
          saleId,
          completedAt,
          steps,
          step: 0,
          nextSendAt: first,
          status: 'ACTIVE',
          origin,
        },
      },
      { upsert: true },
    );
    return result.upsertedCount ? 'created' : 'exists';
  } catch (err) {
    if (err?.code === 11000) return 'exists';
    throw err;
  }
}

/** Ce qui s'est terminé entre `from` et `to` : rendez-vous, sessions, formations validées. */
export async function listCompletions({ from, to }) {
  const out = [];
  const productIds = new Set();

  const events = await CalendarEvent.find({
    type: 'SERVICE_BOOKING',
    status: { $in: ['SCHEDULED', 'COMPLETED'] },
    endsAt: { $gte: from, $lte: to },
    productId: { $ne: null },
    'customerSnapshot.customerId': { $nin: [null, ''] },
  }).select('productId saleId customerSnapshot.customerId endsAt title').lean();
  for (const e of events) {
    if (!mongoose.isValidObjectId(e.customerSnapshot.customerId)) continue;
    out.push({ customerId: e.customerSnapshot.customerId, productId: String(e.productId), sourceKey: `CAL:${e._id}`, completedAt: e.endsAt, saleId: e.saleId || null, title: e.title });
    productIds.add(String(e.productId));
  }

  // Sessions présentielles : les dates vivent sur la fiche, pas sur la vente.
  const sales = await CommerceSale.find({
    paymentStatus: { $in: PAID },
    lines: { $elemMatch: { 'productSnapshot.kind': 'IN_PERSON_TRAINING', sessionId: { $ne: null } } },
    createdAt: { $gte: new Date(from.getTime() - 400 * 86400_000) },
  }).select('customerId lines').lean();
  const trainingIds = [...new Set(sales.flatMap((s) => s.lines.filter((l) => l.productSnapshot?.kind === 'IN_PERSON_TRAINING').map((l) => String(l.productId))))];
  const trainings = new Map((await CommerceProduct.find({ _id: { $in: trainingIds } }).select('sessions').lean()).map((p) => [String(p._id), p]));
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (line.productSnapshot?.kind !== 'IN_PERSON_TRAINING' || !line.sessionId || line.cancellation) continue;
      const session = trainings.get(String(line.productId))?.sessions?.find((s) => String(s._id) === String(line.sessionId));
      if (!session || session.status === 'CANCELLED') continue;
      const blocks = sessionBlocks(session);
      const endsAt = new Date(blocks[blocks.length - 1]?.endsAt || session.endsAt);
      if (!(endsAt >= from && endsAt <= to)) continue;
      out.push({ customerId: String(sale.customerId), productId: String(line.productId), sourceKey: `SES:${sale._id}:${line._id}`, completedAt: endsAt, saleId: sale._id, title: line.productSnapshot?.title || '' });
      productIds.add(String(line.productId));
    }
  }

  // Formations à distance : la validation manuelle de l'institut fait foi.
  const submissions = await TrainingSubmission.find({
    status: 'VALIDATED',
    'decision.decidedAt': { $gte: from, $lte: to },
  }).select('customerId productId saleId decision.decidedAt').lean();
  for (const s of submissions) {
    out.push({ customerId: String(s.customerId), productId: String(s.productId), sourceKey: `SUB:${s._id}`, completedAt: s.decision.decidedAt, saleId: s.saleId || null, title: '' });
    productIds.add(String(s.productId));
  }

  const products = new Map((await CommerceProduct.find({ _id: { $in: [...productIds] } }).select('title kind reviewRequest status').lean()).map((p) => [String(p._id), p]));
  // Seules les fiches PUBLIÉES se notent : une fiche retirée ou devenue une
  // option (« Options pédicure ») n'appelle pas d'avis.
  return out.map((c) => ({ ...c, product: products.get(c.productId) || null })).filter((c) => c.product?.status === 'PUBLISHED');
}

export async function discoverReviewRequests(now = new Date()) {
  const since = await discoverySince(now);
  const from = new Date(Math.max(new Date(since).getTime(), now.getTime() - DISCOVERY_WINDOW_MS));
  let created = 0;
  for (const c of await listCompletions({ from, to: now })) {
    if (await ensureReviewRequest({ ...c, now }) === 'created') created += 1;
  }
  return { created };
}

/* ──────────────────────────────── Envoi ─────────────────────────────── */

async function reviewedProductIds(customerId) {
  return new Set((await Review.find({ customerId }).select('productId').lean()).map((r) => String(r.productId)));
}

/** Une demande dont le produit a déjà un avis de cette cliente ne part plus. */
async function closeIfReviewed(request, reviewed) {
  if (!reviewed.has(String(request.productId))) return false;
  const review = await Review.findOne({ customerId: request.customerId, productId: request.productId }).select('_id').lean();
  await ReviewRequest.updateOne({ _id: request._id }, { $set: { status: 'REVIEWED', nextSendAt: null, reviewId: review?._id || null } });
  return true;
}

function advance(request, now) {
  const step = request.step + 1;
  const next = request.steps[step];
  return next
    ? { $set: { step, nextSendAt: new Date(now.getTime() + stepMs(next)), lastError: '' }, $push: { sentAt: now } }
    : { $set: { step, nextSendAt: null, status: 'COMPLETED', lastError: '' }, $push: { sentAt: now } };
}

export async function sendDueReviewRequests(now = new Date(), { limit = 200 } = {}) {
  const due = await ReviewRequest.find({ status: 'ACTIVE', nextSendAt: { $lte: now } }).sort({ nextSendAt: 1 }).limit(limit).lean();
  const byCustomer = new Map();
  for (const r of due) {
    const key = String(r.customerId);
    if (!byCustomer.has(key)) byCustomer.set(key, []);
    byCustomer.get(key).push(r);
  }
  let emails = 0;
  let skipped = 0;
  for (const [customerId, requests] of byCustomer) {
    const customer = await Customer.findById(customerId).select('email').lean();
    if (!customer?.email) {
      await ReviewRequest.updateMany({ _id: { $in: requests.map((r) => r._id) } }, { $set: { status: 'CANCELLED', nextSendAt: null, lastError: 'Cliente sans adresse e-mail' } });
      skipped += requests.length;
      continue;
    }
    const reviewed = await reviewedProductIds(customerId);
    const live = [];
    const seen = new Set();
    for (const r of requests) {
      if (await closeIfReviewed(r, reviewed)) { skipped += 1; continue; }
      // Deux rendez-vous du même produit : un seul avis attendu, donc une seule mention.
      if (seen.has(String(r.productId))) {
        await ReviewRequest.updateOne({ _id: r._id }, advance(r, now));
        continue;
      }
      seen.add(String(r.productId));
      live.push(r);
    }
    if (!live.length) continue;
    const event = await emitAndDispatch({
      type: 'review.requested',
      entityType: 'Customer',
      entityId: customerId,
      payloadSafe: {
        customerId,
        reviewRequestIds: live.map((r) => String(r._id)),
        productTitles: live.map((r) => (r.title || 'Prestation').slice(0, 180)),
        completedAt: new Date(live[0].completedAt).toISOString(),
        reminder: live.some((r) => r.step > 0),
        requestedAt: now.toISOString(),
      },
      idempotencyKey: `review-requested:${customerId}:${live.map((r) => `${r._id}.${r.step}`).join(',')}`.slice(0, 250),
    });
    if (!event) {
      await ReviewRequest.updateMany({ _id: { $in: live.map((r) => r._id) } }, { $set: { lastError: 'Événement refusé' } });
      logger.warn(`[avis] demande d'avis non émise pour la cliente ${customerId}`);
      continue;
    }
    for (const r of live) await ReviewRequest.updateOne({ _id: r._id }, advance(r, now));
    emails += 1;
  }
  return { due: due.length, emails, skipped };
}

/** Passage du planificateur : détecter, puis envoyer ce qui est dû. */
export async function processReviewRequests(now = new Date()) {
  const discovered = await discoverReviewRequests(now);
  const sent = await sendDueReviewRequests(now);
  if (discovered.created || sent.emails) {
    logger.info(`[avis] ${discovered.created} demande(s) créée(s), ${sent.emails} e-mail(s) envoyé(s), ${sent.skipped} ignorée(s).`);
  }
  return { ...discovered, ...sent };
}

/** Garde de pertinence : au moment d'envoyer, un avis déjà reçu annule l'e-mail. */
export async function reviewRequestStillRelevant(event) {
  const ids = event?.payloadSafe?.reviewRequestIds || [];
  if (!ids.length) return { relevant: true };
  const open = await ReviewRequest.countDocuments({ _id: { $in: ids }, status: { $in: ['ACTIVE', 'COMPLETED'] } });
  return open > 0 ? { relevant: true } : { relevant: false, reason: 'Avis déjà reçu pour ces prestations.' };
}

/* ─────────────────────────── Espace cliente ─────────────────────────── */

function itemOf(request, product) {
  return {
    id: String(request._id),
    productId: String(request.productId),
    title: request.title || product?.title || 'Prestation',
    kind: request.productKind || product?.kind || '',
    completedAt: request.completedAt,
    coverUrl: product?.coverUrl || product?.gallery?.[0] || '',
  };
}

/**
 * Les avis que la cliente peut donner : une entrée par produit pas encore noté.
 * `focus` (la demande du lien cliqué) passe en premier ; elle doit appartenir
 * à la cliente connectée — sinon refus explicite, jamais une autre fiche.
 */
export async function listPendingReviews(customerId, { focus = null } = {}) {
  let focusStatus = null;
  if (focus) {
    if (!mongoose.isValidObjectId(focus)) throw ApiError.notFound('Demande d’avis introuvable');
    const target = await ReviewRequest.findById(focus).select('customerId status productId').lean();
    if (!target) throw ApiError.notFound('Demande d’avis introuvable');
    if (String(target.customerId) !== String(customerId)) {
      throw ApiError.forbidden('Cette demande d’avis concerne un autre compte. Connectez-vous avec l’adresse qui a reçu l’e-mail.', { code: 'REVIEW_NOT_YOURS' });
    }
    focusStatus = target.status === 'REVIEWED' ? 'ALREADY_REVIEWED' : 'OPEN';
  }
  const reviewed = await reviewedProductIds(customerId);
  const requests = await ReviewRequest.find({
    customerId,
    status: { $in: ['ACTIVE', 'COMPLETED'] },
    $or: [{ 'sentAt.0': { $exists: true } }, ...(focus ? [{ _id: focus }] : [])],
  }).sort({ completedAt: -1 }).lean();
  const products = new Map((await CommerceProduct.find({ _id: { $in: requests.map((r) => r.productId) } }).select('title kind coverUrl gallery').lean()).map((p) => [String(p._id), p]));
  const items = [];
  const seen = new Set();
  const ordered = focus ? [...requests.filter((r) => String(r._id) === String(focus)), ...requests.filter((r) => String(r._id) !== String(focus))] : requests;
  for (const r of ordered) {
    const pid = String(r.productId);
    if (reviewed.has(pid) || seen.has(pid)) continue;
    seen.add(pid);
    items.push(itemOf(r, products.get(pid)));
  }
  return { items, focusStatus, reviewedCount: reviewed.size };
}

function reviewTargetKind(kind) {
  return kind === 'SERVICE' ? 'SERVICE' : (kind === 'DISTANCE_TRAINING' || kind === 'IN_PERSON_TRAINING') ? 'TRAINING' : 'PRODUCT';
}

export async function submitRequestedReview(customerId, requestId, payload = {}) {
  if (!mongoose.isValidObjectId(requestId)) throw ApiError.notFound('Demande d’avis introuvable');
  const request = await ReviewRequest.findById(requestId).lean();
  if (!request) throw ApiError.notFound('Demande d’avis introuvable');
  if (String(request.customerId) !== String(customerId)) {
    throw ApiError.forbidden('Cette demande d’avis concerne un autre compte.', { code: 'REVIEW_NOT_YOURS' });
  }
  const rating = Number(payload.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw ApiError.badRequest('Choisissez une note de 1 à 5.', { code: 'REVIEW_RATING_REQUIRED' });
  const comment = String(payload.comment || '').trim();
  if (comment.length > COMMENT_MAX) throw ApiError.badRequest(`Votre commentaire dépasse ${COMMENT_MAX} caractères.`, { code: 'REVIEW_COMMENT_TOO_LONG' });

  const existing = await Review.findOne({ customerId, productId: request.productId }).select('_id').lean();
  if (existing) {
    await ReviewRequest.updateMany({ customerId, productId: request.productId, status: { $in: ['ACTIVE', 'COMPLETED'] } }, { $set: { status: 'REVIEWED', nextSendAt: null, reviewId: existing._id } });
    throw ApiError.conflict('Vous avez déjà laissé un avis sur cette prestation. Merci !', { code: 'ALREADY_REVIEWED' });
  }
  const customer = await Customer.findById(customerId).select('firstName lastName').lean();
  const displayName = [customer?.firstName, customer?.lastName ? `${customer.lastName.trim()[0]}.` : ''].filter(Boolean).join(' ') || 'Cliente';
  let review;
  try {
    review = await Review.create({
      customerId,
      productId: request.productId,
      saleId: request.saleId || null,
      reviewRequestId: request._id,
      targetKind: reviewTargetKind(request.productKind),
      rating,
      comment,
      displayName,
      status: 'PENDING',
      sourceLabel: 'Demande d’avis',
    });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('Vous avez déjà laissé un avis sur cette prestation. Merci !', { code: 'ALREADY_REVIEWED' });
    throw err;
  }
  // Les relances s'arrêtent : celle-ci et toutes les demandes du même produit.
  await ReviewRequest.updateMany(
    { customerId, productId: request.productId, status: { $in: ['ACTIVE', 'COMPLETED'] } },
    { $set: { status: 'REVIEWED', nextSendAt: null, reviewId: review._id } },
  );
  return { id: String(review._id), status: review.status, rating, comment };
}

/* ─────────────────────────────── Campagne ─────────────────────────────── */

/**
 * RATTRAPAGE — les prestations terminées AVANT la mise en service : une demande
 * envoyée tout de suite (puis les relances de la fiche). À lancer
 * explicitement ; `dryRun` liste sans rien créer.
 */
export async function backfillReviewRequests({ until = new Date(), since = new Date(0), dryRun = true } = {}) {
  const completions = await listCompletionsAll({ since, until });
  const reviewedBy = new Map();
  const plan = [];
  for (const c of completions) {
    if (!reviewedBy.has(c.customerId)) reviewedBy.set(c.customerId, await reviewedProductIds(c.customerId));
    if (reviewedBy.get(c.customerId).has(c.productId)) continue;
    if (!effectiveReviewRequestConfig(c.product).enabled) continue;
    plan.push(c);
  }
  if (dryRun) return { candidates: plan.length, plan };
  let created = 0;
  for (const c of plan) {
    if (await ensureReviewRequest({ ...c, origin: 'BACKFILL', sendNow: true }) === 'created') created += 1;
  }
  return { candidates: plan.length, created };
}

async function listCompletionsAll({ since, until }) {
  return listCompletions({ from: since, to: until });
}
