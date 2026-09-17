import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import FormationModule from '../models/FormationModule.js';
import FormationSession from '../models/FormationSession.js';
import Promotion from '../models/Promotion.js';
import Purchase from '../models/Purchase.js';
import Review from '../models/Review.js';
import Sale from '../models/Sale.js';
import User from '../models/user.js';
import DeletedFormationHistory from '../models/DeletedFormationHistory.js';
import {
  extractPreviewFromEditorial,
  getFormationEditorialMap
} from '../services/formationEditorialService.js';
import {
  getFormationPurchasedUserCounts,
  hasFormationBeenPurchased
} from '../services/formationPurchaseStatsService.js';
import { sanitizeFaqInput, serializeFaq } from '../services/faq/faqSanitizer.js';
import {
  createOrRefreshInstituteDecisionFlow,
  FLOW_TYPE_FORMATION_DELETED,
  notifyInstituteDecisionChoiceForFlow
} from '../services/sessionCancellationFlowService.js';

const TYPE_VALUES = ['presentiel', 'distanciel'];
const STATUS_VALUES = ['draft', 'published', 'disabled'];
const COVER_IMAGE_URL_PREFIX = '/uploads/formations';
const FORMATION_TYPE_LOCKED_ERROR = 'FORMATION_TYPE_LOCKED';
const DELETED_HISTORY_LIMIT = 150;

function buildPayload(doc, options = {}) {
  if (!doc) return null;
  const editorialHtml = String(options.editorialHtml || '');
  const previewDescription = extractPreviewFromEditorial(editorialHtml, doc.description || '');
  const purchasedUsersCount = Number(options.purchasedUsersCount || 0);
  const soldCount = Number(options.soldCount || purchasedUsersCount);
  const parsedRefundDays = Number(doc.refundDays);
  return {
    id: doc._id?.toString(),
    name: doc.name,
    description: previewDescription,
    previewDescription,
    editorialHtml,
    legacyDescription: doc.description || '',
    formalities: doc.formalities || '',
    photos: Array.isArray(doc.photos) ? doc.photos.filter(Boolean) : [],
    faq: serializeFaq(doc.faq),
    durationDays: Number.isFinite(doc.durationDays) ? doc.durationDays : 1,
    refundDays: Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : 7,
    price: doc.price || 0,
    coverImage: doc.coverImage || '',
    trailerVideoTitle: doc.trailerVideoTitle || '',
    trailerVideoUrl: doc.trailerVideoUrl || '',
    whatsappGroupTitle: doc.whatsappGroupTitle || '',
    whatsappGroupUrl: doc.whatsappGroupUrl || null,
    type: doc.type,
    // C1 — champs distanciel (accès) exposés pour l'éditeur Catalogue Studio.
    accessDeliveryMode: doc.accessDeliveryMode || 'manual',
    accessUrl: doc.accessUrl || '',
    accessLifetime: doc.accessLifetime !== false,
    isRefundableAfterAccess: Boolean(doc.isRefundableAfterAccess),
    status: doc.status,
    soldCount,
    purchasedUsersCount,
    typeLocked: soldCount > 0,
    createdAt: doc.createdAt
  };
}

function normalizeType(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return TYPE_VALUES.includes(candidate) ? candidate : 'distanciel';
}

function normalizeStatus(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return STATUS_VALUES.includes(candidate) ? candidate : 'draft';
}

function parsePrice(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const number = Number(value);
  if (Number.isNaN(number) || number < 0) {
    return 0;
  }
  return number;
}

function parseDurationDays(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) {
    return 1;
  }
  return Math.floor(number);
}

function parseRefundDays(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return 7;
  }
  return Math.floor(number);
}

function sanitizeWhatsAppUrl(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function sanitizeMetaTitle(value, fallback = '') {
  const candidate = String(value || '').trim();
  return candidate || fallback;
}

function normalizePlainText(value = '') {
  return String(value || '').trim();
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100) / 100;
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function buildDeletedByPayload(sessionUser = null) {
  return {
    userId: normalizePlainText(sessionUser?._id),
    email: normalizePlainText(sessionUser?.email),
    firstName: normalizePlainText(sessionUser?.firstName),
    lastName: normalizePlainText(sessionUser?.lastName),
    role: normalizePlainText(sessionUser?.role)
  };
}

function buildSnapshotKey({ userId = '', email = '', fallback = '' } = {}) {
  const normalizedUserId = normalizePlainText(userId);
  if (normalizedUserId) return `user:${normalizedUserId}`;
  const normalizedEmail = normalizePlainText(email).toLowerCase();
  if (normalizedEmail) return `email:${normalizedEmail}`;
  return `fallback:${normalizePlainText(fallback) || 'unknown'}`;
}

function ensureClientSnapshot(map, key) {
  if (map.has(key)) {
    return map.get(key);
  }
  const created = {
    userId: '',
    email: '',
    firstName: '',
    lastName: '',
    saleIds: new Set(),
    purchaseIds: new Set(),
    totalPaid: 0,
    subscribedAt: null,
    lastSubscribedAt: null
  };
  map.set(key, created);
  return created;
}

function mergeClientIdentity(snapshot, identity = {}) {
  const userId = normalizePlainText(identity.userId);
  const email = normalizePlainText(identity.email);
  const firstName = normalizePlainText(identity.firstName);
  const lastName = normalizePlainText(identity.lastName);
  if (!snapshot.userId && userId) snapshot.userId = userId;
  if (!snapshot.email && email) snapshot.email = email;
  if (!snapshot.firstName && firstName) snapshot.firstName = firstName;
  if (!snapshot.lastName && lastName) snapshot.lastName = lastName;
}

function mergeClientSubscriptionDate(snapshot, value) {
  const date = toDateOrNull(value);
  if (!date) return;
  if (!snapshot.subscribedAt || date.getTime() < snapshot.subscribedAt.getTime()) {
    snapshot.subscribedAt = date;
  }
  if (!snapshot.lastSubscribedAt || date.getTime() > snapshot.lastSubscribedAt.getTime()) {
    snapshot.lastSubscribedAt = date;
  }
}

function mapDeletedHistoryPayload(entry = {}) {
  const clients = Array.isArray(entry.clients) ? entry.clients : [];
  return {
    id: entry._id?.toString() || '',
    formationId: normalizePlainText(entry.formationId),
    formationTitle: normalizePlainText(entry.formationTitle) || 'Formation supprimee',
    formationType: normalizePlainText(entry.formationType),
    formationPrice: normalizeAmount(entry.formationPrice),
    clientsCount: Math.max(0, Number(entry.clientsCount || clients.length || 0)),
    deletedAt: entry.deletedAt || entry.createdAt || null,
    deletedBy: {
      userId: normalizePlainText(entry.deletedBy?.userId),
      email: normalizePlainText(entry.deletedBy?.email),
      firstName: normalizePlainText(entry.deletedBy?.firstName),
      lastName: normalizePlainText(entry.deletedBy?.lastName),
      role: normalizePlainText(entry.deletedBy?.role)
    },
    clients: clients.map(client => ({
      userId: normalizePlainText(client?.userId),
      email: normalizePlainText(client?.email),
      firstName: normalizePlainText(client?.firstName),
      lastName: normalizePlainText(client?.lastName),
      saleIds: Array.isArray(client?.saleIds) ? client.saleIds.map(id => normalizePlainText(id)).filter(Boolean) : [],
      purchaseIds: Array.isArray(client?.purchaseIds)
        ? client.purchaseIds.map(id => normalizePlainText(id)).filter(Boolean)
        : [],
      totalPaid: normalizeAmount(client?.totalPaid),
      subscribedAt: client?.subscribedAt || null,
      lastSubscribedAt: client?.lastSubscribedAt || null
    }))
  };
}

async function collectDeletedFormationClients(formationObjectId) {
  const [purchases, sales] = await Promise.all([
    Purchase.find({ itemType: 'formation', itemId: formationObjectId })
      .select({ _id: 1, userId: 1, createdAt: 1 })
      .lean(),
    Sale.find({
      items: {
        $elemMatch: {
          type: 'formation',
          itemId: formationObjectId
        }
      }
    })
      .select({ userId: 1, customer: 1, saleId: 1, items: 1, createdAt: 1 })
      .lean()
  ]);

  const userIdSet = new Set();
  purchases.forEach(entry => {
    const userId = normalizePlainText(entry?.userId);
    if (userId) userIdSet.add(userId);
  });
  sales.forEach(entry => {
    const userId = normalizePlainText(entry?.userId);
    if (userId) userIdSet.add(userId);
  });

  const users = userIdSet.size
    ? await User.find({ _id: { $in: Array.from(userIdSet) } })
      .select({ email: 1, firstName: 1, lastName: 1 })
      .lean()
    : [];
  const usersById = new Map(users.map(user => [normalizePlainText(user?._id), user]));
  const snapshots = new Map();
  const formationId = normalizePlainText(formationObjectId);

  purchases.forEach(entry => {
    const userId = normalizePlainText(entry?.userId);
    const user = usersById.get(userId);
    const key = buildSnapshotKey({
      userId,
      email: user?.email,
      fallback: `purchase:${normalizePlainText(entry?._id)}`
    });
    const snapshot = ensureClientSnapshot(snapshots, key);
    mergeClientIdentity(snapshot, {
      userId,
      email: user?.email,
      firstName: user?.firstName,
      lastName: user?.lastName
    });
    const purchaseId = normalizePlainText(entry?._id);
    if (purchaseId) snapshot.purchaseIds.add(purchaseId);
    mergeClientSubscriptionDate(snapshot, entry?.createdAt);
  });

  sales.forEach(entry => {
    const userId = normalizePlainText(entry?.userId);
    const user = usersById.get(userId);
    const customer = entry?.customer && typeof entry.customer === 'object' ? entry.customer : {};
    const key = buildSnapshotKey({
      userId,
      email: user?.email || customer?.email,
      fallback: `sale:${normalizePlainText(entry?.saleId)}`
    });
    const snapshot = ensureClientSnapshot(snapshots, key);
    mergeClientIdentity(snapshot, {
      userId,
      email: user?.email || customer?.email,
      firstName: user?.firstName || customer?.firstName,
      lastName: user?.lastName || customer?.lastName
    });
    const saleId = normalizePlainText(entry?.saleId);
    if (saleId) snapshot.saleIds.add(saleId);
    mergeClientSubscriptionDate(snapshot, entry?.createdAt);

    const items = Array.isArray(entry?.items) ? entry.items : [];
    const saleItem = items.find(item => {
      if (item?.type !== 'formation') return false;
      return normalizePlainText(item?.itemId) === formationId;
    });
    if (saleItem) {
      snapshot.totalPaid += normalizeAmount(
        saleItem.finalPrice !== undefined ? saleItem.finalPrice : saleItem.price
      );
    }
  });

  const clients = Array.from(snapshots.values())
    .map(entry => ({
      userId: entry.userId,
      email: entry.email,
      firstName: entry.firstName,
      lastName: entry.lastName,
      saleIds: Array.from(entry.saleIds),
      purchaseIds: Array.from(entry.purchaseIds),
      totalPaid: normalizeAmount(entry.totalPaid),
      subscribedAt: entry.subscribedAt || null,
      lastSubscribedAt: entry.lastSubscribedAt || null
    }))
    .sort((a, b) => {
      const dateA = toDateOrNull(a.lastSubscribedAt)?.getTime() || 0;
      const dateB = toDateOrNull(b.lastSubscribedAt)?.getTime() || 0;
      return dateB - dateA;
    });

  return {
    clients,
    clientsCount: clients.length
  };
}

async function notifyClientsForDeletedFormation({
  formation,
  reason = ''
} = {}) {
  const activePurchases = await Purchase.find({
    itemType: 'formation',
    formationId: formation._id,
    participationStatus: { $ne: 'canceled' }
  }).lean();

  if (!activePurchases.length) {
    return {
      reservedClientsCount: 0,
      notifiedClientsCount: 0,
      emailFailuresCount: 0
    };
  }

  const userIds = Array.from(new Set(activePurchases.map(entry => entry.userId?.toString()).filter(Boolean)));
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
  const userMap = new Map(users.map(user => [String(user._id || ''), user]));

  const results = await Promise.allSettled(
    activePurchases.map(async purchase => {
      const user = userMap.get(String(purchase.userId || '')) || null;
      const { flow, token } = await createOrRefreshInstituteDecisionFlow({
        flowType: FLOW_TYPE_FORMATION_DELETED,
        session: null,
        formationId: formation._id,
        formation,
        userId: purchase.userId,
        clientEmail: String(user?.email || '').trim(),
        purchaseId: purchase._id,
        saleId: String(purchase.saleId || '').trim(),
        reason
      });

      const sent = await notifyInstituteDecisionChoiceForFlow({
        flow,
        token,
        formationTitle: String(formation.name || '').trim(),
        firstName: String(user?.firstName || '').trim(),
        lastName: String(user?.lastName || '').trim()
      });

      if (!sent) {
        console.warn('[FormationGestion][DEV] mail suppression formation non envoye', {
          formationId: String(formation._id || ''),
          flowId: String(flow?.flowId || ''),
          userId: String(purchase.userId || ''),
          email: String(user?.email || '').trim()
        });
      }

      return sent;
    })
  );

  const notifiedClientsCount = results.filter(
    result => result.status === 'fulfilled' && result.value === true
  ).length;
  const emailFailuresCount = results.length - notifiedClientsCount;

  results.forEach(result => {
    if (result.status === 'rejected') {
      console.error('[FormationGestion] echec creation flow suppression formation', result.reason);
    }
  });

  return {
    reservedClientsCount: activePurchases.length,
    notifiedClientsCount,
    emailFailuresCount
  };
}

async function buildSinglePayloadWithLiveStats(doc) {
  if (!doc?._id) {
    return buildPayload(doc);
  }
  const id = doc._id.toString();
  const [editorialMap, statsMap] = await Promise.all([
    getFormationEditorialMap([id]),
    getFormationPurchasedUserCounts([id])
  ]);
  const stats = statsMap.get(id) || { soldCount: 0, purchasedUsersCount: 0 };
  return buildPayload(doc, {
    editorialHtml: editorialMap.get(id) || '',
    soldCount: stats.soldCount,
    purchasedUsersCount: stats.purchasedUsersCount
  });
}

export async function listFormations(_req, res) {
  try {
    const formations = await Formation.find().sort({ createdAt: -1 }).lean();
    const formationIds = formations.map(entry => entry._id?.toString()).filter(Boolean);
    const [editorialMap, statsMap] = await Promise.all([
      getFormationEditorialMap(formationIds),
      getFormationPurchasedUserCounts(formationIds)
    ]);
    const payload = formations.map(entry => {
      const id = entry._id?.toString() || '';
      const stats = statsMap.get(id) || { soldCount: 0, purchasedUsersCount: 0 };
      return buildPayload(entry, {
        editorialHtml: editorialMap.get(id) || '',
        soldCount: stats.soldCount,
        purchasedUsersCount: stats.purchasedUsersCount
      });
    });
    return res.json({ ok: true, formations: payload });
  } catch (error) {
    console.error('Impossible de lister les formations', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les formations.' });
  }
}

// C1 — Lecture d'une formation unique (additif). L'API manager n'exposait que la liste ;
// l'éditeur React a besoin d'un GET ciblé (mêmes stats live que la liste).
export async function getFormation(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  try {
    const formation = await Formation.findById(id).lean();
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    const payload = await buildSinglePayloadWithLiveStats(formation);
    return res.json({ ok: true, formation: payload });
  } catch (error) {
    console.error('Impossible de lire la formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la formation.' });
  }
}

// C1 — Duplication d'une formation (additif). La copie est créée en brouillon (status=draft),
// avec un nom unique. Sessions et modules pédagogiques ne sont PAS copiés (contenu/planning
// propres à chaque formation) — documenté côté Studio.
export async function duplicateFormation(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  try {
    const source = await Formation.findById(id).lean();
    if (!source) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    let copyName = `${source.name} (copie)`;
    let suffix = 1;
    while (await Formation.exists({ name: copyName })) {
      suffix += 1;
      copyName = `${source.name} (copie ${suffix})`;
    }
    const clone = new Formation({
      name: copyName,
      description: source.description || '',
      formalities: source.formalities || '',
      durationDays: source.durationDays || 1,
      refundDays: source.refundDays ?? 7,
      price: source.price || 0,
      coverImage: source.coverImage || '',
      trailerVideoTitle: source.trailerVideoTitle || '',
      trailerVideoUrl: source.trailerVideoUrl || '',
      whatsappGroupTitle: source.whatsappGroupTitle || '',
      whatsappGroupUrl: source.whatsappGroupUrl || null,
      type: source.type,
      accessDeliveryMode: source.accessDeliveryMode || 'manual',
      accessUrl: source.accessUrl || '',
      accessLifetime: source.accessLifetime !== false,
      accessExpiresAt: source.accessExpiresAt || null,
      isRefundableAfterAccess: Boolean(source.isRefundableAfterAccess),
      status: 'draft',
      active: true,
      options: Array.isArray(source.options) ? source.options.map(o => ({ ...o, _id: undefined })) : []
    });
    await clone.save();
    const payload = await buildSinglePayloadWithLiveStats(clone.toObject());
    return res.status(201).json({ ok: true, formation: payload });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Une formation porte deja ce nom.' });
    }
    console.error('Impossible de dupliquer la formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de dupliquer la formation.' });
  }
}

export async function createFormation(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Le nom de la formation est requis.' });
  }
  try {
    const formation = new Formation({
      name,
      // Legacy fallback only used when editorial content is still empty.
      description: String(req.body?.description || '').trim(),
      formalities: String(req.body?.formalities || '').trim(),
      faq: sanitizeFaqInput(req.body?.faq),
      durationDays: parseDurationDays(req.body?.durationDays),
      refundDays: parseRefundDays(req.body?.refundDays),
      price: parsePrice(req.body?.price),
      coverImage: String(req.body?.coverImage || '').trim(),
      photos: Array.isArray(req.body?.photos) ? req.body.photos.map(p => String(p || '').trim()).filter(Boolean) : [],
      trailerVideoTitle: sanitizeMetaTitle(req.body?.trailerVideoTitle),
      trailerVideoUrl: String(req.body?.trailerVideoUrl || '').trim(),
      whatsappGroupTitle: sanitizeMetaTitle(req.body?.whatsappGroupTitle),
      whatsappGroupUrl: sanitizeWhatsAppUrl(req.body?.whatsappGroupUrl),
      type: normalizeType(req.body?.type),
      status: normalizeStatus(req.body?.status)
    });
    await formation.save();
    const payload = await buildSinglePayloadWithLiveStats(formation.toObject());
    return res.status(201).json({ ok: true, formation: payload });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Une formation porte deja ce nom.' });
    }
    console.error('Impossible de creer la formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de creer la formation.' });
  }
}

export async function updateFormation(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  try {
    const formation = await Formation.findById(id);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }
    if (req.body?.name) {
      formation.name = String(req.body.name).trim() || formation.name;
    }
    if (typeof req.body?.formalities === 'string') {
      formation.formalities = req.body.formalities.trim();
    }
    if (req.body?.faq !== undefined) {
      formation.faq = sanitizeFaqInput(req.body.faq);
    }
    if (req.body?.durationDays !== undefined) {
      formation.durationDays = parseDurationDays(req.body.durationDays);
    }
    if (req.body?.refundDays !== undefined) {
      formation.refundDays = parseRefundDays(req.body.refundDays);
    }
    if (req.body?.price !== undefined) {
      formation.price = parsePrice(req.body.price);
    }
    if (typeof req.body?.coverImage === 'string') {
      formation.coverImage = req.body.coverImage.trim();
    }
    if (Array.isArray(req.body?.photos)) {
      formation.photos = req.body.photos.map(p => String(p || '').trim()).filter(Boolean);
    }
    if (typeof req.body?.trailerVideoUrl === 'string') {
      formation.trailerVideoUrl = req.body.trailerVideoUrl.trim();
    }
    if (typeof req.body?.trailerVideoTitle === 'string') {
      formation.trailerVideoTitle = sanitizeMetaTitle(req.body.trailerVideoTitle);
    }
    if (req.body?.type) {
      const nextType = normalizeType(req.body.type);
      if (nextType !== formation.type) {
        const isPurchased = await hasFormationBeenPurchased(formation._id?.toString());
        if (isPurchased) {
          return res.status(409).json({
            ok: false,
            error: FORMATION_TYPE_LOCKED_ERROR,
            message:
              'Type verrouille : cette formation a deja ete achetee. Creez une nouvelle formation pour proposer une autre version.'
          });
        }
      }
      formation.type = nextType;
    }
    if (req.body?.status) {
      formation.status = normalizeStatus(req.body.status);
    }
    if (req.body?.whatsappGroupUrl !== undefined) {
      formation.whatsappGroupUrl = sanitizeWhatsAppUrl(req.body.whatsappGroupUrl);
    }
    if (typeof req.body?.whatsappGroupTitle === 'string') {
      formation.whatsappGroupTitle = sanitizeMetaTitle(req.body.whatsappGroupTitle);
    }
    // C1 — champs distanciel (accès) éditables depuis le Catalogue Studio.
    if (req.body?.accessDeliveryMode !== undefined) {
      formation.accessDeliveryMode = req.body.accessDeliveryMode === 'immediate' ? 'immediate' : 'manual';
    }
    if (typeof req.body?.accessUrl === 'string') {
      formation.accessUrl = req.body.accessUrl.trim();
    }
    if (req.body?.accessLifetime !== undefined) {
      formation.accessLifetime = Boolean(req.body.accessLifetime);
    }
    if (req.body?.isRefundableAfterAccess !== undefined) {
      formation.isRefundableAfterAccess = Boolean(req.body.isRefundableAfterAccess);
    }
    await formation.save();
    const payload = await buildSinglePayloadWithLiveStats(formation.toObject());
    return res.json({ ok: true, formation: payload });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ ok: false, error: 'Une formation porte deja ce nom.' });
    }
    console.error('Impossible de mettre a jour la formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre a jour la formation.' });
  }
}

export async function deleteFormation(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }

  try {
    const formation = await Formation.findById(id).lean();
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    }

    const deletionReason = String(req.body?.reason || req.query?.reason || '').trim();
    const snapshot = await collectDeletedFormationClients(formation._id);
    let notificationSummary = null;
    if (String(formation.type || '').trim().toLowerCase() === 'presentiel') {
      notificationSummary = await notifyClientsForDeletedFormation({
        formation,
        reason: deletionReason
      });
    }
    const history = await DeletedFormationHistory.create({
      formationId: formation._id.toString(),
      formationTitle: normalizePlainText(formation.name) || 'Formation supprimee',
      formationType: normalizePlainText(formation.type),
      formationPrice: normalizeAmount(formation.price),
      clientsCount: snapshot.clientsCount,
      clients: snapshot.clients,
      deletedBy: buildDeletedByPayload(req.sessionUser),
      deletedAt: new Date()
    });

    await Promise.all([
      Formation.deleteOne({ _id: formation._id }),
      FormationModule.deleteMany({ formationId: formation._id }),
      FormationSession.deleteMany({ formationId: formation._id }),
      Promotion.deleteMany({ targetType: 'formation', targetId: formation._id })
    ]);

    return res.json({
      ok: true,
      deleted: {
        formationId: formation._id.toString(),
        clientsCount: snapshot.clientsCount,
        historyId: history?._id?.toString() || ''
      },
      instituteDecisionTriggered: Boolean(notificationSummary),
      reservedClientsCount: notificationSummary?.reservedClientsCount || 0,
      notifiedClientsCount: notificationSummary?.notifiedClientsCount || 0,
      emailFailuresCount: notificationSummary?.emailFailuresCount || 0
    });
  } catch (error) {
    console.error('Impossible de supprimer la formation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer la formation.' });
  }
}

export async function listDeletedFormationHistory(req, res) {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(DELETED_HISTORY_LIMIT, Math.max(1, requestedLimit))
      : 50;
    const history = await DeletedFormationHistory.find()
      .sort({ deletedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      ok: true,
      history: history.map(mapDeletedHistoryPayload)
    });
  } catch (error) {
    console.error('Impossible de lire l historique des formations supprimees', error);
    return res.status(500).json({
      ok: false,
      error: "Impossible de lire l'historique des formations supprimees."
    });
  }
}

export function uploadFormationCover(req, res) {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Fichier manquant.' });
  }
  const coverImage = `${COVER_IMAGE_URL_PREFIX}/${req.file.filename}`;
  return res.status(201).json({ ok: true, coverImage });
}

export async function listFormationReviewsForGestion(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: 'Formation invalide.' });
  }
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const sort = String(req.query.sort || 'recent');
    const pageSize = 20;
    const sortStage =
      sort === 'best'
        ? { rating: -1, createdAt: -1, _id: -1 }
        : { createdAt: -1, rating: -1, _id: -1 };
    const match = { formationId: new mongoose.Types.ObjectId(id) };
    const cursor = Review.find(match)
      .sort(sortStage)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate({ path: 'userId', select: 'email firstName lastName' })
      .lean();
    const [reviews, total] = await Promise.all([cursor, Review.countDocuments(match)]);
    const payload = (Array.isArray(reviews) ? reviews : []).map(entry => {
      const user = entry?.userId && typeof entry.userId === 'object' ? entry.userId : null;
      const email = String(user?.email || '').trim();
      const firstName = String(user?.firstName || '').trim();
      const lastName = String(user?.lastName || '').trim();
      return {
        rating: entry?.rating,
        comment: entry?.comment,
        createdAt: entry?.createdAt,
        authorEmail: email || 'compte supprime',
        authorName: `${firstName} ${lastName}`.trim()
      };
    });
    const hasMore = page * pageSize < total;
    return res.json({ ok: true, reviews: payload, page, hasMore, total });
  } catch (error) {
    console.error('Impossible de lire les avis formation (gestion)', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les avis.' });
  }
}
