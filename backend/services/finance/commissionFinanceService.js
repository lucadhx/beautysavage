// RX2.5 — Commissions premium (lecture finance). RÉUTILISE le moteur commissionPaymentService
// (calcul/carry-over/idempotence) SANS le modifier. Ajoute une couche « termes de paiement »
// (échéance, grace, statut de retard) + un mapping premium pour le front.
//
// Règles métier inchangées : commission = formations uniquement, remboursement = déduction,
// déductions > commissions → facture 0 € + report négatif. Aucun montant inventé.
// (cf. docs/RX2_5_COMMISSION_PREMIUM_AUDIT.md)
import Contract from '../../models/Contract.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import {
  getOrComputeCommissionPayment,
  getMonthsFromContractStart,
  getCommissionSettings,
} from '../commissionPaymentService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function roundToCents(v) {
  const n = Number.isFinite(Number(v)) ? Number(v) : 0;
  return Math.round(n * 100) / 100;
}

// ── Termes de paiement (résolus depuis CommissionSettings ; hook override contrat documenté) ──────
export function resolveCommissionPaymentTerms(settings, contract = null) {
  // Hook futur : un contrat pourra surcharger les termes. Le modèle Contract n'a pas encore de champs
  // de termes → on ne les invente pas ; on documente le point d'extension.
  void contract;
  return {
    paymentDueDays: Number.isFinite(Number(settings?.latePaymentDays)) ? Number(settings.latePaymentDays) : 15,
    gracePeriodDays: Number.isFinite(Number(settings?.gracePeriodDays)) ? Number(settings.gracePeriodDays) : 0,
    blockingMode: settings?.blockingMode || 'none',
    suspensionWarningAfterDays: Number.isFinite(Number(settings?.suspensionWarningAfterDays)) ? Number(settings.suspensionWarningAfterDays) : 0,
  };
}

// availabilityAt = 1er du mois suivant (periodEnd). dueAt/graceEndsAt = snapshot si présent, sinon termes.
export function computeCommissionDueDates(payment, terms) {
  const availabilityAt = new Date(payment.periodEnd);
  const dueAt = payment.dueAt
    ? new Date(payment.dueAt)
    : new Date(availabilityAt.getTime() + terms.paymentDueDays * DAY_MS);
  const graceEndsAt = payment.graceEndsAt
    ? new Date(payment.graceEndsAt)
    : new Date(dueAt.getTime() + terms.gracePeriodDays * DAY_MS);
  return { availabilityAt, dueAt, graceEndsAt };
}

// lateStatus ∈ paid | settled_zero | pending_due | due | grace | overdue | suspension_risk
export function resolveCommissionLateStatus(payment, terms, now = new Date()) {
  if (payment.settledReason === 'paid') return 'paid';
  if (payment.settledReason === 'settled_zero' || Number(payment.netAmountDue || 0) <= 0) return 'settled_zero';
  const { availabilityAt, dueAt, graceEndsAt } = computeCommissionDueDates(payment, terms);
  const t = now.getTime();
  if (t < availabilityAt.getTime()) return 'pending_due';
  if (t < dueAt.getTime()) return 'due';
  if (t < graceEndsAt.getTime()) return 'grace';
  if (terms.blockingMode !== 'none' && terms.suspensionWarningAfterDays > 0) {
    const overdueDays = (t - graceEndsAt.getTime()) / DAY_MS;
    if (overdueDays >= terms.suspensionWarningAfterDays) return 'suspension_risk';
  }
  return 'overdue';
}

// Lignes lisibles du calcul (Formations vendues / Remboursements / Report / À payer).
export function buildCommissionBreakdown(payment) {
  const gross = roundToCents(payment.grossCommissionAmount);
  const refund = roundToCents(payment.refundDeductionAmount);
  const carryIn = roundToCents(payment.carryOverAppliedAmount);
  const net = roundToCents(payment.netAmountDue ?? payment.amount);
  const negCarry = roundToCents(payment.negativeCarryOverAmount);
  const lines = [{ label: 'Formations vendues', amount: gross, kind: 'income' }];
  if (refund > 0) lines.push({ label: 'Remboursements', amount: -refund, kind: 'refund' });
  if (carryIn > 0) lines.push({ label: 'Report précédent', amount: -carryIn, kind: 'carryover' });
  lines.push({ label: 'À payer', amount: net, kind: 'net' });
  if (negCarry > 0) lines.push({ label: 'Reporté au mois suivant', amount: negCarry, kind: 'carryover_next', info: true });
  return lines;
}

// Snapshot durable des dates (lazy, idempotent) — ISOLÉ ici, jamais dans le moteur.
async function ensureDueDateSnapshot(payment, terms) {
  if (payment.dueAt) return payment;
  const { dueAt, graceEndsAt } = computeCommissionDueDates(payment, terms);
  const snapshot = {
    paymentDueDays: terms.paymentDueDays,
    gracePeriodDays: terms.gracePeriodDays,
    blockingMode: terms.blockingMode,
  };
  if (payment._id) {
    await CommissionPayment.updateOne(
      { _id: payment._id, dueAt: null },
      { $set: { dueAt, graceEndsAt, paymentTermsSnapshot: snapshot } },
    ).catch(() => {});
  }
  payment.dueAt = dueAt;
  payment.graceEndsAt = graceEndsAt;
  payment.paymentTermsSnapshot = snapshot;
  return payment;
}

function uiStatus(payment, lateStatus) {
  if (payment.settledReason === 'paid') return 'paid';
  if (payment.settledReason === 'settled_zero' || Number(payment.netAmountDue || 0) <= 0) return 'settled_zero';
  if (lateStatus === 'overdue' || lateStatus === 'suspension_risk') return 'overdue';
  return 'pending';
}

// Mapping premium d'un CommissionPayment.
export function mapCommissionPayment(payment, terms, now = new Date()) {
  const { availabilityAt, dueAt, graceEndsAt } = computeCommissionDueDates(payment, terms);
  const lateStatus = resolveCommissionLateStatus(payment, terms, now);
  const net = roundToCents(payment.netAmountDue ?? payment.amount);
  const paymentId = String(payment._id);
  return {
    id: paymentId,
    month: payment.month,
    year: payment.year,
    label: `${MONTH_LABELS[payment.month] || ''} ${payment.year}`.trim(),
    grossCommission: roundToCents(payment.grossCommissionAmount),
    refundDeduction: roundToCents(payment.refundDeductionAmount),
    carryOverIn: roundToCents(payment.carryOverAppliedAmount),
    netAmountDue: net,
    negativeCarryOver: roundToCents(payment.negativeCarryOverAmount),
    status: uiStatus(payment, lateStatus),
    settledReason: payment.settledReason || null,
    availabilityAt: availabilityAt.toISOString(),
    dueAt: dueAt.toISOString(),
    graceEndsAt: graceEndsAt.toISOString(),
    lateStatus,
    periodStart: payment.periodStart ? new Date(payment.periodStart).toISOString() : null,
    periodEnd: payment.periodEnd ? new Date(payment.periodEnd).toISOString() : null,
    paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : null,
    lines: buildCommissionBreakdown(payment),
    invoice: {
      pdfUrl: payment.stripeInvoicePdfUrl || null,
      invoiceId: payment.stripeInvoiceId || null,
    },
    payment: {
      id: paymentId,
      status: payment.status,
      paymentInProgress: Boolean(payment.paymentInProgress),
    },
    actions: [
      { kind: 'commission_pay', enabled: net > 0 && payment.settledReason !== 'paid', paymentId },
      { kind: 'invoice_view', enabled: Boolean(payment.stripeInvoicePdfUrl), url: payment.stripeInvoicePdfUrl || null },
    ],
  };
}

async function resolveActiveContract() {
  return Contract.findOne({ status: 'active' }).lean();
}

// ── API de lecture ──────────────────────────────────────────────────────────────────
export async function getCurrentCommissionOverview(now = new Date()) {
  const contract = await resolveActiveContract();
  const settings = await getCommissionSettings();
  const terms = resolveCommissionPaymentTerms(settings, contract);
  if (!contract || !contract.activatedAt) {
    return { hasContract: false, terms, current: null, contractActivatedAt: null };
  }
  const month = now.getMonth();
  const year = now.getFullYear();
  const payment = await getOrComputeCommissionPayment(month, year);
  await ensureDueDateSnapshot(payment, terms);
  return {
    hasContract: true,
    contractActivatedAt: new Date(contract.activatedAt).toISOString(),
    terms,
    current: mapCommissionPayment(payment, terms, now),
  };
}

export async function getCommissionPaymentDetail(year, month1, now = new Date()) {
  const y = Number(year);
  const m = Number(month1) - 1; // 1-12 → 0-11
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 0 || m > 11) return null;
  const settings = await getCommissionSettings();
  const contract = await resolveActiveContract();
  const terms = resolveCommissionPaymentTerms(settings, contract);
  const payment = await getOrComputeCommissionPayment(m, y);
  if (!payment) return null;
  await ensureDueDateSnapshot(payment, terms);
  return { terms, detail: mapCommissionPayment(payment, terms, now) };
}

export async function getCommissionPaymentHistory(now = new Date()) {
  const contract = await resolveActiveContract();
  const settings = await getCommissionSettings();
  const terms = resolveCommissionPaymentTerms(settings, contract);
  if (!contract || !contract.activatedAt) return { hasContract: false, terms, items: [] };
  const months = getMonthsFromContractStart(contract.activatedAt, now);
  const items = [];
  for (const { month, year } of months) {
    // SÉQUENTIEL : le carry-over dépend du mois précédent (cf. moteur).
    // eslint-disable-next-line no-await-in-loop
    const payment = await getOrComputeCommissionPayment(month, year);
    // eslint-disable-next-line no-await-in-loop
    await ensureDueDateSnapshot(payment, terms);
    items.push(mapCommissionPayment(payment, terms, now));
  }
  items.reverse(); // plus récent en premier
  return { hasContract: true, contractActivatedAt: new Date(contract.activatedAt).toISOString(), terms, items };
}
