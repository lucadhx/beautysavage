// services/customer360/customer360Mapper.js
// M12 — Sérialisation SAFE de la fiche Customer 360. Règle de confidentialité : on expose l'identité
// du CLIENT consulté (sa propre fiche), jamais de secret/PII technique (passwordHash, passwordSalt,
// sessionTokenHash, stripeCustomerId, giftCard.passwordHash, recipientHash brut, e-mail d'autrui).
// Endpoint admin/dev only. Aucun modèle modifié.

function roundCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function idStr(value) {
  return value === null || value === undefined ? null : String(value?._id || value);
}

function fullName(firstName, lastName, fallback = '') {
  const n = `${firstName || ''} ${lastName || ''}`.trim();
  return n || fallback;
}

/** Identité client SAFE (jamais de hash/secret). */
export function mapCustomerIdentity(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    displayName: fullName(user.firstName, user.lastName, user.email || '—'),
    email: user.email || '',
    // Champs absents du modèle User → exposés null (non disponibles).
    phone: user.phone || null,
    photo: user.photo || null,
    createdAt: user.createdAt || null,
    lastLogin: user.lastLogin || null,
    isActive: user.isActive !== false,
    bookingSuspended: Boolean(user.bookingSuspended)
  };
}

export function mapSale(sale) {
  return {
    id: sale.saleId,
    saleId: sale.saleId,
    createdAt: sale.createdAt || sale.date_achat || null,
    totalAmount: roundCents(sale.totalAmount),
    itemCount: Number(sale.itemCount || (Array.isArray(sale.items) ? sale.items.length : 0)),
    refundStatus: sale.refundStatus || null,
    refundAmount: roundCents(sale.refundAmount),
    items: Array.isArray(sale.items)
      ? sale.items.map(it => ({
          type: it.type || '',
          itemId: idStr(it.itemId),
          name: it.name || '',
          finalPrice: roundCents(it.finalPrice ?? it.price),
          promotionApplied: Boolean(it.promotionApplied)
        }))
      : [],
    giftCardUsage: Array.isArray(sale.giftCardUsage)
      ? sale.giftCardUsage.map(g => ({ code: g.code || '', amountUsed: roundCents(g.amountUsed) }))
      : []
  };
}

export function mapBooking(booking, serviceNameById = new Map()) {
  const serviceName = booking.serviceId?.name || serviceNameById.get(idStr(booking.serviceId)) || 'Prestation';
  const isDeposit = booking.paymentType === 'deposit';
  return {
    id: booking.bookingId || String(booking._id),
    bookingId: booking.bookingId || '',
    serviceName,
    startAt: booking.startAt || null,
    endAt: booking.endAt || null,
    status: booking.status || '',
    paymentType: booking.paymentType || '',
    paymentStatus: booking.paymentStatus || '',
    totalPrice: roundCents(booking.totalPrice),
    depositAmount: roundCents(booking.depositAmount),
    balanceDueAmount: roundCents(booking.balanceDueAmount),
    balanceSettlementMode: booking.balanceSettlementMode || null,
    isDeposit,
    saleId: booking.saleId || null,
    cancelledAt: booking.cancelledAt || null,
    cancelledBy: booking.cancelledBy || null
  };
}

export function mapFormation(purchase, formationById = new Map(), progressByFormation = new Map(), attendanceBySession = new Map()) {
  const fid = idStr(purchase.formationId || purchase.itemId);
  const f = formationById.get(fid);
  // C2 — enrichissement learning (SAFE : aucun token QR ni secret exposé).
  const prog = progressByFormation.get(fid);
  const completedCount = prog ? (prog.completedLessonIds || []).filter(Boolean).length : 0;
  const att = purchase.sessionId ? attendanceBySession.get(idStr(purchase.sessionId)) : null;
  return {
    id: String(purchase._id),
    formationId: fid,
    name: f?.name || 'Formation',
    type: f?.type || null,
    sessionId: idStr(purchase.sessionId),
    participationStatus: purchase.participationStatus || 'active',
    acquiredAt: purchase.createdAt || null,
    startedAt: prog?.startedAt || null,
    completedAt: prog?.completedAt || null,
    completedLessons: completedCount,
    lastLessonId: prog?.lastLessonId ? String(prog.lastLessonId) : null,
    attendanceStatus: att?.status || null,
    attendanceAt: att?.checkedInAt || null
  };
}

export function mapProduct(purchase, productById = new Map()) {
  const p = productById.get(idStr(purchase.itemId));
  return {
    id: String(purchase._id),
    productId: idStr(purchase.itemId),
    name: p?.name || 'Produit',
    acquiredAt: purchase.createdAt || null
  };
}

export function mapGiftCard(card) {
  return {
    id: String(card._id),
    code: card.code || '',
    amount: roundCents(card.amount),
    balance: roundCents(card.balance),
    status: card.status || 'active',
    purchasedAt: card.purchasedAt || card.createdAt || null
  };
}

export function mapRefund(refund) {
  return {
    id: refund.refundId || String(refund._id),
    refundId: refund.refundId || '',
    saleId: refund.saleId || '',
    itemType: refund.itemType || '',
    amount: roundCents(refund.amount),
    status: refund.status || '',
    eligibleRefund: Boolean(refund.eligibleRefund),
    requestedAt: refund.requestedAt || null,
    refundedAt: refund.refundedAt || null,
    hasCreditNote: Boolean(refund.creditNotePdfUrl)
  };
}

export function mapInvoice(invoice) {
  return {
    id: String(invoice._id),
    invoiceId: invoice.invoiceId || invoice.invoiceNumber || invoice.stripeInvoiceNumber || '',
    saleId: invoice.saleId || '',
    status: invoice.status || '',
    official: Boolean(invoice.official),
    documentKind: invoice.documentKind || 'internal_snapshot',
    totalAmount: roundCents(invoice.totalAmount),
    invoiceDate: invoice.invoiceDate || invoice.createdAt || null,
    pdfUrl: invoice.stripeInvoicePdfUrl || (invoice.saleId ? `/api/gestion/sales/${encodeURIComponent(invoice.saleId)}/invoice` : null)
  };
}

/** Communications = SendLog. JAMAIS l'e-mail ni le recipientHash brut. */
export function mapCommunication(sendLog) {
  return {
    id: String(sendLog._id),
    channel: sendLog.channel || 'email',
    templateKey: sendLog.templateKey || '',
    subject: sendLog.subject || '',
    status: sendLog.status || '',
    sentAt: sendLog.sentAt || sendLog.createdAt || null,
    contextType: sendLog.contextType || null
  };
}

/** Notifications STAFF corrélées au client (jamais variablesSnapshot/PII brute). */
export function mapNotification(notification) {
  return {
    id: notification.notificationId || String(notification._id),
    title: notification.title || '',
    category: notification.categorySnapshot?.name || notification.category || 'système',
    icon: notification.categorySnapshot?.icon || null,
    priority: notification.priority || 'normal',
    eventName: notification.eventName || notification.eventType || null,
    createdAt: notification.createdAt || null
  };
}

/** Documents = factures + avoirs + consentements signés (snapshots), tous SAFE. */
export function buildDocuments({ invoices = [], refunds = [], sales = [] }) {
  const docs = [];
  for (const inv of invoices) {
    const m = mapInvoice(inv);
    docs.push({
      id: `invoice-${m.id}`,
      kind: m.official ? 'invoice_official' : (m.documentKind === 'gift_card_usage_receipt' ? 'gift_card_receipt' : 'invoice_internal'),
      label: m.official ? `Facture ${m.invoiceId || ''}`.trim() : `Reçu ${m.invoiceId || ''}`.trim(),
      date: m.invoiceDate,
      url: m.pdfUrl,
      amount: m.totalAmount
    });
  }
  for (const r of refunds) {
    if (r.creditNotePdfUrl) {
      docs.push({
        id: `creditnote-${r.refundId || r._id}`,
        kind: 'credit_note',
        label: `Avoir ${r.creditNoteId || r.refundId || ''}`.trim(),
        date: r.refundedAt || r.requestedAt || null,
        url: r.creditNotePdfUrl,
        amount: roundCents(r.amount)
      });
    }
  }
  for (const sale of sales) {
    const snap = sale.legalConsentSnapshot;
    const accepted = snap && (snap.cgvAccepted || snap.withdrawalWaiverAccepted || snap.serviceDatedAcknowledged);
    if (accepted) {
      docs.push({
        id: `consent-${sale.saleId}`,
        kind: 'signed_consent',
        label: 'Consentement signé',
        date: snap.cgvAcceptedAt || sale.createdAt || null,
        url: null,
        amount: null
      });
    }
  }
  docs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return docs;
}

/** Résumé / KPIs. */
export function buildSummary({ customer, sales = [], bookings = [], formations = [], products = [], giftCards = [], refunds = [], timeline = [] }) {
  const now = Date.now();
  const upcoming = bookings.filter(
    b => b.startAt && new Date(b.startAt).getTime() > now && !['cancelled', 'no_show'].includes(b.status)
  );
  const totalSpent = roundCents(sales.reduce((s, x) => s + Number(x.totalAmount || 0), 0));
  const totalHT = roundCents(
    sales.reduce((s, x) => s + Number(x.taxSnapshot?.totalExcludingTax ?? x.totalAmount ?? 0), 0)
  );
  const lastActivity = timeline.length ? timeline[0].date : (customer?.lastLogin || customer?.createdAt || null);
  const status = customer?.bookingSuspended ? 'suspended' : (customer?.isActive === false ? 'inactive' : 'active');
  return {
    customerId: customer ? String(customer._id) : null,
    displayName: fullName(customer?.firstName, customer?.lastName, customer?.email || '—'),
    firstName: customer?.firstName || '',
    lastName: customer?.lastName || '',
    email: customer?.email || '',
    phone: customer?.phone || null,
    photo: customer?.photo || null,
    createdAt: customer?.createdAt || null,
    status,
    kpis: {
      salesCount: sales.length,
      totalSpent,
      totalHT,
      servicesCount: bookings.length,
      formationsCount: formations.length,
      productsCount: products.length,
      giftCardsCount: giftCards.length,
      refundsCount: refunds.length,
      upcomingBookingsCount: upcoming.length
    },
    nextBooking: upcoming.length
      ? (() => {
          const sorted = [...upcoming].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
          return { bookingId: sorted[0].bookingId, serviceName: sorted[0].serviceName, startAt: sorted[0].startAt };
        })()
      : null,
    lastActivity
  };
}

/** Carte financière. */
export function buildFinancial({ sales = [], bookings = [], giftCards = [], refunds = [], invoices = [] }) {
  const totalSpent = roundCents(sales.reduce((s, x) => s + Number(x.totalAmount || 0), 0));
  const depositsPaid = roundCents(
    bookings.filter(b => b.isDeposit).reduce((s, b) => s + Number(b.depositAmount || 0), 0)
  );
  const balanceDue = roundCents(bookings.reduce((s, b) => s + Number(b.balanceDueAmount || 0), 0));
  const pendingBalances = bookings
    .filter(b => Number(b.balanceDueAmount || 0) > 0)
    .map(b => ({ bookingId: b.bookingId, serviceName: b.serviceName, balanceDueAmount: roundCents(b.balanceDueAmount), startAt: b.startAt }));
  const giftCardsBalance = roundCents(
    giftCards.filter(c => c.status === 'active').reduce((s, c) => s + Number(c.balance || 0), 0)
  );
  const refundsTotal = roundCents(
    refunds.filter(r => r.refundedAt || r.status === 'succeeded' || r.status === 'refunded').reduce((s, r) => s + Number(r.amount || 0), 0)
  );
  const sortedInvoices = [...invoices].sort((a, b) => new Date(b.invoiceDate || 0) - new Date(a.invoiceDate || 0));
  const lastInvoice = sortedInvoices.length ? mapInvoice(sortedInvoices[0]) : null;
  const unpaidInvoices = invoices
    .filter(i => i.official === true && i.status && !['paid', 'succeeded'].includes(String(i.status).toLowerCase()))
    .map(mapInvoice);
  return {
    totalSpent,
    depositsPaid,
    balanceDue,
    pendingBalances,
    giftCardsBalance,
    giftCardsCount: giftCards.length,
    refundsTotal,
    refundsCount: refunds.length,
    lastInvoice,
    unpaidInvoicesCount: unpaidInvoices.length,
    unpaidInvoices
  };
}

export default {
  mapCustomerIdentity,
  mapSale,
  mapBooking,
  mapFormation,
  mapProduct,
  mapGiftCard,
  mapRefund,
  mapInvoice,
  mapCommunication,
  mapNotification,
  buildDocuments,
  buildSummary,
  buildFinancial
};
