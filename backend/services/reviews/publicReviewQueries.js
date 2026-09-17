import mongoose from 'mongoose';

import Review from '../../models/Review.js';
import User from '../../models/user.js';
import {
  combineReviewFilters,
  buildPublishedReviewStatusFilter,
  buildReviewTargetFilter,
  buildReviewTypeFilter,
  normalizeReviewTargetType
} from './reviewTargeting.js';

function buildPublicMatch(targetType, targetId) {
  return combineReviewFilters(
    buildReviewTargetFilter(targetType, new mongoose.Types.ObjectId(targetId)),
    buildPublishedReviewStatusFilter()
  );
}

export async function getPublishedReviewStats(targetType, targetId) {
  const aggregation = await Review.aggregate([
    { $match: buildPublicMatch(targetType, targetId) },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        reviewCount: { $sum: 1 }
      }
    }
  ]);

  const stats = aggregation[0] || { averageRating: 0, reviewCount: 0 };
  return {
    averageRating:
      typeof stats.averageRating === 'number' ? Number(stats.averageRating.toFixed(2)) : 0,
    reviewCount: Number.isFinite(Number(stats.reviewCount)) ? Number(stats.reviewCount) : 0
  };
}

// Statistiques (moyenne + nombre) publiées pour PLUSIEURS cibles en une seule agrégation
// (évite le N+1 sur les listes catalogue). Renvoie une Map id→{averageRating, reviewCount}.
export async function getPublishedReviewStatsForTargets(targetType, targetIds) {
  const normalizedType = normalizeReviewTargetType(targetType);
  const field = normalizedType === 'service' ? 'serviceId' : 'formationId';
  const uniqueIds = [...new Set((targetIds || []).map(id => String(id || '')).filter(Boolean))];
  const map = new Map();
  if (!normalizedType || !uniqueIds.length) return map;

  const objectIds = uniqueIds
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return map;

  const rows = await Review.aggregate([
    {
      $match: combineReviewFilters(
        buildReviewTypeFilter(normalizedType),
        buildPublishedReviewStatusFilter(),
        { [field]: { $in: objectIds } }
      )
    },
    {
      $group: {
        _id: `$${field}`,
        averageRating: { $avg: '$rating' },
        reviewCount: { $sum: 1 }
      }
    }
  ]);

  for (const row of rows) {
    map.set(String(row._id), {
      averageRating:
        typeof row.averageRating === 'number' ? Number(row.averageRating.toFixed(2)) : 0,
      reviewCount: Number.isFinite(Number(row.reviewCount)) ? Number(row.reviewCount) : 0
    });
  }
  return map;
}

// Nom public affiché : prénom + initiale du nom (client), sinon nom saisi (avis manuel).
function formatPublicAuthorName(user) {
  const first = String(user?.firstName || '').trim();
  const last = String(user?.lastName || '').trim();
  if (first && last) return `${first} ${last.charAt(0).toUpperCase()}.`;
  return first || 'Client';
}

export async function listPublishedReviews(
  targetType,
  targetId,
  { page = 1, sort = 'recent', pageSize = 5 } = {}
) {
  const sortStage =
    sort === 'best'
      ? { rating: -1, createdAt: -1, _id: -1 }
      : { createdAt: -1, rating: -1, _id: -1 };

  const match = buildPublicMatch(targetType, targetId);
  const cursor = Review.find(match)
    .sort(sortStage)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .select({ rating: 1, comment: 1, createdAt: 1, displayName: 1, userId: 1, _id: 0 });
  const [rawReviews, total] = await Promise.all([cursor.lean(), Review.countDocuments(match)]);

  const userIds = [...new Set(rawReviews.map(r => String(r.userId || '')).filter(Boolean))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('firstName lastName').lean()
    : [];
  const nameById = new Map(users.map(u => [String(u._id), formatPublicAuthorName(u)]));

  const reviews = rawReviews.map(r => ({
    rating: r.rating,
    comment: r.comment || '',
    createdAt: r.createdAt || null,
    authorName:
      String(r.displayName || '').trim() || nameById.get(String(r.userId || '')) || 'Client'
  }));

  return {
    reviews,
    page,
    hasMore: page * pageSize < total,
    total
  };
}
