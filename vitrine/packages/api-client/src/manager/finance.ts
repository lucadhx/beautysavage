// RX2 — Espace Finance (manager, admin/dev). Le backend agrège et fait autorité ;
// aucun calcul métier côté client.
import { apiGet, apiPost } from '../apiFetch';

export type FinanceRange = 'today' | '7d' | '30d';

export interface FinanceBreakdown {
  prestations: number;
  formations: number;
  giftCards: number;
  products: number;
}

export interface FinanceActionMetric {
  count: number;
  total: number;
}

export interface FinanceDashboard {
  range: FinanceRange;
  rangeLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  today: {
    salesCount: number;
    revenue: number;
    breakdown: FinanceBreakdown;
    giftCardConsumption: number;
  };
  actions: {
    balancesToCollect: FinanceActionMetric;
    refundsToProcess: FinanceActionMetric;
    unpaidInvoices: FinanceActionMetric;
  };
}

/** GET /api/gestion/finance/dashboard — instantané financier (today/actions). */
export async function getFinanceDashboard(range: FinanceRange = 'today'): Promise<FinanceDashboard> {
  const res = await apiGet<{ ok: boolean } & FinanceDashboard>('/api/gestion/finance/dashboard', { range });
  return res;
}

// ── RX2.2 — Financial Timeline ───────────────────────────────────────────────────
export type FinanceMovementType =
  | 'sale' | 'deposit' | 'balance_due' | 'balance_paid'
  | 'refund' | 'gift_card_issue' | 'gift_card_usage' | 'gift_card_manual_debit'
  | 'gift_card_refund_recredit' | 'gift_card_recredit_failed'
  | 'invoice' | 'commission';

export type FinanceMovementDirection = 'in' | 'out' | 'neutral';
export type FinanceMovementStatus = 'paid' | 'pending' | 'refunded' | 'balance_due' | 'failed' | 'cancelled';

export type FinanceTimelinePeriod = 'today' | 'week' | 'month' | 'all';
export type FinanceTimelineTypeFilter =
  | 'all' | 'sale' | 'deposit' | 'balance' | 'gift_card' | 'refund' | 'commission' | 'invoice';

export interface FinanceMovementBadge { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger'; }
export interface FinanceMovementAction {
  kind: 'customer_view' | 'invoice_view' | 'sale_view' | 'refund_process' | 'balance_collect' | 'commission_view' | 'commission_pay' | 'gift_card_view' | 'gift_card_debit';
  enabled: boolean;
  to?: string | null;
  url?: string | null;
  paymentId?: string;
}
export interface FinanceMovementCustomer { id: string; name: string; }
export interface FinanceMovementSource { model: string; id: string; }

export interface FinanceTimelineItem {
  id: string;
  type: FinanceMovementType;
  direction: FinanceMovementDirection;
  amount: number;
  currency: string;
  title: string;
  subtitle: string;
  status: FinanceMovementStatus;
  occurredAt: string | null;
  customer: FinanceMovementCustomer | null;
  source: FinanceMovementSource;
  badges: FinanceMovementBadge[];
  actions: FinanceMovementAction[];
}

export interface FinanceTimelineSummary {
  netAmount: number;
  grossIn: number;
  grossOut: number;
  count: number;
  refundCount: number;
  balanceDueAmount: number;
}

export interface FinanceTimelineFilters {
  period?: FinanceTimelinePeriod;
  type?: FinanceTimelineTypeFilter;
  status?: FinanceMovementStatus | '';
  limit?: number;
}

export interface FinanceTimeline {
  period: FinanceTimelinePeriod;
  type: FinanceTimelineTypeFilter;
  status: FinanceMovementStatus | null;
  summary: FinanceTimelineSummary;
  items: FinanceTimelineItem[];
}

/** GET /api/gestion/finance/timeline — mouvements financiers narratifs + résumé filtrable. */
export async function getFinanceTimeline(filters: FinanceTimelineFilters = {}): Promise<FinanceTimeline> {
  const params: Record<string, string | number> = {
    period: filters.period ?? 'all',
    type: filters.type ?? 'all',
  };
  if (filters.status) params.status = filters.status;
  if (filters.limit) params.limit = filters.limit;
  const res = await apiGet<{ ok: boolean } & FinanceTimeline>('/api/gestion/finance/timeline', params);
  return res;
}

// ── RX2.3 — Détail d'un mouvement (breakdown paiement + profit net) ────────────────
export type NetProfitStatus = 'complete' | 'partial' | 'not_applicable';
export type StripeFeesStatus = 'available' | 'pending' | 'not_applicable';
export type FinanceActionKind =
  | 'customer_view' | 'invoice_view' | 'sale_view' | 'refund_process' | 'balance_collect' | 'commission_view' | 'commission_pay' | 'gift_card_view' | 'gift_card_debit';

export interface FinancePaymentBreakdown {
  paidAmount: number;
  stripePaidAmount: number;
  giftCardPaidAmount: number;
  onSitePaidAmount: number;
  refundAmount: number;
  stripeFeesAmount: number;
  stripeFeesStatus: StripeFeesStatus;
  devCommissionAmount: number;
  netProfitAmount: number;
  netProfitStatus: NetProfitStatus;
}

export interface FinanceBreakdownLine {
  label: string;
  amount: number | null;
  kind: 'income' | 'fee' | 'commission' | 'refund' | 'net' | 'method' | 'balance' | 'document';
  status?: 'pending';
  note?: string;
}

export interface FinanceMovementDetail {
  movement: FinanceTimelineItem;
  paymentBreakdown: FinancePaymentBreakdown;
  lines: FinanceBreakdownLine[];
  actions: FinanceMovementAction[];
}

export interface FinanceMovementRef {
  sourceModel: string;
  sourceId: string;
  type?: string;
}

/** GET /api/gestion/finance/movement-detail — détail breakdown + profit net d'un mouvement. */
export async function getFinanceMovementDetail(ref: FinanceMovementRef): Promise<FinanceMovementDetail> {
  const params: Record<string, string> = { sourceModel: ref.sourceModel, sourceId: ref.sourceId };
  if (ref.type) params.type = ref.type;
  const res = await apiGet<{ ok: boolean } & FinanceMovementDetail>('/api/gestion/finance/movement-detail', params);
  return res;
}

/**
 * POST /api/gestion/refunds/:refundId/status — décision admin 1-clic (accepter/refuser).
 * Réutilise la route B1 (RX2.1) ; le backend orchestre refundService (pas de logique dupliquée).
 */
export async function processRefundStatus(
  refundId: string,
  decision: 'accept' | 'refuse',
  reason?: string,
): Promise<RefundDecisionResult> {
  const status: RefundDecisionStatus = decision === 'accept' ? 'succeeded' : 'canceled';
  return apiPost<RefundDecisionResult>(
    `/api/gestion/refunds/${encodeURIComponent(refundId)}/status`,
    { status, ...(reason ? { reason } : {}) },
  );
}

export type BalancePaymentMethod = 'cash' | 'card' | 'other';
export interface BalancePaidResult { ok: boolean; balanceDueAmount?: number; paymentStatus?: string; idempotent?: boolean; }

/** POST /api/gestion/bookings/:bookingId/balance-paid — encaissement du solde sur place (M11). */
export async function markBookingBalancePaid(
  bookingId: string,
  paymentMethod?: BalancePaymentMethod,
): Promise<BalancePaidResult> {
  return apiPost<BalancePaidResult>(
    `/api/gestion/bookings/${encodeURIComponent(bookingId)}/balance-paid`,
    paymentMethod ? { paymentMethod } : {},
  );
}

export type RefundDecisionStatus = 'succeeded' | 'failed' | 'canceled' | 'pending' | 'requested';

export interface RefundDecisionResult {
  ok: boolean;
  stripeInitiated?: boolean;
  refund?: Record<string, unknown>;
}

/**
 * POST /api/gestion/refunds/:refundId/status — décision admin sur un remboursement (B1).
 * Le backend orchestre l'exécution (Stripe + recredit carte cadeau) et l'audit EventLog.
 */
export async function updateRefundStatus(
  refundId: string,
  status: RefundDecisionStatus,
  reason?: string,
): Promise<RefundDecisionResult> {
  return apiPost<RefundDecisionResult>(
    `/api/gestion/refunds/${encodeURIComponent(refundId)}/status`,
    { status, ...(reason ? { reason } : {}) },
  );
}

// ── RX2.6 — Gift Card Finance (cycle de vie financier des cartes cadeaux) ────────────
export type GiftCardLifecycleStatus = 'success' | 'warning' | 'danger' | 'neutral';

export interface GiftCardLifecycleItem {
  type: string;
  title: string;
  subtitle?: string;
  amount: number | null;
  balanceAfter: number | null;
  occurredAt: string | null;
  status: GiftCardLifecycleStatus;
  source: Record<string, unknown>;
}

export interface GiftCardFinanceTransaction {
  id: string;
  type: 'manual_issued' | 'redeem' | 'manual_debit' | 'credit';
  title: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  occurredAt: string | null;
  note: string;
  saleId: string | null;
  actorRole: string | null;
  source: string | null;
}

export type GiftCardRefundStatus = 'not_applicable' | 'pending' | 'succeeded' | 'failed' | 'rollback_needed';
export interface GiftCardRefundTimelineItem {
  refundId: string;
  saleId: string | null;
  amount: number;
  stripeRefundAmount: number;
  giftCardRefundAmount: number;
  giftCardRefundStatus: GiftCardRefundStatus;
  status: string;
  recovered: boolean;
  isSplit: boolean;
  creditNoteUrl: string | null;
  occurredAt: string | null;
}

export interface GiftCardPaymentSource {
  mode: 'stripe' | 'on_site' | 'unknown';
  label: string;
  invoice: { invoiceId: string | null; pdfUrl: string | null } | null;
  sale: { saleId: string } | null;
}

export interface GiftCardFinanceActor { name: string; id: string | null }

export interface FinanceGiftCardCard {
  id: string;
  maskedCode: string;
  amount: number;
  balance: number;
  status: string;
  creationMode: string;
  paymentMode: string;
  paymentLabel: string;
  purchaserName: string | null;
  recipientName: string | null;
  purchasedAt: string | null;
}

export interface FinanceGiftCardSummary {
  activeBalanceAmount: number;
  issuedAmount: number;
  usedAmount: number;
  manualDebitAmount: number;
  count: number;
}

export interface FinanceGiftCardsResult {
  summary: FinanceGiftCardSummary;
  cards: FinanceGiftCardCard[];
}

export interface FinanceGiftCardDetail {
  giftCard: {
    id: string; maskedCode: string; status: string; creationMode: string;
    paymentMode: string; paymentLabel: string | null; message: string | null; purchasedAt: string | null;
  };
  actors: { purchaser: GiftCardFinanceActor; recipient: GiftCardFinanceActor };
  paymentSource: GiftCardPaymentSource;
  currentBalance: { amount: number; balance: number; reserved: number; available: number; status: string };
  lifecycle: GiftCardLifecycleItem[];
  transactions: GiftCardFinanceTransaction[];
  refunds: GiftCardRefundTimelineItem[];
  qr: { available: boolean; maskedToken: string | null };
  actions: FinanceMovementAction[];
}

export interface FinanceGiftCardFilters {
  creationMode?: 'online' | 'manual_institute';
  status?: 'active' | 'redeemed';
  search?: string;
  limit?: number;
}

/** GET /api/gestion/finance/gift-cards — liste + résumé des cartes cadeaux. */
export async function listFinanceGiftCards(filters: FinanceGiftCardFilters = {}): Promise<FinanceGiftCardsResult> {
  const params: Record<string, string | number> = {};
  if (filters.creationMode) params.creationMode = filters.creationMode;
  if (filters.status) params.status = filters.status;
  if (filters.search) params.search = filters.search;
  if (filters.limit) params.limit = filters.limit;
  const res = await apiGet<{ ok: boolean } & FinanceGiftCardsResult>('/api/gestion/finance/gift-cards', params);
  return res;
}

/** GET /api/gestion/finance/gift-cards/:giftCardId — détail (cycle de vie, transactions, refunds, QR masqué). */
export async function getFinanceGiftCardDetail(giftCardId: string): Promise<FinanceGiftCardDetail> {
  return apiGet<{ ok: boolean } & FinanceGiftCardDetail>(`/api/gestion/finance/gift-cards/${encodeURIComponent(giftCardId)}`);
}
