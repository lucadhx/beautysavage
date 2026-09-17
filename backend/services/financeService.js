// RX2.1 — Finance Dashboard : agrégation d'un instantané financier pour l'espace
// finance React (admin/dev). Le backend reste l'autorité ; aucun calcul métier côté client.
//
// Principe : on combine deux natures de données.
//   • « today »   — fenêtre temporelle (aujourd'hui / 7j / 30j) : ce qui s'est vendu.
//   • « actions » — backlog d'état courant (indépendant de la fenêtre) : ce qu'il reste à faire
//                   (soldes à encaisser, remboursements à traiter, factures impayées).
//
// Aucune donnée inventée : chaque métrique provient d'un champ réel des modèles existants.
import Sale from '../models/Sale.js';
import ServiceBooking from '../models/ServiceBooking.js';
import RefundRequest from '../models/RefundRequest.js';
import Invoice from '../models/Invoice.js';
import { ONSITE_DUE_BOOKING_FILTER } from './finance/financeTimelineService.js';

const VALID_RANGES = new Set(['today', '7d', '30d']);

function roundToCents(value) {
  const candidate = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(candidate * 100) / 100;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

// Fenêtre [start, end) en heure locale serveur. `end` est exclusif.
export function resolveFinanceRange(range = 'today', referenceDate = null, now = new Date()) {
  const safeRange = VALID_RANGES.has(range) ? range : 'today';
  const reference = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
    ? referenceDate
    : now;
  const startToday = startOfLocalDay(reference);
  const endExclusive = new Date(startToday.getTime() + 24 * 60 * 60 * 1000);

  if (safeRange === 'today') {
    return { range: 'today', label: "Aujourd'hui", start: startToday, end: endExclusive };
  }
  const days = safeRange === '7d' ? 7 : 30;
  const start = new Date(startToday.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return {
    range: safeRange,
    label: safeRange === '7d' ? '7 derniers jours' : '30 derniers jours',
    start,
    end: endExclusive,
  };
}

// Agrège les ventes de la fenêtre : nombre, revenu brut (= somme des totalAmount,
// catalogue/acompte selon le type), ventilation par type d'article, conso carte cadeau.
function aggregateSales(sales) {
  let revenue = 0;
  const breakdown = { prestations: 0, formations: 0, giftCards: 0, products: 0 };
  let giftCardConsumption = 0;

  for (const sale of sales) {
    revenue += Number.isFinite(Number(sale.totalAmount)) ? Number(sale.totalAmount) : 0;
    const items = Array.isArray(sale.items) ? sale.items : [];
    for (const item of items) {
      if (!item) continue;
      switch (item.type) {
        case 'service':
          breakdown.prestations += 1;
          break;
        case 'formation':
          breakdown.formations += 1;
          break;
        case 'gift-card':
          breakdown.giftCards += 1;
          break;
        case 'product':
          breakdown.products += 1;
          break;
        default:
          break;
      }
    }
    const usages = Array.isArray(sale.giftCardUsage) ? sale.giftCardUsage : [];
    for (const usage of usages) {
      const used = usage && Number.isFinite(Number(usage.amountUsed)) ? Number(usage.amountUsed) : 0;
      giftCardConsumption += used;
    }
  }

  return {
    salesCount: sales.length,
    revenue: roundToCents(revenue),
    breakdown,
    giftCardConsumption: roundToCents(giftCardConsumption),
  };
}

/**
 * Construit l'instantané du Finance Dashboard.
 * @param {{ range?: 'today'|'7d'|'30d', referenceDate?: Date|null, now?: Date }} opts
 * @returns instantané sérialisable (cards/KPIs/actions).
 */
export async function buildFinanceDashboard({ range = 'today', referenceDate = null, now = new Date() } = {}) {
  const window = resolveFinanceRange(range, referenceDate, now);

  // « today » — ventes de la fenêtre.
  const sales = await Sale.find({ createdAt: { $gte: window.start, $lt: window.end } }).lean();
  const salesAggregate = aggregateSales(sales);

  // « actions » — backlog d'état courant (indépendant de la fenêtre).
  // RX2.4 — À encaisser sur place : filtre UNIFIÉ avec la timeline (acomptes online à solder +
  // prestations manuelles payées 100 % sur place). paymentStatus n'est plus un critère (incohérent).
  const pendingBalanceBookings = await ServiceBooking.find(ONSITE_DUE_BOOKING_FILTER).lean();
  const balancesToCollectTotal = pendingBalanceBookings.reduce(
    (sum, booking) => sum + (Number.isFinite(Number(booking.balanceDueAmount)) ? Number(booking.balanceDueAmount) : 0),
    0,
  );

  // Remboursements à traiter : demandés ou en cours (non terminaux).
  const pendingRefunds = await RefundRequest.find({ status: { $in: ['requested', 'pending'] } }).lean();
  const refundsToProcessTotal = pendingRefunds.reduce(
    (sum, refund) => sum + (Number.isFinite(Number(refund.amount)) ? Number(refund.amount) : 0),
    0,
  );

  // Factures impayées : factures officielles dont le statut n'est pas réglé
  // (même règle que Customer360 buildFinancial : statut ∉ {paid, succeeded}).
  const unpaidInvoices = await Invoice.find({ official: true }).lean();
  const trulyUnpaid = unpaidInvoices.filter((invoice) => {
    const status = String(invoice.status || '').trim().toLowerCase();
    return !['paid', 'succeeded'].includes(status);
  });
  const unpaidInvoicesTotal = trulyUnpaid.reduce(
    (sum, invoice) => sum + (Number.isFinite(Number(invoice.totalAmount)) ? Number(invoice.totalAmount) : 0),
    0,
  );

  return {
    range: window.range,
    rangeLabel: window.label,
    periodStart: window.start.toISOString(),
    periodEnd: window.end.toISOString(),
    generatedAt: now.toISOString(),
    today: {
      salesCount: salesAggregate.salesCount,
      revenue: salesAggregate.revenue,
      breakdown: salesAggregate.breakdown,
      giftCardConsumption: salesAggregate.giftCardConsumption,
    },
    actions: {
      balancesToCollect: {
        count: pendingBalanceBookings.length,
        total: roundToCents(balancesToCollectTotal),
      },
      refundsToProcess: {
        count: pendingRefunds.length,
        total: roundToCents(refundsToProcessTotal),
      },
      unpaidInvoices: {
        count: trulyUnpaid.length,
        total: roundToCents(unpaidInvoicesTotal),
      },
    },
  };
}
