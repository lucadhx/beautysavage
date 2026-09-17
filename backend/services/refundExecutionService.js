import Sale from '../models/Sale.js';
import GiftCardTransaction from '../models/GiftCardTransaction.js';
import SiteIdentity from '../models/SiteIdentity.js';
import User from '../models/user.js';
import ServiceBooking from '../models/ServiceBooking.js';
import { sendRefundConfirmedEmail } from './mailService.js';
import { resolveFrontendUrl } from './system/frontendUrl.js';
import { recreditGiftCardPortion } from './refundGiftCardService.js';
import {
  applyRefundExecutionCap,
  claimGiftCardRecredit
} from './refundRequestService.js';
import { getStripeClient } from './stripe/stripeConfigService.js';
import { emitRefundEvent } from './businessEventService.js';
import { isMailRoleResolverEnabled } from '../constants/mailDispatchRules.js';

// LOT1 — accès Stripe institut consolidé sur l'accesseur canonique `getStripeClient`
// (source unique du client + de la résolution de credential). Fin des `getStripe()` ad-hoc.
const getStripe = getStripeClient;

function roundToCents(value) {
  const candidate = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(candidate * 100) / 100;
}

function roundToCentsInt(value) {
  return Math.round(Number(value || 0) * 100);
}

function buildConflictError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function normalizeCurrentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function buildStripeRefundIdempotencyKey(refundRequest) {
  const refundId = String(refundRequest?.refundId || '').trim();
  return refundId ? `refund-request:${refundId}:stripe-refund` : '';
}

async function resolveSiteNameForEmail() {
  try {
    const identity = await SiteIdentity.findOne({ key: 'global' }).lean();
    const siteName = String(identity?.siteName || '').trim();
    return siteName || 'Beauty Savage';
  } catch (_error) {
    return 'Beauty Savage';
  }
}

// LOT2 — Résout le destinataire + le libellé d'article d'un remboursement (réutilisé par les
// e-mails refund_refused / refund_failed). Best-effort : renvoie des champs vides si introuvable.
export async function resolveRefundRecipientContext(refundRequest) {
  const out = { toEmail: '', firstName: '', lastName: '', itemDetail: '', trackingUrl: '' };
  try {
    const user = refundRequest?.userId ? await User.findById(refundRequest.userId).lean() : null;
    out.toEmail = String(user?.email || '').trim();
    out.firstName = String(user?.firstName || '').trim();
    out.lastName = String(user?.lastName || '').trim();
    out.trackingUrl = refundRequest?.trackingToken
      ? resolveFrontendUrl('refund-tracking', { token: refundRequest.trackingToken })
      : '';
    if (refundRequest?.itemType === 'service') {
      const booking = await ServiceBooking.findOne({ saleId: String(refundRequest.saleId || '') })
        .populate('serviceId')
        .lean()
        .catch(() => null);
      const serviceName = booking?.serviceId?.name || '';
      const startAt = booking?.startAt ? new Date(booking.startAt) : null;
      const dateStr = startAt ? startAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      out.itemDetail = serviceName ? `${serviceName}${dateStr ? ' — ' + dateStr : ''}` : '';
    } else {
      out.itemDetail = String(refundRequest?.meta?.formationTitle || '').trim();
    }
  } catch (err) {
    console.error('[resolveRefundRecipientContext] error', err?.message || err);
  }
  return out;
}

export async function sendRefundConfirmedEmailInternal(refundRequest) {
  // M3C — Event TOUJOURS émis (audit + moteur événementiel). Le subscriber mail (si
  // MAIL_ROLE_RESOLVER_ENABLED=true) envoie l'e-mail refund_confirmed via le moteur par rôles
  // (commerciale→client) pendant cet emit. On NE renvoie donc PAS l'e-mail direct legacy dans
  // ce cas (anti-doublon). Rollback = flag false → e-mail direct legacy ci-dessous conservé.
  await emitRefundEvent('refund.succeeded', refundRequest);
  if (isMailRoleResolverEnabled()) {
    return; // moteur événementiel actif : l'e-mail part via le subscriber (pas de doublon)
  }
  try {
    const user = refundRequest?.userId ? await User.findById(refundRequest.userId).lean() : null;
    const toEmail = String(user?.email || '').trim();
    if (!toEmail) return;

    const trackingUrl = refundRequest?.trackingToken
      ? resolveFrontendUrl('refund-tracking', { token: refundRequest.trackingToken })
      : '';
    const siteName = await resolveSiteNameForEmail();

    const isService = refundRequest?.itemType === 'service';
    let itemDetail = '';
    let serviceName = '';
    let bookingDateStr = '';
    let bookingTimeStr = '';
    let practitionerName = '';
    let booking = null;

    if (isService) {
      try {
        booking = await ServiceBooking.findOne({ saleId: String(refundRequest.saleId || '') })
          .populate('serviceId')
          .populate('practitionerId', 'displayName')
          .lean();
        serviceName = booking?.serviceId?.name || '';
        practitionerName = booking?.practitionerId?.displayName || '';
        const startAt = booking?.startAt ? new Date(booking.startAt) : null;
        bookingDateStr = startAt
          ? startAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          : '';
        bookingTimeStr = startAt
          ? startAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : '';
        itemDetail = serviceName
          ? `${serviceName}${bookingDateStr ? ' — ' + bookingDateStr : ''}${bookingTimeStr ? ' à ' + bookingTimeStr : ''}`
          : '';
      } catch (lookupErr) {
        console.error('[sendRefundConfirmedEmailInternal] ServiceBooking lookup error', lookupErr.message);
      }
    } else {
      const formationTitle = String(refundRequest?.meta?.formationTitle || '').trim();
      itemDetail = formationTitle;
    }

    const templateName = isService ? 'refund_confirmed_service' : 'refund_confirmed';

    await sendRefundConfirmedEmail({
      toEmail,
      siteName,
      firstName: String(user?.firstName || '').trim(),
      lastName: String(user?.lastName || '').trim(),
      formationName: isService ? '' : String(refundRequest?.meta?.formationTitle || '').trim(),
      itemDetail,
      isService,
      serviceName,
      bookingDate: bookingDateStr,
      bookingTime: bookingTimeStr,
      practitionerName,
      amount: Number(refundRequest?.amount || 0),
      refundId: String(refundRequest?.refundId || '').trim(),
      refundedAt: refundRequest?.refundedAt
        ? new Date(refundRequest.refundedAt).toLocaleString('fr-FR')
        : '',
      giftCardRecredited: Boolean(refundRequest?.giftCardRecredited),
      giftCardRecreditAmount: Number(refundRequest?.giftCardRecreditAmount || 0),
      trackingUrl
    });
  } catch (error) {
    console.error('[triggerRefundExecution] Erreur envoi email refund_confirmed', error);
  }
}

export async function triggerRefundExecution(refundRequest, saleInput = null) {
  if (!refundRequest) {
    throw new Error('RefundRequest manquant.');
  }

  const currentStatus = normalizeCurrentStatus(refundRequest.status);
  const currentStripeStatus = normalizeCurrentStatus(refundRequest.stripeRefundStatus);

  if (currentStatus === 'succeeded') {
    return { refund: refundRequest, mode: 'already_succeeded', stripeInitiated: false };
  }
  if (currentStripeStatus === 'pending' && refundRequest.stripeRefundId) {
    return { refund: refundRequest, mode: 'already_pending', stripeInitiated: true };
  }

  const sale =
    saleInput && typeof saleInput === 'object'
      ? saleInput
      : await Sale.findOne({ saleId: String(refundRequest.saleId || '').trim() }).lean();

  if (!sale) {
    throw buildConflictError('Vente introuvable pour ce remboursement.');
  }

  await applyRefundExecutionCap({
    refundRequest,
    sale,
    logPrefix: '[triggerRefundExecution]'
  });

  const saleTotal = roundToCents(sale?.totalAmount || 0);
  const hasGiftCardUsage = Array.isArray(sale?.giftCardUsage) && sale.giftCardUsage.length > 0;
  let giftCardTotal = roundToCents(
    hasGiftCardUsage
      ? sale.giftCardUsage.reduce((sum, usage) => sum + Number(usage?.amountUsed || 0), 0)
      : 0
  );
  const normalizedStripePaymentIntentId = String(sale?.stripePaymentIntentId || '').trim();
  if (!giftCardTotal && !hasGiftCardUsage && normalizedStripePaymentIntentId) {
    const normalizedSaleId = String(sale?.saleId || '').trim();
    if (normalizedSaleId) {
      const fallbackGiftTransactions = await GiftCardTransaction.find({
        saleId: normalizedSaleId,
        transactionType: 'redeem'
      })
        .select({ amount: 1 })
        .lean();
      const fallbackGiftCardTotal = roundToCents(
        fallbackGiftTransactions.reduce((sum, tx) => sum + Number(tx?.amount || 0), 0)
      );
      if (fallbackGiftCardTotal > 0) {
        giftCardTotal = fallbackGiftCardTotal;
        console.warn('[triggerRefundExecution] Fallback split depuis GiftCardTransaction', {
          saleId: normalizedSaleId,
          giftCardTotal
        });
      }
    }
  }
  giftCardTotal = roundToCents(Math.min(saleTotal, Math.max(0, giftCardTotal)));
  const stripeTotal = Math.max(0, saleTotal - giftCardTotal);
  const refundAmountEur = roundToCents(refundRequest.amount || 0);
  const giftCardRefundAmountEur = roundToCents(Math.min(refundAmountEur, giftCardTotal));
  const stripeRefundAmountEur = roundToCents(
    Math.min(stripeTotal, Math.max(0, refundAmountEur - giftCardRefundAmountEur))
  );
  const hasStripePortion = stripeRefundAmountEur > 0;
  const hasGiftCardPortion = giftCardRefundAmountEur > 0;

  refundRequest.stripeRefundAmount = hasStripePortion ? stripeRefundAmountEur : null;
  refundRequest.giftCardRefundAmount = hasGiftCardPortion ? giftCardRefundAmountEur : null;

  if (!hasStripePortion && hasGiftCardPortion) {
    const claim = await claimGiftCardRecredit(refundRequest._id);
    if (!claim.claimed) {
      const latestRefund = claim.refundRequest || refundRequest;
      if (latestRefund?.giftCardRecredited || normalizeCurrentStatus(latestRefund?.status) === 'succeeded') {
        return { refund: latestRefund, mode: 'already_succeeded', stripeInitiated: false };
      }
      return { refund: latestRefund, mode: 'gift_card_recredit_in_progress', stripeInitiated: false };
    }

    const claimedRefund = claim.refundRequest || refundRequest;
    try {
      await recreditGiftCardPortion(sale, giftCardRefundAmountEur);
      const now = new Date();
      claimedRefund.amount = refundAmountEur;
      claimedRefund.stripeRefundAmount = null;
      claimedRefund.giftCardRefundAmount = giftCardRefundAmountEur;
      claimedRefund.status = 'succeeded';
      claimedRefund.stripeRefundStatus = 'not_applicable';
      claimedRefund.giftCardRefundStatus = 'succeeded';
      claimedRefund.refundedAt = now;
      claimedRefund.processedAt = now;
      claimedRefund.giftCardRecredited = true;
      claimedRefund.giftCardRecreditInProgress = false;
      claimedRefund.giftCardRecreditAmount = giftCardRefundAmountEur;
      await claimedRefund.save();
      await sendRefundConfirmedEmailInternal(claimedRefund);
      return { refund: claimedRefund, mode: 'gift_card_only', stripeInitiated: false };
    } catch (giftCardError) {
      claimedRefund.status = 'requested';
      claimedRefund.stripeRefundStatus = 'not_applicable';
      claimedRefund.giftCardRefundStatus = 'rollback_needed';
      claimedRefund.refundedAt = null;
      claimedRefund.processedAt = null;
      claimedRefund.giftCardRecredited = false;
      claimedRefund.giftCardRecreditInProgress = false;
      claimedRefund.giftCardRecreditAmount = null;
      claimedRefund.meta = claimedRefund.meta || {};
      const existingNotes = String(claimedRefund.meta.notes || '').trim();
      const alertNote = 'Echec recrédit carte cadeau - intervention requise';
      claimedRefund.meta.notes = existingNotes.includes(alertNote)
        ? existingNotes
        : [existingNotes, alertNote].filter(Boolean).join(' | ');
      await claimedRefund.save().catch(() => {});
      throw giftCardError;
    }
  }

  if (hasStripePortion) {
    if (!sale?.stripePaymentIntentId) {
      throw buildConflictError('Remboursement Stripe impossible: transaction introuvable.');
    }
    const stripe = await getStripe();
    const stripeRefundAmountCents = roundToCentsInt(stripeRefundAmountEur);
    const stripeRefund = await stripe.refunds.create({
      payment_intent: sale.stripePaymentIntentId,
      amount: stripeRefundAmountCents
    }, {
      idempotencyKey: buildStripeRefundIdempotencyKey(refundRequest)
    });

    refundRequest.stripeRefundId = String(stripeRefund.id || '');
    refundRequest.stripeRefundStatus = 'pending';
    refundRequest.giftCardRefundStatus = hasGiftCardPortion ? 'pending' : 'not_applicable';
    refundRequest.status = 'pending';
    refundRequest.processedAt = null;
    refundRequest.refundedAt = null;
    refundRequest.giftCardRecredited = false;
    refundRequest.giftCardRecreditInProgress = false;
    refundRequest.giftCardRecreditAmount = hasGiftCardPortion ? giftCardRefundAmountEur : null;
    await refundRequest.save();

    return { refund: refundRequest, mode: 'stripe_pending', stripeInitiated: true };
  }

  throw buildConflictError('Aucune operation financiere applicable pour ce remboursement.');
}
