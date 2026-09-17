/**
 * commissionPaymentService.js
 * Calcule les commissions dues pour une période et gère les documents CommissionPayment.
 *
 * Logique de calcul :
 *  - Ventes de la période : Sale.commissionAmount > 0 et createdAt dans [periodStart, periodEnd)
 *  - Remboursements (Sprint pré-React A5) : un remboursement réduit la commission dès
 *    qu'il est RÉGLÉ par n'importe quel moyen — Stripe (`stripeRefundStatus==='succeeded'`)
 *    OU carte cadeau (`giftCardRecredited` / `giftCardRefundStatus==='succeeded'`) OU
 *    statut global `succeeded`. La date de règlement retenue est
 *    `stripeRefundConfirmedAt || refundedAt || processedAt`.
 *    → commission déduite proportionnellement au montant TOTAL remboursé / totalAmount
 *      de la vente, INDÉPENDAMMENT du moyen de paiement (règle documentée : la commission,
 *      calculée au catalogue sur Sale.commissionAmount, suit la valeur de vente conservée).
 *    Corrige le trou « 100 % carte cadeau » (rapport 76) où la commission n'était jamais
 *    déduite car le filtre exigeait `stripeRefundStatus==='succeeded'`.
 */

// A5 — date de règlement effective d'un remboursement, tous moyens confondus.
function resolveRefundSettledAt(refund) {
  const candidates = [refund?.stripeRefundConfirmedAt, refund?.refundedAt, refund?.processedAt];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// A5 — un remboursement est-il terminalement réglé (par Stripe et/ou carte cadeau) ?
function isRefundSettled(refund) {
  return (
    refund?.stripeRefundStatus === 'succeeded' ||
    refund?.giftCardRecredited === true ||
    refund?.giftCardRefundStatus === 'succeeded' ||
    refund?.status === 'succeeded'
  );
}

import mongoose from 'mongoose';

import Sale from '../models/Sale.js';
import RefundRequest from '../models/RefundRequest.js';
import CommissionPayment from '../models/CommissionPayment.js';
import CommissionSettings from '../models/CommissionSettings.js';

function roundToCents(v) {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// getCommissionSettings — récupère (ou crée) le singleton settings
// ---------------------------------------------------------------------------
export async function getCommissionSettings() {
  let settings = await CommissionSettings.findOne().lean();
  if (!settings) {
    const doc = await CommissionSettings.create({ latePaymentDays: 15 });
    settings = doc.toObject();
  }
  return settings;
}

// ---------------------------------------------------------------------------
// computeCommissionsForPeriod
// ---------------------------------------------------------------------------
export async function computeCommissionsForPeriod(periodStart, periodEnd) {
  // 1. Ventes avec commission dans la période
  const sales = await Sale.find({
    createdAt: { $gte: periodStart, $lt: periodEnd },
    commissionAmount: { $gt: 0 }
  }).lean();

  const saleEntries = sales.map(s => {
    // Déduire le formationType depuis items
    const formationItem = (s.items || []).find(i => i.type === 'formation');
    const formationType = formationItem?.name || '';

    return {
      saleId: s._id,
      formationType,
      saleDate: s.createdAt || s.date_achat || null,
      commissionType: s.commissionRate != null ? 'percentage' : 'fixed',
      commissionRate: s.commissionRate ?? null,
      commissionAmount: roundToCents(s.commissionAmount || 0)
    };
  });

  // 2. Remboursements RÉGLÉS (tous moyens) — on récupère les candidats terminés puis on
  //    filtre par date de règlement en JS (la date pertinente peut être dans plusieurs
  //    champs selon le moyen de paiement).
  const candidateRefunds = await RefundRequest.find({
    $or: [
      { stripeRefundStatus: 'succeeded' },
      { giftCardRecredited: true },
      { giftCardRefundStatus: 'succeeded' },
      { status: 'succeeded' }
    ]
  }).lean();

  const refundRequests = candidateRefunds.filter(r => {
    if (!isRefundSettled(r)) return false;
    const settledAt = resolveRefundSettledAt(r);
    return settledAt && settledAt >= periodStart && settledAt < periodEnd;
  });

  // Construire un map saleId (string) → sale pour les calculs proportionnels
  const saleMap = {};
  for (const s of sales) {
    saleMap[s.saleId] = s;
  }

  // Pour les remboursements sur des ventes hors période, charger les sales manquantes
  const missingSaleIds = [];
  for (const r of refundRequests) {
    if (!saleMap[r.saleId]) missingSaleIds.push(r.saleId);
  }
  if (missingSaleIds.length > 0) {
    const extra = await Sale.find({ saleId: { $in: missingSaleIds } }).lean();
    for (const s of extra) saleMap[s.saleId] = s;
  }

  const refundEntries = [];
  for (const r of refundRequests) {
    const sale = saleMap[r.saleId];
    if (!sale || !sale.commissionAmount || sale.commissionAmount <= 0) continue;

    // Déduction proportionnelle au montant TOTAL remboursé (tous moyens), indépendante
    // du moyen de paiement : refundAmount / totalAmount * commissionAmount.
    const ratio = sale.totalAmount > 0
      ? Math.min(1, (r.amount || 0) / sale.totalAmount)
      : 0;
    const deducted = roundToCents(ratio * sale.commissionAmount);
    if (deducted <= 0) continue;

    refundEntries.push({
      refundId: r._id,
      saleId: sale._id,
      refundedAt: resolveRefundSettledAt(r),
      commissionType: sale.commissionRate != null ? 'percentage' : 'fixed',
      commissionRate: sale.commissionRate ?? null,
      commissionAmount: deducted
    });
  }

  // 3. Totaux
  const totalSales = saleEntries.reduce((sum, e) => sum + e.commissionAmount, 0);
  const totalRefunds = refundEntries.reduce((sum, e) => sum + e.commissionAmount, 0);
  const grossCommissionAmount = roundToCents(totalSales);
  const refundDeductionAmount = roundToCents(totalRefunds);
  // `total` conservé pour compat (clamp à 0) ; le carry-over est géré au niveau mensuel
  // (buildMonthlyComputation) — voir correction commissions pré-React.
  const total = roundToCents(Math.max(0, totalSales - totalRefunds));

  return { saleEntries, refundEntries, grossCommissionAmount, refundDeductionAmount, total };
}

// ---------------------------------------------------------------------------
// Carry-over négatif — report du solde déficitaire d'un mois sur le suivant.
// getPreviousMonthCarryOver lit le negativeCarryOverAmount stocké du mois précédent.
// ---------------------------------------------------------------------------
export async function getPreviousMonthCarryOver(month, year) {
  let pm = month - 1;
  let py = year;
  if (pm < 0) { pm = 11; py = year - 1; }
  const prev = await CommissionPayment.findOne({ month: pm, year: py })
    .select('negativeCarryOverAmount')
    .lean();
  return roundToCents(Math.max(0, Number(prev?.negativeCarryOverAmount || 0)));
}

// buildMonthlyComputation — calcul mensuel COMPLET (source unique).
//   netAmountDue            = max(0, gross - refundDeduction - carryOverIn)
//   negativeCarryOverAmount = max(0, refundDeduction + carryOverIn - gross)
// Le carry-over négatif (déductions non absorbées) est reporté au mois suivant au lieu
// d'être perdu par un clamp à 0.
export async function buildMonthlyComputation(month, year) {
  const periodStart = new Date(year, month, 1);
  const periodEnd = new Date(year, month + 1, 1);
  const { saleEntries, refundEntries, grossCommissionAmount, refundDeductionAmount } =
    await computeCommissionsForPeriod(periodStart, periodEnd);
  const carryOverAppliedAmount = await getPreviousMonthCarryOver(month, year);

  const netAmountDue = roundToCents(
    Math.max(0, grossCommissionAmount - refundDeductionAmount - carryOverAppliedAmount)
  );
  const negativeCarryOverAmount = roundToCents(
    Math.max(0, refundDeductionAmount + carryOverAppliedAmount - grossCommissionAmount)
  );

  const calculationSnapshot = {
    grossCommissionAmount,
    refundDeductionAmount,
    carryOverAppliedAmount,
    negativeCarryOverAmount,
    netAmountDue,
    salesCount: saleEntries.length,
    refundsCount: refundEntries.length,
    computedAt: new Date()
  };

  return {
    periodStart,
    periodEnd,
    saleEntries,
    refundEntries,
    grossCommissionAmount,
    refundDeductionAmount,
    carryOverAppliedAmount,
    negativeCarryOverAmount,
    netAmountDue,
    calculationSnapshot
  };
}

// Applique une computation mensuelle sur un document (refresh des champs).
function applyComputationToDoc(doc, comp) {
  doc.sales = comp.saleEntries;
  doc.refunds = comp.refundEntries;
  doc.grossCommissionAmount = comp.grossCommissionAmount;
  doc.refundDeductionAmount = comp.refundDeductionAmount;
  doc.carryOverAppliedAmount = comp.carryOverAppliedAmount;
  doc.negativeCarryOverAmount = comp.negativeCarryOverAmount;
  doc.netAmountDue = comp.netAmountDue;
  doc.amount = comp.netAmountDue; // compat ascendante
  doc.calculationSnapshot = comp.calculationSnapshot;
  if (comp.netAmountDue <= 0) {
    // Mois soldé sans paiement (déductions/carry-over couvrent tout).
    doc.status = 'succeeded';
    doc.settledReason = 'settled_zero';
    doc.paidAt = doc.paidAt || doc.periodStart;
    doc.availableMailSentAt = doc.availableMailSentAt || new Date();
  }
  return doc;
}

// ---------------------------------------------------------------------------
// getOrComputeCommissionPayment
// Retourne le CommissionPayment existant pour mois/année ou en crée un (pending).
// ---------------------------------------------------------------------------
export async function getOrComputeCommissionPayment(month, year) {
  const comp = await buildMonthlyComputation(month, year);
  const existing = await CommissionPayment.findOne({ month, year });

  if (existing) {
    // Un mois RÉGLÉ par paiement effectif est verrouillé (on ne recalcule pas un payé).
    if (existing.status === 'succeeded' && existing.settledReason === 'paid') {
      return existing.toObject();
    }
    // Pending OU settled_zero → REFRESH (source unique de calcul + carry-over).
    applyComputationToDoc(existing, comp);
    await existing.save();
    return existing.toObject();
  }

  const isZero = comp.netAmountDue <= 0;
  try {
    const doc = await CommissionPayment.create({
      month,
      year,
      periodStart: comp.periodStart,
      periodEnd: comp.periodEnd,
      amount: comp.netAmountDue,
      netAmountDue: comp.netAmountDue,
      grossCommissionAmount: comp.grossCommissionAmount,
      refundDeductionAmount: comp.refundDeductionAmount,
      carryOverAppliedAmount: comp.carryOverAppliedAmount,
      negativeCarryOverAmount: comp.negativeCarryOverAmount,
      calculationSnapshot: comp.calculationSnapshot,
      status: isZero ? 'succeeded' : 'pending',
      settledReason: isZero ? 'settled_zero' : null,
      paidAt: isZero ? comp.periodStart : null,
      availableMailSentAt: isZero ? new Date() : null,
      sales: comp.saleEntries,
      refunds: comp.refundEntries
    });
    return doc.toObject();
  } catch (err) {
    // Duplicate key — un autre process l'a déjà créé
    if (err.code === 11000) {
      return CommissionPayment.findOne({ month, year }).lean();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// refreshCommissionPayment
// Recalcule et met à jour un CommissionPayment NON réglé (source unique + carry-over).
// Appelé OBLIGATOIREMENT avant la création d'un PaymentIntent de commission.
// ---------------------------------------------------------------------------
export async function refreshCommissionPayment(paymentId) {
  const payment = await CommissionPayment.findById(paymentId);
  if (!payment) return null;
  // Mois déjà réglé par paiement effectif → verrouillé.
  if (payment.status === 'succeeded' && payment.settledReason === 'paid') {
    return payment.toObject();
  }
  const comp = await buildMonthlyComputation(payment.month, payment.year);
  applyComputationToDoc(payment, comp);
  await payment.save();
  return payment.toObject();
}

// ---------------------------------------------------------------------------
// getMonthsFromContractStart
// Retourne la liste de { month, year } depuis activatedAt jusqu'au mois courant (inclus).
// Accepte un paramètre `now` optionnel pour la simulation de date.
// ---------------------------------------------------------------------------
export function getMonthsFromContractStart(activatedAt, now = new Date()) {
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const months = [];

  let cursor = new Date(new Date(activatedAt).getFullYear(), new Date(activatedAt).getMonth(), 1);

  while (cursor <= currentMonth) {
    months.push({ month: cursor.getMonth(), year: cursor.getFullYear() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}
