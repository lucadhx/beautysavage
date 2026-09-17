// RX4 S3 — Parcours tokenisés post-annulation (décision + report) & suivi remboursement. SANS AUTH : accès
// par token opaque reçu par e-mail. Réutilise les endpoints existants (aucun second moteur). Le serveur fait
// foi (éligibilité, exécution refund, anti-double-booking). Le token n'est jamais journalisé.
import { apiGet, apiPost } from '../apiFetch';
import type { DateIso, MoneyAmount } from '../types';

const FLOW_BASE = '/api/client/session-cancel-flows';

// ── Décision ────────────────────────────────────────────────────────────────

export type DecisionFlowType =
  | 'session_cancelled'
  | 'session_updated'
  | 'formation_deleted'
  | 'service_booking_cancelled';

export type DecisionValue = 'pending' | 'refund' | 'reschedule' | 'confirm' | 'gift_card';

/** Options réellement disponibles (pilotent l'affichage — jamais de bouton fantôme). */
export interface DecisionOptions {
  canConfirm: boolean;
  canReschedule: boolean;
  canGiftCard: boolean;
  canRefund: boolean;
  serviceRescheduleAvailable: boolean;
}

export interface DecisionFormationSession {
  id: string;
  startDate: DateIso;
  durationDays: number;
  schedule: { dayIndex: number; startTime: string; endTime: string }[];
}

export interface DecisionFlow {
  flowId: string;
  flowType: DecisionFlowType;
  decision: DecisionValue;
  tokenExpiresAt: DateIso | null;
  autoRefundAt: DateIso | null;
  autoRefundDays: number;
  reason: string;
  options: DecisionOptions;
  /** Nature du flux, dérivée du payload : formation (sessions) ou prestation (créneaux). */
  kind: 'formation' | 'service';
  // Formation
  formation?: { id: string; name: string; coverImage: string; refundDays: number } | null;
  canceledSession?: DecisionFormationSession | null;
  availableSessions?: DecisionFormationSession[];
  legal?: {
    cgvText: string;
    presentielWaiverBetween7And14: string;
    presentielWaiverWithin7: string;
    refundDays: number;
  } | null;
  // Prestation
  service?: { id: string; name: string; slug: string; duration: number } | null;
  bookingSnapshot?: { startAt: DateIso | null; endAt: DateIso | null; totalPrice: MoneyAmount } | null;
  refundAmount?: MoneyAmount;
  serviceAvailable?: boolean;
  siteName?: string;
}

function normalizeFlow(raw: Record<string, unknown>): DecisionFlow {
  const flow = (raw.flow ?? {}) as Record<string, unknown>;
  const options = (flow.options ?? {}) as Record<string, unknown>;
  const kind = raw.service || raw.serviceSnapshot || raw.bookingSnapshot ? 'service' : 'formation';
  return {
    flowId: String(flow.flowId ?? ''),
    flowType: (flow.flowType ?? 'session_cancelled') as DecisionFlowType,
    decision: (flow.decision ?? 'pending') as DecisionValue,
    tokenExpiresAt: (flow.tokenExpiresAt ?? null) as DateIso | null,
    autoRefundAt: (flow.autoRefundAt ?? null) as DateIso | null,
    autoRefundDays: Number(flow.autoRefundDays ?? 0),
    reason: String(flow.reason ?? ''),
    options: {
      canConfirm: Boolean(options.canConfirm),
      canReschedule: Boolean(options.canReschedule),
      canGiftCard: Boolean(options.canGiftCard),
      canRefund: Boolean(options.canRefund),
      serviceRescheduleAvailable: Boolean(options.serviceRescheduleAvailable),
    },
    kind,
    formation: (raw.formation ?? null) as DecisionFlow['formation'],
    canceledSession: (raw.canceledSession ?? null) as DecisionFlow['canceledSession'],
    availableSessions: (raw.availableSessions ?? []) as DecisionFormationSession[],
    legal: (raw.legal ?? null) as DecisionFlow['legal'],
    service: (raw.service ?? null) as DecisionFlow['service'],
    bookingSnapshot: (raw.bookingSnapshot ?? null) as DecisionFlow['bookingSnapshot'],
    refundAmount: Number(raw.refundAmount ?? 0),
    serviceAvailable: Boolean(raw.serviceAvailable),
    siteName: String(raw.siteName ?? ''),
  };
}

/** GET flow — nécessite flowId + token (lien e-mail). */
export async function getDecisionFlow(flowId: string, token: string): Promise<DecisionFlow> {
  const res = await apiGet<Record<string, unknown>>(`${FLOW_BASE}/${encodeURIComponent(flowId)}`, { token });
  return normalizeFlow(res);
}

/** POST /confirm — conserver la session modifiée (session_updated). */
export async function confirmDecision(flowId: string, token: string): Promise<void> {
  await apiPost(`${FLOW_BASE}/${encodeURIComponent(flowId)}/confirm`, { token });
}

/** POST /refund — demander le remboursement (mot-clé backend « annulation »). */
export async function requestDecisionRefund(flowId: string, token: string): Promise<void> {
  await apiPost(`${FLOW_BASE}/${encodeURIComponent(flowId)}/refund`, { token, confirmationKeyword: 'annulation' });
}

/** POST /gift-card — recevoir une carte cadeau de compensation (formation_deleted). */
export interface DecisionGiftCardResult { code: string; balance: MoneyAmount }
export async function requestDecisionGiftCard(flowId: string, token: string): Promise<DecisionGiftCardResult> {
  const res = await apiPost<{ ok: boolean; giftCard?: { code?: string; balance?: number } }>(
    `${FLOW_BASE}/${encodeURIComponent(flowId)}/gift-card`, { token });
  return { code: String(res.giftCard?.code ?? ''), balance: Number(res.giftCard?.balance ?? 0) };
}

/** POST /reschedule — reporter une session de formation. */
export async function rescheduleFormationDecision(
  flowId: string,
  token: string,
  input: { chosenSessionId: string; acceptedCgv: boolean; renunciationText: string },
): Promise<void> {
  await apiPost(`${FLOW_BASE}/${encodeURIComponent(flowId)}/reschedule`, {
    token,
    chosenSessionId: input.chosenSessionId,
    acceptedCgv: input.acceptedCgv,
    renunciationText: input.renunciationText,
  });
}

/** POST /service-reschedule — reporter une prestation sur un nouveau créneau. */
export interface DecisionNewBooking { bookingId: string; startAt: DateIso; endAt: DateIso; status: string }
export async function rescheduleServiceDecision(
  flowId: string,
  token: string,
  input: { chosenSlotStart: string; chosenSlotEnd: string },
): Promise<DecisionNewBooking> {
  const res = await apiPost<{ ok: boolean; newBooking?: DecisionNewBooking }>(
    `${FLOW_BASE}/${encodeURIComponent(flowId)}/service-reschedule`,
    { token, chosenSlotStart: input.chosenSlotStart, chosenSlotEnd: input.chosenSlotEnd },
  );
  return res.newBooking ?? { bookingId: '', startAt: input.chosenSlotStart, endAt: input.chosenSlotEnd, status: 'confirmed' };
}

// ── Suivi remboursement ──────────────────────────────────────────────────────

export type RefundStatus = 'requested' | 'pending' | 'succeeded' | 'failed' | 'canceled';
export type RefundSplitStatus = 'not_applicable' | 'pending' | 'succeeded' | 'failed' | 'rollback_needed';

export interface RefundSplitPart {
  amount: MoneyAmount | null;
  status: RefundSplitStatus;
}

export interface RefundTracking {
  status: RefundStatus;
  amount: MoneyAmount;
  itemTitle: string;
  itemDate: string | null;
  refundedAt: DateIso | null;
  estimatedDelay: string;
  isSplitRefund: boolean;
  stripe: RefundSplitPart;
  giftCard: RefundSplitPart & { card: { code: string; balance: MoneyAmount; recipientName: string | null } | null };
}

/** GET /api/refund-tracking/:token — statut réel uniquement (aucune invention). */
export async function getRefundTracking(token: string): Promise<RefundTracking> {
  const res = await apiGet<{ ok: boolean; refund?: Record<string, unknown> }>(
    `/api/refund-tracking/${encodeURIComponent(token)}`,
  );
  const r = (res.refund ?? {}) as Record<string, unknown>;
  const gcCard = r.giftCard as { code?: string; balance?: number; recipientName?: string | null } | null | undefined;
  return {
    status: (r.status ?? 'requested') as RefundStatus,
    amount: Number(r.amount ?? 0),
    itemTitle: String(r.itemTitle ?? r.formationTitle ?? ''),
    itemDate: (r.itemDate ?? r.sessionDate ?? null) as string | null,
    refundedAt: (r.refundedAt ?? null) as DateIso | null,
    estimatedDelay: String(r.estimatedDelay ?? ''),
    isSplitRefund: Boolean(r.isSplitRefund),
    stripe: { amount: (r.stripeRefundAmount ?? null) as number | null, status: (r.stripeRefundStatus ?? 'not_applicable') as RefundSplitStatus },
    giftCard: {
      amount: (r.giftCardRefundAmount ?? null) as number | null,
      status: (r.giftCardRefundStatus ?? 'not_applicable') as RefundSplitStatus,
      card: gcCard ? { code: String(gcCard.code ?? ''), balance: Number(gcCard.balance ?? 0), recipientName: gcCard.recipientName ?? null } : null,
    },
  };
}
