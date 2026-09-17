import mongoose from 'mongoose';

import Promotion from '../models/Promotion.js';

const VALID_TARGETS = ['product', 'formation', 'service'];

function normalizeTargetType(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return VALID_TARGETS.includes(candidate) ? candidate : null;
}

function resolveObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
}

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function ensureDate(value) {
  if (!value) return new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function buildActivePromotionQuery(targetType, targetId, date) {
  return {
    targetType,
    targetId,
    startAt: { $lte: date },
    $or: [{ endAt: null }, { endAt: { $gte: date } }]
  };
}

export async function getActivePromotion(targetType, targetId, date = new Date()) {
  const normalizedType = normalizeTargetType(targetType);
  const normalizedId = resolveObjectId(targetId);
  if (!normalizedType || !normalizedId) return null;
  const effectiveDate = ensureDate(date);
  const query = buildActivePromotionQuery(normalizedType, normalizedId, effectiveDate);
  const promotion = await Promotion.findOne(query).sort({ startAt: -1 }).lean();
  return promotion || null;
}

export async function getActivePromotionsForTargets(targetType, targetIds, date = new Date()) {
  const normalizedType = normalizeTargetType(targetType);
  if (!normalizedType || !Array.isArray(targetIds) || !targetIds.length) {
    return new Map();
  }
  const resolvedIds = targetIds
    .map(id => resolveObjectId(id))
    .filter(Boolean)
    .map(objectId => objectId.toString());
  if (!resolvedIds.length) return new Map();
  const effectiveDate = ensureDate(date);
  const query = {
    targetType: normalizedType,
    targetId: { $in: resolvedIds.map(id => new mongoose.Types.ObjectId(id)) },
    startAt: { $lte: effectiveDate },
    $or: [{ endAt: null }, { endAt: { $gte: effectiveDate } }]
  };
  const promotions = await Promotion.find(query).sort({ startAt: -1 }).lean();
  const map = new Map();
  for (const promotion of promotions) {
    const targetKey = promotion.targetId?.toString();
    if (!targetKey || map.has(targetKey)) continue;
    map.set(targetKey, promotion);
  }
  return map;
}

export function calculateFinalPrice(basePrice, promotion) {
  const normalizedBase = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0;
  let finalPrice = normalizedBase;
  if (!promotion) {
    return { finalPrice: roundToCents(finalPrice), discountAmount: 0 };
  }
  const value = Number.isFinite(Number(promotion.discountValue)) ? Number(promotion.discountValue) : 0;
  if (promotion.discountType === 'percentage') {
    finalPrice = normalizedBase - (normalizedBase * value) / 100;
  } else {
    finalPrice = normalizedBase - value;
  }
  finalPrice = roundToCents(finalPrice);
  if (finalPrice < 0) {
    finalPrice = 0;
  }
  const discountAmount = roundToCents(normalizedBase - finalPrice);
  return { finalPrice, discountAmount };
}

// Pré-React E1 — Prix unitaire effectif d'une prestation après promotion. SOURCE UNIQUE
// DÉFINITIVE : le modèle `Promotion(targetType:'service')`. Le sous-document legacy
// `Service.promotion` N'EST PLUS CONSULTÉ côté runtime (migration finalisée, cf. rapport 121 ;
// script scripts/migrateServicePromotionsToPromotionModel.js --apply à exécuter une fois en
// production). Le champ `Service.promotion` est conservé pour compat DB mais n'a plus d'effet.
export async function resolveEffectiveServiceUnitPrice(service, now = new Date()) {
  const base = Number(service?.price || 0);
  const effectiveDate = ensureDate(now);

  const promo = await getActivePromotion('service', service?._id, effectiveDate);
  if (promo) {
    const { finalPrice, discountAmount } = calculateFinalPrice(base, promo);
    return { unitPrice: finalPrice, discountAmount, source: 'promotion', promotionId: promo._id || null };
  }

  return { unitPrice: roundToCents(base), discountAmount: 0, source: null, promotionId: null };
}

export function buildPromotionSummary(promotion) {
  if (!promotion) return null;
  return {
    id: promotion._id?.toString(),
    discountType: promotion.discountType,
    discountValue: Number(promotion.discountValue || 0),
    startAt: promotion.startAt,
    endAt: promotion.endAt
  };
}
