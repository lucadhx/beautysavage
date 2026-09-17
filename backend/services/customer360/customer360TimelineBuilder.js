// services/customer360/customer360TimelineBuilder.js
// M12 — Construit la timeline chronologique fusionnée d'un client (vérité historique). Fusionne les
// entités du domaine + un sous-ensemble curé d'EventLog. Chaque item : { id, date, type, icon, title,
// subtitle, action }. Tri décroissant (plus récent d'abord), borné (cap).

const TIMELINE_CAP = 200;

function dateOf(v) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}
function money(n) {
  return `${Number(n || 0).toFixed(2).replace('.', ',')} €`;
}
function fmtDateFR(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// EventLog → timeline (sous-ensemble curé pour éviter le bruit ; les autres événements sont déjà
// représentés par les entités).
const EVENT_TIMELINE_MAP = {
  'booking.balance_paid_on_site': { type: 'solde_paye', icon: 'bi-cash-stack', title: 'Solde payé sur place' },
  'booking.rescheduled': { type: 'report', icon: 'bi-arrow-left-right', title: 'Créneau reporté' },
  'booking.no_show_marked': { type: 'annulation', icon: 'bi-person-x', title: 'Absence (no-show)' },
  'sale.zero_payment_finalized': { type: 'paiement', icon: 'bi-gift', title: 'Commande réglée (carte cadeau)' },
  // C2 — Learning timeline.
  'formation.started': { type: 'formation_start', icon: 'bi-play-circle', title: 'Formation commencée' },
  'formation.completed': { type: 'formation_done', icon: 'bi-patch-check', title: 'Formation terminée' },
  'formation.attendance_validated': { type: 'presence', icon: 'bi-qr-code-scan', title: 'Présence validée (QR)' }
};

/**
 * @param {{ sales, bookings, formations, products, giftCards, refunds, invoices, communications,
 *           notifications, eventLogs }} data — tableaux DÉJÀ mappés (sauf eventLogs = bruts SAFE).
 * @returns {Array} timeline triée desc, cap TIMELINE_CAP.
 */
export function buildCustomerTimeline(data = {}) {
  const {
    sales = [], bookings = [], formations = [], products = [], giftCards = [],
    refunds = [], invoices = [], communications = [], notifications = [], eventLogs = []
  } = data;
  const items = [];

  for (const s of sales) {
    items.push({
      id: `sale-${s.saleId}`, date: s.createdAt, type: 'achat', icon: 'bi-bag-check',
      title: `Achat ${money(s.totalAmount)}`,
      subtitle: `${s.itemCount} article(s)${s.giftCardUsage?.length ? ' · carte cadeau' : ''}`,
      action: 'view_sale', refId: s.saleId
    });
  }
  for (const b of bookings) {
    if (b.status === 'cancelled') {
      items.push({
        id: `booking-cancel-${b.id}`, date: b.cancelledAt || b.startAt, type: 'annulation', icon: 'bi-calendar-x',
        title: 'Réservation annulée', subtitle: `${b.serviceName} · ${fmtDateFR(b.startAt)}`,
        action: 'view_booking', refId: b.bookingId
      });
    } else {
      items.push({
        id: `booking-${b.id}`, date: b.startAt, type: 'reservation', icon: 'bi-calendar-check',
        title: b.serviceName, subtitle: `${money(b.totalPrice)} · ${b.status}`,
        action: 'view_booking', refId: b.bookingId
      });
    }
  }
  for (const f of formations) {
    items.push({
      id: `formation-${f.id}`, date: f.acquiredAt, type: 'formation', icon: 'bi-mortarboard',
      title: f.name, subtitle: f.type ? `Formation ${f.type}` : 'Formation',
      action: 'view_formation', refId: f.formationId
    });
  }
  for (const p of products) {
    items.push({
      id: `product-${p.id}`, date: p.acquiredAt, type: 'produit', icon: 'bi-box-seam',
      title: p.name, subtitle: 'Produit', action: 'view_product', refId: p.productId
    });
  }
  for (const g of giftCards) {
    items.push({
      id: `giftcard-${g.id}`, date: g.purchasedAt, type: 'carte_cadeau', icon: 'bi-gift',
      title: `Carte cadeau ${money(g.amount)}`, subtitle: `Solde ${money(g.balance)} · ${g.status}`,
      action: 'view_giftcard', refId: g.code
    });
  }
  for (const r of refunds) {
    items.push({
      id: `refund-${r.id}`, date: r.refundedAt || r.requestedAt, type: 'remboursement', icon: 'bi-arrow-counterclockwise',
      title: `Remboursement ${money(r.amount)}`, subtitle: `${r.itemType} · ${r.status}`,
      action: 'view_refund', refId: r.refundId
    });
  }
  for (const inv of invoices) {
    items.push({
      id: `invoice-${inv.id}`, date: inv.invoiceDate, type: 'document', icon: 'bi-file-earmark-text',
      title: inv.official ? 'Facture émise' : 'Reçu émis', subtitle: inv.invoiceId || '',
      action: 'view_invoice', refId: inv.saleId
    });
  }
  for (const c of communications) {
    items.push({
      id: `email-${c.id}`, date: c.sentAt, type: 'email', icon: 'bi-envelope',
      title: c.subject || 'E-mail', subtitle: `${c.channel} · ${c.status}`,
      action: null, refId: null
    });
  }
  for (const n of notifications) {
    items.push({
      id: `notif-${n.id}`, date: n.createdAt, type: 'notification', icon: n.icon || 'bi-bell',
      title: n.title, subtitle: n.category || '', action: null, refId: null
    });
  }
  for (const e of eventLogs) {
    const m = EVENT_TIMELINE_MAP[e.eventName];
    if (!m) continue;
    items.push({
      id: `event-${e._id}`, date: e.createdAt || e.emittedAt, type: m.type, icon: m.icon,
      title: m.title, subtitle: '', action: null, refId: e.contextId || null
    });
  }

  items.sort((a, b) => dateOf(b.date) - dateOf(a.date));
  return items.slice(0, TIMELINE_CAP);
}

export { TIMELINE_CAP };
export default { buildCustomerTimeline };
