// RX2.2 — Financial Timeline : colonne vertébrale narrative de la finance (admin/dev).
// Le backend agrège et fait AUTORITÉ ; le front n'effectue aucun calcul de montant.
//
// Principes (cf. docs/RX2_FINANCIAL_TIMELINE_AUDIT.md) :
//   • Aucun montant inventé : chaque mouvement vient d'un champ réel d'un modèle existant.
//   • Aucun double-count :
//       - facture = lien sur la vente (pas une ligne par défaut) ;
//       - carte cadeau utilisée = moyen de paiement → neutral (déjà dans Sale.totalAmount) ;
//       - gift_card_issue uniquement pour les cartes MANUELLES (les cartes en ligne sont des Sale) ;
//       - commission = CommissionPayment (billing plateforme), pas CommissionTransaction (accruals).
import Sale from '../../models/Sale.js';
import ServiceBooking from '../../models/ServiceBooking.js';
import RefundRequest from '../../models/RefundRequest.js';
import Invoice from '../../models/Invoice.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import CommissionPayment from '../../models/CommissionPayment.js';
import Service from '../../models/Service.js';
import User from '../../models/user.js';

const SOURCE_QUERY_CAP = 500; // garde-fou par source (V1) ; documenté.

// RX2.4 — Filtre UNIFIÉ « paiement sur place dû » (partagé dashboard + timeline). Inclut les acomptes
// online (solde sur place) ET les prestations manuelles payées intégralement sur place. Exclut les
// réservations annulées et les online non encore payées. `paymentStatus` n'est PAS un critère
// (incohérent : les manuelles full sont `pending`). Cf. docs/RX2_4_ONSITE_PAYMENTS_AUDIT.md.
export const ONSITE_DUE_BOOKING_FILTER = {
  balanceDueAmount: { $gt: 0 },
  balanceSettlementMode: 'pay_on_site',
  status: { $nin: ['cancelled', 'pending_payment'] },
};

const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function roundToCents(value) {
  const candidate = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(candidate * 100) / 100;
}
function money(value) {
  return `${roundToCents(value).toFixed(2).replace('.', ',')} €`;
}
function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

// Fenêtre [dateFrom, dateTo) à partir d'une période. `dateTo` exclusif = fin de journée courante.
export function resolveTimelineWindow(period = 'all', now = new Date()) {
  const endExclusive = new Date(startOfLocalDay(now).getTime() + 24 * 60 * 60 * 1000);
  if (period === 'today') return { period, dateFrom: startOfLocalDay(now), dateTo: endExclusive };
  if (period === 'week') return { period, dateFrom: new Date(startOfLocalDay(now).getTime() - 6 * 86400000), dateTo: endExclusive };
  if (period === 'month') return { period, dateFrom: new Date(startOfLocalDay(now).getTime() - 29 * 86400000), dateTo: endExclusive };
  return { period: 'all', dateFrom: null, dateTo: endExclusive };
}

// `type` (filtre utilisateur) → ensemble de `type` de mouvement concrets.
const TYPE_GROUPS = {
  sale: ['sale'],
  deposit: ['deposit'],
  balance: ['balance_due', 'balance_paid'],
  gift_card: ['gift_card_issue', 'gift_card_usage', 'gift_card_manual_debit', 'gift_card_refund_recredit', 'gift_card_recredit_failed'],
  refund: ['refund'],
  commission: ['commission'],
  invoice: ['invoice'],
};
export function typesForFilter(typeFilter) {
  if (!typeFilter || typeFilter === 'all') return null; // null = tous
  return TYPE_GROUPS[typeFilter] || null;
}

function refundStatusToTimeline(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'succeeded') return 'refunded';
  if (s === 'requested' || s === 'pending') return 'pending';
  if (s === 'failed') return 'failed';
  if (s === 'canceled' || s === 'cancelled') return 'cancelled';
  return 'pending';
}
function commissionStatusToTimeline(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'succeeded') return 'paid';
  if (s === 'failed') return 'failed';
  return 'pending';
}

function personName(user) {
  if (!user) return '';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email || '';
}

// ── Mappers purs (testables unitairement) ─────────────────────────────────────────
export function mapSaleToFinanceMovement(sale, { isDeposit = false, customerName = '', invoiceUrl = null } = {}) {
  if (!sale) return null;
  const items = Array.isArray(sale.items) ? sale.items : [];
  const hasGiftCardPayment = Array.isArray(sale.giftCardUsage) && sale.giftCardUsage.length > 0;
  const label = items.find((i) => i?.type === 'service') ? 'Prestation'
    : items.find((i) => i?.type === 'formation') ? 'Formation'
    : items.find((i) => i?.type === 'gift-card') ? 'Carte cadeau'
    : 'Vente';
  const customerId = sale.userId ? String(sale.userId) : null;
  // RX2.3 — commission Dev = formations uniquement → indicateur sur la card.
  const hasFormation = items.some((i) => i?.type === 'formation');
  const badges = [];
  if (isDeposit) badges.push({ label: 'Acompte', tone: 'neutral' });
  if (hasFormation) badges.push({ label: 'Commission formation', tone: 'neutral' });
  if (hasGiftCardPayment) badges.push({ label: 'Carte cadeau', tone: 'neutral' });
  badges.push({ label: sale.stripePaymentIntentId ? 'Stripe' : 'Encaissé', tone: 'success' });
  return {
    id: `sale:${sale.saleId}`,
    type: isDeposit ? 'deposit' : 'sale',
    direction: 'in',
    amount: roundToCents(sale.totalAmount),
    currency: 'EUR',
    title: isDeposit ? 'Acompte reçu' : 'Paiement reçu',
    subtitle: `${label}${customerName ? ` · ${customerName}` : ''}`,
    status: 'paid',
    occurredAt: sale.createdAt ? new Date(sale.createdAt).toISOString() : null,
    customer: customerId ? { id: customerId, name: customerName || personName({ ...sale.customer }) } : null,
    source: { model: 'Sale', id: sale.saleId },
    badges,
    actions: [
      { kind: 'customer_view', enabled: Boolean(customerId), to: customerId ? `/clients/${customerId}` : null },
      { kind: 'invoice_view', enabled: Boolean(invoiceUrl), url: invoiceUrl || null },
      { kind: 'sale_view', enabled: false },
    ],
  };
}

export function mapBookingBalanceToFinanceMovement(booking, { customerName = '', serviceName = '' } = {}) {
  if (!booking) return null;
  const customerId = booking.clientId ? String(booking.clientId) : null;
  const paid = Boolean(booking.balancePaidAt);
  const amount = paid
    ? roundToCents(Number(booking.totalPrice || 0) - Number(booking.depositAmount || 0))
    : roundToCents(booking.balanceDueAmount);
  if (amount <= 0) return null;
  // RX2.4 — wording adaptatif : prestation payée 100 % sur place (full) vs solde d'acompte.
  const isFullOnSite = booking.paymentType === 'full';
  const onSite = booking.paymentMode === 'on_site';
  const isManual = booking.source === 'manual_institute';
  const base = {
    currency: 'EUR',
    subtitle: `${serviceName || 'Prestation'}${customerName ? ` · ${customerName}` : ''}`,
    occurredAt: (paid ? booking.balancePaidAt : booking.createdAt)
      ? new Date(paid ? booking.balancePaidAt : booking.createdAt).toISOString()
      : null,
    customer: customerId ? { id: customerId, name: customerName } : null,
    source: { model: 'ServiceBooking', id: booking.bookingId || String(booking._id) },
    actions: [{ kind: 'customer_view', enabled: Boolean(customerId), to: customerId ? `/clients/${customerId}` : null }],
  };
  if (paid) {
    return {
      ...base,
      id: `balance_paid:${booking.bookingId || booking._id}`,
      type: 'balance_paid', direction: 'in', amount,
      title: isFullOnSite ? 'Paiement sur place encaissé' : 'Solde encaissé', status: 'paid',
      badges: [
        { label: onSite ? 'Sur place' : 'Encaissé', tone: 'success' },
        ...(isManual ? [{ label: 'Réservation manuelle', tone: 'neutral' }] : []),
      ],
    };
  }
  return {
    ...base,
    id: `balance_due:${booking.bookingId || booking._id}`,
    type: 'balance_due', direction: 'neutral', amount,
    title: isFullOnSite ? 'Paiement sur place à encaisser' : 'Solde à encaisser', status: 'balance_due',
    badges: [
      { label: 'À encaisser', tone: 'warning' },
      ...(onSite ? [{ label: 'Sur place', tone: 'neutral' }] : []),
      ...(isManual ? [{ label: 'Réservation manuelle', tone: 'neutral' }] : []),
    ],
    actions: [
      { kind: 'balance_collect', enabled: true, to: '/reservations' },
      ...base.actions,
    ],
  };
}

export function mapRefundToFinanceMovement(refund, { customerName = '' } = {}) {
  if (!refund) return null;
  const customerId = refund.userId ? String(refund.userId) : null;
  const status = refundStatusToTimeline(refund.status);
  const isSplit = Number(refund.giftCardRefundAmount || 0) > 0 && Number(refund.stripeRefundAmount || 0) > 0;
  const badges = [];
  if (isSplit) badges.push({ label: 'Mixte', tone: 'neutral' });
  else if (Number(refund.giftCardRefundAmount || 0) > 0) badges.push({ label: 'Carte cadeau', tone: 'neutral' });
  if (status === 'pending') badges.push({ label: 'En attente', tone: 'warning' });
  const creditNoteUrl = refund.creditNotePdfUrl || null;
  return {
    id: `refund:${refund.refundId}`,
    type: 'refund',
    direction: 'out',
    amount: roundToCents(refund.amount),
    currency: 'EUR',
    title: status === 'refunded' ? 'Remboursement effectué' : 'Remboursement en attente',
    subtitle: `${refund.itemType || 'Article'}${customerName ? ` · ${customerName}` : ''}`,
    status,
    occurredAt: (refund.refundedAt || refund.requestedAt)
      ? new Date(refund.refundedAt || refund.requestedAt).toISOString()
      : null,
    customer: customerId ? { id: customerId, name: customerName } : null,
    source: { model: 'RefundRequest', id: refund.refundId },
    badges,
    actions: [
      { kind: 'refund_process', enabled: status === 'pending', to: '/remboursements' },
      { kind: 'invoice_view', enabled: Boolean(creditNoteUrl), url: creditNoteUrl },
      { kind: 'customer_view', enabled: Boolean(customerId), to: customerId ? `/clients/${customerId}` : null },
    ],
  };
}

export function mapGiftCardTransactionToFinanceMovement(tx, { customerName = '' } = {}) {
  if (!tx) return null;
  const customerId = tx.userId ? String(tx.userId) : null;
  const kind = tx.transactionType;
  let type; let direction; let title;
  if (kind === 'manual_issued') { type = 'gift_card_issue'; direction = 'in'; title = 'Carte cadeau émise'; }
  else if (kind === 'manual_debit') { type = 'gift_card_manual_debit'; direction = 'neutral'; title = 'Débit manuel carte cadeau'; }
  else if (kind === 'redeem') { type = 'gift_card_usage'; direction = 'neutral'; title = 'Carte cadeau utilisée'; }
  else if (kind === 'credit') { type = 'gift_card_refund_recredit'; direction = 'neutral'; title = 'Recrédit carte cadeau'; }
  else return null;
  const giftCardId = tx.giftCardId ? String(tx.giftCardId) : null;
  return {
    id: `giftcardtx:${tx._id}`,
    type,
    direction,
    amount: roundToCents(tx.amount),
    currency: 'EUR',
    title,
    subtitle: customerName || (tx.note ? String(tx.note).slice(0, 60) : 'Carte cadeau'),
    status: 'paid',
    occurredAt: tx.createdAt ? new Date(tx.createdAt).toISOString() : null,
    customer: customerId ? { id: customerId, name: customerName } : null,
    source: { model: 'GiftCardTransaction', id: String(tx._id) },
    badges: kind === 'manual_issued' ? [{ label: 'Sur place', tone: 'success' }] : [{ label: 'Carte cadeau', tone: 'neutral' }],
    // RX2.6 — ouvre le détail finance de la carte cadeau.
    actions: [
      { kind: 'gift_card_view', enabled: Boolean(giftCardId), to: giftCardId ? `/finance/cartes-cadeaux/${giftCardId}` : null },
      { kind: 'customer_view', enabled: Boolean(customerId), to: customerId ? `/clients/${customerId}` : null },
    ],
  };
}

// RX2.6 — Anomalie de recrédit carte cadeau (rollback_needed) → mouvement neutral à traiter.
export function mapGiftCardRecreditFailedToMovement(refund, { customerName = '' } = {}) {
  if (!refund) return null;
  const customerId = refund.userId ? String(refund.userId) : null;
  return {
    id: `gcrecreditfail:${refund.refundId}`,
    type: 'gift_card_recredit_failed',
    direction: 'neutral',
    amount: roundToCents(refund.giftCardRefundAmount),
    currency: 'EUR',
    title: 'Recrédit carte cadeau à traiter',
    subtitle: `Remboursement ${refund.refundId}`,
    status: 'failed',
    occurredAt: refund.requestedAt ? new Date(refund.requestedAt).toISOString() : null,
    customer: customerId ? { id: customerId, name: customerName } : null,
    source: { model: 'RefundRequest', id: refund.refundId },
    badges: [{ label: 'À traiter', tone: 'danger' }],
    actions: [{ kind: 'refund_process', enabled: false, to: '/remboursements' }],
  };
}

export function mapCommissionPaymentToFinanceMovement(payment) {
  if (!payment) return null;
  const amount = roundToCents(payment.netAmountDue ?? payment.amount);
  if (amount <= 0) return null; // mois soldé à 0 € : pas un mouvement monétaire
  const status = commissionStatusToTimeline(payment.status);
  const label = `${MONTH_LABELS[payment.month] || ''} ${payment.year}`.trim();
  return {
    id: `commission:${payment._id}`,
    type: 'commission',
    direction: 'out',
    amount,
    currency: 'EUR',
    title: 'Commission plateforme',
    subtitle: label,
    status,
    occurredAt: (payment.paidAt || payment.periodEnd)
      ? new Date(payment.paidAt || payment.periodEnd).toISOString()
      : null,
    customer: null,
    source: { model: 'CommissionPayment', id: String(payment._id) },
    badges: [
      { label: 'Plateforme', tone: 'neutral' },
      ...(status === 'paid' ? [{ label: 'Payée', tone: 'success' }] : [{ label: 'À payer', tone: 'warning' }]),
    ],
    // RX2.5 — la card commission ouvre le détail premium (/finance/commissions/:year/:month).
    actions: [
      { kind: 'commission_view', enabled: true, to: `/finance/commissions/${payment.year}/${Number(payment.month) + 1}` },
      { kind: 'invoice_view', enabled: Boolean(payment.stripeInvoicePdfUrl), url: payment.stripeInvoicePdfUrl || null },
    ],
  };
}

export function mapInvoiceToFinanceMovement(invoice, { customerName = '' } = {}) {
  if (!invoice) return null;
  const customerId = invoice.userId ? String(invoice.userId) : null;
  const url = invoice.stripeInvoicePdfUrl || invoice.stripeHostedUrl || null;
  const status = ['paid', 'succeeded'].includes(String(invoice.status || '').toLowerCase()) ? 'paid' : 'pending';
  return {
    id: `invoice:${invoice.invoiceId || invoice._id}`,
    type: 'invoice',
    direction: 'neutral', // document lié, pas un mouvement monétaire → exclu du gross
    amount: roundToCents(invoice.totalAmount),
    currency: 'EUR',
    title: 'Facture émise',
    subtitle: `${invoice.invoiceId || '—'}${customerName ? ` · ${customerName}` : ''}`,
    status,
    occurredAt: (invoice.invoiceDate || invoice.createdAt)
      ? new Date(invoice.invoiceDate || invoice.createdAt).toISOString()
      : null,
    customer: customerId ? { id: customerId, name: customerName } : null,
    source: { model: 'Invoice', id: invoice.invoiceId || String(invoice._id) },
    badges: invoice.official ? [{ label: 'Officielle', tone: 'success' }] : [{ label: 'Reçu', tone: 'neutral' }],
    actions: [{ kind: 'invoice_view', enabled: Boolean(url), url }],
  };
}

// ── Résolution des noms (un seul batch User + un seul batch Service) ────────────────
async function resolveUserNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select('firstName lastName email').lean();
  return new Map(users.map((u) => [String(u._id), personName(u)]));
}
async function resolveServiceNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const services = await Service.find({ _id: { $in: unique } }).select('name').lean();
  return new Map(services.map((s) => [String(s._id), s.name || '']));
}

function dateRangeQuery(field, dateFrom, dateTo) {
  const range = {};
  if (dateFrom) range.$gte = dateFrom;
  if (dateTo) range.$lt = dateTo;
  return Object.keys(range).length ? { [field]: range } : {};
}

/**
 * Construit la timeline financière + le résumé.
 * @param {{ dateFrom?: Date|null, dateTo?: Date|null, type?: string, status?: string, limit?: number, now?: Date }} opts
 */
export async function buildFinanceTimeline({ dateFrom = null, dateTo = null, type = 'all', status = '', limit = 50, now = new Date() } = {}) {
  const wantedTypes = typesForFilter(type);
  const wants = (movementType) => !wantedTypes || wantedTypes.includes(movementType);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const movements = [];

  // ── Sales (+ deposit detection + invoice link) ──
  if (wants('sale') || wants('deposit')) {
    const sales = await Sale.find(dateRangeQuery('createdAt', dateFrom, dateTo))
      .sort({ createdAt: -1 }).limit(SOURCE_QUERY_CAP).lean();
    const saleIds = sales.map((s) => s.saleId).filter(Boolean);
    // Quelles ventes sont des acomptes ? (Sale lié à un booking paymentType=deposit)
    const depositBookings = saleIds.length
      ? await ServiceBooking.find({ saleId: { $in: saleIds }, paymentType: 'deposit' }).select('saleId').lean()
      : [];
    const depositSaleIds = new Set(depositBookings.map((b) => String(b.saleId)));
    // Facture officielle liée (pour le lien invoice_view ; pas une ligne).
    const invoices = saleIds.length
      ? await Invoice.find({ saleId: { $in: saleIds }, official: true }).select('saleId stripeInvoicePdfUrl stripeHostedUrl').lean()
      : [];
    const invoiceUrlBySale = new Map(invoices.map((i) => [String(i.saleId), i.stripeInvoicePdfUrl || i.stripeHostedUrl || null]));
    for (const sale of sales) {
      const isDeposit = depositSaleIds.has(String(sale.saleId));
      if (isDeposit ? !wants('deposit') : !wants('sale')) continue;
      const customerName = personName(sale.customer);
      movements.push(mapSaleToFinanceMovement(sale, {
        isDeposit, customerName, invoiceUrl: invoiceUrlBySale.get(String(sale.saleId)) || null,
      }));
    }
  }

  // ── Booking balances (due / paid) ──
  if (wants('balance_due') || wants('balance_paid')) {
    // RX2.4 — dû sur place (filtre unifié) OU déjà encaissé sur place.
    const bookingFilter = {
      $or: [
        ONSITE_DUE_BOOKING_FILTER,
        { balancePaidAt: { $ne: null } },
      ],
    };
    const bookings = await ServiceBooking.find(bookingFilter).sort({ updatedAt: -1 }).limit(SOURCE_QUERY_CAP).lean();
    const userNames = await resolveUserNames(bookings.map((b) => b.clientId));
    const serviceNames = await resolveServiceNames(bookings.map((b) => b.serviceId));
    for (const booking of bookings) {
      const movement = mapBookingBalanceToFinanceMovement(booking, {
        customerName: userNames.get(String(booking.clientId)) || '',
        serviceName: serviceNames.get(String(booking.serviceId)) || '',
      });
      if (!movement) continue;
      if (!wants(movement.type)) continue;
      // Filtre fenêtre sur occurredAt (balance_due = createdAt, balance_paid = balancePaidAt).
      if (!withinWindow(movement.occurredAt, dateFrom, dateTo)) continue;
      movements.push(movement);
    }
  }

  // ── Refunds ──
  if (wants('refund')) {
    const refunds = await RefundRequest.find(dateRangeQuery('requestedAt', dateFrom, dateTo))
      .sort({ requestedAt: -1 }).limit(SOURCE_QUERY_CAP).lean();
    const userNames = await resolveUserNames(refunds.map((r) => r.userId));
    for (const refund of refunds) {
      movements.push(mapRefundToFinanceMovement(refund, { customerName: userNames.get(String(refund.userId)) || '' }));
    }
  }

  // ── Gift card transactions (manual_issued / redeem / manual_debit / credit) ──
  if (wants('gift_card_issue') || wants('gift_card_usage') || wants('gift_card_manual_debit') || wants('gift_card_refund_recredit')) {
    const txs = await GiftCardTransaction.find({
      transactionType: { $in: ['manual_issued', 'redeem', 'manual_debit', 'credit'] },
      ...dateRangeQuery('createdAt', dateFrom, dateTo),
    }).sort({ createdAt: -1 }).limit(SOURCE_QUERY_CAP).lean();
    const userNames = await resolveUserNames(txs.map((t) => t.userId));
    for (const tx of txs) {
      const movement = mapGiftCardTransactionToFinanceMovement(tx, { customerName: userNames.get(String(tx.userId)) || '' });
      if (movement && wants(movement.type)) movements.push(movement);
    }
  }

  // ── Gift card recredit failures (rollback_needed) — anomalies à traiter ──
  if (wants('gift_card_recredit_failed')) {
    const rollbacks = await RefundRequest.find({
      giftCardRefundStatus: 'rollback_needed',
      ...dateRangeQuery('requestedAt', dateFrom, dateTo),
    }).sort({ requestedAt: -1 }).limit(SOURCE_QUERY_CAP).lean();
    const userNames = await resolveUserNames(rollbacks.map((r) => r.userId));
    for (const refund of rollbacks) {
      movements.push(mapGiftCardRecreditFailedToMovement(refund, { customerName: userNames.get(String(refund.userId)) || '' }));
    }
  }

  // ── Commission payments ──
  if (wants('commission')) {
    const payments = await CommissionPayment.find({}).sort({ year: -1, month: -1 }).limit(SOURCE_QUERY_CAP).lean();
    for (const payment of payments) {
      const movement = mapCommissionPaymentToFinanceMovement(payment);
      if (movement && withinWindow(movement.occurredAt, dateFrom, dateTo)) movements.push(movement);
    }
  }

  // ── Invoices : UNIQUEMENT si l'utilisateur filtre explicitement type=invoice (anti double-count). ──
  if (type === 'invoice') {
    const invoices = await Invoice.find({ official: true, ...dateRangeQuery('invoiceDate', dateFrom, dateTo) })
      .sort({ invoiceDate: -1 }).limit(SOURCE_QUERY_CAP).lean();
    const userNames = await resolveUserNames(invoices.map((i) => i.userId));
    for (const invoice of invoices) {
      movements.push(mapInvoiceToFinanceMovement(invoice, { customerName: userNames.get(String(invoice.userId)) || '' }));
    }
  }

  // Filtre statut (V1) + nettoyage des nulls.
  const wantStatus = String(status || '').trim().toLowerCase();
  let filtered = movements.filter(Boolean);
  if (wantStatus) filtered = filtered.filter((m) => m.status === wantStatus);

  // Tri desc par occurredAt (nulls en dernier).
  filtered.sort((a, b) => {
    const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return tb - ta;
  });

  // Summary calculé sur TOUT l'ensemble filtré (avant limit).
  const summary = computeSummary(filtered);

  return { summary, items: filtered.slice(0, safeLimit) };
}

function withinWindow(iso, dateFrom, dateTo) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  if (dateFrom && t < dateFrom.getTime()) return false;
  if (dateTo && t >= dateTo.getTime()) return false;
  return true;
}

export function computeSummary(items) {
  let grossIn = 0; let grossOut = 0; let balanceDueAmount = 0; let refundCount = 0;
  for (const m of items) {
    if (m.direction === 'in') grossIn += m.amount;
    else if (m.direction === 'out') grossOut += m.amount;
    if (m.type === 'balance_due') balanceDueAmount += m.amount;
    if (m.type === 'refund') refundCount += 1;
  }
  return {
    netAmount: roundToCents(grossIn - grossOut),
    grossIn: roundToCents(grossIn),
    grossOut: roundToCents(grossOut),
    count: items.length,
    refundCount,
    balanceDueAmount: roundToCents(balanceDueAmount),
  };
}

// Exporté pour réutilisation/labels éventuels.
export { money };
