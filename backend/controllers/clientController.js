import mongoose from 'mongoose';

import Product from '../models/Product.js';
import Formation from '../models/Formation.js';
import FormationModule from '../models/FormationModule.js';
import FormationSession, {
  buildActiveFormationSessionFilter,
  isInactiveFormationSessionStatus
} from '../models/FormationSession.js';
import Purchase from '../models/Purchase.js';
import User from '../models/user.js';
import CartSnapshot from '../models/CartSnapshot.js';
import Sale from '../models/Sale.js';
import RefundRequest from '../models/RefundRequest.js';
import Review from '../models/Review.js';
import Favorite from '../models/Favorite.js';
import Invoice from '../models/Invoice.js';
import { recordCommissionTransactions } from '../services/commissionService.js';
import { getActivePromotion } from '../services/promotionService.js';
import {
  sendClientSessionCancellationEmail,
  sendInstituteClientCancelledNoticeEmail
} from '../services/mail/mailDispatcher.js';
import { getSessionUserId } from '../utils/session.js';
import { extractClientIp } from '../utils/requestClientIp.js';
import { validateAndBuildConsumerWaiver } from '../utils/consumerWaiver.js';
import { buildLegalConsentSnapshot } from '../services/legalConsentService.js';
import { resolveVitrineUrl } from '../services/system/domainResolver.js';
import { buildModulePayload } from './formationModuleController.js';
import { buildSessionPayload } from './formationSessionController.js';
import {
  REFUND_REASON_CLIENT_CANCEL_PRESENTIEL,
  buildRefundId,
  getPresentielRefundEligibility,
  resolveSaleForFormationPurchase,
  resolveSaleAcceptedText,
  ensureRefundCommissionProvision
} from '../services/refundService.js';
import { triggerRefundExecution } from '../services/stripe/stripeRefundFacade.js';
import {
  applyRefundExecutionCap,
  createRefundRequestOnce,
  findActiveRefundRequestForSaleItem
} from '../services/refundRequestService.js';
import {
  formatSessionDateLabel,
  formatSessionTimeLabel,
  resolveSiteName
} from '../services/sessionCancellationFlowService.js';
import { triggerNotification } from '../services/notificationService.js';
import {
  planGiftCardUsage,
  finalizeGiftCardUsage
} from '../services/checkout/checkoutGiftCardService.js';
// Sprint F1 — Cœur Checkout extrait vers services/checkout/*. clientController n'est plus
// qu'un orchestrateur HTTP : mockPay (legacy) et saveCartSnapshot consomment ces fonctions
// via la facade. Les finaliseurs (processCheckoutStatePurchase, finalizeFreeCheckout) et la
// persistance (persistSale, runPostSaleSideEffects) y sont définis, plus ici.
import {
  persistSale,
  runPostSaleSideEffects,
  applySaleCommissionSnapshot,
  buildCustomerProfile,
  buildSaleEntry,
  buildFormationEntryFromSale,
  validateAndBuildSelectedOptions,
  persistCartSnapshot,
  rollbackSingleSale
} from '../services/checkout/checkoutFacade.js';
import { isActiveRefundRequestStatus } from '../constants/refundRequest.js';

function serializeItem(item) {
  if (!item) return null;
  return {
    id: item._id?.toString(),
    name: item.name,
    active: Boolean(item.active),
    createdAt: item.createdAt
  };
}

function serializeFormation(formation) {
  if (!formation) return null;
  const parsedRefundDays = Number(formation.refundDays);
  return {
    id: formation._id?.toString(),
    name: formation.name,
    description: formation.description || '',
    formalities: formation.formalities || '',
    durationDays: formation.durationDays || 1,
    refundDays: Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : 7,
    type: formation.type,
    status: formation.status,
    price: formation.price,
    coverImage: formation.coverImage,
    whatsappGroupUrl: formation.whatsappGroupUrl || null,
    createdAt: formation.createdAt
  };
}

function serializeProduct(product) {
  if (!product) return null;
  return {
    id: product._id?.toString(),
    name: product.name,
    description: product.description || '',
    price: Number(product.price || 0),
    coverImage: product.coverImage || '',
    photos: Array.isArray(product.photos) ? product.photos : [],
    trailerVideoUrl: product.trailerVideoUrl || '',
    createdAt: product.createdAt
  };
}

export function serializePurchasePayload(purchase, formation, session, product) {
  return {
    id: purchase._id?.toString(),
    formationId: purchase.formationId?.toString(),
    sessionId: purchase.sessionId?.toString(),
    paymentProvider: purchase.paymentProvider,
    paymentStatus: purchase.paymentStatus,
    paymentRef: purchase.paymentRef,
    saleId: String(purchase.saleId || '').trim(),
    participationStatus: String(purchase.participationStatus || 'active').trim() || 'active',
    canceledAt: purchase.canceledAt || null,
    cancellationReason: String(purchase.cancellationReason || '').trim(),
    cancellationEligibleRefund: Boolean(purchase.cancellationEligibleRefund),
    cancellationSessionStartAt: purchase.cancellationSessionStartAt || null,
    refundRequestId: String(purchase.refundRequestId || '').trim(),
    createdAt: purchase.createdAt,
    formation: serializeFormation(formation),
    session: session ? buildSessionPayload(session) : null,
    product: serializeProduct(product)
  };
}


async function collectAdminEmails() {
  const admins = await User.find({ role: 'admin' }).select('email').lean();
  const seen = new Set();
  const emails = [];
  for (const admin of admins) {
    const email = String(admin?.email || '').trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

const NAME_MAX_LENGTH = 64;

function sanitizeProfileName(value) {
  return String(value || '').trim().slice(0, NAME_MAX_LENGTH);
}

// RX4 S2 — Lecture seule du profil client (prénom/nom/e-mail). Miroir de ce que renvoie déjà updateProfile.
// AUCUNE donnée sensible, AUCUNE logique métier : sert l'accueil « Bonjour {prénom} » et le préremplissage
// du formulaire profil (le modèle User n'a pas d'autre champ self-service).
export async function getProfile(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  try {
    const user = await User.findById(userId).select('firstName lastName email').lean();
    if (!user) {
      return res.status(404).json({ ok: false, error: 'Utilisateur introuvable.' });
    }
    return res.json({
      ok: true,
      user: {
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || ''
      }
    });
  } catch (error) {
    console.error('Erreur lecture profil client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire votre profil.' });
  }
}

export async function updateProfile(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const updates = {};
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'firstName')) {
    updates.firstName = sanitizeProfileName(req.body.firstName);
  }
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'lastName')) {
    updates.lastName = sanitizeProfileName(req.body.lastName);
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ ok: false, error: 'Aucun champ valide pour la mise ÃƒÂ  jour.' });
  }
  try {
    const updated = await User.findByIdAndUpdate(userId, updates, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Utilisateur introuvable.' });
    }
    return res.json({
      ok: true,
      user: {
        firstName: updated.firstName || '',
        lastName: updated.lastName || '',
        email: updated.email || ''
      }
    });
  } catch (error) {
    console.error('Erreur mise ÃƒÂ  jour profil client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre ÃƒÂ  jour votre profil.' });
  }
}


function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}


function buildParticipantLabel(user, fallbackId) {
  const email = user?.email || '';
  if (!email.includes('@')) {
    return fallbackId ? `Participant ${String(fallbackId).slice(-4)}` : 'Participant';
  }
  const [local, domain] = email.split('@');
  const safeLocal = local ? `${local[0]}***` : 'participant';
  let safeDomain = domain || 'domaine';
  if (safeDomain.includes('.')) {
    safeDomain = safeDomain.replace(/(.).*?(\..+)/, '$1***$2');
  }
  return `${safeLocal}@${safeDomain}`;
}

async function loadPublishedFormation(formationId) {
  if (!validateObjectId(formationId)) return null;
  const formation = await Formation.findById(formationId).lean();
  if (!formation || formation.status !== 'published') {
    return null;
  }
  return formation;
}

async function loadFormationPurchase(userId, formationId) {
  if (!userId) return null;
  return Purchase.findOne({ userId, formationId, itemType: 'formation' })
    .sort({ createdAt: -1 })
    .lean();
}

async function loadActiveFormationPurchase(userId, formationId) {
  if (!userId) return null;
  return Purchase.findOne({
    userId,
    formationId,
    itemType: 'formation',
    participationStatus: { $ne: 'canceled' }
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function loadFormationPurchaseByIdForUser({ userId, formationId, purchaseId, activeOnly = false } = {}) {
  const normalizedPurchaseId = String(purchaseId || '').trim();
  if (!userId || !validateObjectId(formationId) || !validateObjectId(normalizedPurchaseId)) {
    return null;
  }
  const query = {
    _id: normalizedPurchaseId,
    userId,
    formationId,
    itemType: 'formation'
  };
  if (activeOnly) {
    query.participationStatus = { $ne: 'canceled' };
  }
  return Purchase.findOne(query).lean();
}

async function resolveFormationPurchaseForRequest({
  userId,
  formationId,
  purchaseId,
  activeOnly = false
} = {}) {
  const normalizedPurchaseId = String(purchaseId || '').trim();
  if (normalizedPurchaseId) {
    return loadFormationPurchaseByIdForUser({
      userId,
      formationId,
      purchaseId: normalizedPurchaseId,
      activeOnly
    });
  }
  return activeOnly ? loadActiveFormationPurchase(userId, formationId) : loadFormationPurchase(userId, formationId);
}

function findExistingActiveFormationPurchase(existingPurchases, formationId, { sessionId = null } = {}) {
  const normalizedFormationId = String(formationId || '').trim();
  const normalizedSessionId = sessionId ? String(sessionId).trim() : '';
  return (Array.isArray(existingPurchases) ? existingPurchases : []).find(entry => {
    if (String(entry?.itemType || '').trim().toLowerCase() !== 'formation') return false;
    if (String(entry?.itemId || '') !== normalizedFormationId) return false;
    if (String(entry?.participationStatus || 'active').trim().toLowerCase() === 'canceled') return false;
    if (normalizedSessionId) {
      return String(entry?.sessionId || '') === normalizedSessionId;
    }
    return !entry?.sessionId;
  });
}

function serializeRefundPayload(refund) {
  if (!refund) return null;
  return {
    refundId: String(refund.refundId || '').trim(),
    saleId: String(refund.saleId || '').trim(),
    status: String(refund.status || '').trim(),
    amount: Number.isFinite(Number(refund.amount)) ? Number(refund.amount) : 0,
    requestedAt: refund.requestedAt || null,
    processedAt: refund.processedAt || null,
    eligibleRefund: Boolean(refund.eligibleRefund),
    sessionStartAt: refund.sessionStartAt || null
  };
}

async function findExistingRefundForPurchase(purchaseDoc) {
  const refundId = String(purchaseDoc?.refundRequestId || '').trim();
  if (refundId) {
    const byId = await RefundRequest.findOne({ refundId }).lean();
    if (byId && isActiveRefundRequestStatus(byId.status)) return byId;
  }
  const saleId = String(purchaseDoc?.saleId || '').trim();
  if (!saleId || !purchaseDoc?.itemId) return null;
  const activeRefund = await findActiveRefundRequestForSaleItem({
    saleId,
    itemId: purchaseDoc.itemId,
    itemType: 'formation'
  });
  if (activeRefund) {
    return activeRefund.toObject();
  }
  return null;
}

async function loadUserPurchases(userId, itemType, Model) {
  const purchases = await Purchase.find({ userId, itemType }).sort({ createdAt: -1 }).lean();
  if (!purchases.length) return [];
  const ids = purchases.map(entry => entry.itemId?.toString()).filter(Boolean);
  const records = ids.length ? await Model.find({ _id: { $in: ids } }).lean() : [];
  const recordMap = new Map(records.map(record => [record._id?.toString(), record]));
  return purchases.map(purchase => ({
    id: purchase._id?.toString(),
    itemId: purchase.itemId?.toString(),
    createdAt: purchase.createdAt,
    item: serializeItem(recordMap.get(purchase.itemId?.toString()))
  }));
}

export async function getMyProducts(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  try {
    const products = await loadUserPurchases(userId, 'product', Product);
    return res.json({ ok: true, products });
  } catch (error) {
    console.error('Erreur chargement produits client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les achats produits.' });
  }
}

export async function getMyFormations(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  try {
    const purchases = await Purchase.find({ userId, itemType: 'formation' }).sort({ createdAt: -1 }).lean();
    if (!purchases.length) {
      return res.json({ ok: true, formations: [] });
    }
    const formationIds = Array.from(
      new Set(purchases.map(entry => entry.formationId?.toString()).filter(Boolean))
    );
    const sessionIds = Array.from(
      new Set(purchases.map(entry => entry.sessionId?.toString()).filter(Boolean))
    );
    const [formations, sessions] = await Promise.all([
      formationIds.length ? Formation.find({ _id: { $in: formationIds } }).lean() : [],
      sessionIds.length
        ? FormationSession.find(buildActiveFormationSessionFilter({ _id: { $in: sessionIds } })).lean()
        : []
    ]);
    const formationMap = new Map(formations.map(entry => [entry._id?.toString(), entry]));
    const sessionMap = new Map(sessions.map(entry => [entry._id?.toString(), entry]));
    const reviews = formationIds.length
      ? await Review.find({ userId, formationId: { $in: formationIds } }).lean()
      : [];
    const reviewedSet = new Set(reviews.map(entry => entry.formationId?.toString()).filter(Boolean));
    const payload = purchases.map(purchase => {
      const base = serializePurchasePayload(
        purchase,
        formationMap.get(purchase.formationId?.toString()),
        sessionMap.get(purchase.sessionId?.toString()),
        null
      );
      return {
        ...base,
        hasReview: reviewedSet.has(purchase.formationId?.toString())
      };
    });
    return res.json({ ok: true, formations: payload });
  } catch (error) {
    console.error('Erreur chargement formations client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les achats formations.' });
  }
}

function validateObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || '').trim());
}

const FAVORITE_TARGET_MODELS = {
  product: Product,
  formation: Formation
};

const FAVORITE_TARGET_LABELS = {
  product: 'Produit',
  formation: 'Formation'
};

async function fetchFavoriteTarget(targetType, targetId) {
  const Model = FAVORITE_TARGET_MODELS[targetType];
  if (!Model) return null;
  const query = { _id: targetId };
  if (targetType === 'product') {
    query.active = true;
  }
  if (targetType === 'formation') {
    query.status = 'published';
  }
  return Model.findOne(query).lean();
}

function buildFavoriteDetailUrl(targetType, targetId) {
  if (!targetType || !targetId) return null;
  const params = new URLSearchParams({ type: targetType, id: targetId });
  return `/vitrine.html?page=item-detail&${params.toString()}`;
}

function mapFavoriteTargetPayload(targetType, targetDoc) {
  if (!targetDoc) return null;
  const id = targetDoc._id?.toString();
  if (!id) return null;
  const base = {
    id,
    name: targetDoc.name || '',
    coverImage: targetDoc.coverImage || '',
    price: Number.isFinite(Number(targetDoc.price)) ? Number(targetDoc.price) : 0,
    label: FAVORITE_TARGET_LABELS[targetType] || 'Article',
    available:
      targetType === 'product'
        ? Boolean(targetDoc.active)
        : String(targetDoc.status || '').toLowerCase() === 'published',
    kind: targetType
  };
  if (targetType === 'formation') {
    const formationType = String(targetDoc.type || 'distanciel').toLowerCase();
    const parsedRefundDays = Number(targetDoc.refundDays);
    return {
      ...base,
      formationType,
      formationStatus: targetDoc.status || 'draft',
      sessionRequired: formationType === 'presentiel',
      refundDays: Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : 7
    };
  }
  return { ...base, sessionRequired: false };
}

function buildFavoritePayload(favorite, targetDoc) {
  const target = mapFavoriteTargetPayload(favorite.targetType, targetDoc);
  if (!target) return null;
  return {
    id: favorite._id?.toString(),
    targetType: favorite.targetType,
    targetId: target.id,
    createdAt: favorite.createdAt,
    detailUrl: buildFavoriteDetailUrl(favorite.targetType, target.id),
    target
  };
}

export async function getModulesForFormation(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const formationId = String(req.params.id || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  try {
    const formation = await loadPublishedFormation(formationId);
    if (!formation || formation.type !== 'distanciel') {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    const purchase = await resolveFormationPurchaseForRequest({
      userId,
      formationId: formation._id,
      purchaseId: req.query?.purchaseId,
      activeOnly: false
    });
    if (!purchase) {
      return res.status(403).json({ ok: false, error: 'AccÃ¨s refusÃ© aux modules.' });
    }
    const modules = await FormationModule.find({ formationId: formation._id })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return res.json({
      ok: true,
      formation: serializeFormation(formation),
      modules: modules.map(buildModulePayload)
    });
  } catch (error) {
    console.error('Erreur chargement modules client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les modules.' });
  }
}

export async function getModuleDetail(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const moduleId = String(req.params.moduleId || '').trim();
  if (!validateObjectId(moduleId)) {
    return res.status(400).json({ ok: false, error: 'Module invalide.' });
  }
  try {
    const module = await FormationModule.findById(moduleId).lean();
    if (!module) {
      return res.status(404).json({ ok: false, error: 'Module introuvable.' });
    }
    const formation = await loadPublishedFormation(module.formationId?.toString());
    if (!formation || formation.type !== 'distanciel') {
      return res.status(404).json({ ok: false, error: 'Module distanciel introuvable.' });
    }
    const purchase = await resolveFormationPurchaseForRequest({
      userId,
      formationId: formation._id,
      purchaseId: req.query?.purchaseId,
      activeOnly: false
    });
    if (!purchase) {
      return res.status(403).json({ ok: false, error: 'AccÃ¨s refusÃ© au module.' });
    }
    return res.json({
      ok: true,
      module: buildModulePayload(module)
    });
  } catch (error) {
    console.error('Erreur lecture module client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le module.' });
  }
}

export async function getFormationSession(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const formationId = String(req.params.id || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  try {
    const formation = await loadPublishedFormation(formationId);
    if (!formation || formation.type !== 'presentiel') {
      return res.status(404).json({ ok: false, error: 'Formation prÃ©sentielle introuvable.' });
    }
    const purchase = await resolveFormationPurchaseForRequest({
      userId,
      formationId: formation._id,
      purchaseId: req.query?.purchaseId,
      activeOnly: false
    });
    if (!purchase) {
      return res.status(403).json({ ok: false, error: 'AccÃ¨s refusÃ© : achat requis.' });
    }
    if (!purchase.sessionId) {
      return res.status(404).json({ ok: false, error: 'Session non rÃ©servÃ©e.' });
    }
    const session = await FormationSession.findOne(
      buildActiveFormationSessionFilter({ _id: purchase.sessionId })
    ).lean();
    if (!session || String(session.formationId) !== String(formation._id)) {
      return res.status(409).json({
        ok: false,
        error: 'Cette session a ete annulee par l institut. Consultez votre email pour choisir une option.'
      });
    }
    const payload = buildSessionPayload(session);
    if (!payload) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    const resolvedSale = await resolveSaleForFormationPurchase({
      userId,
      formationId: formation._id,
      preferredSaleId: String(purchase.saleId || '').trim()
    });
    const refundEligibility = getPresentielRefundEligibility({
      sale: resolvedSale?.sale || null,
      formation: {
        ...formation,
        sessionDate: session.startDate
      },
      now: new Date()
    });
    return res.json({ ok: true, session: payload, refundEligibility });
  } catch (error) {
    console.error('Erreur lecture session client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la session.' });
  }
}

export async function getFormationParticipants(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const formationId = String(req.params.id || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  try {
    const formation = await loadPublishedFormation(formationId);
    if (!formation || formation.type !== 'presentiel') {
      return res.status(404).json({ ok: false, error: 'Formation prÃ©sentielle introuvable.' });
    }
    const purchase = await resolveFormationPurchaseForRequest({
      userId,
      formationId: formation._id,
      purchaseId: req.query?.purchaseId,
      activeOnly: false
    });
    if (!purchase || !purchase.sessionId) {
      return res.status(403).json({ ok: false, error: 'AccÃ¨s refusÃ© : achat requis.' });
    }
    const participantsPurchases = await Purchase.find({
      sessionId: purchase.sessionId,
      itemType: 'formation'
    }).lean();
    if (!participantsPurchases.length) {
      return res.json({ ok: true, participants: [] });
    }
    const userIds = Array.from(
      new Set(participantsPurchases.map(entry => entry.userId?.toString()).filter(Boolean))
    );
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
    const userMap = new Map(users.map(user => [user._id?.toString(), user]));
    const participants = participantsPurchases
      .filter(entry => String(entry.userId) !== String(userId))
      .map(entry => ({
        id: entry.userId?.toString(),
        label: buildParticipantLabel(userMap.get(entry.userId?.toString()), entry.userId?.toString()),
        joinedAt: entry.createdAt,
        status: String(entry.participationStatus || 'active').trim() || 'active',
        canceledAt: entry.canceledAt || null
      }))
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === 'active' ? -1 : 1;
        }
        return new Date(left.joinedAt || 0).getTime() - new Date(right.joinedAt || 0).getTime();
      });
    return res.json({ ok: true, participants });
  } catch (error) {
    console.error('Erreur lecture participants', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les participants.' });
  }
}

export async function getFormationSummary(req, res) {
  const formationId = String(req.params.id || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  try {
    const formation = await Formation.findById(formationId).lean();
    if (!formation || formation.status !== 'published') {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    return res.json({ ok: true, formation: serializeFormation(formation) });
  } catch (error) {
    console.error('Erreur lecture formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la formation.' });
  }
}

export async function getPurchaseStatus(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const formationId = String(req.query?.formationId || '').trim();
  const sessionId = String(req.query?.sessionId || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'formationId invalide.' });
  }
  if (sessionId && !validateObjectId(sessionId)) {
    return res.status(400).json({ ok: false, error: 'sessionId invalide.' });
  }
  try {
    const purchased = Boolean(
      await Purchase.exists({
        userId,
        itemType: 'formation',
        itemId: formationId,
        sessionId: sessionId || null,
        participationStatus: { $ne: 'canceled' }
      })
    );
    return res.json({ ok: true, purchased });
  } catch (error) {
    console.error('Erreur lecture statut achat formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de verifier le statut de votre achat.' });
  }
}

export async function postFormationReview(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const formationId = String(req.params.id || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  const rating = Number(req.body?.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ ok: false, error: 'Note invalide.' });
  }
  const comment = String(req.body?.comment || '').trim();
  try {
    const formation = await loadPublishedFormation(formationId);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    const purchase = await loadFormationPurchase(userId, formation._id);
    if (!purchase) {
      return res.status(403).json({ ok: false, error: 'Achat requis pour laisser un avis.' });
    }
    const existingReview = await Review.findOne({
      userId,
      formationId: formation._id,
      $or: [{ targetType: 'formation' }, { targetType: { $exists: false } }]
    }).lean();
    if (existingReview) {
      return res.status(409).json({ ok: false, error: 'Vous avez dÃ©jÃ  laissÃ© un avis.' });
    }
    const review = new Review({
      userId,
      formationId: formation._id,
      targetType: 'formation',
      sourceType: 'client',
      rating,
      comment,
      createdAt: new Date()
    });
    await review.save();
    // LOT2 §11 — notification admin « nouvel avis reçu » (best-effort).
    void triggerNotification('review_received', {
      clientName: `${req.sessionUser?.firstName || ''} ${req.sessionUser?.lastName || ''}`.trim() || '—',
      formationName: formation?.name || '—',
      rating: String(rating)
    });
    return res.status(201).json({ ok: true });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Vous avez dÃ©jÃ  laissÃ© un avis.' });
    }
    console.error('Erreur sauvegarde avis formation', error);
    return res.status(500).json({ ok: false, error: "Impossible de sauvegarder l'avis." });
  }
}

export async function getMyPresentielSession(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  try {
    const purchase = await Purchase.findOne({ userId, sessionId: { $ne: null }, itemType: 'formation' })
      .sort({ createdAt: -1 })
      .lean();
    if (!purchase) {
      return res.status(404).json({ ok: false, error: 'Aucune session reserves.' });
    }
    const [formation, session] = await Promise.all([
      Formation.findById(purchase.formationId).lean(),
      purchase.sessionId
        ? FormationSession.findOne(buildActiveFormationSessionFilter({ _id: purchase.sessionId })).lean()
        : null
    ]);
    if (!formation || formation.type !== 'presentiel' || !session) {
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    return res.json({ ok: true, purchase: serializePurchasePayload(purchase, formation, session) });
  } catch (error) {
    console.error('Erreur lecture session client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la session.' });
  }
}

export async function mockPay(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const user = await User.findById(userId).lean();
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Utilisateur introuvable.' });
  }
  const customer = buildCustomerProfile(user);
  const clientIp = extractClientIp(req);
  const giftCardRequest = Array.isArray(req.body?.giftCards) ? req.body.giftCards : [];
  const requireGiftCardPassword = Boolean(req.body?.requireGiftCardPassword);
  let saleRecord = null;
  let purchaseRecord = null;
  let reservedSession = null;
  const requestedType = String(req.body?.type || '').toLowerCase();
  const itemType = requestedType === 'product' ? 'product' : 'formation';
  const itemId = String(req.body?.id || req.body?.formationId || '').trim();
  const legalDateAchat = new Date();
  if (!validateObjectId(itemId)) {
    return res.status(400).json({ ok: false, error: 'Identifiant de produit ou formation invalide.' });
  }
  try {
    if (itemType === 'formation') {
      const formation = await Formation.findById(itemId).lean();
      if (!formation || formation.status !== 'published') {
        return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
      }
      let consumerWaiver = null;
      const alreadyPurchased = await Purchase.exists({
        userId,
        itemType: 'formation',
        itemId: formation._id,
        sessionId: null,
        participationStatus: { $ne: 'canceled' }
      });
      if (alreadyPurchased) {
        return res.status(409).json({ ok: false, error: 'Vous avez dÃ©jÃ  achetÃ© cette formation.' });
      }
      reservedSession = null;
      let purchaseSelectedOptions = [];
      let optionSaleItemsForMockPay = [];
      if (formation.type === 'presentiel') {
        const sessionId = String(req.body?.sessionId || '').trim();
        const alreadyPurchasedSameSession = await Purchase.exists({
          userId,
          itemType: 'formation',
          itemId: formation._id,
          sessionId,
          participationStatus: { $ne: 'canceled' }
        });
        if (!validateObjectId(sessionId)) {
          return res.status(400).json({ ok: false, error: 'Session requise pour une formation en présentiel.' });
        }
        if (alreadyPurchasedSameSession) {
          return res.status(409).json({ ok: false, error: 'Vous avez deja achete cette session.' });
        }
        const targetSession = await FormationSession.findOne(
          buildActiveFormationSessionFilter({
            _id: sessionId,
            formationId: formation._id
          })
        ).lean();
        if (!targetSession) {
          return res.status(404).json({ ok: false, error: 'Session introuvable.' });
        }
        consumerWaiver = validateAndBuildConsumerWaiver(req.body, {
          dateAchat: legalDateAchat,
          hasDistancielItem: false,
          dateFormation: targetSession.startDate,
          refundDays: formation.refundDays,
          enforcePresentielWaiver: true,
          requireAcceptedCgv: true
        });
        if (Number(targetSession.reservedCount || 0) >= Number(targetSession.maxClients || 0)) {
          return res.status(409).json({ ok: false, error: 'Session complète.' });
        }
        const updatedSession = await FormationSession.findOneAndUpdate(
          buildActiveFormationSessionFilter({
            _id: targetSession._id,
            formationId: formation._id,
            reservedCount: { $lt: targetSession.maxClients }
          }),
          { $inc: { reservedCount: 1 } },
          { new: true }
        );
        if (!updatedSession) {
          return res.status(409).json({ ok: false, error: 'Session complète.' });
        }
        reservedSession = updatedSession;
        const rawSelectedOptions = Array.isArray(req.body?.selectedOptions) ? req.body.selectedOptions : [];
        const optionsResult = validateAndBuildSelectedOptions(rawSelectedOptions, formation, targetSession.startDate);
        purchaseSelectedOptions = optionsResult.selectedOptions;
        optionSaleItemsForMockPay = optionsResult.optionSaleItems;
      } else {
        consumerWaiver = validateAndBuildConsumerWaiver(req.body, {
          dateAchat: legalDateAchat,
          hasDistancielItem: String(formation.type || '').toLowerCase() === 'distanciel',
          enforcePresentielWaiver: false,
          requireAcceptedCgv: true
        });
      }
      const now = new Date();
      const purchase = new Purchase({
        userId,
        formationId: formation._id,
        sessionId: reservedSession ? reservedSession._id : null,
        paymentProvider: 'mock',
        paymentStatus: 'paid',
        paymentRef: `MOCK-${Date.now()}`,
        itemType: 'formation',
        itemId: formation._id,
        selectedOptions: purchaseSelectedOptions,
        createdAt: now
      });
      await purchase.save();
      purchaseRecord = purchase;
      const promotion = await getActivePromotion('formation', formation._id);
      const saleItems = [
        buildSaleEntry({
          type: 'formation',
          itemId: formation._id,
          formationId: formation._id,
          name: formation.name,
          basePrice: Number(formation.price || 0),
          promotion
        }),
        ...optionSaleItemsForMockPay
      ];
      const totalAmount = saleItems.reduce((sum, entry) => sum + Number(entry.finalPrice || 0), 0);
      const giftPlan = await planGiftCardUsage(giftCardRequest, totalAmount, {
        requirePassword: requireGiftCardPassword
      });
      saleRecord = await persistSale({
        userId,
        customer,
        items: saleItems,
        giftCardUsage: giftPlan.saleEntries,
        consumerWaiver,
        clientIp,
        skipPostSaleSideEffects: true,
        legalConsentSnapshot: buildLegalConsentSnapshot({
          legal: {
            acceptedCgv: consumerWaiver?.accepted_cgv,
            waiverAccepted: Boolean(consumerWaiver?.renonciation_text),
            waiverText: consumerWaiver?.renonciation_text || '',
            waiverAcceptedAt: consumerWaiver?.consumerWaiverAcceptedAt || legalDateAchat
          },
          acceptedAt: legalDateAchat,
          source: 'mock_pay'
        })
      });
      const formationEntries = saleItems
        .map(buildFormationEntryFromSale)
        .filter(Boolean);
      if (saleRecord && formationEntries.length) {
        const commissionTransactions = await recordCommissionTransactions({
          saleId: saleRecord.saleId,
          formationEntries
        });
        await applySaleCommissionSnapshot(saleRecord, commissionTransactions);
      }
      if (saleRecord?.saleId && purchaseRecord?._id) {
        purchaseRecord.saleId = saleRecord.saleId;
        await Purchase.findByIdAndUpdate(purchaseRecord._id, { saleId: saleRecord.saleId }).catch(() => {});
      }
      if (giftPlan.usages.length) {
        await finalizeGiftCardUsage({
          userId,
          saleDoc: saleRecord,
          saleItems,
          usages: giftPlan.usages
        });
      }
      if (saleRecord) {
        await runPostSaleSideEffects(saleRecord);
      }
      await CartSnapshot.deleteOne({ userId });
      return res.status(201).json({
        ok: true,
        purchase: serializePurchasePayload(purchase.toObject(), formation, reservedSession || null, null),
        giftCardUsage: giftPlan.saleEntries
      });
    }
    const product = await Product.findById(itemId).lean();
    if (!product || !product.active) {
      return res.status(404).json({ ok: false, error: 'Produit introuvable.' });
    }
    const alreadyPurchased = await Purchase.exists({ userId, itemType: 'product', itemId: product._id });
    if (alreadyPurchased) {
      return res.status(409).json({ ok: false, error: 'Vous avez dÃ©jÃ  achetÃ© ce produit.' });
    }
    const consumerWaiver = validateAndBuildConsumerWaiver(req.body, {
      dateAchat: legalDateAchat,
      hasDistancielItem: false,
      enforcePresentielWaiver: false,
      requireAcceptedCgv: true
    });
    const now = new Date();
    const purchase = new Purchase({
      userId,
      formationId: null,
      sessionId: null,
      paymentProvider: 'mock',
      paymentStatus: 'paid',
      paymentRef: `MOCK-${Date.now()}`,
      itemType: 'product',
      itemId: product._id,
      createdAt: now
    });
    await purchase.save();
    purchaseRecord = purchase;
    const promotion = await getActivePromotion('product', product._id);
    const saleItems = [
      buildSaleEntry({
        type: 'product',
        itemId: product._id,
        name: product.name,
        basePrice: Number(product.price || 0),
        promotion
      })
    ];
    const totalAmount = saleItems.reduce((sum, entry) => sum + Number(entry.finalPrice || 0), 0);
    const giftPlan = await planGiftCardUsage(giftCardRequest, totalAmount, {
      requirePassword: requireGiftCardPassword
    });
    const saleDoc = await persistSale({
      userId,
      customer,
      items: saleItems,
      giftCardUsage: giftPlan.saleEntries,
      consumerWaiver,
      clientIp,
      skipPostSaleSideEffects: true,
      legalConsentSnapshot: buildLegalConsentSnapshot({
        legal: {
          acceptedCgv: consumerWaiver?.accepted_cgv,
          waiverAccepted: Boolean(consumerWaiver?.renonciation_text),
          waiverText: consumerWaiver?.renonciation_text || '',
          waiverAcceptedAt: consumerWaiver?.consumerWaiverAcceptedAt || legalDateAchat
        },
        acceptedAt: legalDateAchat,
        source: 'mock_pay'
      })
    });
    saleRecord = saleDoc;
    if (saleDoc?.saleId && purchaseRecord?._id) {
      purchaseRecord.saleId = saleDoc.saleId;
      await Purchase.findByIdAndUpdate(purchaseRecord._id, { saleId: saleDoc.saleId }).catch(() => {});
    }
    if (giftPlan.usages.length) {
      await finalizeGiftCardUsage({
        userId,
        saleDoc,
        saleItems,
        usages: giftPlan.usages
      });
    }
    if (saleDoc) {
      await runPostSaleSideEffects(saleDoc);
    }
    await CartSnapshot.deleteOne({ userId });
    return res.status(201).json({
      ok: true,
      purchase: serializePurchasePayload(purchase.toObject(), null, null, product),
      giftCardUsage: giftPlan.saleEntries
    });
  } catch (error) {
    if (saleRecord || purchaseRecord || reservedSession) {
      await rollbackSingleSale({
        sale: saleRecord,
        purchase: purchaseRecord,
        session: reservedSession
      });
    }
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message, code: error.code || null });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Vous avez dÃ©jÃ  achetÃ© cet article.' });
    }
    console.error('Erreur paiement simulÃ©', error);
    return res.status(500).json({ ok: false, error: 'Impossible de simuler le paiement.' });
  }
}

export async function saveCartSnapshot(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  try {
    await persistCartSnapshot(userId, items);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur snapshot panier', error);
    return res.status(500).json({ ok: false, error: 'Impossible de sauvegarder le panier.' });
  }
}

export async function listFavorites(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  try {
    const favorites = await Favorite.find({ userId }).sort({ createdAt: -1 }).lean();
    if (!favorites.length) {
      return res.json({ ok: true, favorites: [] });
    }
    const toLoad = favorites.reduce(
      (acc, favorite) => {
        const type = favorite.targetType;
        const targetId = favorite.targetId?.toString();
        if (!type || !targetId) return acc;
        if (!acc[type]) {
          acc[type] = new Set();
        }
        acc[type].add(targetId);
        return acc;
      },
      {}
    );
    const [products, formations] = await Promise.all([
      toLoad.product?.size
        ? Product.find({ _id: { $in: Array.from(toLoad.product) }, active: true }).lean()
        : [],
      toLoad.formation?.size
        ? Formation.find({ _id: { $in: Array.from(toLoad.formation) }, status: 'published' }).lean()
        : []
    ]);
    const productMap = new Map(products.map(entry => [entry._id?.toString(), entry]));
    const formationMap = new Map(formations.map(entry => [entry._id?.toString(), entry]));
    const payload = favorites
      .map(favorite => {
        const targetMap = favorite.targetType === 'formation' ? formationMap : productMap;
        const target = targetMap.get(favorite.targetId?.toString());
        return buildFavoritePayload(favorite, target);
      })
      .filter(Boolean);
    return res.json({ ok: true, favorites: payload });
  } catch (error) {
    console.error('Erreur chargement favoris', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger les favoris.' });
  }
}

export async function listMySales(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  try {
    const sales = await Sale.find({ userId }).sort({ createdAt: -1 }).lean();
    const saleIds = sales.map(entry => entry.saleId).filter(Boolean);
    const invoices = saleIds.length
      ? await Invoice.find({ saleId: { $in: saleIds } }).lean()
      : [];
    const invoiceMap = new Map(invoices.map(entry => [entry.saleId, entry]));
    const payload = sales.map(sale => {
      const items = Array.isArray(sale.items)
        ? sale.items.map(item => ({
            type: item.type,
            name: item.name || 'Article',
            price:
              Number.isFinite(Number(item.finalPrice))
                ? Number(item.finalPrice)
                : Number.isFinite(Number(item.price))
                  ? Number(item.price)
                  : 0
          }))
        : [];
      const giftCardUsage = Array.isArray(sale.giftCardUsage)
        ? sale.giftCardUsage.map(entry => ({
            amountUsed: Number.isFinite(Number(entry.amountUsed)) ? Number(entry.amountUsed) : 0
          }))
        : [];
      const invoice = invoiceMap.get(sale.saleId);
      const saleIdParam = encodeURIComponent(String(sale.saleId || ''));
      return {
        id: sale.saleId,
        createdAt: sale.createdAt,
        date_achat: sale.date_achat || sale.createdAt,
        date_formation: sale.date_formation || null,
        totalAmount: Number.isFinite(Number(sale.totalAmount)) ? Number(sale.totalAmount) : 0,
        itemCount: Number.isFinite(Number(sale.itemCount))
          ? Number(sale.itemCount)
          : items.length,
        items,
        giftCardUsage,
        accepted_cgv: Boolean(sale.accepted_cgv),
        renonciation_text: String(
          sale.renonciation_text || sale.consumerWaiverAcceptedText || ''
        ).trim(),
        client_ip: String(sale.client_ip || '').trim(),
        consumerWaiverAcceptedText: String(
          sale.consumerWaiverAcceptedText || sale.renonciation_text || ''
        ).trim(),
        invoice: invoice
          ? {
              id: invoice.invoiceId,
              number: invoice.invoiceNumber || invoice.stripeInvoiceNumber || '',
              date: invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString() : null,
              stripeInvoiceId: invoice.stripeInvoiceId || null,
              stripeInvoicePdfUrl: invoice.stripeInvoicePdfUrl || null,
              downloadUrl: saleIdParam ? `/api/client/sales/${saleIdParam}/invoice` : null
            }
          : null
      };
    });
    return res.json({ ok: true, sales: payload });
  } catch (error) {
    console.error('Erreur chargement ventes client', error);
    return res.status(500).json({ ok: false, error: "Impossible de charger l'historique des ventes." });
  }
}

async function createPresentielRefundRequest({
  userId,
  formation,
  purchase,
  preferredSaleId = '',
  sessionStartAt = null,
  clientIp = '0.0.0.0'
} = {}) {
  const { sale, amount } = await resolveSaleForFormationPurchase({
    userId,
    formationId: formation?._id,
    preferredSaleId: preferredSaleId || purchase?.saleId || ''
  });
  if (!sale) {
    const missingSaleError = new Error('Vente introuvable pour enregistrer la demande de remboursement.');
    missingSaleError.status = 409;
    throw missingSaleError;
  }

  const totalRefundAmount = roundToCents(amount);

  const refundPayload = {
    refundId: buildRefundId(),
    saleId: String(sale.saleId || '').trim(),
    userId: purchase?.userId || userId,
    itemId: formation?._id || purchase?.itemId,
    itemType: 'formation',
    formationId: formation?._id || purchase?.formationId,
    amount: totalRefundAmount,
    currency: 'EUR',
    status: 'requested',
    requestedAt: new Date(),
    reason: REFUND_REASON_CLIENT_CANCEL_PRESENTIEL,
    clientIp: String(clientIp || '').trim() || '0.0.0.0',
    purchaseAcceptedText: resolveSaleAcceptedText(sale),
    sessionStartAt: sessionStartAt || null,
    eligibleRefund: true,
    meta: {
      formationTitle: String(formation?.name || '').trim() || 'Formation',
      formationCoverImage: String(formation?.coverImage || '').trim() || '',
      saleCreatedAt: sale?.createdAt || null
    }
  };
  await applyRefundExecutionCap({
    refundRequest: refundPayload,
    sale,
    logPrefix: '[createPresentielRefundRequest]'
  });

  const creation = await createRefundRequestOnce(refundPayload);
  let refundRequest = creation.refundRequest;
  if (creation.created) {
    try {
      await ensureRefundCommissionProvision(refundRequest);
    } catch (commissionError) {
      await RefundRequest.deleteOne({ _id: refundRequest._id }).catch(() => {});
      throw commissionError;
    }

    try {
      const execution = await triggerRefundExecution(refundRequest, sale);
      if (execution?.refund) {
        refundRequest = execution.refund;
      }
    } catch (triggerError) {
      console.error('[createPresentielRefundRequest] triggerRefundExecution failed', {
        refundId: String(refundRequest?.refundId || ''),
        saleId: String(sale?.saleId || ''),
        error: triggerError
      });
    }
  }

  const refundId = String(refundRequest.refundId || '').trim();
  if (purchase?._id && refundId) {
    await Purchase.findByIdAndUpdate(purchase._id, {
      refundRequestId: refundId,
      saleId: String(sale.saleId || purchase.saleId || '').trim()
    }).catch(() => {});
  }

  return refundRequest.toObject();
}

export async function cancelFormationParticipation(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }

  const formationId = String(req.params.formationId || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }

  const requestedPurchaseId = String(req.body?.purchaseId || req.query?.purchaseId || '').trim();
  const requestedSaleId = String(req.body?.saleId || '').trim();
  const requestedSessionId = String(req.body?.sessionId || '').trim();

  try {
    const formation = await Formation.findById(formationId).lean();
    if (!formation || String(formation.type || '').toLowerCase() !== 'presentiel') {
      return res
        .status(404)
        .json({ ok: false, error: 'Formation presentielle introuvable.' });
    }

    const purchase = await resolveFormationPurchaseForRequest({
      userId,
      formationId: formation._id,
      purchaseId: requestedPurchaseId,
      activeOnly: false
    });

    if (!purchase) {
      return res.status(403).json({ ok: false, error: 'Achat requis pour annuler cette formation.' });
    }

    const purchaseSessionId = String(purchase.sessionId || '').trim();
    const effectiveSessionId = requestedSessionId || purchaseSessionId;
    if (!effectiveSessionId || !validateObjectId(effectiveSessionId)) {
      console.warn('[CancelPresentiel] session introuvable', {
        userId,
        formationId,
        saleId: requestedSaleId || purchase.saleId || '',
        purchaseId: String(purchase._id || '')
      });
      return res.status(400).json({ ok: false, error: 'Session introuvable.' });
    }

    const session = await FormationSession.findOne({
      _id: effectiveSessionId,
      formationId: formation._id
    }).lean();
    if (!session) {
      console.warn('[CancelPresentiel] session absente en base', {
        userId,
        formationId,
        effectiveSessionId
      });
      return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    }
    if (isInactiveFormationSessionStatus(session.status)) {
      return res.status(409).json({
        ok: false,
        error: 'Cette session a ete annulee par l institut. Consultez votre email pour choisir une option.'
      });
    }

    const now = new Date();
    const normalizedIp = extractClientIp(req);
    const previewSale = await resolveSaleForFormationPurchase({
      userId,
      formationId: formation._id,
      preferredSaleId: requestedSaleId || String(purchase.saleId || '').trim()
    });
    const refundEligibility = getPresentielRefundEligibility({
      sale: previewSale?.sale || null,
      formation: {
        ...formation,
        sessionDate: session.startDate
      },
      now
    });
    const eligibleRefund = Boolean(refundEligibility.eligibleRefund);

    console.info('[CancelPresentiel] decision', {
      userId: String(userId || ''),
      formationId: String(formation._id || ''),
      saleId: requestedSaleId || String(purchase.saleId || '').trim(),
      sessionStartAt: session.startDate || null,
      eligibleRefund,
      reason: refundEligibility.reason,
      refundDays: refundEligibility.refundDays,
      amountHint: Number.isFinite(Number(previewSale?.amount)) ? Number(previewSale.amount) : null
    });

    if (String(purchase.participationStatus || 'active') === 'canceled') {
      let existingRefund = await findExistingRefundForPurchase(purchase);
      if (eligibleRefund && !existingRefund) {
        try {
          existingRefund = await createPresentielRefundRequest({
            userId,
            formation,
            purchase,
            preferredSaleId: requestedSaleId,
            sessionStartAt: session.startDate,
            clientIp: normalizedIp
          });
        } catch (refundError) {
          if (refundError?.code === 'REFUND_ALREADY_EXISTS') {
            return res.status(409).json({
              ok: false,
              code: 'REFUND_ALREADY_EXISTS',
              error: 'REFUND_ALREADY_EXISTS'
            });
          }
          console.error('[CancelPresentiel] creation refund apres annulation existante', refundError);
        }
      }
      return res.json({
        ok: true,
        canceled: true,
        alreadyCanceled: true,
        eligibleRefund: Boolean(eligibleRefund),
        refundEligibility,
        refund: serializeRefundPayload(existingRefund),
        sessionStartAt: session.startDate || null
      });
    }

    const purchaseUpdate = {
      participationStatus: 'canceled',
      canceledAt: now,
      cancellationReason: REFUND_REASON_CLIENT_CANCEL_PRESENTIEL,
      cancellationEligibleRefund: Boolean(eligibleRefund),
      cancellationSessionStartAt: session.startDate || null
    };
    if (requestedSaleId && !purchase.saleId) {
      purchaseUpdate.saleId = requestedSaleId;
    }

    const updatedPurchase = await Purchase.findByIdAndUpdate(purchase._id, purchaseUpdate, {
      new: true
    });

    await FormationSession.findOneAndUpdate(
      { _id: session._id, reservedCount: { $gt: 0 } },
      { $inc: { reservedCount: -1 } }
    ).catch(() => {});

    let refundDoc = null;
    if (eligibleRefund) {
      try {
        refundDoc = await createPresentielRefundRequest({
          userId,
          formation,
          purchase: updatedPurchase || purchase,
          preferredSaleId: requestedSaleId,
          sessionStartAt: session.startDate,
          clientIp: normalizedIp
        });
      } catch (refundError) {
        if (refundError?.code === 'REFUND_ALREADY_EXISTS') {
          return res.status(409).json({
            ok: false,
            code: 'REFUND_ALREADY_EXISTS',
            error: 'REFUND_ALREADY_EXISTS'
          });
        }
        console.error('[CancelPresentiel] erreur creation refund request', refundError);
        return res.status(500).json({
          ok: false,
          error:
            'Annulation enregistree, mais la demande de remboursement a echoue. Reessayez dans quelques instants.'
        });
      }
    }

    // Notification — non bloquant
    try {
      const notifClient = await User.findById(userId).select('firstName lastName email').lean();
      const notifClientName = [notifClient?.firstName, notifClient?.lastName].filter(Boolean).join(' ') || notifClient?.email || '—';
      void triggerNotification('formation_participation_cancelled', {
        clientName: notifClientName,
        formationName: formation?.name || '—',
        sessionDate: session?.startDate
          ? new Date(session.startDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : 'Non renseignée',
        saleId: (updatedPurchase || purchase)?.saleId || ''
      });
    } catch (notifErr) {
      console.error('[Notif] formation_participation_cancelled failed:', notifErr?.message || notifErr);
    }

    try {
      const siteName = await resolveSiteName();
      const sessionLabel = formatSessionDateLabel(buildSessionPayload(session));
      const sessionTimeLabel = formatSessionTimeLabel(buildSessionPayload(session));
      const saleIdForMail = String(
        (updatedPurchase || purchase)?.saleId || requestedSaleId || previewSale?.sale?.saleId || ''
      ).trim();
      const amountPaid = Number.isFinite(Number(previewSale?.amount)) ? Number(previewSale.amount) : 0;
      const trackingUrl = refundDoc?.trackingToken
        ? resolveVitrineUrl(`vitrine.html?page=refund-tracking&token=${refundDoc.trackingToken}`)
        : '';
      const customerName = `${String(req.sessionUser?.firstName || '').trim()} ${String(req.sessionUser?.lastName || '').trim()}`.trim();

      await sendClientSessionCancellationEmail({
        toEmail: String(req.sessionUser?.email || '').trim(),
        siteName,
        firstName: String(req.sessionUser?.firstName || '').trim(),
        lastName: String(req.sessionUser?.lastName || '').trim(),
        clientEmail: String(req.sessionUser?.email || '').trim(),
        formationTitle: String(formation?.name || '').trim() || 'Formation',
        sessionDateLabel: sessionLabel,
        sessionTimeLabel,
        saleId: saleIdForMail,
        amountPaid,
        refundAmount: Number(refundDoc?.amount || 0),
        refundStatus: refundDoc ? String(refundDoc.status || '').trim() : 'non_eligible',
        trackingUrl,
        eligibleRefund: Boolean(eligibleRefund)
      });

      const adminEmails = await collectAdminEmails();
      if (adminEmails.length) {
        await sendInstituteClientCancelledNoticeEmail({
          toEmails: adminEmails,
          siteName,
          customerName: customerName || String(req.sessionUser?.email || '').trim(),
          clientEmail: String(req.sessionUser?.email || '').trim(),
          formationTitle: String(formation?.name || '').trim() || 'Formation',
          sessionDateLabel: sessionLabel,
          sessionTimeLabel,
          saleId: saleIdForMail,
          amountPaid,
          eligibleRefund: Boolean(eligibleRefund),
          reason: REFUND_REASON_CLIENT_CANCEL_PRESENTIEL
        });
      }
    } catch (mailError) {
      console.error('Erreur envoi mails annulation client presentiel', mailError);
    }

    return res.json({
      ok: true,
      canceled: true,
      eligibleRefund: Boolean(eligibleRefund),
      refundEligibility,
      refund: serializeRefundPayload(refundDoc),
      sessionStartAt: session.startDate || null
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message || 'Action impossible.' });
    }
    console.error('Erreur annulation formation presentielle client', error);
    return res.status(500).json({ ok: false, error: 'Impossible d annuler cette formation.' });
  }
}

export async function addFavorite(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const rawType = String(req.body?.targetType || '').trim().toLowerCase();
  if (!FAVORITE_TARGET_MODELS[rawType]) {
    return res.status(400).json({ ok: false, error: 'Type de favori invalide.' });
  }
  const targetId = String(req.body?.targetId || '').trim();
  if (!validateObjectId(targetId)) {
    return res.status(400).json({ ok: false, error: 'Article invalide.' });
  }
  try {
    const target = await fetchFavoriteTarget(rawType, targetId);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Article introuvable.' });
    }
    const favorite = await Favorite.create({
      userId,
      targetType: rawType,
      targetId
    });
    const payload = buildFavoritePayload(favorite, target);
    return res.status(201).json({ ok: true, favorite: payload });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Favori deja enregistre.' });
    }
    console.error('Erreur ajout favori', error);
    return res.status(500).json({ ok: false, error: "Impossible d'enregistrer le favori." });
  }
}

export async function removeFavorite(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const favoriteId = String(req.params.id || '').trim();
  if (!validateObjectId(favoriteId)) {
    return res.status(400).json({ ok: false, error: 'Favori invalide.' });
  }
  try {
    const favorite = await Favorite.findOne({ _id: favoriteId, userId });
    if (!favorite) {
      return res.status(404).json({ ok: false, error: 'Favori introuvable.' });
    }
    await favorite.deleteOne();
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur suppression favori', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer le favori.' });
  }
}

// TEMPORARY â€” FOR TEST PURPOSES ONLY
export async function changeFormationSession(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const formationId = String(req.params.formationId || '').trim();
  if (!validateObjectId(formationId)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  const requestedPurchaseId = String(req.body?.purchaseId || req.query?.purchaseId || '').trim();
  const newSessionId = String(req.body?.newSessionId || '').trim();
  if (!validateObjectId(newSessionId)) {
    return res.status(400).json({ ok: false, error: 'Session invalide.' });
  }
  const formation = await loadPublishedFormation(formationId);
  if (!formation || formation.type !== 'presentiel') {
    return res.status(404).json({ ok: false, error: 'Formation prÃ©sentielle introuvable.' });
  }
  const purchase = await resolveFormationPurchaseForRequest({
    userId,
    formationId: formation._id,
    purchaseId: requestedPurchaseId,
    activeOnly: true
  });
  if (!purchase) {
    return res.status(403).json({ ok: false, error: 'Achat requis pour modifier la session.' });
  }
  if (String(purchase.participationStatus || 'active') === 'canceled') {
    return res.status(409).json({ ok: false, error: 'Cette formation est deja annulee.' });
  }
  const currentSessionId = purchase.sessionId?.toString();
  if (!currentSessionId) {
    return res.status(400).json({ ok: false, error: 'Aucune session Ã  modifier.' });
  }
  if (currentSessionId === newSessionId) {
    return res.status(400).json({ ok: false, error: 'La session sÃ©lectionnÃ©e est identique.' });
  }
  const targetSession = await FormationSession.findOne(
    buildActiveFormationSessionFilter({
      _id: newSessionId,
      formationId: formation._id
    })
  ).lean();
  if (!targetSession) {
    return res.status(404).json({ ok: false, error: 'Session introuvable.' });
  }
  const alreadyBookedTargetSession = await Purchase.exists({
    userId,
    itemType: 'formation',
    formationId: formation._id,
    sessionId: targetSession._id,
    participationStatus: { $ne: 'canceled' },
    _id: { $ne: purchase._id }
  });
  if (alreadyBookedTargetSession) {
    return res.status(409).json({ ok: false, error: 'Cette session est deja reservee sur un autre achat.' });
  }
  if (Number(targetSession.reservedCount || 0) >= Number(targetSession.maxClients || 0)) {
    return res.status(409).json({ ok: false, error: 'Session complÃ¨te.' });
  }
  let updatedTargetSession = null;
  try {
    updatedTargetSession = await FormationSession.findOneAndUpdate(
      buildActiveFormationSessionFilter({
        _id: targetSession._id,
        formationId: formation._id,
        reservedCount: { $lt: targetSession.maxClients }
      }),
      { $inc: { reservedCount: 1 } },
      { new: true }
    );
    if (!updatedTargetSession) {
      return res.status(409).json({ ok: false, error: 'Session complÃ¨te.' });
    }
    const decrementedSession = await FormationSession.findOneAndUpdate(
      {
        _id: currentSessionId,
        reservedCount: { $gt: 0 }
      },
      { $inc: { reservedCount: -1 } },
      { new: true }
    );
    if (!decrementedSession) {
      throw Object.assign(new Error('Impossible de libÃ©rer la session prÃ©cÃ©dente.'), { status: 500 });
    }
    const updatedPurchase = await Purchase.findByIdAndUpdate(
      purchase._id,
      { sessionId: updatedTargetSession._id },
      { new: true }
    ).lean();
    return res.json({
      ok: true,
      session: updatedTargetSession,
      purchase: serializePurchasePayload(updatedPurchase, formation, updatedTargetSession, null)
    });
  } catch (error) {
    if (updatedTargetSession) {
      await FormationSession.findByIdAndUpdate(updatedTargetSession._id, { $inc: { reservedCount: -1 } }).catch(
        () => {}
      );
    }
    const status = error?.status || 500;
    const message = status === 500 ? 'Impossible de changer la session.' : error.message;
    return res.status(status).json({ ok: false, error: message });
  }
}
