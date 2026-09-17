import Formation from '../models/Formation.js';
import SessionCancellationFlow from '../models/SessionCancellationFlow.js';
import User from '../models/user.js';
import { sendRefundAutoInitiatedEmail } from '../services/mailService.js';
import {
  applyFlowRefundDecision,
  FLOW_DECISION_PENDING,
  resolveSiteName
} from '../services/sessionCancellationFlowService.js';
import { resolveVitrineUrl } from '../services/system/domainResolver.js';

let started = false;

function computeNextRun(reference = new Date()) {
  const next = new Date(reference);
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= reference.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function executeJob() {
  const now = new Date();
  try {
    const flows = await SessionCancellationFlow.find({
      decision: FLOW_DECISION_PENDING,
      usedAt: null,
      autoRefundAt: { $lte: now }
    })
      .sort({ autoRefundAt: 1 })
      .limit(300);
    if (!flows.length) {
      return;
    }

    for (const flow of flows) {
      try {
        const { refundRequest } = await applyFlowRefundDecision({
          flow,
          clientIp: '127.0.0.1',
          triggeredBy: 'auto'
        });
        const [user, formation] = await Promise.all([
          User.findById(flow.userId).lean(),
          Formation.findById(flow.formationId).lean()
        ]);
        const siteName = await resolveSiteName();
        const trackingUrl = refundRequest?.trackingToken
          ? resolveVitrineUrl(`vitrine.html?page=refund-tracking&token=${refundRequest.trackingToken}`)
          : '';
        await sendRefundAutoInitiatedEmail({
          toEmail: String(flow.clientEmail || user?.email || '').trim(),
          siteName,
          firstName: String(user?.firstName || '').trim(),
          lastName: String(user?.lastName || '').trim(),
          clientEmail: String(flow.clientEmail || user?.email || '').trim(),
          formationName: String(formation?.name || '').trim() || 'Formation',
          amount: Number(refundRequest?.amount || 0),
          refundId: String(refundRequest?.refundId || '').trim(),
          refundStatus: String(refundRequest?.status || '').trim(),
          refundDateTime: refundRequest?.requestedAt
            ? new Date(refundRequest.requestedAt).toLocaleString('fr-FR')
            : '',
          saleId: String(flow.saleId || '').trim(),
          trackingUrl
        });
      } catch (flowError) {
        console.error('[SessionCancelAutoRefund] flow failed', {
          flowId: String(flow.flowId || ''),
          error: flowError
        });
      }
    }
  } catch (error) {
    console.error('[SessionCancelAutoRefund] execution failed', error);
  }
}

function scheduleNext() {
  const now = new Date();
  const nextRun = computeNextRun(now);
  const delay = Math.max(0, nextRun.getTime() - now.getTime());
  setTimeout(() => {
    void runAndSchedule();
  }, delay);
}

async function runAndSchedule() {
  await executeJob();
  scheduleNext();
}

export async function startSessionCancellationAutoRefundScheduler() {
  if (started) return;
  started = true;
  await executeJob();
  scheduleNext();
}
