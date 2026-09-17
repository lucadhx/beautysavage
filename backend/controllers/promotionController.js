import mongoose from 'mongoose';

import Promotion from '../models/Promotion.js';
import { getSessionUserId } from '../utils/session.js';
import { getActivePromotion, buildPromotionSummary } from '../services/promotionService.js';

const { Types } = mongoose;
const VALID_TARGETS = ['product', 'formation'];
const VALID_DISCOUNT_TYPES = ['fixed', 'percentage'];

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function sanitizeTargetType(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return VALID_TARGETS.includes(candidate) ? candidate : null;
}

function sanitizeDiscountType(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return VALID_DISCOUNT_TYPES.includes(candidate) ? candidate : null;
}

export async function listPromotions(req, res) {
  const targetType = sanitizeTargetType(req.query?.targetType);
  const targetId = String(req.query?.targetId || '').trim();
  if (!targetType || !Types.ObjectId.isValid(targetId)) {
    return res.status(400).json({ ok: false, error: 'Type ou cible invalide.' });
  }
  try {
    const normalizedId = new Types.ObjectId(targetId);
    const promotions = await Promotion.find({ targetType, targetId: normalizedId })
      .sort({ startAt: -1 })
      .lean();
    const activePromotion = await getActivePromotion(targetType, normalizedId);
    return res.json({
      ok: true,
      promotions: promotions.map(buildPromotionSummary).filter(Boolean),
      activePromotion: buildPromotionSummary(activePromotion)
    });
  } catch (error) {
    console.error('Erreur lecture promotions', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les promotions.' });
  }
}

export async function createPromotion(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const targetType = sanitizeTargetType(req.body?.targetType);
  const targetId = String(req.body?.targetId || '').trim();
  const discountType = sanitizeDiscountType(req.body?.discountType);
  const discountValue = Number(req.body?.discountValue);
  const startAt = parseDate(req.body?.startAt) || new Date();
  const endAt = parseDate(req.body?.endAt);
  if (!targetType || !Types.ObjectId.isValid(targetId) || !discountType) {
    return res.status(400).json({ ok: false, error: 'Informations de promotion invalides.' });
  }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return res.status(400).json({ ok: false, error: 'Valeur de remise invalide.' });
  }
  if (endAt && endAt < startAt) {
    return res.status(400).json({ ok: false, error: 'La date de fin doit suivre la date de début.' });
  }
  try {
    const promotion = new Promotion({
      targetType,
      targetId: new Types.ObjectId(targetId),
      discountType,
      discountValue,
      startAt,
      endAt: endAt || null,
      createdBy: userId
    });
    await promotion.save();
    return res.status(201).json({ ok: true, promotion: buildPromotionSummary(promotion) });
  } catch (error) {
    console.error('Erreur creation promotion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de sauvegarder la promotion.' });
  }
}
