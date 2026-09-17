import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

import Service from '../models/Service.js';
import PractitionerProfile from '../models/PractitionerProfile.js';
import { getActivePromotion, calculateFinalPrice } from '../services/promotionService.js';
import {
  getPublishedReviewStats,
  getPublishedReviewStatsForTargets,
  listPublishedReviews
} from '../services/reviews/publicReviewQueries.js';
import { sanitizeFaqInput, serializeFaq } from '../services/faq/faqSanitizer.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildServicePayload(doc) {
  if (!doc) return null;
  return {
    id: doc._id?.toString(),
    name: doc.name,
    slug: doc.slug,
    description: doc.description || '',
    shortDescription: doc.shortDescription || '',
    duration: doc.duration,
    price: doc.price,
    photos: doc.photos || [],
    isActive: doc.isActive,
    isBookable: doc.isBookable,
    paymentType: doc.paymentType,
    depositType: doc.depositType,
    depositValue: doc.depositValue,
    balanceSettlementMode: doc.balanceSettlementMode || 'none',
    capacity: doc.capacity,
    bufferTime: doc.bufferTime,
    promotion: doc.promotion || {},
    boost: doc.boost || {},
    cancellationDays: doc.cancellationDays,
    bookingLeadDays: doc.bookingLeadDays ?? 0,
    allowClientChoosePractitioner: doc.allowClientChoosePractitioner !== false,
    options: (doc.options || []).map(opt => ({
      id: opt._id?.toString(),
      name: opt.name,
      description: opt.description || '',
      price: opt.price,
      isActive: opt.isActive
    })),
    faq: serializeFaq(doc.faq),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

// E1 — `computeEffectivePrice` (lecture legacy `Service.promotion`) supprimé : le prix promo
// vient désormais de la source unique `Promotion` (cf. buildPublicPayload).

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

export async function listServices(req, res) {
  try {
    const docs = await Service.find({}).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, services: docs.map(buildServicePayload) });
  } catch (err) {
    console.error('[serviceController] listServices', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getService(req, res) {
  try {
    const doc = await Service.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });
    return res.json({ ok: true, service: buildServicePayload(doc) });
  } catch (err) {
    console.error('[serviceController] getService', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function createService(req, res) {
  try {
    const { name, description, shortDescription, duration, price, isActive, isBookable,
      paymentType, depositType, depositValue, balanceSettlementMode, capacity, bufferTime, cancellationDays,
      options, promotion, boost } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ ok: false, error: 'Le nom est obligatoire.' });
    }
    if (!duration || parseNumber(duration, 0) < 1) {
      return res.status(400).json({ ok: false, error: 'La durée est obligatoire.' });
    }
    if (price === undefined || price === null || price === '') {
      return res.status(400).json({ ok: false, error: 'Le prix est obligatoire.' });
    }

    const baseSlug = slugify(name.trim());
    let slug = baseSlug;
    let suffix = 0;
    while (await Service.exists({ slug })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const doc = await Service.create({
      name: name.trim(),
      slug,
      description: String(description || '').trim(),
      shortDescription: String(shortDescription || '').trim(),
      duration: parseNumber(duration, 60),
      price: parseNumber(price, 0),
      isActive: isActive !== false,
      isBookable: isBookable !== false,
      paymentType: ['full', 'deposit', 'free'].includes(paymentType) ? paymentType : 'full',
      depositType: ['percentage', 'fixed'].includes(depositType) ? depositType : 'percentage',
      depositValue: parseNumber(depositValue, 0),
      balanceSettlementMode: ['none', 'pay_on_site'].includes(balanceSettlementMode) ? balanceSettlementMode : 'none',
      capacity: Math.max(1, parseNumber(capacity, 1)),
      bufferTime: parseNumber(bufferTime, 0),
      cancellationDays: parseNumber(cancellationDays, 7),
      options: Array.isArray(options) ? options.filter(o => o.name) : [],
      photos: Array.isArray(req.body.photos) ? req.body.photos.map(p => String(p || '').trim()).filter(Boolean) : [],
      faq: sanitizeFaqInput(req.body.faq),
      promotion: promotion || {},
      boost: boost || {},
      createdBy: req.sessionUser?._id || null,
      updatedBy: req.sessionUser?._id || null
    });

    return res.status(201).json({ ok: true, service: buildServicePayload(doc) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Un slug identique existe déjà.' });
    }
    console.error('[serviceController] createService', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function updateService(req, res) {
  try {
    const doc = await Service.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });

    const {
      name, description, shortDescription, duration, price, isActive, isBookable,
      paymentType, depositType, depositValue, balanceSettlementMode, capacity, bufferTime, cancellationDays,
      options, promotion, boost,
      bookingLeadDays, allowClientChoosePractitioner
    } = req.body;

    if (name !== undefined) doc.name = String(name).trim();
    if (description !== undefined) doc.description = String(description).trim();
    if (shortDescription !== undefined) doc.shortDescription = String(shortDescription).trim();
    if (duration !== undefined) doc.duration = Math.max(1, parseNumber(duration, 60));
    if (price !== undefined) doc.price = parseNumber(price, 0);
    if (isActive !== undefined) doc.isActive = Boolean(isActive);
    if (isBookable !== undefined) doc.isBookable = Boolean(isBookable);
    if (paymentType !== undefined && ['full', 'deposit', 'free'].includes(paymentType)) {
      doc.paymentType = paymentType;
    }
    if (depositType !== undefined && ['percentage', 'fixed'].includes(depositType)) {
      doc.depositType = depositType;
    }
    if (depositValue !== undefined) doc.depositValue = parseNumber(depositValue, 0);
    if (balanceSettlementMode !== undefined && ['none', 'pay_on_site'].includes(balanceSettlementMode)) {
      doc.balanceSettlementMode = balanceSettlementMode;
    }
    if (capacity !== undefined) doc.capacity = Math.max(1, parseNumber(capacity, 1));
    if (bufferTime !== undefined) doc.bufferTime = parseNumber(bufferTime, 0);
    if (cancellationDays !== undefined) doc.cancellationDays = parseNumber(cancellationDays, 7);
    if (bookingLeadDays !== undefined) doc.bookingLeadDays = Math.max(0, Number(bookingLeadDays) || 0);
    if (allowClientChoosePractitioner !== undefined) doc.allowClientChoosePractitioner = Boolean(allowClientChoosePractitioner);
    if (Array.isArray(options)) doc.options = options.filter(o => o.name);
    // Galerie : la 1re image est la couverture. Persistée depuis l'éditeur (ajout URL/upload, ordre, suppression).
    if (Array.isArray(req.body.photos)) doc.photos = req.body.photos.map(p => String(p || '').trim()).filter(Boolean);
    if (req.body.faq !== undefined) doc.faq = sanitizeFaqInput(req.body.faq);
    if (promotion !== undefined) doc.promotion = promotion;
    if (boost !== undefined) doc.boost = boost;
    doc.updatedBy = req.sessionUser?._id || null;
    doc.updatedAt = new Date();

    await doc.save();
    return res.json({ ok: true, service: buildServicePayload(doc) });
  } catch (err) {
    console.error('[serviceController] updateService', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function deleteService(req, res) {
  try {
    const doc = await Service.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });
    // Soft delete
    doc.isActive = false;
    doc.updatedAt = new Date();
    await doc.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[serviceController] deleteService', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// C1 — Duplication d'une prestation (additif). La copie est créée en brouillon (isActive=false),
// avec un slug unique et un boost réinitialisé, pour éviter toute publication accidentelle.
export async function duplicateService(req, res) {
  try {
    const source = await Service.findById(req.params.id).lean();
    if (!source) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });

    const copyName = `${source.name} (copie)`;
    const baseSlug = slugify(copyName) || `${source.slug || 'prestation'}-copie`;
    let slug = baseSlug;
    let suffix = 0;
    while (await Service.exists({ slug })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const clone = await Service.create({
      name: copyName,
      slug,
      description: source.description || '',
      shortDescription: source.shortDescription || '',
      duration: source.duration,
      price: source.price,
      photos: Array.isArray(source.photos) ? [...source.photos] : [],
      isActive: false,
      isBookable: source.isBookable !== false,
      paymentType: source.paymentType || 'full',
      depositType: source.depositType || 'percentage',
      depositValue: source.depositValue || 0,
      balanceSettlementMode: source.balanceSettlementMode || 'none',
      capacity: source.capacity || 1,
      bufferTime: source.bufferTime || 0,
      cancellationDays: source.cancellationDays ?? 7,
      bookingLeadDays: source.bookingLeadDays ?? 0,
      allowClientChoosePractitioner: source.allowClientChoosePractitioner !== false,
      options: (source.options || []).map(o => ({
        name: o.name, description: o.description || '', price: o.price, isActive: o.isActive !== false
      })),
      promotion: { isActive: false, type: 'percentage', value: 0, startDate: null, endDate: null },
      boost: { isActive: false, order: 0 },
      createdBy: req.sessionUser?._id || null,
      updatedBy: req.sessionUser?._id || null
    });

    return res.status(201).json({ ok: true, service: buildServicePayload(clone) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Un slug identique existe déjà.' });
    }
    console.error('[serviceController] duplicateService', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function uploadServicePhoto(req, res) {
  try {
    const doc = await Service.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'Aucun fichier reçu.' });

    const photoUrl = `/uploads/services/${req.file.filename}`;
    doc.photos.push(photoUrl);
    doc.updatedAt = new Date();
    await doc.save();
    return res.json({ ok: true, photoUrl, photos: doc.photos });
  } catch (err) {
    console.error('[serviceController] uploadServicePhoto', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function deleteServicePhoto(req, res) {
  try {
    const doc = await Service.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });

    const idx = parseInt(req.params.photoIndex, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= doc.photos.length) {
      return res.status(400).json({ ok: false, error: 'Index de photo invalide.' });
    }

    const photoPath = doc.photos[idx];
    doc.photos.splice(idx, 1);
    doc.updatedAt = new Date();
    await doc.save();

    // Try to delete from disk (non-blocking)
    if (photoPath && photoPath.startsWith('/uploads/')) {
      const abs = path.join(process.cwd(), photoPath);
      fs.unlink(abs, () => {});
    }

    return res.json({ ok: true, photos: doc.photos });
  } catch (err) {
    console.error('[serviceController] deleteServicePhoto', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function patchServiceBoost(req, res) {
  try {
    const doc = await Service.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });

    const { isActive, order } = req.body;
    if (!doc.boost) doc.boost = {};
    if (isActive !== undefined) doc.boost.isActive = Boolean(isActive);
    if (order !== undefined) doc.boost.order = parseNumber(order, 0);
    doc.updatedAt = new Date();
    doc.markModified('boost');
    await doc.save();
    return res.json({ ok: true, boost: doc.boost });
  } catch (err) {
    console.error('[serviceController] patchServiceBoost', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function patchServicePromotion(req, res) {
  try {
    const doc = await Service.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });

    const { isActive, type, value, startDate, endDate } = req.body;
    if (!doc.promotion) doc.promotion = {};
    if (isActive !== undefined) doc.promotion.isActive = Boolean(isActive);
    if (type !== undefined && ['percentage', 'fixed'].includes(type)) doc.promotion.type = type;
    if (value !== undefined) doc.promotion.value = parseNumber(value, 0);
    if (startDate !== undefined) doc.promotion.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) doc.promotion.endDate = endDate ? new Date(endDate) : null;
    doc.updatedAt = new Date();
    doc.markModified('promotion');
    await doc.save();
    return res.json({ ok: true, promotion: doc.promotion });
  } catch (err) {
    console.error('[serviceController] patchServicePromotion', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── Vitrine (public) ────────────────────────────────────────────────────────

// E1 — prix d'affichage vitrine : la promotion vient de la SOURCE UNIQUE `Promotion`
// (plus du sous-document legacy `Service.promotion`). Cohérent avec le checkout/pricing serveur.
async function buildPublicPayload(doc) {
  const promo = await getActivePromotion('service', doc._id);
  const effectivePrice = promo ? calculateFinalPrice(doc.price, promo).finalPrice : doc.price;
  const hasPromo = Boolean(promo) && effectivePrice < doc.price;

  return {
    id: doc._id?.toString(),
    slug: doc.slug,
    name: doc.name,
    shortDescription: doc.shortDescription || '',
    description: doc.description || '',
    duration: doc.duration,
    price: doc.price,
    effectivePrice,
    hasPromo,
    promotionLabel: hasPromo
      ? (promo.discountType === 'percentage'
        ? `-${promo.discountValue}%`
        : `-${Number(promo.discountValue).toFixed(2)} €`)
      : null,
    photos: doc.photos || [],
    isBookable: doc.isBookable,
    paymentType: doc.paymentType,
    depositValue: doc.depositValue,
    depositType: doc.depositType,
    capacity: doc.capacity,
    cancellationDays: doc.cancellationDays,
    bookingLeadDays: doc.bookingLeadDays ?? 0,
    allowClientChoosePractitioner: doc.allowClientChoosePractitioner !== false,
    options: (doc.options || []).filter(o => o.isActive).map(opt => ({
      id: opt._id?.toString(),
      name: opt.name,
      description: opt.description || '',
      price: opt.price
    })),
    faq: serializeFaq(doc.faq),
    boost: doc.boost || {}
  };
}

export async function listPublicServices(req, res) {
  try {
    const docs = await Service.find({ isActive: true }).sort({ 'boost.order': 1, name: 1 }).lean();
    const payloads = await Promise.all(docs.map(buildPublicPayload));
    const statsMap = await getPublishedReviewStatsForTargets('service', payloads.map(p => p.id));
    const services = payloads.map(payload => {
      const stats = statsMap.get(payload.id) || { averageRating: 0, reviewCount: 0 };
      return { ...payload, averageRating: stats.averageRating, reviewCount: stats.reviewCount };
    });
    return res.json({ ok: true, services });
  } catch (err) {
    console.error('[serviceController] listPublicServices', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getPublicServiceBySlug(req, res) {
  try {
    const doc = await Service.findOne({ slug: req.params.slug, isActive: true }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: 'Prestation introuvable.' });

    // Also fetch practitioners who offer this service
    const practitioners = await PractitionerProfile.find({
      serviceIds: doc._id,
      isActive: true
    }).select('displayName photo color').lean();

    const payload = await buildPublicPayload(doc);
    payload.practitioners = practitioners.map(p => ({
      id: p._id?.toString(),
      displayName: p.displayName || '',
      photo: p.photo || null,
      color: p.color || '#c5bb96'
    }));

    return res.json({ ok: true, service: payload });
  } catch (err) {
    console.error('[serviceController] getPublicServiceBySlug', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getServiceReviewStats(req, res) {
  try {
    const serviceId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ ok: false, error: 'Prestation invalide.' });
    }
    const stats = await getPublishedReviewStats('service', serviceId);
    return res.json({ ok: true, averageRating: stats.averageRating, reviewCount: stats.reviewCount });
  } catch (err) {
    console.error('[serviceController] getServiceReviewStats', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getServiceReviews(req, res) {
  try {
    const serviceId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ ok: false, error: 'Prestation invalide.' });
    }
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const sort = String(req.query.sort || 'recent');
    const result = await listPublishedReviews('service', serviceId, { page, sort, pageSize: 5 });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[serviceController] getServiceReviews', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function listBoostedServices(req, res) {
  try {
    const docs = await Service.find({ isActive: true, 'boost.isActive': true })
      .sort({ 'boost.order': 1 })
      .lean();
    const payloads = await Promise.all(docs.map(buildPublicPayload));
    const statsMap = await getPublishedReviewStatsForTargets('service', payloads.map(p => p.id));
    const services = payloads.map(payload => {
      const stats = statsMap.get(payload.id) || { averageRating: 0, reviewCount: 0 };
      return { ...payload, averageRating: stats.averageRating, reviewCount: stats.reviewCount };
    });
    return res.json({ ok: true, services });
  } catch (err) {
    console.error('[serviceController] listBoostedServices', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
