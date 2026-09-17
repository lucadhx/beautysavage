import Sale from '../models/Sale.js';
import GiftCard from '../models/GiftCard.js';
import CartSnapshot from '../models/CartSnapshot.js';
import User from '../models/user.js';
import CommissionTransaction from '../models/CommissionTransaction.js';
import Invoice from '../models/Invoice.js';
import RefundRequest from '../models/RefundRequest.js';
import ServiceBooking from '../models/ServiceBooking.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSegments, locateSegment } from '../utils/statistics.js';
import {
  ensureRefundCommissionProvision,
  ensureRefundCommissionReversal
} from '../services/refundService.js';
import { triggerRefundExecution, resolveRefundRecipientContext } from '../services/refundExecutionService.js';
import { sendRefundRefusedEmail } from '../services/mailService.js';
import { resolvePublicBaseUrl } from '../services/system/domainResolver.js';
import { requireSecret } from '../utils/secretEnv.js';
import { getStripeClient } from '../services/stripe/stripeConfigService.js';
import { getSessionUserId } from '../utils/session.js';
import { emitRefundEvent } from '../services/businessEventService.js';

const GIFT_CARD_PASSWORD_SECRET = requireSecret('GIFT_CARD_PASSWORD_SECRET', { fallback: 'SESSION_SECRET' });
const GIFT_CARD_PASSWORD_KEY = crypto
  .createHash('sha256')
  .update(String(GIFT_CARD_PASSWORD_SECRET))
  .digest();

// LOT1 — accès Stripe institut consolidé sur l'accesseur canonique `getStripeClient`.
const getStripe = getStripeClient;

function roundToCents(value) {
  const candidate = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(candidate * 100) / 100;
}

function parseDateParam(value) {
  if (!value) return null;
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) return null;
  return candidate;
}

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeRefundStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['requested', 'pending', 'succeeded', 'failed', 'canceled'].includes(status)) {
    return status;
  }
  return '';
}

function buildRefundDateFilter(from, to) {
  const createdAt = {};
  if (from) createdAt.$gte = from;
  if (to) createdAt.$lt = to;
  return Object.keys(createdAt).length ? { requestedAt: createdAt } : {};
}

function normalizeStripeRefundStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['not_applicable', 'pending', 'succeeded', 'failed'].includes(status)) {
    return status;
  }
  return 'not_applicable';
}

function normalizeGiftCardRefundStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['not_applicable', 'pending', 'succeeded', 'failed', 'rollback_needed'].includes(status)) {
    return status;
  }
  return 'not_applicable';
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

function buildRecipientName(user = null) {
  const firstName = String(user?.firstName || '').trim();
  const lastName = String(user?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || null;
}

async function resolveReadableInvoicePath(invoice) {
  const pdfPath = String(invoice?.pdfPath || '').trim();
  if (!pdfPath) return null;
  const resolvedPath = path.resolve(process.cwd(), pdfPath);
  try {
    await fs.promises.access(resolvedPath, fs.constants.R_OK);
    return resolvedPath;
  } catch (error) {
    console.error('Facture gestion introuvable sur le disque', error);
    return null;
  }
}

async function resolveStripeInvoicePdfUrl(invoiceDoc) {
  if (!invoiceDoc) return null;
  const directUrl = String(invoiceDoc.stripeInvoicePdfUrl || '').trim();
  if (directUrl) return directUrl;
  const stripeInvoiceId = String(invoiceDoc.stripeInvoiceId || '').trim();
  if (!stripeInvoiceId) return null;
  try {
    const stripe = await getStripe();
    const stripeInvoice = await stripe.invoices.retrieve(stripeInvoiceId);
    const stripePdfUrl = String(stripeInvoice?.invoice_pdf || '').trim();
    if (!stripePdfUrl) return null;
    invoiceDoc.stripeInvoicePdfUrl = stripePdfUrl;
    await invoiceDoc.save();
    return stripePdfUrl;
  } catch (error) {
    console.error('Erreur recuperation invoice_pdf Stripe (gestion)', error);
    return null;
  }
}

async function resolveRecreditedGiftCardPayload(refund = {}) {
  const saleId = String(refund?.saleId || '').trim();
  if (!saleId) return null;

  const sale = await Sale.findOne({ saleId }).select({ giftCardUsage: 1 }).lean();
  const usages = Array.isArray(sale?.giftCardUsage)
    ? sale.giftCardUsage.filter(entry => entry?.giftCardId && Number(entry?.amountUsed || 0) > 0)
    : [];
  if (!usages.length) return null;

  const orderedCardIds = usages.map(entry => String(entry.giftCardId || '').trim()).filter(Boolean);
  if (!orderedCardIds.length) return null;

  const cards = await GiftCard.find({ _id: { $in: orderedCardIds } })
    .select({ code: 1, balance: 1, passwordEncrypted: 1, userId: 1 })
    .lean();
  if (!cards.length) return null;

  const cardById = new Map(cards.map(card => [String(card._id || '').trim(), card]));
  let selectedCard = null;
  for (const cardId of orderedCardIds) {
    if (cardById.has(cardId)) {
      selectedCard = cardById.get(cardId);
      break;
    }
  }
  if (!selectedCard) return null;

  let recipientName = null;
  const recipientUserId = selectedCard?.userId || refund?.userId || null;
  if (recipientUserId) {
    const recipientUser = await User.findById(recipientUserId).select({ firstName: 1, lastName: 1 }).lean();
    recipientName = buildRecipientName(recipientUser);
  }

  // SECURITY (Phase 1A): never expose the gift-card password through the public,
  // unauthenticated tracking endpoint. The card code alone is not usable without
  // the password, which the legitimate owner can retrieve from their account.
  return {
    code: String(selectedCard.code || '').trim(),
    balance: Number.isFinite(Number(selectedCard.balance)) ? Number(selectedCard.balance) : 0,
    expiresAt: null,
    recipientName
  };
}

export async function getSalesStats(req, res) {
  try {
    const period = String(req.query.period || 'day').toLowerCase();
    if (!['day', 'week', 'month', 'year'].includes(period)) {
      return res.status(400).json({ ok: false, error: 'Periode invalide.' });
    }
    const referenceDate = parseDateParam(req.query.referenceDate) || parseDateParam(req.query.startDate);
    const segments = buildSegments(period, referenceDate);
    if (!segments.length) {
      return res.status(500).json({ ok: false, error: 'Impossible de construire la periode demandee.' });
    }
    const startFilter = parseDateParam(req.query.startDate) ?? segments[0]?.start;
    const endFilter = parseDateParam(req.query.endDate) ?? segments[segments.length - 1]?.end;
    const query = {};
    if (startFilter || endFilter) {
      query.createdAt = {};
      if (startFilter) query.createdAt.$gte = startFilter;
      if (endFilter) query.createdAt.$lt = endFilter;
    }
    const sales = await Sale.find(query).lean();
    let totalRevenue = 0;
    let totalFormations = 0;
    let totalProducts = 0;
    let totalGiftCardPurchases = 0;
    let totalGiftCardConsumption = 0;
    for (const sale of sales) {
      const amount = Number.isFinite(Number(sale.totalAmount || 0)) ? Number(sale.totalAmount || 0) : 0;
      totalRevenue += amount;
      const timestamp = new Date(sale.createdAt || Date.now()).getTime();
      const segment = locateSegment(segments, timestamp);
      if (segment) {
        segment.count += 1;
        segment.revenue += amount;
      }
      const items = Array.isArray(sale.items) ? sale.items : [];
      for (const item of items) {
        if (!item) continue;
        switch (item.type) {
          case 'formation':
            totalFormations += 1;
            if (segment) segment.formations += 1;
            break;
          case 'product':
            totalProducts += 1;
            if (segment) segment.products += 1;
            break;
          case 'gift-card':
            totalGiftCardPurchases += 1;
            if (segment) segment.giftCardPurchases += 1;
            break;
          default:
            break;
        }
      }
      const usages = Array.isArray(sale.giftCardUsage) ? sale.giftCardUsage : [];
      for (const usage of usages) {
        if (!usage) continue;
        const used = Number.isFinite(Number(usage.amountUsed || 0)) ? Number(usage.amountUsed || 0) : 0;
        if (!used) continue;
        totalGiftCardConsumption += used;
        if (segment) segment.giftCardUsage += used;
      }
    }
    const responseSeries = segments.map(segment => ({
      label: segment.label,
      count: segment.count,
      revenue: roundToCents(segment.revenue)
    }));
    const detailSeries = {
      formations: segments.map(segment => ({ label: segment.label, value: segment.formations })),
      products: segments.map(segment => ({ label: segment.label, value: segment.products })),
      giftCards: segments.map(segment => ({ label: segment.label, value: segment.giftCardPurchases }))
    };
    const giftCardUsageSeries = segments.map(segment => ({
      label: segment.label,
      value: roundToCents(segment.giftCardUsage)
    }));
    return res.json({
      ok: true,
      period,
      startDate: startFilter?.toISOString(),
      endDate: endFilter?.toISOString(),
      totalSales: sales.length,
      totalRevenue: roundToCents(totalRevenue),
      totalFormations,
      totalProducts,
      totalGiftCardPurchases,
      totalGiftCardConsumption: roundToCents(totalGiftCardConsumption),
      series: responseSeries,
      detailSeries,
      giftCardUsage: giftCardUsageSeries
    });
  } catch (error) {
    console.error('Erreur stats ventes', error);
    return res.status(500).json({ ok: false, error: 'Impossible de calculer les statistiques.' });
  }
}

export async function listSales(req, res) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const sales = await Sale.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const saleIds = sales.map(entry => entry.saleId).filter(Boolean);
    const invoices = saleIds.length ? await Invoice.find({ saleId: { $in: saleIds } }).lean() : [];
    const invoiceMap = new Map(invoices.map(invoice => [String(invoice.saleId || ''), invoice]));
    const commissionDocs = saleIds.length
      ? await CommissionTransaction.find({ saleId: { $in: saleIds } }).lean()
      : [];
    const commissionMap = new Map();
    commissionDocs.forEach(doc => {
      if (!doc || !doc.saleId) return;
      const bucket = commissionMap.get(doc.saleId) || [];
      bucket.push(doc);
      commissionMap.set(doc.saleId, bucket);
    });
    const roundToCents = value => Math.round(Number(value || 0) * 100) / 100;
    const salesWithCommission = sales.map(sale => {
      const details = commissionMap.get(sale.saleId) || [];
      const commissionTotal = roundToCents(
        details.reduce((sum, entry) => sum + Number(entry.commissionAmount || 0), 0)
      );
      const invoice = invoiceMap.get(String(sale.saleId || '')) || null;
      return {
        ...sale,
        commissionTotal,
        commissionDetails: details,
        invoice: invoice
          ? {
              invoiceId: String(invoice.invoiceId || ''),
              stripeInvoiceId: String(invoice.stripeInvoiceId || ''),
              stripeInvoicePdfUrl: String(invoice.stripeInvoicePdfUrl || ''),
              stripeHostedUrl: String(invoice.stripeHostedUrl || ''),
              downloadUrl: `/api/gestion/sales/${encodeURIComponent(String(sale.saleId || ''))}/invoice`
            }
          : null
      };
    });
    return res.json({ ok: true, sales: salesWithCommission });
  } catch (error) {
    console.error('Erreur liste ventes', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les ventes.' });
  }
}

export async function downloadSaleInvoiceForGestion(req, res) {
  const saleId = String(req.params.saleId || '').trim();
  if (!saleId) {
    return res.status(400).json({ ok: false, error: 'Identifiant de vente invalide.' });
  }
  try {
    const invoice = await Invoice.findOne({ saleId });
    if (!invoice) {
      return res.status(404).json({ ok: false, error: 'Facture introuvable.' });
    }

    const stripePdfUrl = await resolveStripeInvoicePdfUrl(invoice);
    if (stripePdfUrl) {
      return res.redirect(302, stripePdfUrl);
    }

    const resolvedPath = await resolveReadableInvoicePath(invoice);
    if (!resolvedPath) {
      return res.status(404).json({ ok: false, error: 'Facture indisponible.' });
    }
    const fileName = String(invoice.fileName || '').trim() || 'facture.pdf';
    return res.download(resolvedPath, fileName, downloadError => {
      if (downloadError && !res.headersSent) {
        console.error('Erreur telechargement facture gestion', downloadError);
        res.status(500).json({ ok: false, error: 'Impossible de telecharger la facture.' });
      }
    });
  } catch (error) {
    console.error('Erreur telechargement facture gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de telecharger la facture.' });
  }
}

export async function listCartSnapshots(req, res) {
  try {
    const snapshots = await CartSnapshot.find().sort({ updatedAt: -1 }).lean();
    const userIds = Array.from(new Set(snapshots.map(snapshot => snapshot.userId?.toString()).filter(Boolean)));
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
    const userMap = new Map(users.map(user => [user._id?.toString(), user]));
    const payload = snapshots.map(snapshot => {
      const user = userMap.get(snapshot.userId?.toString());
      return {
        userId: snapshot.userId?.toString(),
        customer: {
          firstName: user?.firstName || '',
          lastName: user?.lastName || '',
          email: user?.email || ''
        },
        items: snapshot.items,
        totalAmount: snapshot.totalAmount,
        itemCount: snapshot.itemCount,
        updatedAt: snapshot.updatedAt
      };
    });
    return res.json({ ok: true, snapshots: payload });
  } catch (error) {
    console.error('Erreur lecture paniers', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les paniers.' });
  }
}

export async function listRefunds(req, res) {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = Math.min(parsePositiveInt(req.query.limit, 30), 200);
    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);
    const status = normalizeRefundStatus(req.query.status);
    const skip = (page - 1) * limit;

    const filter = {
      ...buildRefundDateFilter(from, to),
      ...(status ? { status } : {})
    };

    const [total, rows, aggregate] = await Promise.all([
      RefundRequest.countDocuments(filter),
      RefundRequest.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      RefundRequest.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: { $ifNull: ['$amount', 0] } }
          }
        }
      ])
    ]);

    const userIds = Array.from(new Set(rows.map(entry => entry.userId?.toString()).filter(Boolean)));
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).select({ email: 1, firstName: 1, lastName: 1 }).lean()
      : [];
    const userMap = new Map(users.map(user => [String(user._id || ''), user]));

    const totalRefunded = roundToCents(Number(aggregate?.[0]?.totalAmount || 0));

    const refunds = rows.map(entry => {
      const user = userMap.get(String(entry.userId || ''));
      const clientEmail = String(user?.email || '').trim();
      const formationTitle = String(entry?.meta?.formationTitle || '').trim() || 'Formation';
      return {
        refundId: String(entry.refundId || '').trim(),
        saleId: String(entry.saleId || '').trim(),
        trackingToken: String(entry.trackingToken || '').trim(),
        creditNoteId: String(entry.creditNoteId || '').trim(),
        creditNotePdfUrl: String(entry.creditNotePdfUrl || '').trim(),
        status: String(entry.status || '').trim(),
        stripeRefundId: String(entry.stripeRefundId || '').trim(),
        stripeRefundStatus: normalizeStripeRefundStatus(entry.stripeRefundStatus),
        giftCardRefundStatus: normalizeGiftCardRefundStatus(entry.giftCardRefundStatus),
        stripeRefundAmount: Number.isFinite(Number(entry.stripeRefundAmount))
          ? Number(entry.stripeRefundAmount)
          : null,
        giftCardRefundAmount: Number.isFinite(Number(entry.giftCardRefundAmount))
          ? Number(entry.giftCardRefundAmount)
          : null,
        amount: Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : 0,
        currency: String(entry.currency || 'EUR').trim() || 'EUR',
        requestedAt: entry.requestedAt || null,
        processedAt: entry.processedAt || null,
        refundedAt: entry.refundedAt || null,
        requiresAdminIntervention: normalizeStripeRefundStatus(entry.stripeRefundStatus) === 'failed',
        eligibleRefund: Boolean(entry.eligibleRefund),
        sessionStartAt: entry.sessionStartAt || null,
        reason: String(entry.reason || '').trim(),
        formationId: entry.formationId?.toString() || '',
        formationTitle,
        formationCoverImage: String(entry?.meta?.formationCoverImage || '').trim(),
        saleCreatedAt: entry?.meta?.saleCreatedAt || null,
        client: {
          userId: entry.userId?.toString() || '',
          email: clientEmail || 'Email indisponible',
          firstName: String(user?.firstName || '').trim(),
          lastName: String(user?.lastName || '').trim()
        }
      };
    });

    return res.json({
      ok: true,
      refunds,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      },
      totalRefunded
    });
  } catch (error) {
    console.error('Erreur lecture remboursements', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les remboursements.' });
  }
}

// A4 — Gouvernance : une décision admin de remboursement laisse toujours une trace
// EventLog (qui/quand/raison/résultat). Mappe le statut cible vers l'event terminal.
function refundEventNameForStatus(status) {
  if (status === 'succeeded') return 'refund.succeeded';
  if (status === 'failed' || status === 'canceled') return 'refund.failed';
  if (status === 'requested' || status === 'pending') return 'refund.requested';
  return null;
}

export async function updateRefundStatus(req, res) {
  const refundId = String(req.params.refundId || '').trim();
  if (!refundId) {
    return res.status(400).json({ ok: false, error: 'Identifiant remboursement invalide.' });
  }
  const nextStatus = normalizeRefundStatus(req.body?.status);
  if (!nextStatus) {
    return res.status(400).json({ ok: false, error: 'Statut remboursement invalide.' });
  }
  // A4 — acteur (admin) + raison pour l'audit. Best-effort : adminId peut être absent.
  const adminId = getSessionUserId(req);
  const adminReason = String(req.body?.reason || '').trim().slice(0, 500);

  // Émission audit (best-effort, ne casse jamais le flux). Appelée après chaque
  // transition terminale pour qu'aucune décision financière ne soit silencieuse.
  const emitAdminRefundAudit = async (refundDoc, status) => {
    const eventName = refundEventNameForStatus(status);
    if (!eventName) return;
    await emitRefundEvent(eventName, refundDoc, {
      actorType: adminId ? 'user' : 'system',
      actorId: adminId ? String(adminId) : null,
      extra: { decidedBy: 'admin', reason: adminReason || null, targetStatus: status }
    });
  };

  try {
    const refund = await RefundRequest.findOne({ refundId });
    if (!refund) {
      return res.status(404).json({ ok: false, error: 'Remboursement introuvable.' });
    }

    const currentStatus = String(refund.status || '').trim();
    if (currentStatus === nextStatus) {
      return res.json({ ok: true, refund: refund.toObject() });
    }

    // Persiste la raison admin dans les notes (audit durable, sans donnée sensible).
    if (adminReason) {
      const existingNotes = String(refund?.meta?.notes || '').trim();
      const tag = `admin:${nextStatus}:${adminReason}`;
      refund.meta = refund.meta || {};
      refund.meta.notes = existingNotes ? `${existingNotes} | ${tag}` : tag;
    }

    const closableStatuses = new Set(['succeeded', 'failed', 'canceled']);
    if (closableStatuses.has(currentStatus) && !closableStatuses.has(nextStatus)) {
      return res.status(409).json({
        ok: false,
        error: 'Transition de statut non autorisee pour ce remboursement.'
      });
    }

    if (nextStatus === 'succeeded') {
      const sale = refund.saleId ? await Sale.findOne({ saleId: refund.saleId }).lean() : null;
      if (!sale) {
        return res.status(409).json({
          ok: false,
          error: 'Vente introuvable pour ce remboursement.'
        });
      }
      try {
        const execution = await triggerRefundExecution(refund, sale);
        await ensureRefundCommissionProvision(execution.refund || refund);
        await emitAdminRefundAudit(execution.refund || refund, 'succeeded');
        return res.json({
          ok: true,
          stripeInitiated: Boolean(execution?.stripeInitiated),
          refund: (execution.refund || refund).toObject()
        });
      } catch (executionError) {
        if (executionError?.status === 409) {
          return res.status(409).json({ ok: false, error: executionError.message });
        }
        throw executionError;
      }
    }

    refund.status = nextStatus;
    refund.processedAt = closableStatuses.has(nextStatus) ? new Date() : null;
    refund.stripeRefundStatus = normalizeStripeRefundStatus(refund.stripeRefundStatus);
    refund.giftCardRefundStatus = normalizeGiftCardRefundStatus(refund.giftCardRefundStatus);
    await refund.save();

    if (nextStatus === 'requested' || nextStatus === 'pending') {
      await ensureRefundCommissionProvision(refund);
    }
    if (nextStatus === 'failed' || nextStatus === 'canceled') {
      await ensureRefundCommissionReversal(refund);
      // LOT2 P1-12 — e-mail client « demande de remboursement non retenue » (best-effort).
      try {
        const ctx = await resolveRefundRecipientContext(refund);
        if (ctx.toEmail) {
          await sendRefundRefusedEmail({
            toEmail: ctx.toEmail,
            firstName: ctx.firstName,
            itemDetail: ctx.itemDetail,
            refundReason: adminReason || 'Demande non éligible',
            actionUrl: ctx.trackingUrl || resolvePublicBaseUrl()
          });
        }
      } catch (mailErr) {
        console.error('[updateRefundStatus] Erreur envoi email refund_refused', mailErr?.message || mailErr);
      }
    }

    await emitAdminRefundAudit(refund, nextStatus);

    return res.json({ ok: true, refund: refund.toObject() });
  } catch (error) {
    console.error('Erreur mise a jour statut remboursement', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre a jour le remboursement.' });
  }
}

export async function getRefundByTrackingToken(req, res) {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'Token manquant.' });

  try {
    const refund = await RefundRequest.findOne({ trackingToken: token }).lean();
    if (!refund) {
      return res.status(404).json({ ok: false, error: 'Lien invalide ou expire.' });
    }
    const expiresAt = refund.trackingTokenExpiresAt ? new Date(refund.trackingTokenExpiresAt) : null;
    if (expiresAt && expiresAt < new Date()) {
      return res.status(404).json({ ok: false, error: 'Lien expire.' });
    }

    const itemType = String(refund.itemType || 'formation');

    let itemTitle = '';
    let itemDate = null;

    if (itemType === 'service') {
      const booking = await ServiceBooking.findOne({ saleId: refund.saleId })
        .populate('serviceId', 'name').lean();
      itemTitle = booking?.serviceId?.name
        || String(refund.meta?.formationTitle || '')
        || 'Prestation';
      const startAt = booking?.startAt || refund.sessionStartAt || null;
      itemDate = startAt
        ? new Date(startAt).toLocaleString('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : null;
    } else {
      itemTitle = String(refund.meta?.formationTitle || '');
      itemDate = refund.sessionStartAt
        ? new Date(refund.sessionStartAt).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
          })
        : null;
    }

    const stripeRefundStatus = normalizeStripeRefundStatus(refund.stripeRefundStatus);
    const giftCardRefundStatus = normalizeGiftCardRefundStatus(refund.giftCardRefundStatus);
    const stripeRefundAmount = Number.isFinite(Number(refund.stripeRefundAmount))
      ? Number(refund.stripeRefundAmount)
      : null;
    const giftCardRefundAmount = Number.isFinite(Number(refund.giftCardRefundAmount))
      ? Number(refund.giftCardRefundAmount)
      : null;
    const giftCard =
      giftCardRefundStatus === 'succeeded' ? await resolveRecreditedGiftCardPayload(refund) : null;

    const payload = {
      status: String(refund.status || 'requested'),
      amount: Number(refund.amount || 0),
      itemType,
      itemTitle,
      itemDate,
      formationTitle: itemTitle,
      sessionDate: itemDate,
      refundedAt: refund.refundedAt || null,
      stripeRefundConfirmedAt: refund.stripeRefundConfirmedAt || null,
      estimatedDelay: '5 a 10 jours ouvres',
      giftCardRecredited: Boolean(refund.giftCardRecredited),
      giftCardRecreditAmount: refund.giftCardRecreditAmount || null,
      stripeRefundStatus,
      giftCardRefundStatus,
      stripeRefundAmount,
      giftCardRefundAmount,
      giftCard,
      isSplitRefund: Boolean(
        Number.isFinite(stripeRefundAmount) &&
          Number.isFinite(giftCardRefundAmount) &&
          stripeRefundAmount > 0 &&
          giftCardRefundAmount > 0
      )
    };

    return res.json({
      ok: true,
      refund: payload,
      ...payload
    });
  } catch (error) {
    console.error('Erreur lecture tracking remboursement', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le suivi.' });
  }
}

export async function getServiceBookingForSale(req, res) {
  const saleId = String(req.params.saleId || '').trim();
  if (!saleId) return res.status(400).json({ ok: false, error: 'saleId manquant.' });

  try {
    const booking = await ServiceBooking.findOne({ saleId })
      .select('bookingId totalPrice depositAmount paymentType status startAt endAt selectedOptions')
      .lean();

    if (!booking) return res.status(404).json({ ok: false, booking: null });

    return res.json({
      ok: true,
      booking: {
        bookingId: booking.bookingId,
        totalPrice: booking.totalPrice,
        depositAmount: booking.depositAmount,
        paymentType: booking.paymentType,
        status: booking.status,
        startAt: booking.startAt,
        endAt: booking.endAt,
        selectedOptions: booking.selectedOptions || []
      }
    });
  } catch (error) {
    console.error('getServiceBookingForSale error', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
