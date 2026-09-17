import mongoose from 'mongoose';

import Review, { REVIEW_STATUSES } from '../models/Review.js';
import Formation from '../models/Formation.js';
import Service from '../models/Service.js';
import User from '../models/user.js';
import { triggerNotification } from '../services/notificationService.js';

// LOT2 §11 — Variables SAFE pour les notifications d'avis (admin). Best-effort, jamais throw.
async function buildReviewNotifVars(doc) {
  let formationName = '';
  try {
    if (doc.formationId) {
      const f = await Formation.findById(doc.formationId).select('name').lean();
      formationName = f?.name || '';
    } else if (doc.serviceId) {
      const s = await Service.findById(doc.serviceId).select('name').lean();
      formationName = s?.name || '';
    }
  } catch { /* best-effort */ }
  let clientName = doc.displayName || '';
  if (!clientName && doc.userId) {
    try {
      const u = await User.findById(doc.userId).select('firstName lastName').lean();
      clientName = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
    } catch { /* best-effort */ }
  }
  return { clientName: clientName || '—', formationName: formationName || '—', rating: String(doc.rating || '') };
}
import {
  combineReviewFilters,
  buildModerationStatusFilter,
  buildReviewTypeFilter,
  inferReviewSourceType,
  inferReviewTargetType,
  normalizeReviewTargetType
} from '../services/reviews/reviewTargeting.js';

const MANUAL_CREATION_STATUSES = new Set(['pending', 'published']);

const isId = value => mongoose.Types.ObjectId.isValid(value);

function getReviewTargetName(review, maps) {
  const targetType = inferReviewTargetType(review);
  if (targetType === 'service') {
    return maps.serviceById.get(String(review.serviceId || '')) || 'Prestation';
  }
  return maps.formationById.get(String(review.formationId || '')) || 'Formation';
}

function buildReviewPayload(doc, maps) {
  const targetType = inferReviewTargetType(doc);
  const sourceType = inferReviewSourceType(doc);
  const formationId = doc.formationId ? String(doc.formationId) : null;
  const serviceId = doc.serviceId ? String(doc.serviceId) : null;
  const targetName = getReviewTargetName(doc, maps);
  const displayName = String(doc.displayName || '').trim();
  const authorName =
    sourceType === 'manual_institute'
      ? displayName || 'Avis manuel'
      : maps.userById.get(String(doc.userId || '')) || 'Client';
  const status = doc.status || 'published';

  return {
    id: String(doc._id),
    targetType,
    targetId: targetType === 'service' ? serviceId : formationId,
    targetName,
    formationId,
    formationName: targetType === 'formation' ? targetName : null,
    serviceId,
    serviceName: targetType === 'service' ? targetName : null,
    authorName,
    rating: doc.rating,
    comment: doc.comment || '',
    status,
    createdAt: doc.createdAt || null,
    moderatedAt: doc.moderatedAt || null,
    sourceType,
    isManual: sourceType === 'manual_institute',
    sourceLabel:
      sourceType === 'manual_institute'
        ? "Ajouté manuellement par l'institut"
        : 'Avis client'
  };
}

function buildBaseFilter(query = {}) {
  const filters = [];
  const type = normalizeReviewTargetType(query.type);
  if (type) {
    filters.push(buildReviewTypeFilter(type));
  }
  if (query.formationId && isId(query.formationId)) {
    filters.push(buildReviewTypeFilter('formation'));
    filters.push({ formationId: new mongoose.Types.ObjectId(query.formationId) });
  }
  if (query.serviceId && isId(query.serviceId)) {
    filters.push({ targetType: 'service', serviceId: new mongoose.Types.ObjectId(query.serviceId) });
  }
  return combineReviewFilters(...filters);
}

async function buildReferenceMaps(reviews) {
  const formationIds = [...new Set(reviews.map(entry => String(entry.formationId || '')).filter(Boolean))];
  const serviceIds = [...new Set(reviews.map(entry => String(entry.serviceId || '')).filter(Boolean))];
  const userIds = [...new Set(reviews.map(entry => String(entry.userId || '')).filter(Boolean))];

  const [formations, services, users] = await Promise.all([
    formationIds.length ? Formation.find({ _id: { $in: formationIds } }).select('name').lean() : [],
    serviceIds.length ? Service.find({ _id: { $in: serviceIds } }).select('name').lean() : [],
    userIds.length ? User.find({ _id: { $in: userIds } }).select('firstName lastName email').lean() : []
  ]);

  return {
    formationById: new Map(formations.map(entry => [String(entry._id), entry.name])),
    serviceById: new Map(services.map(entry => [String(entry._id), entry.name])),
    userById: new Map(
      users.map(entry => [
        String(entry._id),
        `${entry.firstName || ''} ${entry.lastName || ''}`.trim() || entry.email || 'Client'
      ])
    )
  };
}

async function buildCounts(baseFilter) {
  const rows = await Review.aggregate([
    { $match: baseFilter },
    {
      $project: {
        normalizedStatus: { $ifNull: ['$status', 'published'] },
        normalizedType: {
          $cond: [
            {
              $or: [
                { $eq: ['$targetType', 'service'] },
                { $ne: ['$serviceId', null] }
              ]
            },
            'service',
            'formation'
          ]
        }
      }
    }
  ]);

  const counts = { pending: 0, published: 0, rejected: 0 };
  const countsByType = { formation: 0, service: 0 };

  for (const row of rows) {
    counts[row.normalizedStatus] = (counts[row.normalizedStatus] || 0) + 1;
    countsByType[row.normalizedType] = (countsByType[row.normalizedType] || 0) + 1;
  }

  return { counts, countsByType };
}

async function resolveTarget(targetType, targetId) {
  if (targetType === 'service') {
    return Service.findById(targetId).select('name').lean();
  }
  return Formation.findById(targetId).select('name').lean();
}

export async function listReviewsForModeration(req, res) {
  try {
    const baseFilter = buildBaseFilter(req.query);
    const listFilter = combineReviewFilters(
      baseFilter,
      buildModerationStatusFilter(req.query.status)
    );
    const reviews = await Review.find(listFilter).sort({ createdAt: -1 }).limit(200).lean();
    const [maps, { counts, countsByType }] = await Promise.all([
      buildReferenceMaps(reviews),
      buildCounts(baseFilter)
    ]);

    return res.json({
      ok: true,
      reviews: reviews.map(review => buildReviewPayload(review, maps)),
      counts,
      countsByType
    });
  } catch (error) {
    console.error('[reviewModeration] list', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function moderateReview(req, res) {
  try {
    const { reviewId } = req.params;
    const status = String(req.body?.status || '');
    if (!isId(reviewId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    if (!REVIEW_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Statut invalide.' });

    const doc = await Review.findById(reviewId);
    if (!doc) return res.status(404).json({ ok: false, error: 'Avis introuvable.' });

    doc.status = status;
    doc.moderatedAt = new Date();
    doc.moderatedByAdminId = req.sessionUser?._id || null;
    await doc.save();

    // LOT2 §11 — notification admin (best-effort).
    if (status === 'published' || status === 'rejected') {
      try {
        const vars = await buildReviewNotifVars(doc);
        void triggerNotification(status === 'published' ? 'review_published' : 'review_rejected', vars);
      } catch { /* best-effort */ }
    }

    return res.json({ ok: true, review: { id: String(doc._id), status: doc.status } });
  } catch (error) {
    console.error('[reviewModeration] moderate', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function createManualReview(req, res) {
  try {
    const targetType = normalizeReviewTargetType(req.body?.targetType);
    const targetId = String(req.body?.targetId || '').trim();
    const displayName = String(req.body?.displayName || '').trim();
    const comment = String(req.body?.comment || '').trim();
    const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
    const rating = Number(req.body?.rating);

    if (!targetType) {
      return res.status(400).json({ ok: false, error: 'Type d’avis invalide.' });
    }
    if (!isId(targetId)) {
      return res.status(400).json({ ok: false, error: 'Élément concerné invalide.' });
    }
    if (!displayName) {
      return res.status(400).json({ ok: false, error: 'Le nom affiché est obligatoire.' });
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: 'Note invalide.' });
    }
    if (!MANUAL_CREATION_STATUSES.has(requestedStatus)) {
      return res.status(400).json({ ok: false, error: 'Statut manuel invalide.' });
    }

    const now = new Date();
    // Date de l'avis réglable côté institut (backdate possible ; jamais dans le futur).
    let createdAt = now;
    if (req.body?.reviewDate !== undefined && req.body?.reviewDate !== null && String(req.body.reviewDate).trim() !== '') {
      const parsed = new Date(req.body.reviewDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ ok: false, error: 'Date de l’avis invalide.' });
      }
      if (parsed.getTime() > now.getTime()) {
        return res.status(400).json({ ok: false, error: 'La date de l’avis ne peut pas être dans le futur.' });
      }
      createdAt = parsed;
    }

    const target = await resolveTarget(targetType, targetId);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Élément concerné introuvable.' });
    }

    const review = await Review.create({
      targetType,
      sourceType: 'manual_institute',
      displayName,
      rating,
      comment,
      status: requestedStatus,
      moderatedAt: requestedStatus === 'published' ? now : null,
      moderatedByAdminId: requestedStatus === 'published' ? req.sessionUser?._id || null : null,
      formationId: targetType === 'formation' ? target._id : null,
      serviceId: targetType === 'service' ? target._id : null,
      createdAt
    });

    // LOT2 §11 — notification admin (best-effort).
    void triggerNotification('review_manual', {
      clientName: displayName || '—',
      formationName: target?.name || '—',
      rating: String(rating)
    });

    const maps = {
      formationById: targetType === 'formation' ? new Map([[String(target._id), target.name]]) : new Map(),
      serviceById: targetType === 'service' ? new Map([[String(target._id), target.name]]) : new Map(),
      userById: new Map()
    };

    return res.status(201).json({ ok: true, review: buildReviewPayload(review.toObject(), maps) });
  } catch (error) {
    console.error('[reviewModeration] createManual', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
