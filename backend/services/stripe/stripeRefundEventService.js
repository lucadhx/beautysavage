// services/stripe/stripeRefundEventService.js
// Sprint F2 — Extraction PUREMENT STRUCTURELLE du handler webhook `charge.refund.updated`
// hors de stripeController. Aucune modification de comportement : fonction déplacée verbatim.
//
// Gère succeeded/failed/pending : idempotence, credit note Stripe (idempotente), recredit
// carte cadeau (claim atomique + rollback_needed), commission reversal, email/notif.

import RefundRequest from '../../models/RefundRequest.js';
import Sale from '../../models/Sale.js';
import Invoice from '../../models/Invoice.js';
import User from '../../models/user.js';
import { sendRefundConfirmedEmailInternal, resolveRefundRecipientContext } from '../refundExecutionService.js';
import { sendRefundFailedEmail } from '../mailService.js';
import { resolvePublicBaseUrl } from '../system/domainResolver.js';
import { ensureRefundCommissionReversal } from '../refundService.js';
import { triggerNotification } from '../notificationService.js';
import { recreditGiftCardPortion } from '../refundGiftCardService.js';
import { claimGiftCardRecredit } from '../refundRequestService.js';
import { getStripeClient } from './stripeConfigService.js';

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

function buildCreditNoteIdempotencyKey(refundDoc) {
  const refundId = String(refundDoc?.refundId || '').trim();
  return refundId ? `refund-request:${refundId}:credit-note` : '';
}

export async function handleRefundUpdatedEvent(event) {
  const stripeRefundObj = event.data.object;
  const stripeRefundId = String(stripeRefundObj.id || '').trim();
  if (!stripeRefundId) return;

  let refundDoc = await RefundRequest.findOne({ stripeRefundId });
  if (!refundDoc) {
    console.warn('[Stripe Webhook] RefundRequest introuvable pour stripeRefundId', stripeRefundId);
    return;
  }

  const refundStatus = String(stripeRefundObj.status || '').trim().toLowerCase();
  const stripeFailureReason = String(stripeRefundObj.failure_reason || '').trim();
  const giftCardAmount = Number.isFinite(Number(refundDoc.giftCardRefundAmount))
    ? Number(refundDoc.giftCardRefundAmount)
    : 0;
  const sale = refundDoc.saleId ? await Sale.findOne({ saleId: refundDoc.saleId }).lean() : null;

  const tryCreateCreditNote = async () => {
    if (!sale?.saleId) return;
    if (String(refundDoc.creditNoteId || '').trim()) return;
    const invoice = await Invoice.findOne({ saleId: sale.saleId }).lean();
    const stripeRefundAmount = Number.isFinite(Number(refundDoc.stripeRefundAmount))
      ? Number(refundDoc.stripeRefundAmount)
      : 0;
    if (!invoice?.stripeInvoiceId || stripeRefundAmount <= 0) return;
    try {
      const stripe = await getStripeClient();
      const creditNote = await stripe.creditNotes.create({
        invoice: invoice.stripeInvoiceId,
        amount: Math.round(stripeRefundAmount * 100),
        out_of_band_amount: Math.round(stripeRefundAmount * 100),
        reason: 'order_change',
        memo: `Remboursement vente ${sale.saleId}`
      }, {
        idempotencyKey: buildCreditNoteIdempotencyKey(refundDoc)
      });
      await RefundRequest.findByIdAndUpdate(refundDoc._id, {
        creditNoteId: creditNote.id,
        creditNotePdfUrl: creditNote.pdf
      });
      refundDoc.creditNoteId = creditNote.id;
      refundDoc.creditNotePdfUrl = creditNote.pdf;
    } catch (err) {
      console.error('[CreditNote] Echec creation credit note Stripe:', err);
    }
  };

  if (refundStatus === 'succeeded') {
    const alreadyFinalized =
      String(refundDoc.status || '').trim() === 'succeeded' &&
      normalizeStripeRefundStatus(refundDoc.stripeRefundStatus) === 'succeeded' &&
      ['succeeded', 'not_applicable'].includes(normalizeGiftCardRefundStatus(refundDoc.giftCardRefundStatus));
    if (alreadyFinalized) {
      await tryCreateCreditNote();
      return;
    }

    refundDoc.stripeRefundStatus = 'succeeded';
    const confirmedAt = stripeRefundObj.updated
      ? new Date(stripeRefundObj.updated * 1000)
      : (stripeRefundObj.created ? new Date(stripeRefundObj.created * 1000) : new Date());
    refundDoc.stripeRefundConfirmedAt = Number.isNaN(confirmedAt.getTime()) ? new Date() : confirmedAt;

    if (giftCardAmount > 0) {
      const claim = await claimGiftCardRecredit(refundDoc._id);
      if (!claim.claimed) {
        const latestRefund = claim.refundRequest;
        const latestGiftStatus = normalizeGiftCardRefundStatus(latestRefund?.giftCardRefundStatus);
        if (latestRefund?.giftCardRecredited || latestGiftStatus === 'succeeded') {
          refundDoc = latestRefund;
        } else {
          console.info('[Stripe Webhook] Duplicate refund webhook skipped while gift-card recredit is in progress', {
            stripeRefundId,
            refundId: refundDoc.refundId
          });
          return;
        }
      } else {
        refundDoc = claim.refundRequest || refundDoc;
        try {
          if (!sale) {
            throw new Error('Sale not found for mixed refund gift card recredit.');
          }
          await recreditGiftCardPortion(sale, giftCardAmount);
          refundDoc.giftCardRefundStatus = 'succeeded';
          refundDoc.giftCardRecredited = true;
          refundDoc.giftCardRecreditInProgress = false;
          refundDoc.giftCardRecreditAmount = giftCardAmount;
        } catch (giftError) {
          console.error('[Stripe Webhook] Echec recredit carte cadeau apres succes Stripe', {
            stripeRefundId,
            refundId: refundDoc.refundId,
            error: giftError
          });
          refundDoc.giftCardRefundStatus = 'rollback_needed';
          refundDoc.status = 'pending';
          refundDoc.processedAt = new Date();
          refundDoc.giftCardRecredited = false;
          refundDoc.giftCardRecreditInProgress = false;
          refundDoc.giftCardRecreditAmount = null;
          const existingNotes = String(refundDoc?.meta?.notes || '').trim();
          const alertNote = 'Echec Stripe - intervention requise';
          refundDoc.meta = refundDoc.meta || {};
          refundDoc.meta.notes = existingNotes.includes(alertNote)
            ? existingNotes
            : [existingNotes, alertNote].filter(Boolean).join(' | ');
          await refundDoc.save();
          return;
        }
      }
    } else {
      refundDoc.giftCardRefundStatus = 'not_applicable';
      refundDoc.giftCardRecreditInProgress = false;
    }

    const giftCardStatus = normalizeGiftCardRefundStatus(refundDoc.giftCardRefundStatus);
    const canFinalize = giftCardStatus === 'succeeded' || giftCardStatus === 'not_applicable';
    refundDoc.status = canFinalize ? 'succeeded' : 'pending';
    refundDoc.refundedAt = canFinalize ? new Date() : null;
    refundDoc.processedAt = new Date();
    await refundDoc.save();

    if (!canFinalize) {
      return;
    }

    await tryCreateCreditNote();

    console.log('[Stripe Webhook] Remboursement confirme', { stripeRefundId, refundId: refundDoc.refundId });

    try {
      await sendRefundConfirmedEmailInternal(refundDoc);
    } catch (emailErr) {
      console.error('[Stripe Webhook] Erreur envoi email confirmation remboursement', emailErr);
    }

    // Notification remboursement confirmé
    try {
      const refundUser = refundDoc.userId
        ? await User.findById(refundDoc.userId).select('firstName lastName email').lean()
        : null;
      const clientName = [refundUser?.firstName, refundUser?.lastName].filter(Boolean).join(' ')
        || refundUser?.email || '—';
      // P1-8 — clé dédiée au SUCCÈS (auparavant `refund_requested`, au libellé trompeur).
      void triggerNotification('refund_completed', {
        clientName,
        amount: typeof refundDoc.amount === 'number' ? refundDoc.amount.toFixed(2) : '—',
        link: '/gestion.html?page=ventes',
        linkLabel: 'Voir les ventes'
      });
    } catch {}

    return;
  }

  if (refundStatus === 'failed') {
    refundDoc.stripeRefundStatus = 'failed';
    refundDoc.giftCardRecreditInProgress = false;
    if (giftCardAmount > 0) {
      const currentGiftStatus = normalizeGiftCardRefundStatus(refundDoc.giftCardRefundStatus);
      refundDoc.giftCardRefundStatus = currentGiftStatus === 'succeeded' ? 'succeeded' : 'pending';
    } else {
      refundDoc.giftCardRefundStatus = 'not_applicable';
    }
    refundDoc.status = 'failed';
    refundDoc.processedAt = new Date();
    refundDoc.refundedAt = null;
    const existingNotes = String(refundDoc?.meta?.notes || '').trim();
    const alertNote = 'Echec Stripe - intervention requise';
    refundDoc.meta = refundDoc.meta || {};
    refundDoc.meta.notes = existingNotes.includes(alertNote)
      ? existingNotes
      : [existingNotes, alertNote].filter(Boolean).join(' | ');
    await refundDoc.save();
    await ensureRefundCommissionReversal(refundDoc).catch(error =>
      console.error('[Stripe Webhook] Impossible de compenser la commission apres echec refund', error)
    );
    console.error('[Stripe Webhook] Remboursement echoue', {
      stripeRefundId,
      refundId: refundDoc.refundId,
      failureReason: stripeFailureReason || 'unknown'
    });
    // LOT2 P1-12 — e-mail client « remboursement en cours de traitement » (best-effort).
    try {
      const ctx = await resolveRefundRecipientContext(refundDoc);
      if (ctx.toEmail) {
        await sendRefundFailedEmail({
          toEmail: ctx.toEmail,
          firstName: ctx.firstName,
          itemDetail: ctx.itemDetail,
          amount: Number(refundDoc.amount || 0),
          actionUrl: ctx.trackingUrl || resolvePublicBaseUrl()
        });
      }
    } catch (mailErr) {
      console.error('[Stripe Webhook] Erreur envoi email refund_failed', mailErr?.message || mailErr);
    }
    return;
  }

  refundDoc.stripeRefundStatus = normalizeStripeRefundStatus(refundStatus === 'pending' ? 'pending' : refundDoc.stripeRefundStatus);
  await refundDoc.save();
}
