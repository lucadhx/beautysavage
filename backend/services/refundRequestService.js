import RefundRequest from '../models/RefundRequest.js';
import {
  ACTIVE_REFUND_REQUEST_STATUSES,
  REFUND_REQUEST_ACTIVE_UNIQUE_INDEX_NAME
} from '../constants/refundRequest.js';
import { emitRefundEvent } from './businessEventService.js';

function roundToCents(value) {
  const candidate = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(candidate * 100) / 100;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildActiveRefundSaleItemFilter({
  saleId,
  itemId,
  itemType
} = {}) {
  const normalizedSaleId = normalizeText(saleId);
  const normalizedItemType = normalizeText(itemType);
  if (!normalizedSaleId || !itemId || !normalizedItemType) {
    return null;
  }
  return {
    saleId: normalizedSaleId,
    itemId,
    itemType: normalizedItemType,
    status: { $in: ACTIVE_REFUND_REQUEST_STATUSES }
  };
}

function appendMetaNote(target, note) {
  const normalizedNote = normalizeText(note);
  if (!target || !normalizedNote) return;
  target.meta = target.meta || {};
  const existingNotes = normalizeText(target.meta.notes);
  if (existingNotes.includes(normalizedNote)) return;
  target.meta.notes = [existingNotes, normalizedNote].filter(Boolean).join(' | ');
}

function resolveCommittedRefundAmount(refund) {
  const stripeAmount = roundToCents(refund?.stripeRefundAmount || 0);
  const giftCardAmount = roundToCents(refund?.giftCardRefundAmount || 0);
  const totalExecutedAmount = roundToCents(stripeAmount + giftCardAmount);
  if (totalExecutedAmount > 0) {
    return totalExecutedAmount;
  }
  return roundToCents(refund?.amount || 0);
}

function buildDuplicateRefundRequestError(existing) {
  const error = new Error('REFUND_ALREADY_EXISTS');
  error.code = 'REFUND_ALREADY_EXISTS';
  error.status = 409;
  error.refundId = normalizeText(existing?.refundId);
  error.existingRefundRequest = existing || null;
  return error;
}

export function isRefundRequestSaleItemDuplicateKeyError(error) {
  if (Number(error?.code) !== 11000) {
    return false;
  }
  const keyPattern = error?.keyPattern || {};
  const keyMessage = normalizeText(error?.message);
  return (
    Boolean(keyPattern.saleId && keyPattern.itemId && keyPattern.itemType) ||
    keyMessage.includes(REFUND_REQUEST_ACTIVE_UNIQUE_INDEX_NAME) ||
    keyMessage.includes('saleId_1_itemId_1_itemType_1')
  );
}

export async function findActiveRefundRequestForSaleItem({
  saleId,
  itemId,
  itemType
} = {}) {
  const filter = buildActiveRefundSaleItemFilter({ saleId, itemId, itemType });
  if (!filter) return null;
  return RefundRequest.findOne(filter).sort({ requestedAt: -1 });
}

export async function createRefundRequestOnce(payload = {}) {
  const existing = await findActiveRefundRequestForSaleItem({
    saleId: payload.saleId,
    itemId: payload.itemId,
    itemType: payload.itemType
  });
  if (existing) {
    return { refundRequest: existing, created: false, duplicate: true };
  }

  const refundRequest = new RefundRequest(payload);
  try {
    await refundRequest.save();
    // Audit-only event (best-effort, no side effect).
    await emitRefundEvent('refund.requested', refundRequest);
    return { refundRequest, created: true, duplicate: false };
  } catch (error) {
    if (!isRefundRequestSaleItemDuplicateKeyError(error)) {
      throw error;
    }
    const concurrentExisting = await findActiveRefundRequestForSaleItem({
      saleId: payload.saleId,
      itemId: payload.itemId,
      itemType: payload.itemType
    });
    if (concurrentExisting) {
      return { refundRequest: concurrentExisting, created: false, duplicate: true };
    }
    throw error;
  }
}

export async function assertNoActiveRefundRequestForSaleItem({
  saleId,
  itemId,
  itemType
} = {}) {
  const existing = await findActiveRefundRequestForSaleItem({ saleId, itemId, itemType });
  if (existing) {
    throw buildDuplicateRefundRequestError(existing);
  }
}

export async function calculateRefundExecutionCap({
  refundRequest,
  sale
} = {}) {
  const saleId = normalizeText(refundRequest?.saleId || sale?.saleId);
  const saleTotal = roundToCents(sale?.totalAmount || 0);
  const requestedAmount = roundToCents(refundRequest?.amount || 0);
  const currentRefundId = refundRequest?._id || null;

  let alreadyCommittedAmount = 0;
  if (saleId) {
    const otherRefunds = await RefundRequest.find({
      saleId,
      status: { $in: ACTIVE_REFUND_REQUEST_STATUSES },
      ...(currentRefundId ? { _id: { $ne: currentRefundId } } : {})
    })
      .select({
        amount: 1,
        stripeRefundAmount: 1,
        giftCardRefundAmount: 1
      })
      .lean();
    alreadyCommittedAmount = roundToCents(
      otherRefunds.reduce((sum, refund) => sum + resolveCommittedRefundAmount(refund), 0)
    );
  }

  const remainingRefundableAmount = roundToCents(Math.max(0, saleTotal - alreadyCommittedAmount));
  const cappedAmount = roundToCents(Math.min(Math.max(0, requestedAmount), remainingRefundableAmount));

  return {
    saleTotal,
    requestedAmount,
    alreadyCommittedAmount,
    remainingRefundableAmount,
    cappedAmount,
    wasCapped: cappedAmount !== requestedAmount
  };
}

export async function applyRefundExecutionCap({
  refundRequest,
  sale,
  logPrefix = '[refund]'
} = {}) {
  const cap = await calculateRefundExecutionCap({ refundRequest, sale });
  if (refundRequest) {
    refundRequest.amount = cap.cappedAmount;
  }
  if (cap.wasCapped) {
    appendMetaNote(
      refundRequest,
      `Montant plafonne: demande ${cap.requestedAmount.toFixed(2)} EUR, execution ${cap.cappedAmount.toFixed(2)} EUR.`
    );
    console.warn(`${logPrefix} refund amount capped`, {
      refundId: normalizeText(refundRequest?.refundId),
      saleId: normalizeText(refundRequest?.saleId || sale?.saleId),
      requestedAmount: cap.requestedAmount,
      cappedAmount: cap.cappedAmount,
      saleTotal: cap.saleTotal,
      alreadyCommittedAmount: cap.alreadyCommittedAmount
    });
  }
  return cap;
}

export async function claimGiftCardRecredit(refundId) {
  const normalizedRefundId = refundId || null;
  if (!normalizedRefundId) {
    return { claimed: false, refundRequest: null };
  }
  const refundRequest = await RefundRequest.findOneAndUpdate(
    {
      _id: normalizedRefundId,
      giftCardRecredited: { $ne: true },
      giftCardRecreditInProgress: { $ne: true }
    },
    {
      $set: { giftCardRecreditInProgress: true }
    },
    { new: true }
  );
  if (refundRequest) {
    return { claimed: true, refundRequest };
  }
  const latestRefundRequest = await RefundRequest.findById(normalizedRefundId);
  return { claimed: false, refundRequest: latestRefundRequest };
}

export {
  ACTIVE_REFUND_REQUEST_STATUSES
};
