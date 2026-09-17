import mongoose from 'mongoose';

import Sale from '../models/Sale.js';
import Formation from '../models/Formation.js';
import FormationSession from '../models/FormationSession.js';
import { buildSessionPayload } from './formationSessionController.js';
import {
  applyFlowConfirmDecision,
  applyFlowGiftCardDecision,
  applyFlowRefundDecision,
  applyFlowRescheduleDecision,
  applyFlowServiceRescheduleDecision,
  FLOW_TYPE_FORMATION_DELETED,
  FLOW_TYPE_SESSION_UPDATED,
  FLOW_TYPE_SERVICE_BOOKING_CANCELLED,
  getFlowDecisionContext,
  loadValidatedFlowForClient,
  listAvailableSlotsForServiceReschedule,
  resolveSiteName,
  formatSessionDateLabel,
  formatSessionTimeLabel,
  SESSION_CANCELLATION_TOKEN_TTL_DAYS
} from '../services/sessionCancellationFlowService.js';
import { extractClientIp } from '../utils/requestClientIp.js';
import {
  CHECKOUT_CGV_TEXT,
  PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
  PRESENTIEL_WAIVER_WITHIN_7_TEXT
} from '../constants/consumerWaiver.js';
import {
  sendGiftCardCompensationEmail,
  sendRefundAutoInitiatedEmail,
  sendRefundRequestedEmail,
  sendSessionRescheduledEmail
} from '../services/mailService.js';
import { resolveVitrineUrl } from '../services/system/domainResolver.js';

function sanitizeToken(value) {
  return String(value || '').trim();
}

function buildSnapshotPayload(flow, snapshot = null, fallbackId = '') {
  const source = snapshot || {};
  return {
    id: String(fallbackId || '').trim(),
    startDate: source?.startDate || null,
    durationDays: Number.isFinite(Number(source?.durationDays)) ? Number(source.durationDays) : 1,
    schedule: Array.isArray(source?.schedule) ? source.schedule : []
  };
}

function buildClientFlowPayload(flow, extra = {}) {
  const ft = String(flow.flowType || '').trim();
  const isServiceFlow = ft === FLOW_TYPE_SERVICE_BOOKING_CANCELLED;
  return {
    flowId: String(flow.flowId || '').trim(),
    flowType: ft || 'session_cancelled',
    decision: String(flow.decision || 'pending').trim() || 'pending',
    tokenExpiresAt: flow.tokenExpiresAt || null,
    autoRefundAt: flow.autoRefundAt || null,
    usedAt: flow.usedAt || null,
    decisionAt: flow.decisionAt || null,
    chosenSessionId: flow.chosenSessionId ? String(flow.chosenSessionId) : '',
    giftCardId: flow.giftCardId ? String(flow.giftCardId) : '',
    reason: String(flow.reason || '').trim(),
    autoRefundDays: SESSION_CANCELLATION_TOKEN_TTL_DAYS,
    options: {
      canConfirm: ft === FLOW_TYPE_SESSION_UPDATED,
      canReschedule: ft !== FLOW_TYPE_FORMATION_DELETED,
      canGiftCard: ft === FLOW_TYPE_FORMATION_DELETED,
      canRefund: true,
      serviceRescheduleAvailable: isServiceFlow ? Boolean(extra.serviceAvailable) : false
    }
  };
}

function mapAvailableSessionPayload(sessions = []) {
  return sessions
    .map(buildSessionPayload)
    .filter(Boolean)
    .map(entry => ({
      ...entry,
      startDate: entry.startDate || null
    }));
}

function buildFormationPayload(flow, formation) {
  const fallbackRefundDays = Number(flow?.formationSnapshot?.refundDays);
  if (formation) {
    const parsedRefundDays = Number(formation.refundDays);
    return {
      id: String(formation._id || ''),
      name: String(formation.name || '').trim() || 'Formation',
      coverImage: String(formation.coverImage || '').trim(),
      refundDays: Number.isFinite(parsedRefundDays) ? Math.max(0, parsedRefundDays) : 7
    };
  }
  return {
    id: String(flow.formationId || ''),
    name: String(flow?.formationSnapshot?.name || '').trim() || 'Formation',
    coverImage: String(flow?.formationSnapshot?.coverImage || '').trim(),
    refundDays: Number.isFinite(fallbackRefundDays) ? Math.max(0, fallbackRefundDays) : 7
  };
}

async function resolveFormationName(flow) {
  const formation = flow?.formationId ? await Formation.findById(flow.formationId).lean() : null;
  return String(formation?.name || flow?.formationSnapshot?.name || '').trim() || 'Formation';
}

export async function getSessionCancellationFlowDecision(req, res) {
  const flowId = String(req.params.flowId || '').trim();
  const token = sanitizeToken(req.query?.token);

  try {
    const flowResult = await loadValidatedFlowForClient({
      flowId,
      token
    });
    if (!flowResult.ok) {
      return res.status(flowResult.status).json({ ok: false, code: flowResult.code, error: flowResult.error });
    }

    const flow = flowResult.flow;
    const ctx = await getFlowDecisionContext(flow);
    const { formation, currentSession, availableSessions, service, serviceAvailable } = ctx;
    const siteName = await resolveSiteName();
    const isServiceFlow = String(flow.flowType || '').trim() === FLOW_TYPE_SERVICE_BOOKING_CANCELLED;

    if (isServiceFlow) {
      const bookingSnap = flow.bookingSnapshot || {};
      const sale = flow.saleId
        ? await Sale.findOne({ saleId: flow.saleId }).select('totalAmount').lean()
        : null;
      const refundAmount = sale?.totalAmount ?? bookingSnap.depositAmount ?? 0;
      return res.json({
        ok: true,
        siteName,
        flow: buildClientFlowPayload(flow, { serviceAvailable }),
        service: service
          ? {
              id: String(service._id || ''),
              name: String(service.name || '').trim(),
              slug: String(service.slug || '').trim(),
              duration: Number(service.duration) || 0,
              allowClientChoosePractitioner: Boolean(service.allowClientChoosePractitioner ?? true),
              isActive: Boolean(service.isActive),
              isBookable: Boolean(service.isBookable)
            }
          : null,
        serviceSnapshot: flow.serviceSnapshot || null,
        bookingSnapshot: {
          startAt: bookingSnap.startAt || null,
          endAt: bookingSnap.endAt || null,
          totalPrice: Number(bookingSnap.totalPrice) || 0,
          practitionerId: bookingSnap.practitionerId
            ? String(bookingSnap.practitionerId)
            : null,
          selectedOptions: Array.isArray(bookingSnap.selectedOptions)
            ? bookingSnap.selectedOptions
            : []
        },
        refundAmount: Number(refundAmount) || 0,
        serviceAvailable
      });
    }

    const formationPayload = buildFormationPayload(flow, formation);

    return res.json({
      ok: true,
      siteName,
      flow: buildClientFlowPayload(flow, { serviceAvailable: false }),
      formation: formationPayload,
      canceledSession: currentSession
        ? buildSessionPayload(currentSession)
        : buildSnapshotPayload(flow, flow.originalSessionSnapshot, flow.sessionId),
      updatedSession:
        flow.flowType === FLOW_TYPE_SESSION_UPDATED
          ? buildSnapshotPayload(flow, flow.updatedSessionSnapshot, flow.sessionId)
          : null,
      availableSessions: mapAvailableSessionPayload(availableSessions),
      legal: {
        cgvText: CHECKOUT_CGV_TEXT,
        presentielWaiverBetween7And14: PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
        presentielWaiverWithin7: PRESENTIEL_WAIVER_WITHIN_7_TEXT,
        refundDays: Number.isFinite(Number(formationPayload?.refundDays))
          ? Number(formationPayload.refundDays)
          : 7
      }
    });
  } catch (error) {
    console.error('Erreur lecture flow institut', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire ce lien de decision.' });
  }
}

export async function submitSessionCancellationRefundDecision(req, res) {
  const flowId = String(req.params.flowId || '').trim();
  const token = sanitizeToken(req.body?.token || req.query?.token);
  const confirmationKeyword = String(req.body?.confirmationKeyword || '').trim().toLowerCase();

  if (confirmationKeyword !== 'annulation') {
    return res.status(400).json({
      ok: false,
      code: 'CONFIRMATION_KEYWORD_INVALID',
      error: 'Saisissez "annulation" pour confirmer.'
    });
  }

  try {
    const flowResult = await loadValidatedFlowForClient({ flowId, token });
    if (!flowResult.ok) {
      return res.status(flowResult.status).json({ ok: false, code: flowResult.code, error: flowResult.error });
    }

    const { flow, refundRequest, sale } = await applyFlowRefundDecision({
      flow: flowResult.flow,
      clientIp: extractClientIp(req),
      triggeredBy: 'client'
    });

    const formationName = await resolveFormationName(flow);
    const trackingUrl = refundRequest?.trackingToken
      ? resolveVitrineUrl(`vitrine.html?page=refund-tracking&token=${refundRequest.trackingToken}`)
      : '';
    // SECURITY (Phase 1A): removed a debug log that exposed the public refund
    // tracking token, the full tracking URL and the client email in stdout.
    await sendRefundRequestedEmail({
      toEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      siteName: await resolveSiteName(),
      firstName: String(req.sessionUser?.firstName || '').trim(),
      lastName: String(req.sessionUser?.lastName || '').trim(),
      clientEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      formationName,
      amount: Number(refundRequest?.amount || 0),
      refundId: String(refundRequest?.refundId || '').trim(),
      refundStatus: String(refundRequest?.status || '').trim(),
      refundDateTime: refundRequest?.requestedAt ? new Date(refundRequest.requestedAt).toLocaleString('fr-FR') : '',
      saleId: String(sale?.saleId || flow.saleId || '').trim(),
      trackingUrl
    });

    return res.json({
      ok: true,
      decision: String(flow.decision || 'pending').trim() || 'pending',
      flow: buildClientFlowPayload(flow),
      refund: {
        refundId: String(refundRequest?.refundId || '').trim(),
        status: String(refundRequest?.status || '').trim(),
        amount: Number(refundRequest?.amount || 0),
        requestedAt: refundRequest?.requestedAt || null
      }
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message || 'Action impossible.' });
    }
    console.error('Erreur decision remboursement institut', error);
    return res.status(500).json({ ok: false, error: 'Impossible de valider votre demande.' });
  }
}

export async function submitSessionCancellationRescheduleDecision(req, res) {
  const flowId = String(req.params.flowId || '').trim();
  const token = sanitizeToken(req.body?.token || req.query?.token);
  const chosenSessionId = String(req.body?.chosenSessionId || '').trim();
  const acceptedCgv = Boolean(req.body?.acceptedCgv || req.body?.accepted_cgv);
  const renunciationText = String(req.body?.renonciation_text || req.body?.renunciationText || '').trim();

  try {
    const flowResult = await loadValidatedFlowForClient({ flowId, token });
    if (!flowResult.ok) {
      return res.status(flowResult.status).json({ ok: false, code: flowResult.code, error: flowResult.error });
    }

    const { flow, targetSession, expectedRenunciationText } = await applyFlowRescheduleDecision({
      flow: flowResult.flow,
      chosenSessionId,
      acceptedCgv,
      renunciationText
    });

    const formationName = await resolveFormationName(flow);
    await sendSessionRescheduledEmail({
      toEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      siteName: await resolveSiteName(),
      firstName: String(req.sessionUser?.firstName || '').trim(),
      lastName: String(req.sessionUser?.lastName || '').trim(),
      clientEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      formationName,
      sessionDateLabel: formatSessionDateLabel(buildSessionPayload(targetSession)),
      sessionTimeLabel: formatSessionTimeLabel(buildSessionPayload(targetSession)),
      saleId: String(flow.saleId || '').trim()
    });

    return res.json({
      ok: true,
      decision: 'reschedule',
      flow: buildClientFlowPayload(flow),
      chosenSession: buildSessionPayload(targetSession),
      legal: {
        accepted_cgv: true,
        renonciation_text: expectedRenunciationText || null
      }
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message || 'Action impossible.' });
    }
    console.error('Erreur decision report institut', error);
    return res.status(500).json({ ok: false, error: 'Impossible de valider votre nouvelle session.' });
  }
}

export async function submitSessionCancellationConfirmDecision(req, res) {
  const flowId = String(req.params.flowId || '').trim();
  const token = sanitizeToken(req.body?.token || req.query?.token);

  try {
    const flowResult = await loadValidatedFlowForClient({ flowId, token });
    if (!flowResult.ok) {
      return res.status(flowResult.status).json({ ok: false, code: flowResult.code, error: flowResult.error });
    }

    const { flow, confirmedSessionSnapshot } = await applyFlowConfirmDecision({
      flow: flowResult.flow
    });

    const formationName = await resolveFormationName(flow);
    await sendSessionRescheduledEmail({
      toEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      siteName: await resolveSiteName(),
      firstName: String(req.sessionUser?.firstName || '').trim(),
      lastName: String(req.sessionUser?.lastName || '').trim(),
      clientEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      formationName,
      sessionDateLabel: formatSessionDateLabel(confirmedSessionSnapshot),
      sessionTimeLabel: formatSessionTimeLabel(confirmedSessionSnapshot),
      saleId: String(flow.saleId || '').trim()
    });

    return res.json({
      ok: true,
      decision: 'confirm',
      flow: buildClientFlowPayload(flow)
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message || 'Action impossible.' });
    }
    console.error('Erreur decision confirmation session modifiee', error);
    return res.status(500).json({ ok: false, error: 'Impossible de confirmer votre presence.' });
  }
}

export async function submitSessionCancellationGiftCardDecision(req, res) {
  const flowId = String(req.params.flowId || '').trim();
  const token = sanitizeToken(req.body?.token || req.query?.token);

  try {
    const flowResult = await loadValidatedFlowForClient({ flowId, token });
    if (!flowResult.ok) {
      return res.status(flowResult.status).json({ ok: false, code: flowResult.code, error: flowResult.error });
    }

    const { flow, amount, giftCard, giftCardPassword } = await applyFlowGiftCardDecision({
      flow: flowResult.flow
    });
    const formationName = await resolveFormationName(flow);
    await sendGiftCardCompensationEmail({
      toEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      siteName: await resolveSiteName(),
      firstName: String(req.sessionUser?.firstName || '').trim(),
      lastName: String(req.sessionUser?.lastName || '').trim(),
      clientEmail: String(flow.clientEmail || req.sessionUser?.email || '').trim(),
      formationTitle: formationName,
      saleId: String(flow.saleId || '').trim(),
      amountPaid: amount,
      giftCardCode: String(giftCard?.code || '').trim(),
      giftCardPassword: String(giftCardPassword || '').trim(),
      giftCardBalance: Number(giftCard?.balance || amount || 0)
    });

    return res.json({
      ok: true,
      decision: 'gift_card',
      flow: buildClientFlowPayload(flow),
      giftCard: {
        id: String(giftCard?._id || '').trim(),
        code: String(giftCard?.code || '').trim(),
        balance: Number(giftCard?.balance || 0)
      }
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message || 'Action impossible.' });
    }
    console.error('Erreur decision carte cadeau', error);
    return res.status(500).json({ ok: false, error: 'Impossible de creer votre carte cadeau.' });
  }
}

export async function submitServiceRescheduleDecision(req, res) {
  const flowId = String(req.params.flowId || '').trim();
  const token = sanitizeToken(req.body?.token || req.query?.token);
  const chosenSlotStart = String(req.body?.chosenSlotStart || '').trim();
  const chosenSlotEnd = String(req.body?.chosenSlotEnd || '').trim();
  const practitionerId = String(req.body?.practitionerId || '').trim() || null;

  if (!chosenSlotStart || !chosenSlotEnd) {
    return res.status(400).json({ ok: false, error: 'Créneau requis (chosenSlotStart + chosenSlotEnd).' });
  }

  try {
    const flowResult = await loadValidatedFlowForClient({ flowId, token });
    if (!flowResult.ok) {
      return res.status(flowResult.status).json({ ok: false, code: flowResult.code, error: flowResult.error });
    }

    if (String(flowResult.flow.flowType || '').trim() !== FLOW_TYPE_SERVICE_BOOKING_CANCELLED) {
      return res.status(409).json({ ok: false, error: 'Action non disponible pour ce type de flow.' });
    }

    const { flow, newBooking } = await applyFlowServiceRescheduleDecision({
      flow: flowResult.flow,
      chosenSlotStart,
      chosenSlotEnd,
      practitionerId
    });

    return res.json({
      ok: true,
      decision: 'reschedule',
      flow: buildClientFlowPayload(flow),
      newBooking: {
        bookingId: String(newBooking.bookingId || ''),
        startAt: newBooking.startAt,
        endAt: newBooking.endAt,
        status: newBooking.status
      }
    });
  } catch (error) {
    if (error?.code === 'SLOT_UNAVAILABLE' || error?.message === 'SLOT_UNAVAILABLE') {
      return res.status(409).json({
        ok: false,
        code: 'SLOT_UNAVAILABLE',
        error: 'Ce créneau n\'est plus disponible. Veuillez en choisir un autre.'
      });
    }
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message || 'Action impossible.' });
    }
    console.error('Erreur décision report prestation', error);
    return res.status(500).json({ ok: false, error: 'Impossible de valider votre nouveau créneau.' });
  }
}

export async function sendAutoRefundNotification({
  toEmail,
  siteName = 'Beauty Savage',
  firstName = '',
  lastName = '',
  clientEmail = '',
  formationName = '',
  amount = 0,
  refundId = '',
  refundStatus = 'requested',
  saleId = '',
  trackingUrl = ''
} = {}) {
  return sendRefundAutoInitiatedEmail({
    toEmail,
    siteName,
    firstName,
    lastName,
    clientEmail,
    formationName,
    amount,
    refundId,
    refundStatus,
    refundDateTime: new Date().toLocaleString('fr-FR'),
    saleId,
    trackingUrl
  });
}
