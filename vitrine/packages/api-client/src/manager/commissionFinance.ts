// RX2.5 — Commissions premium (manager, admin/dev). Lecture via /api/gestion/finance/commissions/* ;
// le PAIEMENT réutilise /api/commissions/payments/:id/* (Stripe Dev hébergé U3). Aucun calcul front.
import { apiGet, apiPost } from '../apiFetch';
import type { FinanceMovementAction } from './finance';

export type CommissionLateStatus =
  | 'paid' | 'settled_zero' | 'pending_due' | 'due' | 'grace' | 'overdue' | 'suspension_risk';
export type CommissionUiStatus = 'paid' | 'settled_zero' | 'pending' | 'overdue';
export type CommissionBlockingMode = 'none' | 'warning_only' | 'block_purchases' | 'block_manager';

export interface CommissionTerms {
  paymentDueDays: number;
  gracePeriodDays: number;
  blockingMode: CommissionBlockingMode;
  suspensionWarningAfterDays: number;
}

export interface CommissionBreakdownLine {
  label: string;
  amount: number;
  kind: 'income' | 'refund' | 'carryover' | 'net' | 'carryover_next';
  info?: boolean;
}

export interface CommissionPaymentView {
  id: string;
  month: number;
  year: number;
  label: string;
  grossCommission: number;
  refundDeduction: number;
  carryOverIn: number;
  netAmountDue: number;
  negativeCarryOver: number;
  status: CommissionUiStatus;
  settledReason: string | null;
  availabilityAt: string;
  dueAt: string;
  graceEndsAt: string;
  lateStatus: CommissionLateStatus;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  lines: CommissionBreakdownLine[];
  invoice: { pdfUrl: string | null; invoiceId: string | null };
  payment: { id: string; status: string; paymentInProgress: boolean };
  actions: FinanceMovementAction[];
}

export interface CommissionOverview {
  hasContract: boolean;
  contractActivatedAt: string | null;
  terms: CommissionTerms;
  current: CommissionPaymentView | null;
}
export interface CommissionHistory {
  hasContract: boolean;
  contractActivatedAt?: string | null;
  terms: CommissionTerms;
  items: CommissionPaymentView[];
}
export interface CommissionDetail {
  terms: CommissionTerms;
  detail: CommissionPaymentView;
}

export interface CommissionIntentResult {
  ok: boolean;
  settledZero?: boolean;
  mode?: 'hosted';
  url?: string;
  clientSecret?: string;
  alreadySucceeded?: boolean;
  amountCents?: number;
  status?: string;
}
export interface CommissionStatusResult { ok: boolean; status?: string; paidAt?: string | null; }

/** GET /api/gestion/finance/commissions/current — commission du mois courant. */
export async function getCommissionOverview(): Promise<CommissionOverview> {
  return apiGet<{ ok: boolean } & CommissionOverview>('/api/gestion/finance/commissions/current');
}
/** GET /api/gestion/finance/commissions/history — historique (mois depuis activation contrat). */
export async function getCommissionHistory(): Promise<CommissionHistory> {
  return apiGet<{ ok: boolean } & CommissionHistory>('/api/gestion/finance/commissions/history');
}
/** GET /api/gestion/finance/commissions/:year/:month — détail (month = 1-12). */
export async function getCommissionDetail(year: number, month: number): Promise<CommissionDetail> {
  return apiGet<{ ok: boolean } & CommissionDetail>(`/api/gestion/finance/commissions/${year}/${month}`);
}

/** POST /api/commissions/payments/:id/create-intent — paiement Stripe Dev hébergé (U3). */
export async function createCommissionPaymentIntent(paymentId: string): Promise<CommissionIntentResult> {
  return apiPost<CommissionIntentResult>(`/api/commissions/payments/${encodeURIComponent(paymentId)}/create-intent`, {});
}
/** GET /api/commissions/payments/:id/check-status — statut après retour de paiement. */
export async function checkCommissionPaymentStatus(paymentId: string): Promise<CommissionStatusResult> {
  return apiGet<CommissionStatusResult>(`/api/commissions/payments/${encodeURIComponent(paymentId)}/check-status`);
}
