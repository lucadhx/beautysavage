export const REVIEW_TARGET_TYPES = Object.freeze(['formation', 'service']);
export const REVIEW_SOURCE_TYPES = Object.freeze(['client', 'manual_institute']);

export function normalizeReviewTargetType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return REVIEW_TARGET_TYPES.includes(normalized) ? normalized : null;
}

export function normalizeReviewSourceType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return REVIEW_SOURCE_TYPES.includes(normalized) ? normalized : null;
}

export function inferReviewTargetType(review) {
  if (String(review?.targetType || '').trim().toLowerCase() === 'service' || review?.serviceId) {
    return 'service';
  }
  return 'formation';
}

export function inferReviewSourceType(review) {
  if (String(review?.sourceType || '').trim().toLowerCase() === 'manual_institute') {
    return 'manual_institute';
  }
  return review?.userId ? 'client' : 'manual_institute';
}

export function combineReviewFilters(...filters) {
  const normalized = filters.filter(Boolean).filter(filter => Object.keys(filter).length > 0);
  if (!normalized.length) return {};
  if (normalized.length === 1) return normalized[0];
  return { $and: normalized };
}

export function buildFormationTypeFilter() {
  return {
    $or: [{ targetType: 'formation' }, { targetType: { $exists: false } }]
  };
}

export function buildReviewTypeFilter(targetType) {
  const normalized = normalizeReviewTargetType(targetType);
  if (normalized === 'service') return { targetType: 'service' };
  if (normalized === 'formation') return buildFormationTypeFilter();
  return {};
}

export function buildReviewTargetFilter(targetType, targetId) {
  const normalized = normalizeReviewTargetType(targetType);
  if (!targetId || !normalized) return {};
  if (normalized === 'service') {
    return { targetType: 'service', serviceId: targetId };
  }
  return combineReviewFilters(buildFormationTypeFilter(), { formationId: targetId });
}

export function buildPublishedReviewStatusFilter() {
  return {
    $or: [{ status: 'published' }, { status: { $exists: false } }]
  };
}

export function buildModerationStatusFilter(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'published') return buildPublishedReviewStatusFilter();
  if (normalized === 'pending' || normalized === 'rejected') return { status: normalized };
  return {};
}
