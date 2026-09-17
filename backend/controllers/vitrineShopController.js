import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import FormationSession, { buildActiveFormationSessionFilter } from '../models/FormationSession.js';
import Product from '../models/Product.js';
import Review from '../models/Review.js';
import {
  calculateFinalPrice,
  getActivePromotionsForTargets,
  buildPromotionSummary
} from '../services/promotionService.js';
import { getEditableContent } from '../services/editableContentService.js';
import {
  extractPreviewFromEditorial,
  getFormationEditorialMap
} from '../services/formationEditorialService.js';
import { getFormationPurchasedUsersCount } from '../services/formationPurchaseStatsService.js';
import { getPublishedReviewStatsForTargets, listPublishedReviews } from '../services/reviews/publicReviewQueries.js';
import { serializeFaq } from '../services/faq/faqSanitizer.js';

const { Types } = mongoose;
const FORMATION_STATUS_PUBLISHED = 'published';

function sanitizePhotos(value) {
  if (!Array.isArray(value)) return [];
  return value.map(entry => String(entry || '').trim()).filter(Boolean);
}

function buildHighlightEntry(item, kind, promotion) {
  if (!item) return null;
  const prices = buildPricePayload(item.price, promotion);
  const parsedRefundDays = Number(item?.refundDays);
  return {
    id: item._id?.toString(),
    kind,
    name: item.name,
    coverImage: item.coverImage || '',
    type: kind === 'formation' ? item.type || 'formation' : 'produit',
    price: prices.price,
    finalPrice: prices.finalPrice,
    boostOrder: Number.isFinite(Number(item.boostOrder)) ? Number(item.boostOrder) : null,
    activePromotion: buildPromotionSummary(promotion),
    refundDays:
      kind === 'formation' && Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : undefined
  };
}

export async function getHighlightedItems(_req, res) {
  try {
    const [boostedFormations, boostedProducts] = await Promise.all([
      Formation.find({ isBoosted: true }).lean(),
      Product.find({ isBoosted: true }).lean()
    ]);
    const formationIds = boostedFormations.map(entry => entry._id?.toString()).filter(Boolean);
    const productIds = boostedProducts.map(entry => entry._id?.toString()).filter(Boolean);
    const [formationPromotions, productPromotions] = await Promise.all([
      getActivePromotionsForTargets('formation', formationIds),
      getActivePromotionsForTargets('product', productIds)
    ]);
    const highlights = [
      ...boostedProducts
        .map(doc => buildHighlightEntry(doc, 'product', productPromotions.get(doc._id?.toString())))
        .filter(Boolean),
      ...boostedFormations
        .map(doc => buildHighlightEntry(doc, 'formation', formationPromotions.get(doc._id?.toString())))
        .filter(Boolean)
    ]
      .filter(entry => Number.isFinite(Number(entry.boostOrder)))
      .sort((a, b) => Number(a.boostOrder) - Number(b.boostOrder))
      .slice(0, 3);
    return res.json({ ok: true, highlights });
  } catch (error) {
    console.error('Erreur boosts vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger les éléments mis en avant.' });
  }
}

function buildPricePayload(basePrice, promotion) {
  const normalizedBase = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0;
  const { finalPrice } = calculateFinalPrice(normalizedBase, promotion);
  return {
    price: normalizedBase,
    finalPrice,
    activePromotion: buildPromotionSummary(promotion)
  };
}

function buildFormationForShop(doc, promotion, editorialHtml = '') {
  if (!doc) return null;
  const prices = buildPricePayload(doc.price, promotion);
  const previewDescription = extractPreviewFromEditorial(editorialHtml, doc.description || '');
  const parsedRefundDays = Number(doc.refundDays);
  return {
    id: doc._id?.toString(),
    name: doc.name,
    description: previewDescription,
    price: prices.price,
    finalPrice: prices.finalPrice,
    coverImage: doc.coverImage || '',
    type: doc.type,
    refundDays: Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : 7,
    status: doc.status,
    activePromotion: prices.activePromotion,
    createdAt: doc.createdAt
  };
}

function buildProductForShop(doc, promotion) {
  if (!doc) return null;
  const prices = buildPricePayload(doc.price, promotion);
  return {
    id: doc._id?.toString(),
    name: doc.name,
    price: prices.price,
    finalPrice: prices.finalPrice,
    coverImage: doc.coverImage || '',
    activePromotion: prices.activePromotion,
    createdAt: doc.createdAt
  };
}

function buildOptionForVitrine(option, sessionStartAt = null) {
  if (!option) return null;
  let available = false;
  if (sessionStartAt) {
    const startMs = new Date(sessionStartAt).getTime();
    const nowMs = Date.now();
    const deadlineMs = Number(option.deadlineDays || 0) * 86400000;
    available = startMs - nowMs > deadlineMs;
  }
  return {
    id: option._id?.toString(),
    name: option.name || '',
    description: option.description || '',
    image: option.image || '',
    price: Number.isFinite(Number(option.price)) ? Number(option.price) : 0,
    deadlineDays: Number.isFinite(Number(option.deadlineDays)) ? Number(option.deadlineDays) : 0,
    available
  };
}

async function buildDetail(item, kind, promotion) {
  if (!item) return null;
  const photos = [item.coverImage, ...(sanitizePhotos(item.photos || []))].filter(Boolean);
  const detailType = kind === 'formation' ? item.type || 'distanciel' : 'produit';
  const priceInfo = buildPricePayload(item.price, promotion);
  const targetId = item._id?.toString();
  const editorial = targetId ? await getEditableContent(kind, targetId) : {};
  const editorialHtml = String(editorial.description || '');
  const previewDescription = extractPreviewFromEditorial(editorialHtml, item.description || '');
  const purchasedUsersCount =
    kind === 'formation' && targetId ? await getFormationPurchasedUsersCount(targetId) : 0;
  const options =
    kind === 'formation' && item.type === 'presentiel' && Array.isArray(item.options)
      ? item.options.map(opt => buildOptionForVitrine(opt, null))
      : [];
  const parsedRefundDays = Number(item?.refundDays);
  return {
    kind,
    id: item._id?.toString(),
    name: item.name,
    description: previewDescription,
    price: priceInfo.price,
    finalPrice: priceInfo.finalPrice,
    coverImage: item.coverImage || '',
    photos,
    trailerVideoUrl: item.trailerVideoUrl || '',
    type: detailType,
    refundDays:
      kind === 'formation' && Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : undefined,
    status: item.status || '',
    activePromotion: priceInfo.activePromotion,
    createdAt: item.createdAt,
    editorialHtml,
    salesCount: purchasedUsersCount,
    purchasedUsersCount,
    options,
    faq: kind === 'formation' ? serializeFaq(item.faq) : []
  };
}

export async function getFormationSessionOptions(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    const sessionId = String(req.params.sessionId || '').trim();
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ ok: false, error: 'Formation ou session invalide.' });
    }
    const formation = await Formation.findOne({ _id: id, status: FORMATION_STATUS_PUBLISHED }).lean();
    if (!formation || formation.type !== 'presentiel') {
      return res.status(404).json({ ok: false, error: 'Formation présentielle introuvable.' });
    }
    const session = await FormationSession.findOne(
      buildActiveFormationSessionFilter({ _id: sessionId, formationId: formation._id })
    ).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    const sessionStartAt = session.startDate;
    const options = Array.isArray(formation.options)
      ? formation.options.map(opt => buildOptionForVitrine(opt, sessionStartAt))
      : [];
    return res.json({ ok: true, options });
  } catch (error) {
    console.error('Erreur options session vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les options.' });
  }
}

async function notFound(res, message = 'Élément introuvable.') {
  return res.status(404).json({ ok: false, error: message });
}

export async function getShopListing(_req, res) {
  try {
    const [formations, products] = await Promise.all([
      Formation.find({ status: FORMATION_STATUS_PUBLISHED }).lean(),
      Product.find({ active: true }).lean()
    ]);
    const formationIds = Array.from(
      new Set(formations.map(entry => entry._id?.toString()).filter(Boolean))
    );
    const productIds = Array.from(
      new Set(products.map(entry => entry._id?.toString()).filter(Boolean))
    );
    const [formationPromotions, productPromotions, formationEditorialMap, formationReviewStats] = await Promise.all([
      getActivePromotionsForTargets('formation', formationIds),
      getActivePromotionsForTargets('product', productIds),
      getFormationEditorialMap(formationIds),
      getPublishedReviewStatsForTargets('formation', formationIds)
    ]);
    const payload = {
      formations: formations
        .map(doc => {
          const built = buildFormationForShop(
            doc,
            formationPromotions.get(doc._id?.toString()),
            formationEditorialMap.get(doc._id?.toString()) || ''
          );
          if (!built) return null;
          const stats = formationReviewStats.get(doc._id?.toString()) || { averageRating: 0, reviewCount: 0 };
          return { ...built, averageRating: stats.averageRating, reviewCount: stats.reviewCount };
        })
        .filter(Boolean),
      products: products
        .map(doc => buildProductForShop(doc, productPromotions.get(doc._id?.toString())))
        .filter(Boolean)
    };
    return res.json({ ok: true, ...payload });
  } catch (error) {
    console.error('Erreur shop listing', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger la boutique.' });
  }
}

export async function getFormationDetail(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Formation invalide.' });
    }
    const formation = await Formation.findOne({ _id: id, status: FORMATION_STATUS_PUBLISHED }).lean();
    if (!formation) {
      return notFound(res, 'Formation introuvable.');
    }
    const formationId = formation._id?.toString();
    const formationPromotionMap = formationId
      ? await getActivePromotionsForTargets('formation', [formationId])
      : new Map();
    const detail = await buildDetail(formation, 'formation', formationPromotionMap.get(formationId));
    return res.json({ ok: true, formation: detail });
  } catch (error) {
    console.error('Erreur détail formation vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la formation.' });
  }
}

export async function getProductDetail(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Produit invalide.' });
    }
    const product = await Product.findOne({ _id: id, active: true }).lean();
    if (!product) {
      return notFound(res, 'Produit introuvable.');
    }
    const productId = product._id?.toString();
    const productPromotionMap = productId
      ? await getActivePromotionsForTargets('product', [productId])
      : new Map();
    const detail = await buildDetail(product, 'product', productPromotionMap.get(productId));
    return res.json({ ok: true, product: detail });
  } catch (error) {
    console.error('Erreur détail produit vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le produit.' });
  }
}

export async function getFormationReviewStats(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    if (!Types.ObjectId.isValid(formationId)) {
      return res.status(400).json({ ok: false, error: 'Formation invalide.' });
    }
    const objectId = new Types.ObjectId(formationId);
    const aggregation = await Review.aggregate([
      { $match: { formationId: objectId, $or: [{ status: 'published' }, { status: { $exists: false } }] } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 }
        }
      }
    ]);
    const stats = aggregation[0] || { averageRating: 0, reviewCount: 0 };
    const averageRating =
      typeof stats.averageRating === 'number' ? Number(stats.averageRating.toFixed(2)) : 0;
    const reviewCount = Number.isFinite(Number(stats.reviewCount)) ? Number(stats.reviewCount) : 0;
    return res.json({ ok: true, averageRating, reviewCount });
  } catch (error) {
    console.error('Erreur stats avis vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les avis.' });
  }
}

export async function getFormationReviews(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    if (!Types.ObjectId.isValid(formationId)) {
      return res.status(400).json({ ok: false, error: 'Formation invalide.' });
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const sort = String(req.query.sort || 'recent');
    const result = await listPublishedReviews('formation', formationId, { page, sort });
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Erreur liste avis vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les avis.' });
  }
}
