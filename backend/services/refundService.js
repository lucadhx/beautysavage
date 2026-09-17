import crypto from 'node:crypto';
import mongoose from 'mongoose';

import Sale from '../models/Sale.js';
import CommissionTransaction from '../models/CommissionTransaction.js';
import CommissionPayment from '../models/CommissionPayment.js';
import { RETRACTATION_DAYS } from '../constants/consumerWaiver.js';
import { calculateCommissionAmount, getActiveCommissionConfig } from './commissionService.js';
import { emitCommissionEvent } from './businessEventService.js';

export const REFUND_REASON_CLIENT_CANCEL_PRESENTIEL = 'client_cancel_presentiel';
export const REFUND_REASON_SESSION_CANCELED_BY_INSTITUTE = 'session_canceled_by_institute';
export const REFUND_SOURCE_ADJUSTMENT = 'refund_adjustment';
export const REFUND_SOURCE_REVERSAL = 'refund_reversal';

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
}

export function buildRefundId() {
  const suffix = crypto.randomUUID().split('-')[0];
  return `REF-${Date.now()}-${suffix}`;
}

function normalizeRefundDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(0, parsed);
}

function normalizeSessionDateFromFormation(formation = {}) {
  const candidates = [
    formation?.sessionDate,
    formation?.sessionStartAt,
    formation?.date_session,
    formation?.startDate
  ];
  for (const candidate of candidates) {
    const parsed = new Date(candidate || '');
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

export function getPresentielRefundEligibility({ sale, formation, now = new Date() } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const purchaseDate = new Date(sale?.createdAt || sale?.date_achat || '');
  const sessionDate = normalizeSessionDateFromFormation(formation);
  const refundDays = normalizeRefundDays(formation?.refundDays);

  const hasValidPurchaseDate = !Number.isNaN(purchaseDate.getTime());
  const hasValidSessionDate = !Number.isNaN(sessionDate?.getTime?.() || Number.NaN);

  const daysSincePurchase = hasValidPurchaseDate
    ? (nowDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
    : Number.POSITIVE_INFINITY;
  const withinLegalRetractation = daysSincePurchase < RETRACTATION_DAYS;

  const waiverSigned = Boolean(sale?.consumerWaiverAcceptedAt);
  const legalEligible = withinLegalRetractation && !waiverSigned;

  const daysBeforeSession = hasValidSessionDate
    ? (sessionDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24)
    : Number.NEGATIVE_INFINITY;
  const institutEligible = daysBeforeSession > refundDays;

  return {
    eligibleRefund: legalEligible || institutEligible,
    reason: legalEligible ? 'retractation' : institutEligible ? 'institut' : 'none',
    refundDays,
    daysBeforeSession: Number.isFinite(daysBeforeSession) ? Math.floor(daysBeforeSession) : null,
    daysSincePurchase: Number.isFinite(daysSincePurchase) ? Math.floor(daysSincePurchase) : null,
    waiverSigned
  };
}

// Pré-React C3 — Éligibilité remboursement d'une formation DISTANCIELLE (contenu numérique
// à vie). Règle produit : une fois l'accès donné, PAS de remboursement (renonciation au droit
// de rétractation obligatoire avant accès immédiat, cf. A1). Tant que l'accès n'est pas donné
// et que la fenêtre légale n'est pas expirée, le cas reste à arbitrer (documenté, non auto).
export const REFUND_REASON_DISTANCIEL_ACCESS_GRANTED = 'distanciel_access_granted_non_refundable';

export function getDistancielRefundEligibility({ formation, sale, now = new Date() } = {}) {
  const type = String(formation?.type || '').trim().toLowerCase();
  if (type !== 'distanciel') {
    return { applicable: false, eligibleRefund: false, reason: 'not_distanciel' };
  }
  const isRefundableAfterAccess = formation?.isRefundableAfterAccess === true;
  const accessGranted = Boolean(
    sale?.accessGrantedAt ||
      String(sale?.accessDeliveryStatus || '') === 'immediate'
  );

  if (accessGranted && !isRefundableAfterAccess) {
    return {
      applicable: true,
      eligibleRefund: false,
      reason: REFUND_REASON_DISTANCIEL_ACCESS_GRANTED,
      accessGranted: true,
      lifetime: formation?.accessLifetime !== false
    };
  }
  // Accès non encore donné : la rétractation légale pourrait s'appliquer si aucune
  // renonciation immédiate n'a été acceptée — arbitrage manuel (documenté rapport 112).
  return {
    applicable: true,
    eligibleRefund: false,
    reason: 'distanciel_access_pending_manual_review',
    accessGranted: false,
    lifetime: formation?.accessLifetime !== false
  };
}

function findSaleItemForFormation(saleDoc, formationId) {
  const target = String(formationId || '').trim();
  const items = Array.isArray(saleDoc?.items) ? saleDoc.items : [];
  return (
    items.find(item => {
      if (item?.type !== 'formation') return false;
      const itemFormationId = String(item?.formationId || item?.itemId || '').trim();
      return itemFormationId === target;
    }) || null
  );
}

function resolveRefundableAmountFromSale(saleDoc, formationId) {
  const normalizedFormationId = String(formationId || '').trim();
  const saleItem = findSaleItemForFormation(saleDoc, normalizedFormationId);
  if (!saleItem) {
    return { saleItem: null, amount: 0 };
  }
  const items = Array.isArray(saleDoc?.items) ? saleDoc.items : [];
  const refundableItems = items.filter(item => {
    const type = String(item?.type || '').trim().toLowerCase();
    const itemFormationId = String(item?.formationId || '').trim();
    const itemId = String(item?.itemId || '').trim();
    if (type === 'formation') {
      return itemFormationId === normalizedFormationId || itemId === normalizedFormationId;
    }
    if (type === 'formation-option') {
      return itemFormationId === normalizedFormationId;
    }
    return false;
  });
  const amount = roundToCents(
    Math.max(
      0,
      refundableItems.reduce((sum, item) => {
        const candidate = item?.finalPrice ?? item?.price ?? item?.basePrice ?? 0;
        return sum + Number(candidate || 0);
      }, 0)
    )
  );
  return { saleItem, amount };
}

export async function resolveSaleForFormationPurchase({
  userId,
  formationId,
  preferredSaleId = ''
} = {}) {
  const userObjectId = toObjectId(userId);
  const formationObjectId = toObjectId(formationId);
  if (!userObjectId || !formationObjectId) {
    return { sale: null, saleItem: null, amount: 0 };
  }

  const saleQueries = [];
  const preferred = String(preferredSaleId || '').trim();
  const formationMatch = [{ 'items.itemId': formationObjectId }, { 'items.formationId': formationObjectId }];
  if (preferred) {
    saleQueries.push({ userId: userObjectId, saleId: preferred, $or: formationMatch });
  }
  saleQueries.push({ userId: userObjectId, $or: formationMatch });

  for (const query of saleQueries) {
    const sale = await Sale.findOne(query).sort({ createdAt: -1 }).lean();
    if (!sale) continue;
    const { saleItem, amount } = resolveRefundableAmountFromSale(sale, formationObjectId);
    if (!saleItem) continue;
    return {
      sale,
      saleItem,
      amount
    };
  }

  return { sale: null, saleItem: null, amount: 0 };
}

export function resolveSaleAcceptedText(saleDoc) {
  return String(
    saleDoc?.renonciation_text ||
      saleDoc?.consumerWaiverAcceptedText ||
      ''
  ).trim();
}

async function resolveCommissionBase(refundDoc) {
  const saleId = String(refundDoc?.saleId || '').trim();
  const formationId = toObjectId(refundDoc?.formationId);
  if (!saleId || !formationId) {
    return { commissionAmountAbs: 0, commissionType: 'fixed', commissionValue: 0 };
  }

  const saleCommissionRows = await CommissionTransaction.find({
    saleId,
    formationId,
    $or: [{ sourceType: { $exists: false } }, { sourceType: 'sale' }]
  }).lean();
  const saleCommissionAmount = roundToCents(
    saleCommissionRows.reduce((sum, row) => sum + Math.max(0, Number(row?.commissionAmount || 0)), 0)
  );
  if (saleCommissionAmount > 0) {
    const first = saleCommissionRows[0] || {};
    return {
      commissionAmountAbs: saleCommissionAmount,
      commissionType: first.commissionType || 'fixed',
      commissionValue: Number.isFinite(Number(first.commissionValue)) ? Number(first.commissionValue) : 0
    };
  }

  const config = await getActiveCommissionConfig();
  const commissionType = config?.type || 'fixed';
  const commissionValue = Number.isFinite(Number(config?.value)) ? Number(config.value) : 0;
  const commissionAmountAbs = roundToCents(
    Math.max(
      0,
      calculateCommissionAmount({
        type: commissionType,
        value: commissionValue,
        price: Number(refundDoc?.amount || 0)
      })
    )
  );
  return { commissionAmountAbs, commissionType, commissionValue };
}

// A5 — Émet les events d'audit commission après création d'une provision de
// remboursement. `commission.adjusted` est toujours émis ; `commission.reversal_required`
// l'est en plus si la commission de la vente a déjà été PAYÉE (CommissionPayment du mois
// de la vente au statut `succeeded`), car la déduction ne peut plus réduire une facture
// réglée → récupération manuelle nécessaire (claw-back non automatisée, cf. rapport 88).
// Best-effort : ne throw jamais vers le flux remboursement.
async function emitRefundCommissionAdjustmentEvents(refundDoc, adjustmentRow) {
  try {
    const saleId = String(refundDoc?.saleId || '').trim();
    const refundId = String(refundDoc?.refundId || '').trim();
    const amountAbs = roundToCents(Math.abs(Number(adjustmentRow?.commissionAmount || 0)));
    const sale = saleId ? await Sale.findOne({ saleId }).select({ createdAt: 1 }).lean() : null;

    let alreadyPaid = null;
    if (sale?.createdAt) {
      const saleDate = new Date(sale.createdAt);
      alreadyPaid = await CommissionPayment.findOne({
        month: saleDate.getMonth(),
        year: saleDate.getFullYear(),
        status: 'succeeded'
      }).lean();
    }

    const baseExtra = { saleId: saleId || null, refundId: refundId || null, commissionAmountAdjusted: amountAbs };

    await emitCommissionEvent('commission.adjusted', alreadyPaid, {
      contextType: 'refund_request',
      contextId: refundId || null,
      extra: baseExtra
    });

    if (alreadyPaid) {
      await emitCommissionEvent('commission.reversal_required', alreadyPaid, {
        contextType: 'refund_request',
        contextId: refundId || null,
        extra: { ...baseExtra, reason: 'sale_commission_already_paid' }
      });
    }
  } catch (err) {
    console.warn('[commission] emit refund commission events failed:', err?.message || err);
  }
}

export async function ensureRefundCommissionProvision(refundDoc) {
  const refundId = String(refundDoc?.refundId || '').trim();
  if (!refundId) return null;

  const existing = await CommissionTransaction.findOne({
    refundId,
    sourceType: REFUND_SOURCE_ADJUSTMENT
  });
  if (existing) return existing.toObject();

  const formationId = toObjectId(refundDoc?.formationId);
  if (!formationId) return null;
  const base = await resolveCommissionBase(refundDoc);
  if (!Number.isFinite(base.commissionAmountAbs) || base.commissionAmountAbs <= 0) {
    return null;
  }
  const row = await CommissionTransaction.create({
    saleId: String(refundDoc.saleId || '').trim(),
    formationId,
    formationName:
      String(refundDoc?.meta?.formationTitle || '').trim() || 'Remboursement formation',
    sourceType: REFUND_SOURCE_ADJUSTMENT,
    refundId,
    commissionType: base.commissionType,
    commissionValue: base.commissionValue,
    commissionAmount: roundToCents(-Math.abs(base.commissionAmountAbs)),
    createdAt: refundDoc?.requestedAt || new Date()
  });
  await emitRefundCommissionAdjustmentEvents(refundDoc, row.toObject());
  return row.toObject();
}

/**
 * Compute refund eligibility for a service booking cancellation.
 * Eligibility is based on:
 * - Legal retractation (14 days after purchase) if waiver not signed
 * - Institut policy (daysBeforeService > cancellationDays)
 */
export function getServiceRefundEligibility({ sale, booking, now = new Date() } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const purchaseDate = new Date(sale?.createdAt || sale?.date_achat || '');
  const serviceDate = booking?.startAt ? new Date(booking.startAt) : null;
  const snapshot = booking?.consumerWaiverSnapshot || {};
  const cancellationDays = normalizeRefundDays(snapshot.refundDays ?? 7);

  const hasValidPurchaseDate = !Number.isNaN(purchaseDate.getTime());
  const hasValidServiceDate = serviceDate && !Number.isNaN(serviceDate.getTime());

  const daysSincePurchase = hasValidPurchaseDate
    ? (nowDate.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
    : Number.POSITIVE_INFINITY;
  const withinLegalRetractation = daysSincePurchase < RETRACTATION_DAYS;
  const waiverSigned = Boolean(snapshot.waiverAcceptedAt);
  const legalEligible = withinLegalRetractation && !waiverSigned;

  const daysBeforeService = hasValidServiceDate
    ? (serviceDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24)
    : Number.NEGATIVE_INFINITY;
  const institutEligible = daysBeforeService > cancellationDays;

  return {
    eligibleRefund: legalEligible || institutEligible,
    reason: legalEligible ? 'retractation' : institutEligible ? 'institut' : 'none',
    cancellationDays,
    daysBeforeService: Number.isFinite(daysBeforeService) ? Math.floor(daysBeforeService) : null,
    daysSincePurchase: Number.isFinite(daysSincePurchase) ? Math.floor(daysSincePurchase) : null,
    waiverSigned
  };
}

export async function ensureRefundCommissionReversal(refundDoc) {
  const refundId = String(refundDoc?.refundId || '').trim();
  if (!refundId) return null;
  const existing = await CommissionTransaction.findOne({
    refundId,
    sourceType: REFUND_SOURCE_REVERSAL
  });
  if (existing) return existing.toObject();

  const provision = await CommissionTransaction.findOne({
    refundId,
    sourceType: REFUND_SOURCE_ADJUSTMENT
  }).lean();
  if (!provision) return null;
  const amountAbs = roundToCents(Math.abs(Number(provision.commissionAmount || 0)));
  if (amountAbs <= 0) return null;

  const formationId = toObjectId(refundDoc?.formationId) || provision.formationId;
  if (!formationId) return null;

  const row = await CommissionTransaction.create({
    saleId: String(refundDoc.saleId || provision.saleId || '').trim(),
    formationId,
    formationName:
      String(refundDoc?.meta?.formationTitle || provision.formationName || '').trim() ||
      'Annulation provision remboursement',
    sourceType: REFUND_SOURCE_REVERSAL,
    refundId,
    commissionType: provision.commissionType || 'fixed',
    commissionValue: Number.isFinite(Number(provision.commissionValue))
      ? Number(provision.commissionValue)
      : 0,
    commissionAmount: amountAbs,
    createdAt: new Date()
  });
  // A5 — la provision de déduction est annulée (remboursement échoué/annulé) :
  // la commission redevient due. Trace d'audit best-effort.
  try {
    await emitCommissionEvent('commission.cancelled', null, {
      contextType: 'refund_request',
      contextId: refundId || null,
      extra: {
        saleId: String(refundDoc.saleId || provision.saleId || '').trim() || null,
        refundId: refundId || null,
        commissionAmountRestored: amountAbs,
        reason: 'refund_provision_reversed'
      }
    });
  } catch (err) {
    console.warn('[commission] emit commission.cancelled failed:', err?.message || err);
  }
  return row.toObject();
}
