import crypto from 'node:crypto';
import mongoose from 'mongoose';
import argon2 from 'argon2';

import GiftCard, { GIFT_CARD_STATUSES } from '../models/GiftCard.js';
import GiftCardConfig from '../models/GiftCardConfig.js';
import GiftCardTransaction from '../models/GiftCardTransaction.js';
import Formation from '../models/Formation.js';
import FormationSession, { buildActiveFormationSessionFilter } from '../models/FormationSession.js';
import Product from '../models/Product.js';
import Purchase from '../models/Purchase.js';
import Sale from '../models/Sale.js';
import CartSnapshot from '../models/CartSnapshot.js';
import { recordCommissionTransactions } from '../services/commissionService.js';
import {
  calculateFinalPrice,
  getActivePromotionsForTargets
} from '../services/promotionService.js';
import { getSessionUserId } from '../utils/session.js';
import { requireSecret } from '../utils/secretEnv.js';
import {
  applySaleCommissionSnapshot,
  persistSale,
  runPostSaleSideEffects
} from '../services/checkout/checkoutFacade.js';
import { serializePurchasePayload } from './clientController.js';
import User from '../models/user.js';
import { extractClientIp } from '../utils/requestClientIp.js';
import { validateAndBuildConsumerWaiver } from '../utils/consumerWaiver.js';
import {
  computeAvailableGiftCardBalance,
  debitGiftCardBalanceAtomic,
  recreditGiftCardBalanceAtomic
} from '../services/giftCardReservationService.js';
import {
  rotateGiftCardQrToken,
  resolveGiftCardFromQrPayload
} from '../services/giftCard/giftCardQrService.js';
import { generateGiftCardAssets, formatGiftCardAmount } from '../services/giftCard/giftCardRenderService.js';
import { getPublishedTemplateBySlug } from '../services/giftCard/giftCardTemplateService.js';
import { getActiveGiftCardTemplateOrSeed } from '../services/giftCard/giftCardTemplateResolver.js';
import { notifyDevAlert } from '../services/devAlertService.js';
import GiftCardTemplate from '../models/GiftCardTemplate.js';
import { sendGiftCardEventMail } from '../services/giftCard/giftCardMailService.js';

const MANUAL_GIFT_CARD_PAYMENT_LABEL = 'Paiement sur place';
const MANUAL_GIFT_CARD_PAYMENT_METHODS = new Set(['cash', 'card', 'other']);

const { Types } = mongoose;
const GIFT_CARD_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GIFT_CARD_PASSWORD_LENGTH = 10;
const GIFT_CARD_PASSWORD_SECRET = requireSecret('GIFT_CARD_PASSWORD_SECRET', { fallback: 'SESSION_SECRET' });
const GIFT_CARD_PASSWORD_KEY = crypto
  .createHash('sha256')
  .update(String(GIFT_CARD_PASSWORD_SECRET))
  .digest();

function sanitizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAvailableBalance(card) {
  return computeAvailableGiftCardBalance(card);
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function buildCustomerProfile(user) {
  return {
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || ''
  };
}

function sanitizeSearchRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildOwnerName(userLike) {
  const firstName = String(userLike?.firstName || '').trim();
  const lastName = String(userLike?.lastName || '').trim();
  return `${firstName} ${lastName}`.trim() || '';
}

function generateGiftCardPassword(length = GIFT_CARD_PASSWORD_LENGTH) {
  const normalizedLength = Math.max(8, Math.min(12, Number(length) || GIFT_CARD_PASSWORD_LENGTH));
  let output = '';
  while (output.length < normalizedLength) {
    const randomIndex = crypto.randomInt(0, GIFT_CARD_PASSWORD_CHARSET.length);
    output += GIFT_CARD_PASSWORD_CHARSET.charAt(randomIndex);
  }
  return output;
}

function encryptGiftCardPassword(password) {
  const normalizedPassword = String(password || '').trim();
  if (!normalizedPassword) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', GIFT_CARD_PASSWORD_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(normalizedPassword, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptGiftCardPassword(encryptedValue) {
  const payload = String(encryptedValue || '').trim();
  if (!payload) return '';
  const parts = payload.split('.');
  if (parts.length !== 3) return '';
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const authTag = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', GIFT_CARD_PASSWORD_KEY, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8').trim();
  } catch (_error) {
    return '';
  }
}

function hasGiftCardPassword(card) {
  const passwordHash = String(card?.passwordHash || '').trim();
  const passwordEncrypted = String(card?.passwordEncrypted || '').trim();
  return Boolean(passwordHash && passwordEncrypted);
}

function resolveGiftCardPassword(card) {
  if (!hasGiftCardPassword(card)) return '';
  return decryptGiftCardPassword(card.passwordEncrypted);
}

async function hashGiftCardPassword(password) {
  return argon2.hash(String(password || '').trim(), {
    type: argon2.argon2id
  });
}

async function verifyGiftCardPasswordHash(card, candidatePassword) {
  const passwordHash = String(card?.passwordHash || '').trim();
  const password = String(candidatePassword || '').trim();
  if (!passwordHash || !password) return false;
  try {
    return await argon2.verify(passwordHash, password);
  } catch (_error) {
    return false;
  }
}

async function assignGiftCardPassword(card, { save = true } = {}) {
  const generatedPassword = generateGiftCardPassword();
  card.passwordHash = await hashGiftCardPassword(generatedPassword);
  card.passwordEncrypted = encryptGiftCardPassword(generatedPassword);
  if (save) {
    await card.save();
  }
  return generatedPassword;
}

async function ensureGiftCardPassword(card, { save = true } = {}) {
  if (!card) return '';
  if (!hasGiftCardPassword(card)) {
    return assignGiftCardPassword(card, { save });
  }
  const existingPassword = resolveGiftCardPassword(card);
  if (existingPassword) return existingPassword;
  return assignGiftCardPassword(card, { save });
}

async function loadConfig() {
  const config = await GiftCardConfig.findOne().sort({ createdAt: -1 }).lean();
  return config || { minAmount: 50, description: '', image: '' };
}

export async function createGiftCardForPurchase({
  userId,
  amount,
  purchasedAt = new Date(),
  enforceMinAmount = true,
  // RX3 S4 — bénéficiaire optionnel du parcours d'achat en ligne (React). Champs déjà sur le modèle
  // (M13, jusqu'ici remplis seulement par le flux manuel institut). Additif, sans e-mail (non modélisé).
  recipientName = '',
  message = ''
} = {}) {
  const normalizedAmount = sanitizeNumber(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    const error = new Error('Montant carte cadeau invalide.');
    error.status = 400;
    error.code = 'GIFT_CARD_AMOUNT_INVALID';
    throw error;
  }

  const config = await loadConfig();
  const minAmount = Number(config?.minAmount || 0);
  if (enforceMinAmount && normalizedAmount < minAmount) {
    const error = new Error(`Le montant minimal est de ${minAmount} EUR.`);
    error.status = 400;
    error.code = 'GIFT_CARD_MIN_AMOUNT';
    throw error;
  }

  // Propriétaire (pour le mail carte cadeau) — best-effort, ne bloque pas la création.
  const owner = userId ? await User.findById(userId).lean().catch(() => null) : null;

  // Template actif garanti (seed si aucun) : le PDF vient TOUJOURS du template actif, jamais d'un
  // rendu vide/codé en dur. Best-effort : un souci de résolution ne doit pas casser le paiement.
  let template = null;
  try {
    template = await getActiveGiftCardTemplateOrSeed();
  } catch (templateError) {
    console.error('Résolution template carte cadeau online (non bloquant)', templateError?.message || templateError);
  }

  const code = await generateUniqueCode();
  const giftCard = new GiftCard({
    code,
    userId,
    amount: normalizedAmount,
    balance: normalizedAmount,
    configId: config?._id || null,
    purchasedAt,
    recipientName: String(recipientName || '').trim().slice(0, 120),
    purchaserName: buildOwnerName(owner),
    message: String(message || '').trim().slice(0, 500),
    activeTemplateId: template?._id || null
  });
  const password = await ensureGiftCardPassword(giftCard, { save: false });
  // QR opaque réel (jamais le secret en clair) pour la carte PDF.
  const { payload: qrPayload } = rotateGiftCardQrToken(giftCard);
  await giftCard.save();

  // Rendu carte (HTML + PDF depuis le template actif) + mail commerciale→client — best-effort.
  await deliverOnlineGiftCardEmail({ giftCard, owner, code, password, qrPayload, template });

  return { giftCard, config };
}

/**
 * GC-TPL-AUDIT — Livraison de la carte cadeau achetée en ligne : génère le PDF depuis le template
 * ACTIF (même pipeline que le flux manuel) et l'envoie par mail (event `gift_card.online_created`,
 * commerciale → client, PJ Brevo). Best-effort : ne throw jamais, ne casse jamais le paiement.
 */
async function deliverOnlineGiftCardEmail({ giftCard, owner, code, password, qrPayload, template }) {
  let assets = null;
  try {
    assets = await generateGiftCardAssets(giftCard, { code, pin: password, qrPayload, template });
    giftCard.cardVisualUrl = assets.cardVisualUrl;
    giftCard.generatedPdfUrl = assets.generatedPdfUrl;
    if (!giftCard.activeTemplateId && assets.templateId) {
      giftCard.activeTemplateId = assets.templateId;
    }
    await giftCard.save();
  } catch (renderError) {
    console.error('Erreur rendu carte cadeau online (non bloquant)', renderError?.message || renderError);
    // P1-6 — la panne de rendu (PDF) était silencieuse : alerte Dev.
    notifyDevAlert('system_error', {
      scope: 'gift_card.render.online',
      errorMessage: renderError?.message || 'Erreur de rendu carte cadeau'
    });
  }

  if (!owner?.email) return { event: false, mail: 'client_missing' };

  const mailVariables = {
    ...(assets?.variables || {}),
    recipientName: giftCard.recipientName || '',
    purchaserName: giftCard.purchaserName || '',
    amount: formatGiftCardAmount(giftCard.amount),
    balance: formatGiftCardAmount(giftCard.amount),
    code,
    pin: password,
    message: giftCard.message || '',
    cardLink: giftCard.cardVisualUrl || ''
  };

  try {
    return await sendGiftCardEventMail({
      eventName: 'gift_card.online_created',
      giftCard,
      client: buildClientForMail(owner),
      variables: mailVariables,
      attachment: assets?.pdfBase64 ? { name: assets.pdfFileName, content: assets.pdfBase64 } : null,
      eventPayload: { creationMode: 'online', paymentMode: 'stripe' }
    });
  } catch (mailError) {
    console.error('Erreur mail carte cadeau online (non bloquant)', mailError?.message || mailError);
    // P1-6 — l'échec d'envoi était silencieux : alerte Dev.
    notifyDevAlert('system_error', {
      scope: 'gift_card.mail.online',
      errorMessage: mailError?.message || 'Erreur envoi carte cadeau'
    });
    return { event: false, mail: 'failed' };
  }
}

function buildGiftCardPayload(card, { includePassword = false } = {}) {
  if (!card) return null;
  const payload = {
    id: card._id?.toString(),
    code: card.code,
    amount: Number(card.amount || 0),
    balance: Number(card.balance || 0),
    availableBalance: getAvailableBalance(card),
    reservedAmount: Number(card.reservedAmount || 0),
    status: card.status,
    purchasedAt: card.purchasedAt,
    createdAt: card.createdAt,
    saleId: card.saleId,
    hasPassword: hasGiftCardPassword(card)
  };
  if (includePassword) {
    payload.password = resolveGiftCardPassword(card) || null;
  }
  return payload;
}

function buildGiftCardGestionPayload(card) {
  const payload = buildGiftCardPayload(card, { includePassword: false });
  if (!payload) return null;
  const owner = card?.owner || card?.user || card?.userId || null;
  return {
    ...payload,
    userId: owner?._id?.toString() || card?.userId?.toString() || null,
    ownerEmail: String(owner?.email || card?.ownerEmail || '').trim() || '',
    ownerName: buildOwnerName(owner)
  };
}

function buildGiftCardTransactionPayload(transaction, { viewerUserId = null, forGestion = false } = {}) {
  const transactionType = String(transaction?.transactionType || 'redeem').trim() || 'redeem';
  const transactionUserId = transaction?.userId?._id
    ? transaction.userId._id.toString()
    : transaction?.userId?.toString();
  const usedByYou = Boolean(viewerUserId && transactionUserId && viewerUserId === transactionUserId);
  let usedByLabel = usedByYou ? 'Utilisee par vous' : 'Utilisee par un autre client';
  if (transactionType === 'manual_debit') {
    const actorRole = String(transaction?.actorRole || '').trim();
    usedByLabel = actorRole === 'dev' ? 'Debit manuel par dev' : 'Debit manuel par admin';
  } else if (transactionType === 'credit') {
    usedByLabel = 'Recredit systeme';
  }
  const payload = {
    id: transaction?._id?.toString(),
    amount: Number(transaction?.amount || 0),
    balanceBefore: Number(transaction?.balanceBefore || 0),
    balanceAfter: Number(transaction?.balanceAfter || 0),
    saleId: transaction?.saleId || '',
    createdAt: transaction?.createdAt || null,
    transactionType,
    note: String(transaction?.note || '').trim(),
    items: Array.isArray(transaction?.items) ? transaction.items : [],
    usedByYou,
    usedByLabel
  };
  if (forGestion) {
    payload.actorRole = String(transaction?.actorRole || '').trim() || '';
    payload.actorEmail = String(transaction?.actorUserId?.email || '').trim() || '';
    payload.ownerEmail = String(transaction?.userId?.email || '').trim() || '';
  }
  return payload;
}

function buildGiftSaleEntry({ type, itemId, formationId = null, name, basePrice, promotion }) {
  const normalizedBase = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0;
  const { finalPrice } = calculateFinalPrice(normalizedBase, promotion);
  return {
    type,
    itemId: new Types.ObjectId(itemId),
    formationId: Types.ObjectId.isValid(formationId) ? new Types.ObjectId(formationId) : null,
    name: (name || '').trim(),
    basePrice: normalizedBase,
    finalPrice,
    price: finalPrice,
    promotionApplied: Boolean(promotion),
    promotionId: promotion?._id || null
  };
}

function buildGiftFormationEntry(entry) {
  if (!entry || entry.type !== 'formation') {
    return null;
  }
  return {
    formationId: entry.itemId,
    formationName: entry.name || 'Formation',
    price: Number.isFinite(Number(entry.finalPrice)) ? Number(entry.finalPrice) : 0
  };
}

async function generateUniqueCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const exists = await GiftCard.exists({ code });
    if (!exists) {
      return code;
    }
  }
  throw new Error('Impossible de generer un code unique pour la carte cadeau.');
}

async function resolveItems(rawItems, userId) {
  const normalizedMap = new Map();
  for (const rawItem of rawItems) {
    const rawType = String(rawItem?.type || '').toLowerCase();
    if (rawType !== 'product' && rawType !== 'formation') {
      const error = new Error("Type d'article invalide.");
      error.status = 400;
      throw error;
    }
    const itemId = String(rawItem?.id || '').trim();
    if (!Types.ObjectId.isValid(itemId)) {
      const error = new Error("Identifiant d'article invalide.");
      error.status = 400;
      throw error;
    }
    const sessionId = rawItem?.sessionId ? String(rawItem.sessionId || '').trim() : null;
    const key = `${rawType}:${itemId}:${sessionId || ''}`;
    if (!normalizedMap.has(key)) {
      normalizedMap.set(key, { type: rawType, id: itemId, sessionId });
    } else if (sessionId) {
      normalizedMap.get(key).sessionId = sessionId;
    }
  }
  const items = Array.from(normalizedMap.values());
  if (!items.length) {
    const error = new Error('Aucun article valide.');
    error.status = 400;
    throw error;
  }
  const formationIds = Array.from(
    new Set(items.filter(entry => entry.type === 'formation').map(entry => entry.id))
  );
  const productIds = Array.from(
    new Set(items.filter(entry => entry.type === 'product').map(entry => entry.id))
  );
  const sessionIds = Array.from(new Set(items.map(entry => entry.sessionId).filter(Boolean)));
  const [formations, products, sessions, existingPurchases] = await Promise.all([
    formationIds.length ? Formation.find({ _id: { $in: formationIds } }).lean() : [],
    productIds.length ? Product.find({ _id: { $in: productIds } }).lean() : [],
    sessionIds.length
      ? FormationSession.find(buildActiveFormationSessionFilter({ _id: { $in: sessionIds } })).lean()
      : [],
    Purchase.find({
      userId,
      $or: items.map(entry => ({
        itemType: entry.type,
        itemId: new Types.ObjectId(entry.id)
      }))
    }).lean()
  ]);
  const formationMap = new Map(formations.map(entry => [entry._id?.toString(), entry]));
  const productMap = new Map(products.map(entry => [entry._id?.toString(), entry]));
  const sessionMap = new Map(sessions.map(entry => [entry._id?.toString(), entry]));
  const purchasedSet = new Set(
    existingPurchases
      .filter(entry => {
        const itemType = String(entry?.itemType || '').trim().toLowerCase();
        if (itemType !== 'formation') return true;
        const participationStatus = String(entry?.participationStatus || 'active').trim().toLowerCase();
        return participationStatus !== 'canceled';
      })
      .map(entry => `${entry.itemType}:${entry.itemId?.toString()}`)
  );
  const validated = [];
  for (const entry of items) {
    const key = `${entry.type}:${entry.id}`;
    if (entry.type === 'product' && purchasedSet.has(key)) {
      const error = new Error('Vous avez deja achete cet article.');
      error.status = 409;
      throw error;
    }
    if (entry.type === 'product') {
      const product = productMap.get(entry.id);
      if (!product || !product.active) {
        const error = new Error('Produit introuvable.');
        error.status = 404;
        throw error;
      }
      validated.push({ entry, detail: { ...product, type: 'product', name: product.name }, session: null });
      continue;
    }
    const formation = formationMap.get(entry.id);
    if (!formation || formation.status !== 'published') {
      const error = new Error('Formation introuvable.');
      error.status = 404;
      throw error;
    }
    if (formation.type === 'presentiel') {
      if (!entry.sessionId || !Types.ObjectId.isValid(entry.sessionId)) {
        const error = new Error('Session invalide pour la formation presentielle.');
        error.status = 400;
        throw error;
      }
      const alreadyPurchasedSameSession = existingPurchases.find(purchase => {
        if (String(purchase?.itemType || '').trim().toLowerCase() !== 'formation') return false;
        if (String(purchase?.itemId || '') !== String(formation._id || '')) return false;
        if (String(purchase?.participationStatus || 'active').trim().toLowerCase() === 'canceled') return false;
        return String(purchase?.sessionId || '') === String(entry.sessionId || '');
      });
      if (alreadyPurchasedSameSession) {
        const error = new Error('Vous avez deja achete cette session.');
        error.status = 409;
        throw error;
      }
      const session = sessionMap.get(entry.sessionId);
      if (!session || session.formationId?.toString() !== formation._id?.toString()) {
        const error = new Error('Session introuvable.');
        error.status = 404;
        throw error;
      }
      if (Number(session.reservedCount || 0) >= Number(session.maxClients || 0)) {
        const error = new Error('Session complete.');
        error.status = 409;
        throw error;
      }
      validated.push({
        entry,
        detail: { ...formation, type: 'formation' },
        session
      });
      continue;
    }
    const alreadyPurchasedDistanciel = existingPurchases.find(purchase => {
      if (String(purchase?.itemType || '').trim().toLowerCase() !== 'formation') return false;
      if (String(purchase?.itemId || '') !== String(formation._id || '')) return false;
      if (String(purchase?.participationStatus || 'active').trim().toLowerCase() === 'canceled') return false;
      return !purchase?.sessionId;
    });
    if (alreadyPurchasedDistanciel) {
      const error = new Error('Vous avez deja achete cet article.');
      error.status = 409;
      throw error;
    }
    validated.push({
      entry,
      detail: { ...formation, type: 'formation' },
      session: null
    });
  }
  return validated;
}

async function ensureSessionReservation(entry, updatedSessions) {
  if (entry.type !== 'formation' || !entry.session || entry.detail.type !== 'formation') {
    return null;
  }
  const targetSession = entry.session;
  const updated = await FormationSession.findOneAndUpdate(
    buildActiveFormationSessionFilter({
      _id: targetSession._id,
      formationId: targetSession.formationId,
      reservedCount: { $lt: targetSession.maxClients }
    }),
    { $inc: { reservedCount: 1 } },
    { new: true }
  );
  if (!updated) {
    const error = new Error('Session complete.');
    error.status = 409;
    throw error;
  }
  updatedSessions.push(updated);
  return updated;
}

function buildResponsePayload(createdPurchases) {
  return createdPurchases.map(entry =>
    serializePurchasePayload(
      entry.purchase.toObject(),
      entry.formation,
      entry.session,
      entry.product
    )
  );
}

async function deductGiftCardBalance(card, amount) {
  // Phase 1B-1: atomic conditional debit (no over-debit under concurrency).
  const { balanceBefore, balanceAfter } = await debitGiftCardBalanceAtomic({
    giftCardId: card._id,
    amount
  });
  card.balance = balanceAfter;
  card.status = balanceAfter > 0 ? 'active' : 'redeemed';
  return { balanceBefore, balanceAfter };
}

export async function getGiftCardConfig(req, res) {
  try {
    const config = await loadConfig();
    return res.json({ ok: true, config });
  } catch (error) {
    console.error('Erreur lecture configuration cartes cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la configuration.' });
  }
}

export async function updateGiftCardConfig(req, res) {
  try {
    const candidate = {};
    if (req.body?.minAmount !== undefined) {
      const minAmount = sanitizeNumber(req.body.minAmount);
      if (minAmount < 0) {
        return res.status(400).json({ ok: false, error: 'Montant minimal invalide.' });
      }
      candidate.minAmount = minAmount;
    }
    if (req.body?.maxAmount !== undefined) {
      const maxAmount = sanitizeNumber(req.body.maxAmount);
      if (maxAmount < 0) {
        return res.status(400).json({ ok: false, error: 'Montant maximal invalide.' });
      }
      candidate.maxAmount = maxAmount;
    }
    if (req.body?.presetAmounts !== undefined) {
      const raw = Array.isArray(req.body.presetAmounts) ? req.body.presetAmounts : [];
      const presets = [...new Set(
        raw.map(v => sanitizeNumber(v)).filter(n => Number.isFinite(n) && n > 0)
      )].sort((a, b) => a - b);
      candidate.presetAmounts = presets;
    }
    // Cohérence min ≤ max (si max défini > 0).
    const effectiveMin = candidate.minAmount;
    const effectiveMax = candidate.maxAmount;
    if (effectiveMin !== undefined && effectiveMax !== undefined && effectiveMax > 0 && effectiveMin > effectiveMax) {
      return res.status(400).json({ ok: false, error: 'Le montant minimal dépasse le montant maximal.' });
    }
    if (req.body?.description !== undefined) {
      candidate.description = String(req.body.description || '').trim();
    }
    if (req.body?.image !== undefined) {
      candidate.image = String(req.body.image || '').trim();
    }
    if (!Object.keys(candidate).length) {
      return res.status(400).json({ ok: false, error: 'Aucun champ a mettre a jour.' });
    }
    const config = await GiftCardConfig.findOneAndUpdate({}, candidate, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }).lean();
    return res.json({ ok: true, config });
  } catch (error) {
    console.error('Erreur mise a jour carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre a jour la configuration.' });
  }
}

export async function uploadGiftCardConfigImage(req, res) {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Aucun fichier reçu.' });
    const imageUrl = `/uploads/giftcards/${req.file.filename}`;
    await GiftCardConfig.findOneAndUpdate({}, { image: imageUrl }, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    });
    return res.json({ ok: true, imageUrl });
  } catch (error) {
    console.error('Erreur upload image carte cadeau', error);
    return res.status(500).json({ ok: false, error: "Impossible d'uploader l'image." });
  }
}

export async function purchaseGiftCard(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const amount = sanitizeNumber(req.body?.amount);
  const clientIp = extractClientIp(req);
  try {
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Utilisateur introuvable.' });
    }
    const now = new Date();
    const consumerWaiver = validateAndBuildConsumerWaiver(req.body, {
      dateAchat: now,
      hasDistancielItem: false,
      enforcePresentielWaiver: false,
      requireAcceptedCgv: false
    });
    const giftCardCreation = await createGiftCardForPurchase({
      userId,
      amount,
      purchasedAt: now
    });
    const giftCard = giftCardCreation.giftCard;
    const customer = buildCustomerProfile(user);
    const saleRecord = await persistSale({
      userId,
      customer,
      items: [
        {
          type: 'gift-card',
          itemId: giftCard._id,
          name: 'Carte cadeau',
          price: amount
        }
      ],
      consumerWaiver,
      clientIp
    });
    if (saleRecord) {
      giftCard.saleId = saleRecord.saleId;
      await giftCard.save();
    }
    return res.status(201).json({
      ok: true,
      giftCard: buildGiftCardPayload(giftCard, { includePassword: true })
    });
  } catch (error) {
    console.error('Erreur achat carte cadeau', error);
    if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
      return res.status(Number(error.status)).json({
        ok: false,
        error: error.message || "Impossible d'acheter la carte cadeau.",
        code: error?.code || null
      });
    }
    return res.status(500).json({ ok: false, error: "Impossible d'acheter la carte cadeau." });
  }
}

export async function listMyGiftCards(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  try {
    const cards = await GiftCard.find({ userId }).sort({ createdAt: -1 });
    for (const card of cards) {
      if (!hasGiftCardPassword(card)) {
        await ensureGiftCardPassword(card, { save: true });
      }
    }
    return res.json({
      ok: true,
      cards: cards
        .map(card => buildGiftCardPayload(card, { includePassword: true }))
        .filter(Boolean)
    });
  } catch (error) {
    console.error('Erreur lecture cartes client', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire vos cartes.' });
  }
}

export async function getGiftCardDetail(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const cardId = String(req.params.id || '').trim();
  if (!Types.ObjectId.isValid(cardId)) {
    return res.status(400).json({ ok: false, error: 'Carte invalide.' });
  }
  try {
    const card = await GiftCard.findOne({ _id: cardId, userId });
    if (!card) {
      return res.status(404).json({ ok: false, error: 'Carte introuvable.' });
    }
    if (!hasGiftCardPassword(card)) {
      await ensureGiftCardPassword(card, { save: true });
    }
    const transactions = await GiftCardTransaction.find({ giftCardId: card._id })
      .sort({ createdAt: -1 })
      .lean();
    const currentUserId = userId?.toString();
    return res.json({
      ok: true,
      card: buildGiftCardPayload(card, { includePassword: true }),
      transactions: transactions.map(transaction =>
        buildGiftCardTransactionPayload(transaction, { viewerUserId: currentUserId })
      )
    });
  } catch (error) {
    console.error('Erreur detail carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la carte.' });
  }
}
async function validateItemEntries(rawItems, userId) {
  const resolved = await resolveItems(rawItems, userId);
  const formationIds = Array.from(
    new Set(resolved.map(entry => (entry.entry.type === 'formation' ? entry.entry.id : null)).filter(Boolean))
  );
  const productIds = Array.from(
    new Set(resolved.map(entry => (entry.entry.type === 'product' ? entry.entry.id : null)).filter(Boolean))
  );
  const [formationPromotions, productPromotions] = await Promise.all([
    getActivePromotionsForTargets('formation', formationIds),
    getActivePromotionsForTargets('product', productIds)
  ]);
  const enriched = resolved.map(item => {
    const source = item.entry;
    const detail = item.detail;
    const promotion =
      source.type === 'formation' ? formationPromotions.get(source.id) : productPromotions.get(source.id);
    const type = source.type;
    const id = source.id;
    return {
      ...item,
      type,
      id,
      saleItem: buildGiftSaleEntry({
        type,
        itemId: id,
        formationId: type === 'formation' ? id : null,
        name: detail?.name || 'Article',
        basePrice: Number(detail?.price || 0),
        promotion
      })
    };
  });
  const totalAmount = enriched.reduce((sum, entry) => sum + Number(entry.saleItem.finalPrice || 0), 0);
  return { resolved: enriched, totalAmount };
}

export async function validateGiftCard(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const code = normalizeCode(req.body?.code);
  if (!code) {
    return res.status(400).json({ ok: false, error: 'Code manquant.' });
  }
  try {
    const card = await GiftCard.findOne({ code }).lean();
    const availableBalance = getAvailableBalance(card);
    if (!card || card.status !== 'active' || availableBalance <= 0) {
      return res.status(404).json({ ok: false, error: 'Carte introuvable ou epuisee.' });
    }
    return res.json({ ok: true, card: buildGiftCardPayload(card) });
  } catch (error) {
    console.error('Erreur validation carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de valider la carte.' });
  }
}

export async function validateGiftCardCredentials(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const code = normalizeCode(req.body?.code);
  const password = String(req.body?.password || '').trim();
  if (!code || !password) {
    return res.status(400).json({ ok: false, error: 'Code et mot de passe requis.' });
  }
  try {
    const card = await GiftCard.findOne({ code });
    const availableBalance = getAvailableBalance(card);
    if (!card || card.status !== 'active' || availableBalance <= 0) {
      return res.status(404).json({ ok: false, error: 'Carte introuvable ou epuisee.' });
    }
    const validPassword = await verifyGiftCardPasswordHash(card, password);
    if (!validPassword) {
      return res
        .status(401)
        .json({ ok: false, error: 'Code ou mot de passe invalide.', code: 'INVALID_GIFT_CARD_CREDENTIALS' });
    }
    return res.json({ ok: true, card: buildGiftCardPayload(card) });
  } catch (error) {
    console.error('Erreur validation credentials carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de verifier la carte.' });
  }
}

export async function redeemGiftCard(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentification requise.' });
  }
  const code = normalizeCode(req.body?.code);
  const clientIp = extractClientIp(req);
  if (!code) {
    return res.status(400).json({ ok: false, error: 'Code manquant.' });
  }
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ ok: false, error: 'Aucun article a payer.' });
    }
    const card = await GiftCard.findOne({ code });
    const availableBalance = getAvailableBalance(card);
    if (!card || card.status !== 'active' || availableBalance <= 0) {
      return res.status(404).json({ ok: false, error: 'Carte introuvable ou epuisee.' });
    }
    let resolved;
    let totalAmount = 0;
    let consumerWaiver = null;
    try {
      const validation = await validateItemEntries(rawItems, userId);
      resolved = validation.resolved;
      totalAmount = validation.totalAmount;
      const hasDistancielFormation = resolved.some(
        entry => entry.type === 'formation' && String(entry?.detail?.type || '').toLowerCase() === 'distanciel'
      );
      consumerWaiver = validateAndBuildConsumerWaiver(req.body, {
        dateAchat: new Date(),
        hasDistancielItem: hasDistancielFormation,
        enforcePresentielWaiver: false,
        requireAcceptedCgv: false
      });
    } catch (error) {
      const status = error?.status || 500;
      const message = status === 500 ? "Impossible d'utiliser la carte cadeau." : error.message;
      return res.status(status).json({ ok: false, error: message, code: error.code || null });
    }
    if (availableBalance < totalAmount) {
      return res.status(409).json({ ok: false, error: 'Solde insuffisant sur la carte.' });
    }
    const createdPurchases = [];
    const updatedSessions = [];
    let saleDoc = null;
    let debitSnapshot = null;
    let savedTransactionId = null;
    let customer = null;
    const user = await User.findById(userId).lean();
    if (user) {
      customer = buildCustomerProfile(user);
    }
    try {
      for (const entry of resolved) {
        const updatedSession = await ensureSessionReservation(entry, updatedSessions);
        const now = new Date();
        const purchase = new Purchase({
          userId,
          formationId: entry.type === 'formation' ? new Types.ObjectId(entry.id) : null,
          sessionId: updatedSession ? updatedSession._id : null,
          paymentProvider: 'gift-card',
          paymentStatus: 'paid',
          paymentRef: `GFT-${now.getTime()}-${crypto.randomBytes(3).toString('hex')}`,
          itemType: entry.type,
          itemId: new Types.ObjectId(entry.id),
          createdAt: now
        });
        await purchase.save();
        createdPurchases.push({
          purchase,
          formation: entry.type === 'formation' ? entry.detail : null,
          session: updatedSession || null,
          product: entry.type === 'product' ? entry.detail : null
        });
      }
      const saleItems = resolved.map(entry => entry.saleItem);
      const formationEntries = saleItems
        .map(buildGiftFormationEntry)
        .filter(Boolean);
      saleDoc = await persistSale({
        userId,
        customer,
        items: saleItems,
        giftCardUsage: [
          {
            giftCardId: card._id,
            code: card.code,
            amountUsed: totalAmount
          }
        ],
        consumerWaiver,
        clientIp,
        skipPostSaleSideEffects: true
      });
      if (saleDoc && formationEntries.length) {
        const commissionTransactions = await recordCommissionTransactions({
          saleId: saleDoc.saleId,
          formationEntries
        });
        await applySaleCommissionSnapshot(saleDoc, commissionTransactions);
      }
      const { balanceBefore, balanceAfter } = await deductGiftCardBalance(card, totalAmount);
      debitSnapshot = { balanceBefore, balanceAfter };
      await CartSnapshot.deleteOne({ userId });
      const responsePayload = buildResponsePayload(createdPurchases);
      const transaction = new GiftCardTransaction({
        giftCardId: card._id,
        transactionType: 'redeem',
        userId,
        actorRole: 'client',
        amount: totalAmount,
        balanceBefore,
        balanceAfter,
        saleId: saleDoc ? saleDoc.saleId : '',
        items: saleItems.map(item => ({
          type: item.type === 'gift-card' ? 'product' : item.type,
          itemId: item.itemId,
          price: item.finalPrice
        }))
      });
      await transaction.save();
      savedTransactionId = transaction._id;
      if (saleDoc) {
        await runPostSaleSideEffects(saleDoc);
      }
      return res.status(201).json({
        ok: true,
        purchases: responsePayload,
        giftCard: buildGiftCardPayload(card)
      });
    } catch (error) {
      if (savedTransactionId) {
        await GiftCardTransaction.deleteOne({ _id: savedTransactionId }).catch(() => {});
      }
      if (debitSnapshot) {
        // Phase 1B-1: atomic compensating recredit (no stale-doc overwrite).
        const debited = Math.max(0, Number(debitSnapshot.balanceBefore || 0) - Number(debitSnapshot.balanceAfter || 0));
        const recredited = await recreditGiftCardBalanceAtomic({ giftCardId: card._id, amount: debited }).catch(() => null);
        if (recredited) {
          card.balance = recredited.balance;
          card.status = recredited.status;
        }
      }
      if (createdPurchases.length) {
        const ids = createdPurchases.map(entry => entry.purchase._id);
        await Purchase.deleteMany({ _id: { $in: ids } }).catch(err =>
          console.error('Erreur rollback achats gift-card', err)
        );
      }
      if (updatedSessions.length) {
        await Promise.all(
          updatedSessions.map(session =>
            FormationSession.findByIdAndUpdate(session._id, { $inc: { reservedCount: -1 } })
          )
        ).catch(err => console.error('Erreur rollback sessions gift-card', err));
      }
      if (saleDoc) {
        await Sale.deleteOne({ _id: saleDoc._id }).catch(() => {});
      }
      const status = error?.status || 500;
      const message =
        status === 500 ? "Impossible d'utiliser la carte cadeau." : error.message;
      return res.status(status).json({ ok: false, error: message, code: error.code || null });
    }
  } catch (error) {
    console.error('Erreur paiement carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de traiter la carte cadeau.' });
  }
}

export async function listGiftCards(req, res) {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const sort = String(req.query.sort || 'desc').toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const filters = {};

    if (status && GIFT_CARD_STATUSES.includes(status)) {
      filters.status = status;
    }

    if (search) {
      const regex = new RegExp(sanitizeSearchRegex(search), 'i');
      const userMatches = await User.find({ email: regex }).select('_id').lean();
      const matchedUserIds = userMatches.map(user => user._id);
      const orFilters = [{ code: regex }, { saleId: regex }];
      if (Types.ObjectId.isValid(search)) {
        orFilters.push({ _id: new Types.ObjectId(search) });
      }
      if (matchedUserIds.length) {
        orFilters.push({ userId: { $in: matchedUserIds } });
      }
      filters.$or = orFilters;
    }

    const cards = await GiftCard.find(filters)
      .populate('userId', 'email firstName lastName role')
      .sort({ createdAt: sort === 'asc' ? 1 : -1 })
      .limit(limit)
      .lean();

    return res.json({
      ok: true,
      cards: cards.map(card => buildGiftCardGestionPayload(card)).filter(Boolean)
    });
  } catch (error) {
    console.error('Erreur gestion cartes cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les cartes.' });
  }
}

export async function getGiftCardDetailForGestion(req, res) {
  const cardId = String(req.params.id || '').trim();
  if (!Types.ObjectId.isValid(cardId)) {
    return res.status(400).json({ ok: false, error: 'Carte invalide.' });
  }

  try {
    const card = await GiftCard.findById(cardId)
      .populate('userId', 'email firstName lastName role')
      .lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Carte introuvable.' });
    }

    const transactions = await GiftCardTransaction.find({ giftCardId: card._id })
      .populate('actorUserId', 'email firstName lastName role')
      .populate('userId', 'email firstName lastName role')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      card: buildGiftCardGestionPayload(card),
      transactions: transactions.map(transaction =>
        buildGiftCardTransactionPayload(transaction, { forGestion: true })
      )
    });
  } catch (error) {
    console.error('Erreur detail carte cadeau (gestion)', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le detail de la carte.' });
  }
}

export async function lookupGiftCardForGestion(req, res) {
  const code = normalizeCode(req.body?.code ?? req.query?.code);
  if (!code) {
    return res.status(400).json({ ok: false, error: 'Code manquant.' });
  }

  try {
    const card = await GiftCard.findOne({ code })
      .populate('userId', 'email firstName lastName role')
      .lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Aucune carte trouvee.' });
    }

    return res.json({
      ok: true,
      card: buildGiftCardGestionPayload(card)
    });
  } catch (error) {
    console.error('Erreur lookup carte cadeau (gestion)', error);
    return res.status(500).json({ ok: false, error: 'Impossible de rechercher la carte.' });
  }
}

export async function verifyGiftCardPasswordForGestion(req, res) {
  const code = normalizeCode(req.body?.code);
  const password = String(req.body?.password || '').trim();
  if (!code || !password) {
    return res.status(400).json({ ok: false, error: 'Code et mot de passe requis.' });
  }

  try {
    const card = await GiftCard.findOne({ code })
      .populate('userId', 'email firstName lastName role');

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Aucune carte trouvee.' });
    }

    if (!hasGiftCardPassword(card)) {
      return res.status(409).json({ ok: false, error: 'Cette carte ne possede pas encore de mot de passe.' });
    }

    const isValid = await verifyGiftCardPasswordHash(card, password);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });
    }

    return res.json({
      ok: true,
      card: buildGiftCardGestionPayload(card)
    });
  } catch (error) {
    console.error('Erreur verification mot de passe carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de verifier le mot de passe.' });
  }
}

export async function manualDebitGiftCardForGestion(req, res) {
  const code = normalizeCode(req.body?.code);
  const password = String(req.body?.password || '').trim();
  const note = String(req.body?.note || '').trim();
  const amount = sanitizeNumber(req.body?.amount);

  if (!code || !password) {
    return res.status(400).json({ ok: false, error: 'Code et mot de passe requis.' });
  }
  if (amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Montant invalide.' });
  }

  try {
    const card = await GiftCard.findOne({ code })
      .populate('userId', 'email firstName lastName role');
    const availableBalance = getAvailableBalance(card);

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Aucune carte trouvee.' });
    }

    if (card.status !== 'active' || availableBalance <= 0) {
      return res.status(409).json({ ok: false, error: 'Carte epuisee ou inactive.' });
    }

    if (!hasGiftCardPassword(card)) {
      return res.status(409).json({ ok: false, error: 'Cette carte ne possede pas encore de mot de passe.' });
    }

    const passwordIsValid = await verifyGiftCardPasswordHash(card, password);
    if (!passwordIsValid) {
      return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });
    }

    if (amount > availableBalance) {
      return res.status(409).json({ ok: false, error: 'Montant superieur au solde restant.' });
    }

    const actorId = req.sessionUser?._id || null;
    const actorRoleRaw = String(req.sessionUser?.role || '').trim().toLowerCase();
    const actorRole = actorRoleRaw === 'dev' ? 'dev' : 'admin';

    const { balanceBefore, balanceAfter } = await deductGiftCardBalance(card, amount);
    const transaction = new GiftCardTransaction({
      giftCardId: card._id,
      transactionType: 'manual_debit',
      userId: card.userId?._id || card.userId,
      actorUserId: actorId,
      actorRole,
      amount,
      balanceBefore,
      balanceAfter,
      saleId: '',
      note,
      items: []
    });
    await transaction.save();

    // P1-10 — parité avec manualDebitGiftCardById : envoyer l'e-mail gift_card.manual_debited
    // (auparavant cette route code+mot de passe débitait sans jamais notifier le client).
    const owner = card.userId && typeof card.userId === 'object' ? card.userId : null;
    const mailResult = await sendGiftCardEventMail({
      eventName: 'gift_card.manual_debited',
      giftCard: card,
      client: buildClientForMail(owner),
      variables: {
        recipientName: card.recipientName || buildOwnerName(owner),
        amount: formatGiftCardAmount(amount),
        balance: formatGiftCardAmount(balanceAfter),
        code: card.code,
        transactionReason: note,
        paymentLabel: card.paymentLabel || ''
      },
      eventPayload: { amountEur: amount },
      actorId: actorId
    });

    const hydratedTransaction = await GiftCardTransaction.findById(transaction._id)
      .populate('actorUserId', 'email firstName lastName role')
      .populate('userId', 'email firstName lastName role')
      .lean();

    return res.json({
      ok: true,
      card: buildGiftCardGestionPayload(card),
      transaction: buildGiftCardTransactionPayload(hydratedTransaction, { forGestion: true }),
      mail: mailResult
    });
  } catch (error) {
    console.error('Erreur debit manuel carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible d effectuer le debit manuel.' });
  }
}

function buildMissingPasswordFilter() {
  return {
    $or: [
      { passwordHash: { $exists: false } },
      { passwordHash: null },
      { passwordHash: '' },
      { passwordEncrypted: { $exists: false } },
      { passwordEncrypted: null },
      { passwordEncrypted: '' }
    ]
  };
}

function buildClientForMail(user) {
  return {
    email: String(user?.email || '').trim(),
    firstName: String(user?.firstName || '').trim(),
    lastName: String(user?.lastName || '').trim()
  };
}

function resolveActorRole(req) {
  return String(req.sessionUser?.role || '').trim().toLowerCase() === 'dev' ? 'dev' : 'admin';
}

/**
 * M13 — Part 3 : création manuelle d'une carte cadeau par l'institut (paiement sur place).
 * POST /api/gestion/gift-cards/manual
 * Body : { customerId, recipientName, amount, manualPaymentMethod, manualPaymentNote?, templateId?, message?, purchaserName? }
 * Aucun Stripe, aucune facture Stripe. Transaction initiale `manual_issued`, event + mail (carte PDF jointe).
 */
export async function createManualGiftCard(req, res) {
  const customerId = String(req.body?.customerId || '').trim();
  const recipientName = String(req.body?.recipientName || '').trim();
  const amount = sanitizeNumber(req.body?.amount);
  const manualPaymentMethod = String(req.body?.manualPaymentMethod || '').trim().toLowerCase();
  const manualPaymentNote = String(req.body?.manualPaymentNote || '').trim();
  const message = String(req.body?.message || '').trim();
  const templateId = String(req.body?.templateId || '').trim();

  if (!Types.ObjectId.isValid(customerId)) {
    return res.status(400).json({ ok: false, error: 'Client invalide.' });
  }
  if (!recipientName) {
    return res.status(400).json({ ok: false, error: 'Le nom du bénéficiaire est obligatoire.', code: 'RECIPIENT_NAME_REQUIRED' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Montant invalide.', code: 'GIFT_CARD_AMOUNT_INVALID' });
  }
  if (!MANUAL_GIFT_CARD_PAYMENT_METHODS.has(manualPaymentMethod)) {
    return res.status(400).json({ ok: false, error: 'Mode de paiement sur place invalide.', code: 'MANUAL_PAYMENT_METHOD_INVALID' });
  }

  try {
    const customer = await User.findById(customerId).lean();
    if (!customer) {
      return res.status(404).json({ ok: false, error: 'Client introuvable.' });
    }

    // Template de rendu : explicite (publié) ou template actif.
    let template = null;
    if (templateId && Types.ObjectId.isValid(templateId)) {
      template = await GiftCardTemplate.findOne({ _id: templateId, status: 'published' }).lean();
      if (!template) {
        return res.status(404).json({ ok: false, error: 'Template introuvable ou non publié.' });
      }
    } else {
      // Resolver : template actif garanti (seed si aucun) — jamais de rendu depuis un template vide.
      template = await getActiveGiftCardTemplateOrSeed();
    }

    const purchaserName = String(req.body?.purchaserName || '').trim() || buildOwnerName(customer);
    const code = await generateUniqueCode();
    const now = new Date();

    const giftCard = new GiftCard({
      code,
      userId: customerId,
      amount,
      balance: amount,
      status: 'active',
      purchasedAt: now,
      recipientName,
      purchaserName,
      message,
      creationMode: 'manual_institute',
      paymentMode: 'on_site',
      paymentLabel: MANUAL_GIFT_CARD_PAYMENT_LABEL,
      activeTemplateId: template?._id || null,
      createdByAdminId: req.sessionUser?._id || null,
      manualPaymentMethod,
      manualPaymentNote
    });
    const password = await ensureGiftCardPassword(giftCard, { save: false });
    const { payload: qrPayload } = rotateGiftCardQrToken(giftCard);
    await giftCard.save();

    // Rendu carte (HTML + PDF) — best-effort, n'empêche pas la création si le rendu échoue.
    let assets = null;
    try {
      assets = await generateGiftCardAssets(giftCard, { code, pin: password, qrPayload, template });
      giftCard.cardVisualUrl = assets.cardVisualUrl;
      giftCard.generatedPdfUrl = assets.generatedPdfUrl;
      await giftCard.save();
    } catch (renderError) {
      console.error('Erreur rendu carte cadeau manuelle (non bloquant)', renderError?.message || renderError);
    }

    // Transaction initiale `manual_issued` (émission).
    const transaction = await GiftCardTransaction.create({
      giftCardId: giftCard._id,
      transactionType: 'manual_issued',
      source: 'manual_institute',
      userId: customerId,
      actorUserId: req.sessionUser?._id || null,
      actorRole: resolveActorRole(req),
      amount,
      balanceBefore: 0,
      balanceAfter: amount,
      saleId: '',
      note: manualPaymentNote,
      items: []
    });

    // Event + mail (best-effort, ne casse jamais la création).
    const mailVariables = {
      ...(assets?.variables || {}),
      recipientName,
      purchaserName,
      amount: formatGiftCardAmount(amount),
      balance: formatGiftCardAmount(amount),
      code,
      pin: password,
      message,
      paymentLabel: MANUAL_GIFT_CARD_PAYMENT_LABEL,
      cardLink: giftCard.cardVisualUrl || ''
    };
    const mailResult = await sendGiftCardEventMail({
      eventName: 'gift_card.manual_created',
      giftCard,
      client: buildClientForMail(customer),
      variables: mailVariables,
      attachment: assets?.pdfBase64 ? { name: assets.pdfFileName, content: assets.pdfBase64 } : null,
      eventPayload: { creationMode: 'manual_institute', paymentMode: 'on_site' },
      actorId: req.sessionUser?._id || null
    });

    return res.status(201).json({
      ok: true,
      giftCard: {
        ...buildGiftCardGestionPayload(giftCard),
        recipientName,
        purchaserName,
        creationMode: 'manual_institute',
        paymentMode: 'on_site',
        paymentLabel: MANUAL_GIFT_CARD_PAYMENT_LABEL,
        cardVisualUrl: giftCard.cardVisualUrl,
        generatedPdfUrl: giftCard.generatedPdfUrl,
        // Code + mot de passe retournés UNE FOIS à l'admin (route dev/admin sécurisée) pour impression.
        code,
        password
      },
      transaction: buildGiftCardTransactionPayload(transaction.toObject(), { forGestion: true }),
      mail: mailResult
    });
  } catch (error) {
    console.error('Erreur création manuelle carte cadeau', error);
    const status = Number(error?.status) >= 400 && Number(error?.status) < 500 ? Number(error.status) : 500;
    return res.status(status).json({
      ok: false,
      error: status === 500 ? 'Impossible de créer la carte cadeau.' : error.message,
      code: error?.code || null
    });
  }
}

/**
 * M13 — Part 4 : retrouve une carte via un QR scanné.
 * POST /api/gestion/gift-cards/lookup-qr  Body : { qrPayload }
 */
export async function lookupGiftCardByQr(req, res) {
  const qrPayload = String(req.body?.qrPayload || req.body?.payload || '').trim();
  if (!qrPayload) {
    return res.status(400).json({ ok: false, error: 'QR manquant.' });
  }
  try {
    const card = await resolveGiftCardFromQrPayload(qrPayload, { lean: false });
    if (!card) {
      return res.status(404).json({ ok: false, error: 'QR invalide ou carte introuvable.', code: 'GIFT_CARD_QR_INVALID' });
    }
    const populated = await GiftCard.findById(card._id)
      .populate('userId', 'email firstName lastName role')
      .lean();
    return res.json({ ok: true, card: buildGiftCardGestionPayload(populated) });
  } catch (error) {
    console.error('Erreur lookup QR carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le QR.' });
  }
}

/**
 * M13 — Part 4 : débit manuel par identifiant de carte, motivé (sans mot de passe).
 * POST /api/gestion/gift-cards/:id/manual-debit  Body : { amount, reason, preview? }
 * `preview:true` → renvoie le solde projeté SANS débiter (validation en 2 temps côté UI).
 */
export async function manualDebitGiftCardById(req, res) {
  const cardId = String(req.params?.id || '').trim();
  const amount = sanitizeNumber(req.body?.amount);
  const reason = String(req.body?.reason || '').trim();
  const preview = req.body?.preview === true || String(req.query?.preview || '').toLowerCase() === 'true';

  if (!Types.ObjectId.isValid(cardId)) {
    return res.status(400).json({ ok: false, error: 'Carte invalide.' });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ ok: false, error: 'Montant invalide.', code: 'GIFT_CARD_AMOUNT_INVALID' });
  }
  if (!reason) {
    return res.status(400).json({ ok: false, error: 'Le motif est obligatoire.', code: 'DEBIT_REASON_REQUIRED' });
  }

  try {
    const card = await GiftCard.findById(cardId).populate('userId', 'email firstName lastName role');
    if (!card) {
      return res.status(404).json({ ok: false, error: 'Carte introuvable.' });
    }
    const availableBalance = getAvailableBalance(card);
    if (card.status !== 'active' || availableBalance <= 0) {
      return res.status(409).json({ ok: false, error: 'Carte épuisée ou inactive.', code: 'GIFT_CARD_NOT_DEBITABLE' });
    }
    if (amount > availableBalance) {
      return res.status(409).json({ ok: false, error: 'Montant supérieur au solde restant.', code: 'GIFT_CARD_BALANCE_INSUFFICIENT' });
    }

    // Preview : aperçu du solde restant, aucune écriture.
    if (preview) {
      return res.json({
        ok: true,
        preview: true,
        amount,
        balanceBefore: availableBalance,
        balanceAfter: Math.max(0, availableBalance - amount)
      });
    }

    const { balanceBefore, balanceAfter } = await deductGiftCardBalance(card, amount);
    const transaction = await GiftCardTransaction.create({
      giftCardId: card._id,
      transactionType: 'manual_debit',
      source: 'manual_institute',
      userId: card.userId?._id || card.userId,
      actorUserId: req.sessionUser?._id || null,
      actorRole: resolveActorRole(req),
      amount,
      balanceBefore,
      balanceAfter,
      saleId: '',
      note: reason,
      items: []
    });

    const owner = card.userId && typeof card.userId === 'object' ? card.userId : null;
    const mailResult = await sendGiftCardEventMail({
      eventName: 'gift_card.manual_debited',
      giftCard: card,
      client: buildClientForMail(owner),
      variables: {
        recipientName: card.recipientName || buildOwnerName(owner),
        amount: formatGiftCardAmount(amount),
        balance: formatGiftCardAmount(balanceAfter),
        code: card.code,
        transactionReason: reason,
        paymentLabel: card.paymentLabel || ''
      },
      eventPayload: { amountEur: amount },
      actorId: req.sessionUser?._id || null
    });

    const hydrated = await GiftCardTransaction.findById(transaction._id)
      .populate('actorUserId', 'email firstName lastName role')
      .populate('userId', 'email firstName lastName role')
      .lean();

    return res.json({
      ok: true,
      card: buildGiftCardGestionPayload(card),
      transaction: buildGiftCardTransactionPayload(hydrated, { forGestion: true }),
      mail: mailResult
    });
  } catch (error) {
    console.error('Erreur débit manuel carte cadeau (par id)', error);
    return res.status(500).json({ ok: false, error: 'Impossible d\'effectuer le débit manuel.' });
  }
}

/**
 * LOT2 §4 — Reset PIN + renvoi carte cadeau.
 * L'ancien PIN (hashé + chiffré) est écrasé → invalidé. Un nouveau PIN est généré, le QR est
 * pivoté, `pinVersion` incrémenté, le PDF régénéré, l'e-mail renvoyé (event
 * `gift_card.pin_reset_and_resent`), la transaction `pin_reset` journalisée.
 * SÉCURITÉ : le nouveau PIN n'est JAMAIS renvoyé par l'API (uniquement dans l'e-mail/PDF), jamais loggué.
 * POST /api/gestion/gift-cards/:id/reset-pin
 */
export async function resetGiftCardPinAndResend(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
  }
  try {
    const card = await GiftCard.findById(id).populate('userId', 'email firstName lastName role');
    if (!card) return res.status(404).json({ ok: false, error: 'Carte introuvable.' });
    if (card.status !== 'active') return res.status(409).json({ ok: false, error: 'Carte inactive.' });

    const owner = card.userId && typeof card.userId === 'object' ? card.userId : null;
    if (!owner?.email) return res.status(409).json({ ok: false, error: "Aucune adresse e-mail bénéficiaire." });

    // Nouveau PIN → l'ancien hash/chiffré est écrasé (invalidé). QR pivoté (ancien invalidé).
    const newPin = await assignGiftCardPassword(card, { save: false });
    const { payload: qrPayload } = rotateGiftCardQrToken(card);
    card.pinVersion = Number(card.pinVersion || 0) + 1;
    card.pinResetAt = new Date();
    await card.save();

    // Régénération du PDF avec le nouveau code (best-effort).
    let assets = null;
    try {
      const template = await getActiveGiftCardTemplateOrSeed();
      assets = await generateGiftCardAssets(card, { code: card.code, pin: newPin, qrPayload, template });
      card.cardVisualUrl = assets.cardVisualUrl;
      card.generatedPdfUrl = assets.generatedPdfUrl;
      if (assets.templateId) card.activeTemplateId = assets.templateId;
      await card.save();
    } catch (renderErr) {
      console.error('Erreur régénération carte cadeau (reset PIN)', renderErr?.message || renderErr);
      notifyDevAlert('system_error', { scope: 'gift_card.render.pin_reset', errorMessage: renderErr?.message || 'render' });
    }

    // Journalisation (jamais le PIN en clair).
    const actorId = req.sessionUser?._id || null;
    await GiftCardTransaction.create({
      giftCardId: card._id,
      transactionType: 'pin_reset',
      source: 'manual_institute',
      userId: owner?._id || card.userId,
      actorUserId: actorId,
      actorRole: resolveActorRole(req),
      amount: 0,
      balanceBefore: card.balance,
      balanceAfter: card.balance,
      saleId: '',
      note: `PIN réinitialisé (v${card.pinVersion})`,
      items: []
    });

    // Renvoi (best-effort) — le couple from/to vient de la règle centrale.
    const mailResult = await sendGiftCardEventMail({
      eventName: 'gift_card.pin_reset_and_resent',
      giftCard: card,
      client: buildClientForMail(owner),
      variables: {
        recipientName: card.recipientName || buildOwnerName(owner),
        code: card.code,
        pin: newPin,
        balance: formatGiftCardAmount(card.balance),
        message: card.message || ''
      },
      attachment: assets?.pdfBase64 ? { name: assets.pdfFileName, content: assets.pdfBase64 } : null,
      eventPayload: { pinVersion: card.pinVersion },
      actorId
    });

    return res.json({
      ok: true,
      card: buildGiftCardGestionPayload(card),
      pinVersion: card.pinVersion,
      mail: mailResult
    });
  } catch (error) {
    console.error('Erreur reset PIN carte cadeau', error);
    return res.status(500).json({ ok: false, error: "Impossible de réinitialiser le code." });
  }
}

export async function generateMissingGiftCardPasswords(req, res) {
  try {
    const missingFilter = buildMissingPasswordFilter();
    const wantsDryRun =
      req.method === 'GET'
        ? String(req.query?.dryRun || '').trim().toLowerCase() === 'true'
        : Boolean(req.body?.dryRun);
    const totalMissing = await GiftCard.countDocuments(missingFilter);

    if (!totalMissing || wantsDryRun) {
      return res.json({ ok: true, generatedCount: 0, totalMissing });
    }

    const cards = await GiftCard.find(missingFilter);
    let generatedCount = 0;
    for (const card of cards) {
      await assignGiftCardPassword(card, { save: true });
      generatedCount += 1;
    }

    return res.json({
      ok: true,
      generatedCount,
      totalMissing
    });
  } catch (error) {
    console.error('Erreur generation mots de passe cartes cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de generer les mots de passe.' });
  }
}




