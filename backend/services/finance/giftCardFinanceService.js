// RX2.6 — Gift Card Finance : la carte cadeau comme cycle de vie financier complet (lecture, admin/dev).
// Le backend fait AUTORITÉ. Règles :
//   • aucun montant inventé (tout vient du ledger GiftCardTransaction / RefundRequest) ;
//   • JAMAIS le code/mot de passe complet ni le token QR (masqués) ;
//   • AUCUNE mention d'expiration (règle produit RX2.6) ;
//   • carte cadeau utilisée = moyen de paiement (jamais une remise).
// (cf. docs/RX2_6_GIFT_CARD_FINANCE_AUDIT.md)
import GiftCard from '../../models/GiftCard.js';
import GiftCardTransaction from '../../models/GiftCardTransaction.js';
import RefundRequest from '../../models/RefundRequest.js';
import Sale from '../../models/Sale.js';
import Invoice from '../../models/Invoice.js';
import User from '../../models/user.js';

const LIST_CAP = 500;

function roundToCents(v) {
  const n = Number.isFinite(Number(v)) ? Number(v) : 0;
  return Math.round(n * 100) / 100;
}
function maskCode(code) {
  const c = String(code || '');
  if (!c) return '••••';
  return `••••${c.slice(-4)}`;
}
function personName(user) {
  if (!user) return '';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.email || '';
}
function iso(d) {
  if (!d) return null;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── Source de paiement ──────────────────────────────────────────────────────────────
export function resolveGiftCardPaymentSource(giftCard, { invoice = null } = {}) {
  const mode = giftCard.paymentMode === 'on_site' || giftCard.creationMode === 'manual_institute'
    ? 'on_site'
    : giftCard.paymentMode === 'stripe' || giftCard.creationMode === 'online'
      ? 'stripe'
      : 'unknown';
  const label = giftCard.paymentLabel
    || (mode === 'stripe' ? 'Stripe' : mode === 'on_site' ? 'Paiement sur place' : 'Inconnu');
  return {
    mode,
    label,
    invoice: invoice ? { invoiceId: invoice.invoiceId || null, pdfUrl: invoice.stripeInvoicePdfUrl || invoice.stripeHostedUrl || null } : null,
    sale: giftCard.saleId ? { saleId: giftCard.saleId } : null,
  };
}

// ── Acteurs (acheteur / bénéficiaire) ──────────────────────────────────────────────
export function resolveGiftCardActors(giftCard, { owner = null, buyer = null } = {}) {
  const ownerId = giftCard.userId ? String(giftCard.userId) : null;
  const purchaserName = giftCard.purchaserName || personName(buyer) || '';
  const recipientName = giftCard.recipientName || personName(owner) || '';
  return {
    purchaser: { name: purchaserName || 'Inconnu', id: buyer?._id ? String(buyer._id) : null },
    recipient: { name: recipientName || 'Titulaire', id: ownerId },
  };
}

// ── Mapping transaction ─────────────────────────────────────────────────────────────
const TX_TITLE = {
  manual_issued: 'Émission (paiement sur place)',
  redeem: 'Carte cadeau utilisée',
  manual_debit: 'Débit manuel',
  credit: 'Recrédit remboursement',
};
export function mapGiftCardTransaction(tx) {
  if (!tx) return null;
  const inflow = tx.transactionType === 'credit' || tx.transactionType === 'manual_issued';
  return {
    id: String(tx._id),
    type: tx.transactionType,
    title: TX_TITLE[tx.transactionType] || 'Mouvement',
    amount: roundToCents(inflow ? tx.amount : -tx.amount),
    balanceBefore: roundToCents(tx.balanceBefore),
    balanceAfter: roundToCents(tx.balanceAfter),
    occurredAt: iso(tx.createdAt),
    note: tx.note ? String(tx.note).slice(0, 140) : '',
    saleId: tx.saleId || null,
    actorRole: tx.actorRole || null,
    source: tx.source || null,
  };
}

// ── Mapping refund split ────────────────────────────────────────────────────────────
export function mapGiftCardRefund(refund) {
  if (!refund) return null;
  const gcStatus = refund.giftCardRefundStatus || 'not_applicable';
  const recovered = refund.giftCardRecredited === true && Number(refund.giftCardRecreditAttempts || 0) > 1;
  return {
    refundId: refund.refundId,
    saleId: refund.saleId || null,
    amount: roundToCents(refund.amount),
    stripeRefundAmount: roundToCents(refund.stripeRefundAmount),
    giftCardRefundAmount: roundToCents(refund.giftCardRefundAmount),
    giftCardRefundStatus: gcStatus,
    status: gcStatus === 'not_applicable' ? (refund.status || 'pending') : gcStatus,
    recovered,
    isSplit: Number(refund.stripeRefundAmount || 0) > 0 && Number(refund.giftCardRefundAmount || 0) > 0,
    creditNoteUrl: refund.creditNotePdfUrl || null,
    occurredAt: iso(refund.refundedAt || refund.requestedAt),
  };
}

// ── Lifecycle (chronologique, lisible) ──────────────────────────────────────────────
export function buildGiftCardLifecycle(giftCard, transactions, refunds) {
  const items = [];
  const isManual = giftCard.creationMode === 'manual_institute';
  items.push({
    type: 'created',
    title: isManual ? 'Carte cadeau créée (paiement sur place)' : 'Carte cadeau créée',
    subtitle: isManual ? (giftCard.manualPaymentMethod ? `Réglé en ${giftCard.manualPaymentMethod}` : 'Paiement sur place') : 'Achat en ligne',
    amount: roundToCents(giftCard.amount),
    balanceAfter: roundToCents(giftCard.amount),
    occurredAt: iso(giftCard.purchasedAt),
    status: 'success',
    source: { mode: isManual ? 'on_site' : 'stripe' },
  });
  if (giftCard.recipientName) {
    items.push({ type: 'offered', title: `Offerte à ${giftCard.recipientName}`, subtitle: giftCard.purchaserName ? `de la part de ${giftCard.purchaserName}` : '', amount: null, balanceAfter: null, occurredAt: iso(giftCard.purchasedAt), status: 'neutral', source: {} });
  }
  if (giftCard.qrTokenHash) items.push({ type: 'qr_generated', title: 'QR code généré', amount: null, balanceAfter: null, occurredAt: iso(giftCard.purchasedAt), status: 'neutral', source: {} });
  if (giftCard.generatedPdfUrl) items.push({ type: 'pdf_generated', title: 'Carte PDF générée', amount: null, balanceAfter: null, occurredAt: iso(giftCard.purchasedAt), status: 'neutral', source: {} });

  for (const tx of transactions) {
    if (tx.type === 'manual_issued') continue; // = création (déjà couverte)
    if (tx.type === 'redeem') items.push({ type: 'used', title: 'Carte cadeau utilisée', subtitle: 'Moyen de paiement', amount: tx.amount, balanceAfter: tx.balanceAfter, occurredAt: tx.occurredAt, status: 'neutral', source: { saleId: tx.saleId } });
    else if (tx.type === 'manual_debit') items.push({ type: 'manual_debit', title: 'Débit manuel', subtitle: tx.note || '', amount: tx.amount, balanceAfter: tx.balanceAfter, occurredAt: tx.occurredAt, status: 'warning', source: {} });
    else if (tx.type === 'credit') items.push({ type: 'refund_recredit', title: 'Recrédit remboursement', amount: tx.amount, balanceAfter: tx.balanceAfter, occurredAt: tx.occurredAt, status: 'success', source: { saleId: tx.saleId } });
  }

  for (const r of refunds) {
    if (r.giftCardRefundStatus === 'rollback_needed') {
      items.push({ type: 'rollback_needed', title: 'Recrédit carte cadeau à traiter', subtitle: `Remboursement ${r.refundId}`, amount: r.giftCardRefundAmount, balanceAfter: null, occurredAt: r.occurredAt, status: 'danger', source: { refundId: r.refundId } });
    } else if (r.giftCardRefundStatus === 'failed') {
      items.push({ type: 'refund_recredit_failed', title: 'Échec de recrédit', subtitle: `Remboursement ${r.refundId}`, amount: r.giftCardRefundAmount, balanceAfter: null, occurredAt: r.occurredAt, status: 'danger', source: { refundId: r.refundId } });
    }
  }

  items.sort((a, b) => {
    const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return ta - tb; // chronologique (cycle de vie)
  });
  return items;
}

// ── Transactions & refunds ──────────────────────────────────────────────────────────
export async function buildGiftCardTransactionTimeline(giftCard) {
  const txs = await GiftCardTransaction.find({ giftCardId: giftCard._id }).sort({ createdAt: -1 }).limit(LIST_CAP).lean();
  return txs.map(mapGiftCardTransaction).filter(Boolean);
}

export async function buildGiftCardRefundTimeline(giftCard) {
  // Ventes où cette carte a été utilisée + saleId des recrédits (credit).
  const usageSales = await Sale.find({ 'giftCardUsage.giftCardId': giftCard._id }).select('saleId').lean();
  const creditTxs = await GiftCardTransaction.find({ giftCardId: giftCard._id, transactionType: 'credit' }).select('saleId').lean();
  const saleIds = [...new Set([
    ...usageSales.map((s) => s.saleId),
    ...creditTxs.map((t) => t.saleId),
  ].filter(Boolean))];
  if (!saleIds.length) return [];
  const refunds = await RefundRequest.find({
    saleId: { $in: saleIds },
    $or: [{ giftCardRefundAmount: { $gt: 0 } }, { giftCardRefundStatus: { $ne: 'not_applicable' } }],
  }).sort({ requestedAt: -1 }).lean();
  return refunds.map(mapGiftCardRefund).filter(Boolean);
}

// ── Détail ──────────────────────────────────────────────────────────────────────────
export async function getGiftCardFinanceDetail(giftCardId) {
  const giftCard = await GiftCard.findById(giftCardId).lean();
  if (!giftCard) return null;

  const [owner, sale, transactions] = await Promise.all([
    giftCard.userId ? User.findById(giftCard.userId).select('firstName lastName email').lean() : null,
    giftCard.saleId ? Sale.findOne({ saleId: giftCard.saleId }).select('saleId userId customer').lean() : null,
    buildGiftCardTransactionTimeline(giftCard),
  ]);
  const buyer = sale
    ? (sale.customer && (sale.customer.firstName || sale.customer.lastName || sale.customer.email)
        ? { firstName: sale.customer.firstName, lastName: sale.customer.lastName, email: sale.customer.email }
        : (sale.userId ? await User.findById(sale.userId).select('firstName lastName email').lean() : null))
    : null;
  const invoice = giftCard.saleId ? await Invoice.findOne({ saleId: giftCard.saleId, official: true }).select('invoiceId stripeInvoicePdfUrl stripeHostedUrl').lean() : null;
  const refunds = await buildGiftCardRefundTimeline(giftCard);
  const lifecycle = buildGiftCardLifecycle(giftCard, transactions, refunds);

  const ownerId = giftCard.userId ? String(giftCard.userId) : null;
  const invoiceUrl = invoice ? (invoice.stripeInvoicePdfUrl || invoice.stripeHostedUrl || null) : null;

  return {
    giftCard: {
      id: String(giftCard._id),
      maskedCode: maskCode(giftCard.code),
      status: giftCard.status,
      creationMode: giftCard.creationMode || 'online',
      paymentMode: giftCard.paymentMode || 'stripe',
      paymentLabel: giftCard.paymentLabel || null,
      message: giftCard.message || null,
      purchasedAt: iso(giftCard.purchasedAt),
    },
    actors: resolveGiftCardActors(giftCard, { owner, buyer }),
    paymentSource: resolveGiftCardPaymentSource(giftCard, { invoice }),
    currentBalance: {
      amount: roundToCents(giftCard.amount),
      balance: roundToCents(giftCard.balance),
      reserved: roundToCents(giftCard.reservedAmount),
      available: roundToCents(Number(giftCard.balance || 0) - Number(giftCard.reservedAmount || 0)),
      status: giftCard.status,
    },
    lifecycle,
    transactions,
    refunds,
    qr: { available: Boolean(giftCard.qrTokenHash), maskedToken: giftCard.qrTokenHash ? '••••' : null },
    actions: [
      { kind: 'customer_view', enabled: Boolean(ownerId), to: ownerId ? `/clients/${ownerId}` : null },
      { kind: 'gift_card_debit', enabled: giftCard.status === 'active' && Boolean(ownerId), to: ownerId ? `/clients/${ownerId}` : null },
      { kind: 'invoice_view', enabled: Boolean(invoiceUrl), url: invoiceUrl },
    ],
  };
}

// ── Liste + summary ─────────────────────────────────────────────────────────────────
export async function listGiftCardFinanceCards(filters = {}) {
  const query = {};
  if (filters.creationMode === 'online' || filters.creationMode === 'manual_institute') query.creationMode = filters.creationMode;
  if (filters.status === 'active' || filters.status === 'redeemed') query.status = filters.status;
  const search = String(filters.search || '').trim();
  if (search) {
    query.$or = [
      { recipientName: { $regex: search, $options: 'i' } },
      { purchaserName: { $regex: search, $options: 'i' } },
    ];
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 200);
  const cards = await GiftCard.find(query).sort({ purchasedAt: -1 }).limit(limit).lean();

  const cardsView = cards.map((c) => ({
    id: String(c._id),
    maskedCode: maskCode(c.code),
    amount: roundToCents(c.amount),
    balance: roundToCents(c.balance),
    status: c.status,
    creationMode: c.creationMode || 'online',
    paymentMode: c.paymentMode || 'stripe',
    paymentLabel: c.paymentLabel || (c.paymentMode === 'on_site' || c.creationMode === 'manual_institute' ? 'Paiement sur place' : 'Stripe'),
    purchaserName: c.purchaserName || null,
    recipientName: c.recipientName || null,
    purchasedAt: iso(c.purchasedAt),
  }));

  // Summary (agrégats globaux, indépendants du filtre de liste).
  const [allCards, redeemAgg, manualDebitAgg] = await Promise.all([
    GiftCard.find({}).select('amount balance status').lean(),
    GiftCardTransaction.aggregate([{ $match: { transactionType: 'redeem' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    GiftCardTransaction.aggregate([{ $match: { transactionType: 'manual_debit' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);
  const issuedAmount = roundToCents(allCards.reduce((s, c) => s + Number(c.amount || 0), 0));
  const activeBalanceAmount = roundToCents(allCards.filter((c) => c.status === 'active').reduce((s, c) => s + Number(c.balance || 0), 0));
  const usedAmount = roundToCents(redeemAgg[0]?.total || 0);
  const manualDebitAmount = roundToCents(manualDebitAgg[0]?.total || 0);

  return {
    summary: { activeBalanceAmount, issuedAmount, usedAmount, manualDebitAmount, count: allCards.length },
    cards: cardsView,
  };
}
