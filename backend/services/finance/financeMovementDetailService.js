// RX2.3 — Détail financier d'un mouvement : breakdown paiement + PROFIT NET estimé + lignes lisibles.
// Le backend fait AUTORITÉ ; aucun calcul de montant côté front. AUCUN montant inventé :
//   • frais Stripe inconnus → status 'pending' (jamais d'estimation par formule) ;
//   • commission Dev = formations UNIQUEMENT (source CommissionTransaction sourceType 'sale') ;
//   • profit net = montant payé − frais Stripe − commission Dev − remboursements.
// (cf. docs/RX2_3_PAYMENTS_REFUNDS_NET_PROFIT_AUDIT.md)
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import CommissionTransaction from '../../models/CommissionTransaction.js';
import Invoice from '../../models/Invoice.js';
import Service from '../../models/Service.js';
import User from '../../models/user.js';
import {
  mapSaleToFinanceMovement, mapBookingBalanceToFinanceMovement, mapRefundToFinanceMovement,
  mapGiftCardTransactionToFinanceMovement, mapCommissionPaymentToFinanceMovement, mapInvoiceToFinanceMovement,
} from './financeTimelineService.js';

function roundToCents(value) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(n * 100) / 100;
}
function personName(user) {
  if (!user) return '';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email || '';
}

// Frais Stripe : statut dérivé des champs réels (jamais recalculé). stripeFee est en CENTIMES.
function resolveStripeFees(sale) {
  const pi = String(sale.stripePaymentIntentId || '').trim();
  const hasRealPi = Boolean(pi) && !pi.startsWith('free_');
  if (!hasRealPi) return { status: 'not_applicable', amount: 0 };
  if (sale.stripeFee === null || sale.stripeFee === undefined) return { status: 'pending', amount: null };
  return { status: 'available', amount: roundToCents(Number(sale.stripeFee) / 100) };
}

// Commission Dev de la vente = somme des CommissionTransaction (sourceType 'sale') — formations only.
async function resolveDevCommission(saleId) {
  if (!saleId) return 0;
  const rows = await CommissionTransaction.find({ saleId: String(saleId) }).lean();
  const total = rows
    .filter((t) => t.sourceType === 'sale' || (!t.sourceType && Number(t.commissionAmount || 0) > 0))
    .reduce((sum, t) => sum + Number(t.commissionAmount || 0), 0);
  return roundToCents(total);
}

// Remboursements aboutis de la vente.
async function resolveRefundedAmount(saleId) {
  if (!saleId) return 0;
  const refunds = await RefundRequest.find({ saleId: String(saleId), status: 'succeeded' }).lean();
  return roundToCents(refunds.reduce((sum, r) => sum + Number(r.amount || 0), 0));
}

function emptyBreakdown(overrides = {}) {
  return {
    paidAmount: 0, stripePaidAmount: 0, giftCardPaidAmount: 0, onSitePaidAmount: 0,
    refundAmount: 0, stripeFeesAmount: 0, stripeFeesStatus: 'not_applicable',
    devCommissionAmount: 0, netProfitAmount: 0, netProfitStatus: 'not_applicable',
    ...overrides,
  };
}

// ── Sale / deposit ────────────────────────────────────────────────────────────────
async function buildSaleDetail(sale, isDeposit) {
  const paidAmount = roundToCents(sale.totalAmount);
  const giftCardPaidAmount = roundToCents(
    Array.isArray(sale.giftCardUsage)
      ? sale.giftCardUsage.reduce((s, g) => s + Number(g?.amountUsed || 0), 0)
      : 0,
  );
  const fees = resolveStripeFees(sale);
  const snapStripe = sale?.pricingSnapshot?.stripePaymentAmount;
  const hasRealPi = fees.status !== 'not_applicable';
  const stripePaidAmount = roundToCents(
    Number.isFinite(Number(snapStripe)) ? Number(snapStripe) : (hasRealPi ? paidAmount - giftCardPaidAmount : 0),
  );
  const onSitePaidAmount = roundToCents(Math.max(0, paidAmount - giftCardPaidAmount - stripePaidAmount));
  const devCommissionAmount = await resolveDevCommission(sale.saleId);
  const refundAmount = await resolveRefundedAmount(sale.saleId);

  const feeKnown = fees.status === 'available';
  const netProfitAmount = roundToCents(paidAmount - (feeKnown ? fees.amount : 0) - devCommissionAmount - refundAmount);
  const netProfitStatus = fees.status === 'pending' ? 'partial' : 'complete';

  const breakdown = {
    paidAmount, stripePaidAmount, giftCardPaidAmount, onSitePaidAmount,
    refundAmount, stripeFeesAmount: feeKnown ? fees.amount : 0, stripeFeesStatus: fees.status,
    devCommissionAmount, netProfitAmount, netProfitStatus,
  };

  const lines = [{ label: 'Montant payé', amount: paidAmount, kind: 'income' }];
  if (giftCardPaidAmount > 0) lines.push({ label: 'Payé par carte cadeau', amount: giftCardPaidAmount, kind: 'method' });
  if (fees.status === 'available') lines.push({ label: 'Frais Stripe', amount: -fees.amount, kind: 'fee' });
  else if (fees.status === 'pending') lines.push({ label: 'Frais Stripe', amount: null, kind: 'fee', status: 'pending', note: 'en attente de synchronisation' });
  if (devCommissionAmount > 0) lines.push({ label: 'Commission plateforme', amount: -devCommissionAmount, kind: 'commission' });
  if (refundAmount > 0) lines.push({ label: 'Remboursé', amount: -refundAmount, kind: 'refund' });
  lines.push({ label: 'Profit net estimé', amount: netProfitAmount, kind: 'net', status: netProfitStatus });

  return { breakdown, lines, isDeposit };
}

// ── Booking balance ─────────────────────────────────────────────────────────────────
function buildBalanceDetail(booking) {
  const paid = Boolean(booking.balancePaidAt);
  const amount = paid
    ? roundToCents(Number(booking.totalPrice || 0) - Number(booking.depositAmount || 0))
    : roundToCents(booking.balanceDueAmount);
  if (paid) {
    const breakdown = emptyBreakdown({
      paidAmount: amount, onSitePaidAmount: amount,
      netProfitAmount: amount, netProfitStatus: 'complete',
    });
    return {
      breakdown,
      lines: [
        { label: 'Payé sur place', amount, kind: 'income' },
        { label: 'Profit net estimé', amount, kind: 'net', status: 'complete' },
      ],
    };
  }
  // RX2.4 — wording adaptatif : prestation payée 100 % sur place (full) vs solde d'acompte.
  const dueLabel = booking.paymentType === 'full' ? 'Paiement sur place à encaisser' : 'Solde à encaisser';
  return {
    breakdown: emptyBreakdown({ netProfitStatus: 'not_applicable' }),
    lines: [{ label: dueLabel, amount, kind: 'balance' }],
  };
}

// ── Refund ────────────────────────────────────────────────────────────────────────
function buildRefundDetail(refund) {
  const amount = roundToCents(refund.amount);
  const lines = [{ label: 'Remboursé', amount: -amount, kind: 'refund' }];
  const stripePart = roundToCents(refund.stripeRefundAmount);
  const gcPart = roundToCents(refund.giftCardRefundAmount);
  if (stripePart > 0 && gcPart > 0) {
    lines.push({ label: 'Dont en ligne', amount: -stripePart, kind: 'method' });
    lines.push({ label: 'Dont carte cadeau', amount: -gcPart, kind: 'method' });
  }
  return { breakdown: emptyBreakdown({ refundAmount: amount }), lines };
}

// ── Gift card transaction ─────────────────────────────────────────────────────────
function buildGiftCardDetail(tx) {
  const amount = roundToCents(tx.amount);
  if (tx.transactionType === 'manual_issued') {
    return {
      breakdown: emptyBreakdown({ paidAmount: amount, onSitePaidAmount: amount }),
      lines: [{ label: 'Payé sur place', amount, kind: 'income' }],
    };
  }
  // redeem / manual_debit : moyen de paiement (neutre).
  return {
    breakdown: emptyBreakdown(),
    lines: [{ label: 'Carte cadeau utilisée', amount, kind: 'method' }],
  };
}

// ── Commission payment ──────────────────────────────────────────────────────────────
function buildCommissionDetail(payment) {
  const amount = roundToCents(payment.netAmountDue ?? payment.amount);
  return {
    breakdown: emptyBreakdown({ devCommissionAmount: amount }),
    lines: [{ label: 'Commission plateforme', amount: -amount, kind: 'commission' }],
  };
}

function buildInvoiceDetail(invoice) {
  return {
    breakdown: emptyBreakdown(),
    lines: [{ label: 'Document', amount: roundToCents(invoice.totalAmount), kind: 'document' }],
  };
}

/**
 * Construit le détail d'un mouvement financier.
 * @param {{ sourceModel: string, sourceId: string, type?: string }} params
 * @returns {Promise<object|null>} null si la source est introuvable / invalide.
 */
export async function buildFinanceMovementDetail({ sourceModel, sourceId, type } = {}) {
  const model = String(sourceModel || '').trim();
  const id = String(sourceId || '').trim();
  if (!model || !id) return null;

  let movement = null;
  let detail = null;

  if (model === 'Sale') {
    const sale = await Sale.findOne({ saleId: id }).lean();
    if (!sale) return null;
    const isDeposit = type === 'deposit'
      ? true
      : Boolean(await ServiceBooking.exists({ saleId: id, paymentType: 'deposit' }));
    detail = await buildSaleDetail(sale, isDeposit);
    const invoice = await Invoice.findOne({ saleId: id, official: true }).select('stripeInvoicePdfUrl stripeHostedUrl').lean();
    const invoiceUrl = invoice ? (invoice.stripeInvoicePdfUrl || invoice.stripeHostedUrl || null) : null;
    movement = mapSaleToFinanceMovement(sale, { isDeposit, customerName: personName(sale.customer), invoiceUrl });
  } else if (model === 'ServiceBooking') {
    const booking = await ServiceBooking.findOne({ bookingId: id }).lean();
    if (!booking) return null;
    const [user, service] = await Promise.all([
      booking.clientId ? User.findById(booking.clientId).select('firstName lastName email').lean() : null,
      booking.serviceId ? Service.findById(booking.serviceId).select('name').lean() : null,
    ]);
    detail = buildBalanceDetail(booking);
    movement = mapBookingBalanceToFinanceMovement(booking, { customerName: personName(user), serviceName: service?.name || '' });
  } else if (model === 'RefundRequest') {
    const refund = await RefundRequest.findOne({ refundId: id }).lean();
    if (!refund) return null;
    const user = refund.userId ? await User.findById(refund.userId).select('firstName lastName email').lean() : null;
    detail = buildRefundDetail(refund);
    movement = mapRefundToFinanceMovement(refund, { customerName: personName(user) });
  } else if (model === 'GiftCardTransaction') {
    const tx = await GiftCardTransaction.findById(id).lean();
    if (!tx) return null;
    const user = tx.userId ? await User.findById(tx.userId).select('firstName lastName email').lean() : null;
    detail = buildGiftCardDetail(tx);
    movement = mapGiftCardTransactionToFinanceMovement(tx, { customerName: personName(user) });
  } else if (model === 'CommissionPayment') {
    const payment = await CommissionPayment.findById(id).lean();
    if (!payment) return null;
    detail = buildCommissionDetail(payment);
    movement = mapCommissionPaymentToFinanceMovement(payment);
  } else if (model === 'Invoice') {
    const invoice = await Invoice.findOne({ invoiceId: id }).lean();
    if (!invoice) return null;
    const user = invoice.userId ? await User.findById(invoice.userId).select('firstName lastName email').lean() : null;
    detail = buildInvoiceDetail(invoice);
    movement = mapInvoiceToFinanceMovement(invoice, { customerName: personName(user) });
  } else {
    return null;
  }

  if (!movement || !detail) return null;
  return {
    movement,
    paymentBreakdown: detail.breakdown,
    lines: detail.lines,
    actions: movement.actions || [],
  };
}
