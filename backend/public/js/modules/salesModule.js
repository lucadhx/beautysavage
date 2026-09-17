import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { buildGestionLineGraph } from '../helpers/graphStylePreset.js';

const STATS_ENDPOINT = '/api/gestion/sales/stats';
const SALES_ENDPOINT = '/api/gestion/sales';
const CARTS_ENDPOINT = '/api/gestion/carts';
const REFUNDS_ENDPOINT = '/api/gestion/refunds?limit=400';
const STRIPE_TRANSACTION_FEES_ENDPOINT = '/api/stripe/transaction-fees';
const STRIPE_PENDING_FEES_COUNT_ENDPOINT = '/api/stripe/pending-fees-count';

const PERIODS = [
  { value: 'day', label: 'Jour' },
  { value: 'week', label: 'Semaine' },
  { value: 'month', label: 'Mois' },
  { value: 'year', label: 'Année' }
];

const TAB_ANALYTICS = 'analytics';
const TAB_RECORDS = 'records';
const TAB_REFUNDS = 'refunds';
const VIEW_SALES = 'sales';
const VIEW_CARTS = 'carts';

const CURRENCY = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

const escapeHtml = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtCurrency = value => CURRENCY.format(Number.isFinite(Number(value)) ? Number(value) : 0);
const fmtCurrencyFromCents = value => {
  if (!Number.isFinite(Number(value))) return 'Non disponible';
  return fmtCurrency(Number(value) / 100);
};
const fmtPercent = (value, minimumFractionDigits = 0, maximumFractionDigits = 2) => {
  if (!Number.isFinite(Number(value))) return 'Non disponible';
  return `${Number(value).toLocaleString('fr-FR', {
    minimumFractionDigits,
    maximumFractionDigits
  })}%`;
};
const buildStripeFeeLabel = (feeCents, stripeAmountCents) => {
  if (!Number.isFinite(Number(feeCents))) return 'Non disponible';
  const normalizedStripeAmountCents = Number.isFinite(Number(stripeAmountCents))
    ? Math.round(Math.max(0, Number(stripeAmountCents)))
    : 0;
  if (normalizedStripeAmountCents <= 0) {
    return fmtCurrencyFromCents(feeCents);
  }
  const feePercent = (Number(feeCents) / normalizedStripeAmountCents) * 100;
  return `${fmtCurrencyFromCents(feeCents)} (${fmtPercent(feePercent, 2, 2)} sur ${fmtCurrencyFromCents(normalizedStripeAmountCents)})`;
};
const buildProviderCommissionLabel = (commissionAmount, commissionRate) => {
  if (!Number.isFinite(Number(commissionAmount)) || !Number.isFinite(Number(commissionRate))) {
    return 'Non disponible';
  }
  return `${fmtCurrency(commissionAmount)} (${fmtPercent(commissionRate, 0, 2)})`;
};
const buildNetRevenueLabel = ({ totalAmount, stripeFeeCents, providerCommissionAmount, hasStripePayment }) => {
  if (!Number.isFinite(Number(stripeFeeCents))) {
    return hasStripePayment ? 'Calcul en attente des données Stripe' : 'Non disponible';
  }
  const providerAmount = Number.isFinite(Number(providerCommissionAmount))
    ? Number(providerCommissionAmount)
    : 0;
  const total = Number.isFinite(Number(totalAmount)) ? Number(totalAmount) : 0;
  return fmtCurrency(total - Number(stripeFeeCents) / 100 - providerAmount);
};
const fmtDate = value => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : date.toLocaleString('fr-FR');
};
const fmtDateShort = value => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime())
    ? 'Date inconnue'
    : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const normalizeProofValue = value => String(value || '').trim();
const REFUND_SUB_STATUS_LABELS = {
  not_applicable: 'Non applicable',
  pending: 'En attente',
  succeeded: 'Effectué',
  failed: 'Échec',
  rollback_needed: 'Intervention requise'
};

function normalizeRefundSubStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function getRefundSubStatusLabel(status) {
  const key = normalizeRefundSubStatus(status);
  return REFUND_SUB_STATUS_LABELS[key] || 'En attente';
}

function getRefundSubStatusChipClass(status) {
  const key = normalizeRefundSubStatus(status);
  if (key === 'succeeded') return 'payment-result__chip payment-result__chip--success';
  if (key === 'failed' || key === 'rollback_needed') {
    return 'payment-result__chip payment-result__chip--failed';
  }
  if (key === 'pending') return 'payment-result__chip payment-result__chip--pending';
  return 'payment-result__chip';
}

function buildRefundTrackingUrl(trackingToken) {
  const token = String(trackingToken || '').trim();
  if (!token) return '';
  return `/vitrine.html?page=refund-tracking&token=${encodeURIComponent(token)}`;
}

function normalizeSaleItemType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'formation-option') return 'formation';
  if (normalized === 'service-option') return 'service';
  if (['formation', 'gift-card', 'product', 'service'].includes(normalized)) return normalized;
  return 'formation';
}

function pickPrimarySaleItem(sale) {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  if (!items.length) return null;
  const prioritized = items.find(item =>
    ['formation', 'gift-card', 'product', 'service'].includes(normalizeSaleItemType(item?.type))
  );
  return prioritized || items[0];
}

function getSaleTypeMeta(sale) {
  const primaryItem = pickPrimarySaleItem(sale);
  const itemType = normalizeSaleItemType(primaryItem?.type);
  if (itemType === 'gift-card') {
    return {
      itemType,
      badgeLabel: 'Carte cadeau',
      badgeClass: 'sales-pill--type-gift',
      headerLabel: 'Achat carte cadeau',
      fallbackTitle: 'Carte cadeau'
    };
  }
  if (itemType === 'product') {
    return {
      itemType,
      badgeLabel: 'Produit',
      badgeClass: 'sales-pill--type-product',
      headerLabel: 'Produit',
      fallbackTitle: 'Produit'
    };
  }
  if (itemType === 'service') {
    return {
      itemType,
      badgeLabel: 'Prestation',
      badgeClass: 'sales-pill--type-service',
      headerLabel: 'Prestation',
      fallbackTitle: 'Prestation'
    };
  }
  const hasSessionDate = !Number.isNaN(new Date(sale?.date_session || sale?.date_formation || '').getTime());
  return {
    itemType: 'formation',
    badgeLabel: 'Formation',
    badgeClass: 'sales-pill--type-formation',
    headerLabel: hasSessionDate ? 'Formation présentielle' : 'Formation distancielle',
    fallbackTitle: 'Formation'
  };
}

function getSaleStatusMeta(sale) {
  const refundStatus = normalizeRefundSubStatus(sale?.refundStatus);
  if (refundStatus === 'succeeded') {
    return { label: 'Annulé', className: 'sales-pill--status-danger' };
  }
  if (refundStatus === 'pending' || refundStatus === 'requested') {
    return { label: 'En attente', className: 'sales-pill--status-warning' };
  }
  return { label: 'Payé', className: 'sales-pill--status-success' };
}

function getRefundPartStatusMeta(status) {
  const normalized = normalizeRefundSubStatus(status);
  if (normalized === 'succeeded') {
    return {
      label: 'Remboursé',
      className: 'sales-pill--substatus-success',
      icon: ''
    };
  }
  if (normalized === 'failed') {
    return {
      label: 'Échec',
      className: 'sales-pill--substatus-danger',
      icon: ''
    };
  }
  if (normalized === 'rollback_needed') {
    return {
      label: 'Intervention requise',
      className: 'sales-pill--substatus-danger',
      icon: 'bi-exclamation-triangle'
    };
  }
  if (normalized === 'not_applicable') {
    return {
      label: 'Non applicable',
      className: 'sales-pill--substatus-neutral',
      icon: ''
    };
  }
  return {
    label: 'En attente',
    className: 'sales-pill--substatus-warning',
    icon: ''
  };
}

function getRefundGlobalStatusMeta(refundEntry) {
  const normalizedStatus = String(refundEntry?.status || '').trim().toLowerCase();
  const stripeStatus = normalizeRefundSubStatus(refundEntry?.stripeRefundStatus || 'not_applicable');
  const giftStatus = normalizeRefundSubStatus(refundEntry?.giftCardRefundStatus || 'not_applicable');
  const hasFailure = ['failed', 'rollback_needed'].includes(stripeStatus) || ['failed', 'rollback_needed'].includes(giftStatus);
  if (hasFailure) {
    return {
      label: 'Intervention requise',
      className: 'sales-pill--status-danger',
      icon: 'bi-exclamation-triangle'
    };
  }
  const applicableStatuses = [stripeStatus, giftStatus].filter(status => status !== 'not_applicable');
  const allSucceeded = applicableStatuses.length > 0 && applicableStatuses.every(status => status === 'succeeded');
  if (normalizedStatus === 'succeeded' || allSucceeded) {
    return {
      label: 'Remboursé',
      className: 'sales-pill--status-success',
      icon: 'bi-check2-circle'
    };
  }
  return {
    label: 'En cours',
    className: 'sales-pill--status-warning',
    icon: 'bi-hourglass-split'
  };
}

function dayStart(date) {
  const target = new Date(date || Date.now());
  target.setHours(0, 0, 0, 0);
  return target;
}

function bounds(period, ref = new Date()) {
  const base = new Date(ref);
  if (period === 'week') {
    const start = dayStart(base);
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
  }
  if (period === 'month') return { start: new Date(base.getFullYear(), base.getMonth(), 1), end: new Date(base.getFullYear(), base.getMonth() + 1, 1) };
  if (period === 'year') return { start: new Date(base.getFullYear(), 0, 1), end: new Date(base.getFullYear() + 1, 0, 1) };
  const start = dayStart(base);
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
}

function move(period, reference, direction) {
  const next = new Date(reference);
  if (period === 'week') next.setDate(next.getDate() + 7 * direction);
  else if (period === 'month') next.setMonth(next.getMonth() + direction);
  else if (period === 'year') next.setFullYear(next.getFullYear() + direction);
  else next.setDate(next.getDate() + direction);
  return bounds(period, next).start;
}

function periodLabel(period, start, end) {
  if (period === 'day') return start.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' });
  if (period === 'week') {
    const lastDay = new Date(end);
    lastDay.setDate(lastDay.getDate() - 1);
    return `${start.toLocaleDateString('fr-FR')} - ${lastDay.toLocaleDateString('fr-FR')}`;
  }
  if (period === 'month') return start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return `Année ${start.getFullYear()}`;
}

function graph(points, intent = 'accent', ariaLabel = 'Evolution') {
  return buildGestionLineGraph({
    points,
    intent,
    ariaLabel,
    width: 420,
    height: 180,
    labelStep: 'auto',
    emptyMessage: 'Aucune donnée disponible.'
  });
}

function buildPawLoader(message = 'Chargement...') {
  return `
    <div class="sales-inline-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="sales-inline-loader__paws" aria-hidden="true">
        <span class="sales-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="sales-inline-loader__paw sales-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="sales-inline-loader__paw sales-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="sales-inline-loader__label">${escapeHtml(message)}</p>
    </div>
  `;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { credentials: 'include', signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Erreur réseau');
  return payload;
}

function saleInvoiceUrl(sale) {
  const stripeInvoicePdfUrl = String(sale?.invoice?.stripeInvoicePdfUrl || '').trim();
  if (stripeInvoicePdfUrl) return stripeInvoicePdfUrl;
  const saleId = String(sale?.saleId || '').trim();
  if (!saleId) return '';
  return String(sale?.invoice?.downloadUrl || `/api/gestion/sales/${encodeURIComponent(saleId)}/invoice`);
}

export async function renderModule(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="module-panel sales-dashboard" data-sales>
      <header class="sales-dashboard__header"><div><h2>Ventes</h2><p class="muted">Suivi des revenus et des performances.</p></div></header>
      <nav class="sales-main-tabs" role="tablist">
        <button type="button" class="sales-main-tab is-active" data-main-tab="${TAB_ANALYTICS}">Statistiques & analyses</button>
        <button type="button" class="sales-main-tab" data-main-tab="${TAB_RECORDS}">Ventes et Paniers</button>
        <button type="button" class="sales-main-tab" data-main-tab="${TAB_REFUNDS}">Remboursements</button>
      </nav>
      <section class="sales-main-panel" data-panel="${TAB_ANALYTICS}">
        <div class="sales-period-toolbar">
          <div class="sales-period-filter" data-period-filter>${PERIODS.map(period => `<button type="button" class="sales-period-filter__option" data-period="${period.value}">${period.label}</button>`).join('')}</div>
          <div class="sales-period-navigation">
            <button type="button" class="sales-period-navigation__btn" data-nav="-1" aria-label="Période précédente"><i class="bi bi-chevron-left"></i></button>
            <span class="sales-period-navigation__label" data-period-label>Chargement...</span>
            <button type="button" class="sales-period-navigation__btn" data-nav="1" aria-label="Période suivante"><i class="bi bi-chevron-right"></i></button>
          </div>
        </div>
        <div class="sales-kpi-grid">
          <article class="sales-kpi-card"><small>Revenus</small><strong data-kpi="revenue">â‚¬0</strong></article>
          <article class="sales-kpi-card"><small>Ventes</small><strong data-kpi="sales">0</strong></article>
          <article class="sales-kpi-card"><small>Cartes cadeaux</small><strong data-kpi="gifts">0</strong></article>
        </div>
        <div class="sales-kpi-grid" data-stripe-pending-indicator hidden></div>
        <div class="sales-graph-grid">
          <article class="sales-graph-card"><header><strong>Ventes</strong></header><div data-graph="sales"></div></article>
          <article class="sales-graph-card"><header><strong>Revenus</strong></header><div data-graph="revenue"></div></article>
          <article class="sales-graph-card"><header><strong>Usage cartes cadeaux</strong></header><div data-graph="giftUsage"></div></article>
          <article class="sales-graph-card"><header><strong>Détail des ventes</strong></header><div data-graph="detail"></div><div class="graph-legend sales-detail-legend" data-detail-legend></div></article>
        </div>
        <p class="form-message" data-analytics-error></p>
      </section>
      <section class="sales-main-panel" data-panel="${TAB_RECORDS}" hidden>
        <div class="sales-records-toolbar">
          <label class="sales-search-field"><i class="bi bi-search"></i><input type="search" placeholder="Rechercher par email ou ID de vente" data-search></label>
          <div class="sales-record-switch">
            <button type="button" class="sales-record-switch__option is-active" data-view="${VIEW_SALES}" aria-pressed="true"><i class="bi bi-cash-stack"></i><span>Ventes</span></button>
            <button type="button" class="sales-record-switch__option" data-view="${VIEW_CARTS}" aria-pressed="false"><i class="bi bi-cart3"></i><span>Paniers</span></button>
          </div>
        </div>
        <div class="sales-type-filters" data-type-filters>
          <button type="button" class="sales-type-filter is-active" data-type-filter="all">Tout</button>
          <button type="button" class="sales-type-filter" data-type-filter="formation"><i class="bi bi-mortarboard"></i> Formations</button>
          <button type="button" class="sales-type-filter" data-type-filter="service"><i class="bi bi-scissors"></i> Prestations</button>
          <button type="button" class="sales-type-filter" data-type-filter="gift-card"><i class="bi bi-gift"></i> Cartes cadeaux</button>
        </div>
        <div data-records="${VIEW_SALES}"></div>
        <div data-records="${VIEW_CARTS}" hidden></div>
      </section>
      <section class="sales-main-panel" data-panel="${TAB_REFUNDS}" hidden>
        <div class="sales-records-toolbar">
          <label class="sales-search-field">
            <i class="bi bi-search"></i>
            <input type="search" placeholder="Rechercher par email, saleId ou refundId" data-refund-search>
          </label>
          <p class="sales-refund-total" data-refund-total>- 0,00 â‚¬</p>
        </div>
        <div data-refunds-list></div>
      </section>
      <div class="sales-detail-modal-overlay" data-sale-modal hidden>
        <div class="sales-detail-modal" role="dialog" aria-modal="true" aria-label="Détails vente">
          <header class="sales-detail-modal__header">
            <h3>Détail de la vente</h3>
            <div class="sales-detail-modal__actions">
              <button type="button" class="sales-detail-modal__icon-button" data-action="download" aria-label="Télécharger la facture"><i class="bi bi-download"></i></button>
              <button type="button" class="sales-detail-modal__icon-button" data-action="close-modal" aria-label="Fermer"><i class="bi bi-x-lg"></i></button>
            </div>
          </header>
          <div class="sales-detail-modal__body" data-sale-modal-body></div>
        </div>
      </div>
      <div class="sales-detail-modal-overlay" data-refund-modal hidden>
        <div class="sales-detail-modal sales-detail-modal--refund" role="dialog" aria-modal="true" aria-label="Details remboursement">
          <header class="sales-detail-modal__header">
            <h3>Détail du remboursement</h3>
            <div class="sales-detail-modal__actions">
              <button type="button" class="sales-detail-modal__icon-button" data-action="close-refund-modal" aria-label="Fermer"><i class="bi bi-x-lg"></i></button>
            </div>
          </header>
          <div class="sales-detail-modal__body" data-refund-modal-body></div>
        </div>
      </div>
    </div>
  `;

  const root = container.querySelector('[data-sales]');
  const state = {
    mainTab: TAB_ANALYTICS,
    view: VIEW_SALES,
    period: 'day',
    bounds: bounds('day'),
    reference: bounds('day').start,
    statsCache: new Map(),
    statsAbort: null,
    recordsAbort: null,
    sales: null,
    carts: null,
    search: '',
    searchTimer: null,
    selectedSaleId: '',
    salesSearchRequestId: 0,
    salesSearchLoading: false,
    refunds: null,
    refundsAbort: null,
    refundSearch: '',
    refundSearchTimer: null,
    refundSearchRequestId: 0,
    refundSearchLoading: false,
    refundsTotalAmount: 0,
    stripeFeesAbort: null,
    pendingStripeCountAbort: null,
    pendingStripeCount: 0,
    salesTypeFilter: 'all' // 'all' | 'formation' | 'service' | 'gift-card'
  };

  const ui = {
    error: root.querySelector('[data-analytics-error]'),
    periodLabel: root.querySelector('[data-period-label]'),
    kpiRevenue: root.querySelector('[data-kpi="revenue"]'),
    kpiSales: root.querySelector('[data-kpi="sales"]'),
    kpiGifts: root.querySelector('[data-kpi="gifts"]'),
    gSales: root.querySelector('[data-graph="sales"]'),
    gRevenue: root.querySelector('[data-graph="revenue"]'),
    gGift: root.querySelector('[data-graph="giftUsage"]'),
    gDetail: root.querySelector('[data-graph="detail"]'),
    detailLegend: root.querySelector('[data-detail-legend]'),
    pendingStripeIndicator: root.querySelector('[data-stripe-pending-indicator]'),
    recordsSales: root.querySelector(`[data-records="${VIEW_SALES}"]`),
    recordsCarts: root.querySelector(`[data-records="${VIEW_CARTS}"]`),
    searchInput: root.querySelector('[data-search]'),
    refundSearchInput: root.querySelector('[data-refund-search]'),
    refundsList: root.querySelector('[data-refunds-list]'),
    refundsTotal: root.querySelector('[data-refund-total]'),
    modal: root.querySelector('[data-sale-modal]'),
    modalBody: root.querySelector('[data-sale-modal-body]'),
    modalDownload: root.querySelector('[data-action="download"]'),
    refundModal: root.querySelector('[data-refund-modal]'),
    refundModalBody: root.querySelector('[data-refund-modal-body]')
  };

  const renderTabs = () => {
    root.querySelectorAll('[data-main-tab]').forEach(button => {
      const active = button.dataset.mainTab === state.mainTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-panel]').forEach(panel => {
      const isActive = panel.dataset.panel === state.mainTab;
      panel.hidden = !isActive;
      panel.style.display = isActive ? '' : 'none';
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
  };

  const renderRecordView = () => {
    root.querySelectorAll('[data-view]').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-records]').forEach(panel => (panel.hidden = panel.dataset.records !== state.view));
  };

  const renderPeriod = () => {
    root.querySelectorAll('[data-period]').forEach(button => {
      const active = button.dataset.period === state.period;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    ui.periodLabel.textContent = periodLabel(state.period, state.bounds.start, state.bounds.end);
    const nowStart = bounds(state.period).start.getTime();
    const nextBtn = root.querySelector('[data-nav="1"]');
    if (nextBtn) nextBtn.disabled = state.bounds.start.getTime() >= nowStart;
  };

  const renderStats = payload => {
    const series = Array.isArray(payload?.series) ? payload.series : [];
    ui.gSales.innerHTML = graph(
      series.map(entry => ({ label: entry.label, value: entry.count })),
      'accent',
      'Evolution des ventes'
    );
    ui.gRevenue.innerHTML = graph(
      series.map(entry => ({ label: entry.label, value: entry.revenue })),
      'accent-strong',
      'Evolution des revenus'
    );
    ui.gGift.innerHTML = graph(
      (payload?.giftCardUsage || []).map(entry => ({ label: entry.label, value: entry.value })),
      'neutral',
      'Usage des cartes cadeaux'
    );
    const d = payload?.detailSeries || {};
    const detailValues = PERIODS.length ? (d.formations || []).map((entry, i) => Number(entry?.value || 0) + Number(d.products?.[i]?.value || 0) + Number(d.giftCards?.[i]?.value || 0)) : [];
    const detailPoints = (d.formations || []).map((entry, i) => ({ label: entry?.label || '', value: detailValues[i] || 0 }));
    ui.gDetail.innerHTML = graph(detailPoints, 'muted', 'Detail des ventes');
    ui.detailLegend.innerHTML = '<span data-graph-intent="accent">Formations</span><span data-graph-intent="accent-strong">Produits</span><span data-graph-intent="muted">Cartes cadeaux</span>';
    ui.kpiRevenue.textContent = fmtCurrency(payload?.totalRevenue || 0);
    ui.kpiSales.textContent = String(payload?.totalSales || 0);
    ui.kpiGifts.textContent = String(payload?.totalGiftCardPurchases || 0);
  };

  const renderPendingStripeIndicator = () => {
    if (!ui.pendingStripeIndicator) return;
    const count = Number.isFinite(Number(state.pendingStripeCount))
      ? Math.max(0, Math.round(Number(state.pendingStripeCount)))
      : 0;
    if (!count) {
      ui.pendingStripeIndicator.innerHTML = '';
      ui.pendingStripeIndicator.hidden = true;
      return;
    }
    ui.pendingStripeIndicator.hidden = false;
    ui.pendingStripeIndicator.innerHTML = `
      <article class="sales-kpi-card">
        <small>Transactions en attente de donnees Stripe</small>
        <strong>${count}</strong>
        <p class="muted">Les frais Stripe seront completes automatiquement des qu ils sont disponibles.</p>
      </article>
    `;
  };

  const loadPendingStripeCount = async () => {
    if (state.pendingStripeCountAbort) state.pendingStripeCountAbort.abort();
    const abortController = new AbortController();
    state.pendingStripeCountAbort = abortController;
    try {
      const payload = await fetchJson(
        STRIPE_PENDING_FEES_COUNT_ENDPOINT,
        abortController.signal
      );
      state.pendingStripeCount = Number.isFinite(Number(payload?.count)) ? Number(payload.count) : 0;
      renderPendingStripeIndicator();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      state.pendingStripeCount = 0;
      renderPendingStripeIndicator();
    } finally {
      if (state.pendingStripeCountAbort === abortController) {
        state.pendingStripeCountAbort = null;
      }
    }
  };

  const loadStats = async () => {
    ui.error.textContent = '';
    const key = `${state.period}:${state.bounds.start.toISOString()}`;
    if (state.statsCache.has(key)) return renderStats(state.statsCache.get(key));
    if (state.statsAbort) state.statsAbort.abort();
    state.statsAbort = new AbortController();
    try {
      const params = new URLSearchParams({ period: state.period, startDate: state.bounds.start.toISOString(), endDate: state.bounds.end.toISOString(), referenceDate: state.bounds.start.toISOString() });
      const payload = await fetchJson(`${STATS_ENDPOINT}?${params.toString()}`, state.statsAbort.signal);
      state.statsCache.set(key, payload);
      renderStats(payload);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      ui.error.textContent = error.message || 'Impossible de charger les statistiques.';
    }
  };

  const renderSalesList = () => {
    if (state.salesSearchLoading) {
      ui.recordsSales.innerHTML = buildPawLoader('Recherche des ventes...');
      return;
    }
    const q = state.search.trim().toLowerCase();
    const entries = (state.sales || []).filter(sale => {
      if (state.salesTypeFilter !== 'all') {
        const saleType = normalizeSaleItemType(pickPrimarySaleItem(sale)?.type);
        if (saleType !== state.salesTypeFilter) return false;
      }
      if (!q) return true;
      return String(sale?.saleId || '').toLowerCase().includes(q) || String(sale?.customer?.email || '').toLowerCase().includes(q);
    });
    if (!entries.length) {
      ui.recordsSales.innerHTML = '<p class="module-placeholder">Aucune vente pour cette recherche.</p>';
      return;
    }
    ui.recordsSales.innerHTML = `
      <div class="sales-record-list sales-record-list--premium">
        ${entries
          .map((sale, index) => {
            const typeMeta = getSaleTypeMeta(sale);
            const saleStatus = getSaleStatusMeta(sale);
            const primaryItem = pickPrimarySaleItem(sale);
            const title = String(primaryItem?.name || '').trim() || typeMeta.fallbackTitle;
            const customerEmail = String(sale?.customer?.email || '').trim() || 'Email indisponible';
            const saleId = String(sale?.saleId || '').trim();
            const saleIdLabel = saleId || 'N/A';
            const panelId = `sale-card-panel-${index}`;
            return `
              <article class="sales-record-card sales-record-card--premium sales-record-card--sale" style="--sales-card-index: ${index};">
                <header class="sales-record-card__header">
                  <div class="sales-record-card__header-left">
                    <span class="sales-pill sales-pill--type ${escapeHtml(typeMeta.badgeClass)}">${escapeHtml(typeMeta.badgeLabel)}</span>
                    <span class="sales-record-card__header-label">${escapeHtml(typeMeta.headerLabel)}</span>
                  </div>
                  <span class="sales-pill sales-pill--status ${escapeHtml(saleStatus.className)}">${escapeHtml(saleStatus.label)}</span>
                </header>
                <div class="sales-record-card__separator" aria-hidden="true"></div>
                <div class="sales-record-card__body">
                  <div class="sales-record-card__title-row">
                    <h3 class="sales-record-card__title">${escapeHtml(title)}</h3>
                    <strong class="sales-record-card__amount">${fmtCurrency(sale?.totalAmount || 0)}</strong>
                  </div>
                  <p class="sales-record-card__summary-line">Client : ${escapeHtml(customerEmail)} · ${escapeHtml(fmtDateShort(sale?.createdAt))}</p>
                </div>
                <div class="sales-record-card__actions">
                  <button type="button" class="sales-record-detail-button sales-record-detail-button--pill sales-record-toggle-button" data-toggle-card-details="${escapeHtml(panelId)}" aria-expanded="false" aria-controls="${escapeHtml(panelId)}">
                    <span data-toggle-label>Details</span>
                    <i class="bi bi-chevron-down" data-toggle-icon aria-hidden="true"></i>
                  </button>
                </div>
                <div class="sales-record-card__collapsible" id="${escapeHtml(panelId)}" aria-hidden="true">
                  <div class="sales-record-card__details">
                    <p class="sales-record-card__info">Client : ${escapeHtml(customerEmail)}</p>
                    <p class="sales-record-card__info">Date : ${escapeHtml(fmtDate(sale?.createdAt))}</p>
                    <p class="sales-record-card__meta-line">ID ${escapeHtml(saleIdLabel)} · ${Number(sale?.itemCount || 0)} article(s)</p>
                    ${
                      saleId
                        ? `<button type="button" class="sales-record-detail-button sales-record-detail-button--pill sales-record-detail-button--inline" data-open-sale="${escapeHtml(saleId)}" aria-label="Ouvrir le detail de la vente">
                             <span>Fiche complete</span>
                             <i class="bi bi-arrow-right-circle" aria-hidden="true"></i>
                           </button>`
                        : '<button type="button" class="sales-record-detail-button sales-record-detail-button--pill sales-record-detail-button--inline" disabled>Fiche complete</button>'
                    }
                  </div>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  };

  const renderCartsList = () => {
    const entries = state.carts || [];
    if (!entries.length) return (ui.recordsCarts.innerHTML = '<p class="module-placeholder">Aucun panier en cours.</p>');
    ui.recordsCarts.innerHTML = `<div class="sales-record-list">${entries.map(cart => `<article class="sales-record-card sales-record-card--cart"><div class="sales-record-card__main"><div class="sales-record-card__top"><strong>${escapeHtml(cart?.customer?.email || 'Email indisponible')}</strong><span class="sales-record-card__amount">${fmtCurrency(cart?.totalAmount || 0)}</span></div><p class="muted">${escapeHtml(fmtDate(cart?.updatedAt))}</p><div class="sales-record-card__meta"><span>Panier actif</span><span class="sales-record-chip">Articles: ${Number(cart?.itemCount || 0)}</span></div></div></article>`).join('')}</div>`;
  };

  const renderRefundsList = () => {
    if (!ui.refundsList) return;
    if (!state.refunds || state.refundSearchLoading) {
      ui.refundsList.innerHTML = buildPawLoader(
        state.refundSearchLoading ? 'Recherche des remboursements...' : 'Chargement des remboursements...'
      );
      if (ui.refundsTotal && !state.refunds) {
        ui.refundsTotal.textContent = '- 0,00 EUR';
      }
      return;
    }

    const q = state.refundSearch.trim().toLowerCase();
    const entries = state.refunds.filter(entry => {
      if (!q) return true;
      const haystacks = [entry?.client?.email, entry?.saleId, entry?.refundId, entry?.formationTitle]
        .map(value => String(value || '').toLowerCase())
        .join(' ');
      return haystacks.includes(q);
    });

    const total = entries.reduce(
      (sum, entry) => sum + (Number.isFinite(Number(entry?.amount)) ? Number(entry.amount) : 0),
      0
    );
    const displayedTotal = q.length > 0
      ? total
      : Number.isFinite(Number(state.refundsTotalAmount))
        ? Number(state.refundsTotalAmount)
        : total;
    if (ui.refundsTotal) {
      ui.refundsTotal.textContent = `- ${fmtCurrency(displayedTotal)}`;
    }

    if (!entries.length) {
      ui.refundsList.innerHTML = '<p class="module-placeholder">Aucun remboursement pour cette recherche.</p>';
      return;
    }

    ui.refundsList.innerHTML = `
      <div class="sales-record-list sales-record-list--premium">
        ${entries
          .map((entry, index) => {
            const amount = Number(entry?.amount || 0);
            const globalStatus = getRefundGlobalStatusMeta(entry);
            const stripePartStatus = getRefundPartStatusMeta(entry?.stripeRefundStatus);
            const giftPartStatus = getRefundPartStatusMeta(entry?.giftCardRefundStatus);
            const stripeAmount = Number.isFinite(Number(entry?.stripeRefundAmount))
              ? fmtCurrency(Number(entry.stripeRefundAmount))
              : 'Non applicable';
            const giftAmount = Number.isFinite(Number(entry?.giftCardRefundAmount))
              ? fmtCurrency(Number(entry.giftCardRefundAmount))
              : 'Non applicable';
            const clientEmail = String(entry?.client?.email || '').trim() || 'Email indisponible';
            const refundId = String(entry?.refundId || '').trim();
            const formationTitle = String(entry?.formationTitle || '').trim() || 'Formation';
            const globalStatusLabel = globalStatus.icon
              ? `<i class="bi ${escapeHtml(globalStatus.icon)}" aria-hidden="true"></i>${escapeHtml(globalStatus.label)}`
              : escapeHtml(globalStatus.label);
            const stripeStatusLabel = stripePartStatus.icon
              ? `<i class="bi ${escapeHtml(stripePartStatus.icon)}" aria-hidden="true"></i>${escapeHtml(stripePartStatus.label)}`
              : escapeHtml(stripePartStatus.label);
            const giftStatusLabel = giftPartStatus.icon
              ? `<i class="bi ${escapeHtml(giftPartStatus.icon)}" aria-hidden="true"></i>${escapeHtml(giftPartStatus.label)}`
              : escapeHtml(giftPartStatus.label);
            const panelId = `refund-card-panel-${index}`;
            return `
              <article class="sales-record-card sales-record-card--premium sales-record-card--refund" style="--sales-card-index: ${index};">
                <header class="sales-record-card__header">
                  <div class="sales-record-card__header-left">
                    <span class="sales-pill sales-pill--type sales-pill--type-refund">Remboursement</span>
                  </div>
                  <span class="sales-pill sales-pill--status ${escapeHtml(globalStatus.className)}">${globalStatusLabel}</span>
                </header>
                <div class="sales-record-card__separator" aria-hidden="true"></div>
                <div class="sales-record-card__body">
                  <div class="sales-record-card__title-row">
                    <h3 class="sales-record-card__title">Formation : ${escapeHtml(formationTitle)}</h3>
                    <strong class="sales-record-card__amount">${fmtCurrency(amount)}</strong>
                  </div>
                  <p class="sales-record-card__summary-line">Client : ${escapeHtml(clientEmail)} · ${escapeHtml(fmtDateShort(entry?.requestedAt))}</p>
                </div>
                <div class="sales-record-card__actions">
                  <button type="button" class="sales-record-detail-button sales-record-detail-button--pill sales-record-toggle-button" data-toggle-card-details="${escapeHtml(panelId)}" aria-expanded="false" aria-controls="${escapeHtml(panelId)}">
                    <span data-toggle-label>Details</span>
                    <i class="bi bi-chevron-down" data-toggle-icon aria-hidden="true"></i>
                  </button>
                </div>
                <div class="sales-record-card__collapsible" id="${escapeHtml(panelId)}" aria-hidden="true">
                  <div class="sales-record-card__details">
                    <p class="sales-record-card__info">Client : ${escapeHtml(clientEmail)}</p>
                    <p class="sales-record-card__info">Demande le : ${escapeHtml(fmtDate(entry?.requestedAt))}</p>
                    <div class="sales-record-card__refund-split">
                      <p class="sales-record-card__split-row">
                        <span>Part bancaire : ${escapeHtml(stripeAmount)}</span>
                        <span class="sales-pill sales-pill--substatus ${escapeHtml(stripePartStatus.className)}">${stripeStatusLabel}</span>
                      </p>
                      <p class="sales-record-card__split-row">
                        <span>Part carte cadeau : ${escapeHtml(giftAmount)}</span>
                        <span class="sales-pill sales-pill--substatus ${escapeHtml(giftPartStatus.className)}">${giftStatusLabel}</span>
                      </p>
                    </div>
                    <p class="sales-record-card__meta-line">saleId : ${escapeHtml(entry?.saleId || 'N/A')} · refundId : ${escapeHtml(refundId || 'N/A')}</p>
                    ${
                      refundId
                        ? `<button type="button" class="sales-record-detail-button sales-record-detail-button--pill sales-record-detail-button--inline" data-open-refund="${escapeHtml(refundId)}" aria-label="Ouvrir le detail du remboursement">
                             <span>Fiche complete</span>
                             <i class="bi bi-arrow-right-circle" aria-hidden="true"></i>
                           </button>`
                        : '<button type="button" class="sales-record-detail-button sales-record-detail-button--pill sales-record-detail-button--inline" disabled>Fiche complete</button>'
                    }
                  </div>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  };
  const loadRecords = async () => {
    if (state.sales && state.carts) {
      renderSalesList();
      return renderCartsList();
    }
    ui.recordsSales.innerHTML = buildPawLoader('Chargement des ventes...');
    ui.recordsCarts.innerHTML = buildPawLoader('Chargement des paniers...');
    if (state.recordsAbort) state.recordsAbort.abort();
    state.recordsAbort = new AbortController();
    try {
      const [salesPayload, cartsPayload] = await Promise.all([
        fetchJson(SALES_ENDPOINT, state.recordsAbort.signal),
        fetchJson(CARTS_ENDPOINT, state.recordsAbort.signal)
      ]);
      state.sales = Array.isArray(salesPayload?.sales) ? salesPayload.sales : [];
      state.carts = Array.isArray(cartsPayload?.snapshots) ? cartsPayload.snapshots : [];
      renderSalesList();
      renderCartsList();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      ui.recordsSales.innerHTML = `<p class="form-message">${escapeHtml(error.message || 'Impossible de charger les ventes.')}</p>`;
      ui.recordsCarts.innerHTML = `<p class="form-message">${escapeHtml(error.message || 'Impossible de charger les paniers.')}</p>`;
    }
  };

  const loadRefunds = async () => {
    if (state.refunds) {
      renderRefundsList();
      return;
    }
    renderRefundsList();
    if (state.refundsAbort) state.refundsAbort.abort();
    state.refundsAbort = new AbortController();
    try {
      const payload = await fetchJson(REFUNDS_ENDPOINT, state.refundsAbort.signal);
      state.refunds = Array.isArray(payload?.refunds) ? payload.refunds : [];
      state.refundsTotalAmount = Number.isFinite(Number(payload?.totalRefunded))
        ? Number(payload.totalRefunded)
        : 0;
      renderRefundsList();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      ui.refundsList.innerHTML = `<p class="form-message">${escapeHtml(error.message || 'Impossible de charger les remboursements.')}</p>`;
      if (ui.refundsTotal) {
        ui.refundsTotal.textContent = '- 0,00 â‚¬';
      }
    }
  };

  const runSearchWithLoader = async requestId => {
    const startedAt = Date.now();
    state.salesSearchLoading = true;
    renderSalesList();
    const remaining = 500 - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    if (requestId !== state.salesSearchRequestId) return;
    state.salesSearchLoading = false;
    renderSalesList();
  };

  const scheduleSearchRender = () => {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    const requestId = state.salesSearchRequestId + 1;
    state.salesSearchRequestId = requestId;
    state.searchTimer = setTimeout(() => {
      state.searchTimer = null;
      void runSearchWithLoader(requestId);
    }, 300);
  };

  const runRefundSearchWithLoader = async requestId => {
    const startedAt = Date.now();
    state.refundSearchLoading = true;
    renderRefundsList();
    const remaining = 500 - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    if (requestId !== state.refundSearchRequestId) return;
    state.refundSearchLoading = false;
    renderRefundsList();
  };

  const scheduleRefundSearchRender = () => {
    if (state.refundSearchTimer) clearTimeout(state.refundSearchTimer);
    const requestId = state.refundSearchRequestId + 1;
    state.refundSearchRequestId = requestId;
    state.refundSearchTimer = setTimeout(() => {
      state.refundSearchTimer = null;
      void runRefundSearchWithLoader(requestId);
    }, 280);
  };

  const findSaleById = saleId =>
    (state.sales || []).find(entry => String(entry?.saleId || '') === String(saleId || '')) || null;

  const setStripeTransactionValues = (feeText, netText, isLoading = false) => {
    const feeNode = ui.modalBody.querySelector('[data-stripe-fee-value]');
    const netNode = ui.modalBody.querySelector('[data-stripe-net-value]');
    const loadingMarkup =
      '<span class="sales-detail-stripe-loading"><span class="sales-detail-stripe-spinner" aria-hidden="true"></span>Chargement...</span>';
    if (feeNode) {
      if (isLoading) feeNode.innerHTML = loadingMarkup;
      else feeNode.textContent = feeText;
      feeNode.classList.toggle('is-loading', Boolean(isLoading));
    }
    if (netNode) {
      if (isLoading) netNode.innerHTML = loadingMarkup;
      else netNode.textContent = netText;
      netNode.classList.toggle('is-loading', Boolean(isLoading));
    }
  };

  const loadStripeTransactionFees = async (saleId, paymentIntentId) => {
    if (!paymentIntentId) return;
    const sale = findSaleById(saleId);
    if (!sale) return;
    if (state.stripeFeesAbort) state.stripeFeesAbort.abort();
    const abortController = new AbortController();
    state.stripeFeesAbort = abortController;
    setStripeTransactionValues('Chargement...', 'Chargement...', true);
    try {
      const params = new URLSearchParams({ paymentIntentId });
      const payload = await fetchJson(
        `${STRIPE_TRANSACTION_FEES_ENDPOINT}?${params.toString()}`,
        abortController.signal
      );
      if (state.selectedSaleId !== saleId || ui.modal.hasAttribute('hidden')) return;
      const hasStripeData =
        Number.isFinite(Number(payload?.fee)) && Number.isFinite(Number(payload?.net));
      if (hasStripeData) {
        sale.stripeFee = Number(payload.fee);
        sale.stripeNet = Number(payload.net);
        sale.stripeAmount = Number.isFinite(Number(payload?.amount))
          ? Number(payload.amount)
          : null;
      }
      const totalAmount = Number.isFinite(Number(sale?.totalAmount)) ? Number(sale.totalAmount) : 0;
      const stripeAmountCents = Number.isFinite(Number(payload?.amount))
        ? Number(payload.amount)
        : hasStripeData
          ? Number(payload.fee) + Number(payload.net)
          : null;
      const feeLabel = hasStripeData
        ? buildStripeFeeLabel(Number(payload.fee), stripeAmountCents)
        : 'Donnees Stripe en cours de recuperation';
      const netLabel = hasStripeData
        ? buildNetRevenueLabel({
            totalAmount,
            stripeFeeCents: Number(payload.fee),
            providerCommissionAmount: sale?.commissionAmount,
            hasStripePayment: true
          })
        : 'Calcul en attente des donnees Stripe';
      setStripeTransactionValues(feeLabel, netLabel, false);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (state.selectedSaleId !== saleId || ui.modal.hasAttribute('hidden')) return;
      setStripeTransactionValues(
        'Donnees Stripe en cours de recuperation',
        'Calcul en attente des donnees Stripe',
        false
      );
    } finally {
      if (state.stripeFeesAbort === abortController) {
        state.stripeFeesAbort = null;
      }
    }
  };

  const closeModal = () => {
    if (state.stripeFeesAbort) {
      state.stripeFeesAbort.abort();
      state.stripeFeesAbort = null;
    }
    state.selectedSaleId = '';
    ui.modal.classList.remove('is-visible');
    ui.modal.setAttribute('hidden', '');
  };

  const openModal = saleId => {
    const sale = findSaleById(saleId);
    if (!sale) return;
    state.selectedSaleId = String(sale?.saleId || '');

    const invoiceUrl = saleInvoiceUrl(sale);
    const stripePaymentIntentId = String(sale?.stripePaymentIntentId || '').trim();
    const stripeTransactionId = stripePaymentIntentId || String(sale?.stripeSessionId || '').trim();

    // ── Client ──────────────────────────────────────────────────
    const firstName = String(sale?.customer?.firstName || '').trim();
    const lastName = String(sale?.customer?.lastName || '').trim();
    const customerName = [firstName, lastName].filter(Boolean).join(' ');
    const customerEmail = String(sale?.customer?.email || '').trim();

    // ── Dates ───────────────────────────────────────────────────
    const sessionDate = sale?.date_session || sale?.date_formation;

    // ── Articles ────────────────────────────────────────────────
    const items = Array.isArray(sale?.items) ? sale.items : [];
    const giftCardUsages = Array.isArray(sale?.giftCardUsage) ? sale.giftCardUsage : [];

    const formationItems = items.filter(item => item?.type === 'formation');
    const optionItems = items.filter(item => item?.type === 'formation-option');
    const productItems = items.filter(item => item?.type === 'product');
    const giftCardPurchaseItems = items.filter(item => item?.type === 'gift-card');
    const serviceItems = items.filter(item => item?.type === 'service');
    const serviceOptionItems = items.filter(item => item?.type === 'service-option');

    const itemsTotal = items.reduce((sum, item) => sum + Number(item?.finalPrice ?? item?.price ?? 0), 0);
    const giftCardTotal = giftCardUsages.reduce((sum, u) => sum + Number(u?.amountUsed ?? 0), 0);

    // ── Financials ──────────────────────────────────────────────
    const totalAmount = Number.isFinite(Number(sale?.totalAmount)) ? Number(sale.totalAmount) : 0;
    const stripePaymentAmount = Math.max(0, totalAmount - giftCardTotal);
    const hasStoredStripeFee = Number.isFinite(Number(sale?.stripeFee));
    const hasStoredStripeNet = Number.isFinite(Number(sale?.stripeNet));
    const storedStripeAmountCents = Number.isFinite(Number(sale?.stripeAmount))
      ? Number(sale.stripeAmount)
      : (hasStoredStripeFee && hasStoredStripeNet)
        ? Number(sale.stripeFee) + Number(sale.stripeNet)
        : stripePaymentAmount > 0 ? Math.round(stripePaymentAmount * 100) : null;

    const shouldLoadStripeData = Boolean(stripePaymentIntentId) && (
      !hasStoredStripeFee || !hasStoredStripeNet ||
      !Number.isFinite(Number(storedStripeAmountCents)) || Number(storedStripeAmountCents) <= 0
    );

    const stripeFeeLabel = hasStoredStripeFee
      ? buildStripeFeeLabel(Number(sale.stripeFee), storedStripeAmountCents)
      : stripePaymentIntentId ? 'Chargement…' : 'Non disponible';

    const netRevenueLabel = buildNetRevenueLabel({
      totalAmount,
      stripeFeeCents: hasStoredStripeFee ? Number(sale?.stripeFee) : null,
      providerCommissionAmount: sale?.commissionAmount,
      hasStripePayment: Boolean(stripePaymentIntentId)
    });

    const providerCommissionLabel = buildProviderCommissionLabel(sale?.commissionAmount, sale?.commissionRate);

    // ── Statut badge ─────────────────────────────────────────────
    const refundStatus = String(sale?.refundStatus || '').trim().toLowerCase();
    let statusBadgeClass = 'sdm-status-badge--confirmed';
    let statusBadgeLabel = 'Confirmée';
    if (refundStatus === 'succeeded') {
      statusBadgeClass = 'sdm-status-badge--refunded';
      statusBadgeLabel = 'Remboursée';
    } else if (refundStatus === 'pending' || refundStatus === 'requested') {
      statusBadgeClass = 'sdm-status-badge--pending';
      statusBadgeLabel = 'Remb. en cours';
    }

    // ── Section Formation ────────────────────────────────────────
    const formationItem = formationItems[0] || null;
    const formationType = sessionDate ? 'Présentielle' : 'Distancielle';
    const formationSectionHtml = formationItem ? `
      <div class="sdm-section">
        <p class="sdm-section-title">Formation</p>
        <p class="sdm-item-name">${escapeHtml(formationItem?.name || 'Formation')}</p>
        <div class="sdm-formation-meta">
          <span class="sdm-formation-type-chip">
            <i class="bi bi-${sessionDate ? 'geo-alt-fill' : 'camera-video'}"></i>
            ${escapeHtml(formationType)}
          </span>
          ${sessionDate ? `<span class="sdm-meta-date"><i class="bi bi-calendar-event"></i> ${escapeHtml(fmtDateShort(sessionDate))}</span>` : ''}
        </div>
      </div>
    ` : '';

    // ── Section Prestation ───────────────────────────────────────
    const serviceItem = serviceItems[0] || null;
    // Service section initially rendered with sale data; booking data loaded async below
    const serviceSectionHtml = serviceItem ? `
      <div class="sdm-section" data-sdm-service-section>
        <p class="sdm-section-title">Prestation</p>
        <p class="sdm-item-name">${escapeHtml(serviceItem?.name || 'Prestation')}</p>
        <p class="sdm-service-loading muted"><i class="bi bi-arrow-repeat"></i> Chargement des détails…</p>
      </div>
    ` : '';

    // ── Tableau de paiement ───────────────────────────────────────
    let paymentRowsHtml = '';

    if (formationItem) {
      paymentRowsHtml += `
        <div class="sdm-payment-row">
          <span class="sdm-row-label">${escapeHtml(formationItem?.name || 'Formation')}</span>
          <span class="sdm-row-amount">${fmtCurrency(formationItem?.finalPrice ?? formationItem?.price ?? 0)}</span>
        </div>`;
      for (const opt of optionItems) {
        paymentRowsHtml += `
          <div class="sdm-payment-row sdm-payment-row--option">
            <span class="sdm-row-label">${escapeHtml(opt?.name || 'Option')}</span>
            <span class="sdm-row-amount">${fmtCurrency(opt?.finalPrice ?? opt?.price ?? 0)}</span>
          </div>`;
      }
    }

    for (const p of productItems) {
      paymentRowsHtml += `
        <div class="sdm-payment-row">
          <span class="sdm-row-label">${escapeHtml(p?.name || 'Produit')}</span>
          <span class="sdm-row-amount">${fmtCurrency(p?.finalPrice ?? p?.price ?? 0)}</span>
        </div>`;
    }

    for (const gc of giftCardPurchaseItems) {
      paymentRowsHtml += `
        <div class="sdm-payment-row">
          <span class="sdm-row-label">${escapeHtml(gc?.name || 'Carte cadeau')}</span>
          <span class="sdm-row-amount">${fmtCurrency(gc?.finalPrice ?? gc?.price ?? 0)}</span>
        </div>`;
    }

    if (serviceItem) {
      // Payment rows for service — will be replaced by async booking load with full data
      paymentRowsHtml += `
        <div class="sdm-payment-row" data-sdm-service-payment-placeholder>
          <span class="sdm-row-label">${escapeHtml(serviceItem?.name || 'Prestation')}</span>
          <span class="sdm-row-amount">${fmtCurrency(totalAmount)}</span>
        </div>`;
    }

    paymentRowsHtml += `
      <div class="sdm-payment-row sdm-payment-row--subtotal">
        <span class="sdm-row-label">Sous-total</span>
        <span class="sdm-row-amount">${fmtCurrency(items.length > 0 ? itemsTotal : totalAmount)}</span>
      </div>`;

    if (giftCardUsages.length > 0) {
      for (const usage of giftCardUsages) {
        const codeText = usage?.code ? ` (code\u00a0: ${escapeHtml(usage.code)})` : '';
        paymentRowsHtml += `
          <div class="sdm-payment-row sdm-payment-row--giftcard">
            <span class="sdm-row-label"><i class="bi bi-gift"></i> Carte cadeau${codeText}</span>
            <span class="sdm-row-amount sdm-row-amount--negative">− ${fmtCurrency(Number(usage?.amountUsed ?? 0))}</span>
          </div>`;
      }
      paymentRowsHtml += `
        <div class="sdm-payment-row sdm-payment-row--stripe">
          <span class="sdm-row-label"><i class="bi bi-credit-card-2-front"></i> Payé par Stripe</span>
          <span class="sdm-row-amount">${fmtCurrency(stripePaymentAmount)}</span>
        </div>`;
    }

    // ── Synthèse financière ───────────────────────────────────────
    const loadingSpinnerHtml = `<span class="sales-detail-stripe-loading"><span class="sales-detail-stripe-spinner" aria-hidden="true"></span>Chargement…</span>`;

    const stripeFeeCell = `<span class="sales-detail-stripe-value${shouldLoadStripeData ? ' is-loading' : ''}" data-stripe-fee-value>${
      shouldLoadStripeData ? loadingSpinnerHtml : escapeHtml(stripeFeeLabel)
    }</span>`;

    const netRevenueCell = `<span class="sales-detail-stripe-value${shouldLoadStripeData ? ' is-loading' : ''}" data-stripe-net-value>${
      shouldLoadStripeData ? loadingSpinnerHtml : escapeHtml(netRevenueLabel)
    }</span>`;

    const hasProviderCommission = Number.isFinite(Number(sale?.commissionAmount));
    const providerCommissionRowHtml = hasProviderCommission ? `
      <div class="sdm-finance-row">
        <span class="sdm-finance-label">Commission prestataire</span>
        <span class="sdm-row-amount">${escapeHtml(providerCommissionLabel)}</span>
      </div>` : '';

    const financeRowsHtml = `
      <div class="sdm-finance-row">
        <span class="sdm-finance-label">Montant total client</span>
        <span class="sdm-row-amount">${fmtCurrency(totalAmount)}</span>
      </div>
      <div class="sdm-finance-row">
        <div class="sdm-finance-label-stack">
          <span>Commission Stripe</span>
          <span class="sdm-finance-sublabel">Calculée sur le montant Stripe uniquement${giftCardTotal > 0 ? ' (hors carte cadeau)' : ''}</span>
        </div>
        ${stripeFeeCell}
      </div>
      ${providerCommissionRowHtml}
      <div class="sdm-finance-row sdm-finance-row--net">
        <span class="sdm-finance-label">Revenu net</span>
        ${netRevenueCell}
      </div>`;

    // ── Section Stripe ────────────────────────────────────────────
    const stripeSectionHtml = stripeTransactionId ? `
      <div class="sdm-section">
        <p class="sdm-section-title">Transaction Stripe</p>
        <div class="sdm-stripe-id-row">
          <code class="sales-detail-stripe-id">${escapeHtml(stripeTransactionId)}</code>
          <button type="button" class="sales-detail-copy-button" data-copy-stripe-id="${escapeHtml(stripeTransactionId)}">Copier</button>
        </div>
        ${stripePaymentIntentId ? `<span class="sdm-payment-status"><i class="bi bi-check-circle-fill sdm-icon--success"></i> Paiement confirmé</span>` : ''}
      </div>` : '';

    // ── Section Remboursement ─────────────────────────────────────
    const refundSectionHtml = (refundStatus && refundStatus !== '') ? `
      <div class="sdm-section sdm-section--refund">
        <p class="sdm-section-title">Remboursement</p>
        <div class="sdm-refund-status-row">
          <i class="bi bi-arrow-counterclockwise"></i>
          <span>${escapeHtml(
            refundStatus === 'succeeded' ? 'Remboursé' :
            refundStatus === 'pending' ? 'En cours de traitement' :
            refundStatus === 'requested' ? 'Demande reçue' :
            refundStatus === 'failed' ? 'Échec' : refundStatus
          )}</span>
        </div>
        ${(Number.isFinite(Number(sale?.refundAmount)) && Number(sale.refundAmount) > 0)
          ? `<p class="sdm-refund-amount">Montant remboursé&nbsp;: <strong class="sdm-row-amount--negative">− ${fmtCurrency(Number(sale.refundAmount))}</strong></p>`
          : ''}
      </div>` : '';

    // ── Section Renonciations signées ────────────────────────────
    const waiverItemsWithSnapshot = items.filter(
      item => item?.consumerWaiverSnapshot?.waiverType
    );
    let waiverSignedSectionHtml = '';
    if (waiverItemsWithSnapshot.length) {
      const waiverTypeLabel = type => {
        if (type === 'legal') return 'Renonciation legale (droit de retractation 14j)';
        if (type === 'institut') return 'Politique de remboursement de l etablissement';
        if (type === 'both') return 'Renonciation legale + politique de l etablissement';
        return type || 'Inconnue';
      };
      // Group by waiverType
      const groupMap = new Map();
      waiverItemsWithSnapshot.forEach(item => {
        const snap = item.consumerWaiverSnapshot;
        const key = snap.waiverType;
        if (!groupMap.has(key)) {
          groupMap.set(key, { waiverType: key, acceptedAt: snap.waiverAcceptedAt, formations: [] });
        }
        if (item.name) groupMap.get(key).formations.push(item.name);
      });
      const waiverRows = Array.from(groupMap.values())
        .map(group => `
          <div class="sdm-waiver-item">
            <p class="sdm-waiver-type"><strong>${escapeHtml(waiverTypeLabel(group.waiverType))}</strong></p>
            ${group.formations.length ? `<p class="sdm-waiver-formations">${escapeHtml(group.formations.join(', '))}</p>` : ''}
            <p class="sdm-waiver-date">Signee le : ${escapeHtml(group.acceptedAt ? fmtDate(group.acceptedAt) : 'Date inconnue')}</p>
          </div>`)
        .join('');
      waiverSignedSectionHtml = `
        <div class="sdm-section sdm-section--waivers">
          <p class="sdm-section-title">Renonciations signees</p>
          <div class="sdm-waiver-list">${waiverRows}</div>
        </div>`;
    }

    // ── Section Preuves (collapsée) ───────────────────────────────
    const ipProof = normalizeProofValue(sale?.client_ip) || 'Non disponible';
    const waiverProof = normalizeProofValue(sale?.renonciation_text) ||
      normalizeProofValue(sale?.consumerWaiverAcceptedText) || 'Non applicable';

    const proofSectionHtml = `
      <div class="sdm-section sdm-section--proof">
        <p class="sdm-section-title">Preuves d'achat</p>
        <div class="sdm-proof-grid">
          <span class="sdm-proof-key">CGV acceptées</span><span class="sdm-proof-val">${escapeHtml(sale?.accepted_cgv ? 'Oui' : 'Non')}</span>
          <span class="sdm-proof-key">Date d'achat</span><span class="sdm-proof-val">${escapeHtml(fmtDate(sale?.date_achat || sale?.createdAt))}</span>
          <span class="sdm-proof-key">Adresse IP</span><span class="sdm-proof-val sdm-proof-val--mono">${escapeHtml(ipProof)}</span>
        </div>
        ${waiverProof !== 'Non applicable' ? `
          <details class="sdm-proof-details">
            <summary>Texte de renonciation</summary>
            <p class="sdm-proof-text">${escapeHtml(waiverProof)}</p>
          </details>` : ''}
      </div>`;

    // ── Render ────────────────────────────────────────────────────
    ui.modalDownload.dataset.url = invoiceUrl;
    ui.modalDownload.disabled = !invoiceUrl;

    ui.modalBody.innerHTML = `
      <div class="sdm-header-section">
        <div class="sdm-id-row">
          <span class="sdm-id-label">Vente</span>
          <code class="sales-detail-stripe-id">${escapeHtml(sale?.saleId || 'N/A')}</code>
          ${sale?.saleId ? `<button type="button" class="sales-detail-copy-button" data-copy-stripe-id="${escapeHtml(sale.saleId)}">Copier</button>` : ''}
        </div>
        <div class="sdm-date-status-row">
          <span class="sdm-date-text"><i class="bi bi-calendar3"></i> ${escapeHtml(fmtDate(sale?.createdAt))}</span>
          <span class="sdm-status-badge ${escapeHtml(statusBadgeClass)}">${escapeHtml(statusBadgeLabel)}</span>
        </div>
      </div>

      <div class="sdm-section">
        <p class="sdm-section-title">Client</p>
        ${customerName ? `<p class="sdm-item-name">${escapeHtml(customerName)}</p>` : ''}
        <a class="sdm-client-email" href="mailto:${escapeHtml(customerEmail)}">${escapeHtml(customerEmail || 'Email indisponible')}</a>
      </div>

      ${formationSectionHtml}
      ${serviceSectionHtml}

      <div class="sdm-section">
        <p class="sdm-section-title">Récapitulatif de paiement</p>
        <div class="sdm-payment-table">${paymentRowsHtml}</div>
      </div>

      <div class="sdm-section sdm-section--finance">
        <p class="sdm-section-title">Synthèse financière</p>
        <div class="sdm-finance-table">${financeRowsHtml}</div>
      </div>

      ${stripeSectionHtml}

      ${refundSectionHtml}

      ${waiverSignedSectionHtml}

      ${proofSectionHtml}
    `;

    ui.modal.removeAttribute('hidden');
    requestAnimationFrame(() => ui.modal.classList.add('is-visible'));
    if (shouldLoadStripeData) {
      void loadStripeTransactionFees(String(sale?.saleId || ''), stripePaymentIntentId);
    }

    // ── Async: load ServiceBooking details for service sales ──────
    if (serviceItem && String(sale?.saleId || '').trim()) {
      void (async () => {
        try {
          const bRes = await fetch(`/api/gestion/sales/${encodeURIComponent(sale.saleId)}/service-booking`);
          if (state.selectedSaleId !== String(sale?.saleId || '')) return; // modal changed
          const bData = await bRes.json().catch(() => ({}));
          const booking = bData.booking;

          const sectionEl = ui.modalBody.querySelector('[data-sdm-service-section]');
          const paymentPlaceholder = ui.modalBody.querySelector('[data-sdm-service-payment-placeholder]');
          if (!booking) {
            if (sectionEl) sectionEl.querySelector('.sdm-service-loading')?.remove();
            return;
          }

          const bookingTotalPrice = Number(booking.totalPrice || 0);
          const bookingDepositAmount = Number(booking.depositAmount || 0);
          const isDeposit = booking.paymentType === 'deposit' && bookingDepositAmount > 0;
          const remainingOnSite = isDeposit ? bookingTotalPrice - bookingDepositAmount : 0;
          const selectedOptions = Array.isArray(booking.selectedOptions) ? booking.selectedOptions : [];

          // Update service section
          if (sectionEl) {
            const optionsHtml = selectedOptions.length
              ? `<ul class="sdm-service-options">${selectedOptions.map(o =>
                  `<li><span class="sdm-service-option-name">${escapeHtml(o.name || '')}</span><span class="sdm-row-amount">${fmtCurrency(o.price || 0)}</span></li>`
                ).join('')}</ul>`
              : '';
            sectionEl.innerHTML = `
              <p class="sdm-section-title">Prestation</p>
              <p class="sdm-item-name">${escapeHtml(serviceItem?.name || 'Prestation')}</p>
              ${optionsHtml}
              ${isDeposit ? `<span class="sdm-formation-type-chip"><i class="bi bi-piggy-bank"></i> Acompte</span>` : ''}
            `;
          }

          // Update payment rows
          if (paymentPlaceholder) {
            const optRows = selectedOptions.map(o => `
              <div class="sdm-payment-row sdm-payment-row--option">
                <span class="sdm-row-label">${escapeHtml(o.name || 'Option')}</span>
                <span class="sdm-row-amount">${fmtCurrency(o.price || 0)}</span>
              </div>`).join('');
            const depositRows = isDeposit ? `
              <div class="sdm-payment-row sdm-payment-row--subtotal">
                <span class="sdm-row-label">Total prestation</span>
                <span class="sdm-row-amount">${fmtCurrency(bookingTotalPrice)}</span>
              </div>
              <div class="sdm-payment-row sdm-payment-row--deposit">
                <span class="sdm-row-label"><i class="bi bi-piggy-bank"></i> Acompte encaissé en ligne</span>
                <span class="sdm-row-amount">${fmtCurrency(totalAmount)}</span>
              </div>
              <div class="sdm-payment-row sdm-payment-row--deposit-remaining">
                <span class="sdm-row-label">Reste dû en présentiel</span>
                <span class="sdm-row-amount">${fmtCurrency(remainingOnSite)}</span>
              </div>` : '';
            const fullPriceLabel = isDeposit
              ? `${escapeHtml(serviceItem?.name || 'Prestation')} <span class="sdm-meta-note">(prix total)</span>`
              : escapeHtml(serviceItem?.name || 'Prestation');
            const serviceRow = `
              <div class="sdm-payment-row">
                <span class="sdm-row-label">${fullPriceLabel}</span>
                <span class="sdm-row-amount">${fmtCurrency(bookingTotalPrice)}</span>
              </div>`;
            const newHtml = `${serviceRow}${optRows}${depositRows}`;
            paymentPlaceholder.outerHTML = newHtml;
          }
        } catch {}
      })();
    }
  };

  const closeRefundModal = () => {
    if (!ui.refundModal) return;
    ui.refundModal.classList.remove('is-visible');
    ui.refundModal.setAttribute('hidden', '');
  };

  const setRecordCardExpandedState = (card, shouldExpand) => {
    if (!card) return;
    const toggleButton = card.querySelector('[data-toggle-card-details]');
    const collapsible = card.querySelector('.sales-record-card__collapsible');
    if (!toggleButton || !collapsible) return;
    card.classList.toggle('is-expanded', shouldExpand);
    toggleButton.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
    collapsible.setAttribute('aria-hidden', shouldExpand ? 'false' : 'true');
    const toggleLabel = toggleButton.querySelector('[data-toggle-label]');
    if (toggleLabel) toggleLabel.textContent = shouldExpand ? 'Reduire' : 'Details';
    const toggleIcon = toggleButton.querySelector('[data-toggle-icon]');
    if (toggleIcon) {
      toggleIcon.classList.toggle('bi-chevron-down', !shouldExpand);
      toggleIcon.classList.toggle('bi-chevron-up', shouldExpand);
    }
  };

  const openRefundModal = refundId => {
    const refund = (state.refunds || []).find(
      entry => String(entry?.refundId || '') === String(refundId || '')
    );
    if (!refund || !ui.refundModal || !ui.refundModalBody) return;
    const amount = Number.isFinite(Number(refund?.amount)) ? Number(refund.amount) : 0;
    const stripeStatus = normalizeRefundSubStatus(refund?.stripeRefundStatus || 'not_applicable');
    const giftStatus = normalizeRefundSubStatus(refund?.giftCardRefundStatus || 'not_applicable');
    const stripeAmount = Number.isFinite(Number(refund?.stripeRefundAmount))
      ? Number(refund.stripeRefundAmount)
      : null;
    const giftAmount = Number.isFinite(Number(refund?.giftCardRefundAmount))
      ? Number(refund.giftCardRefundAmount)
      : null;
    const normalizedStatus = String(refund?.status || '').trim().toLowerCase();
    const globalStatusLabel = normalizedStatus === 'succeeded' ? 'Rembourse' : 'En attente';
    const globalStatusClass = normalizedStatus === 'succeeded'
      ? 'sdm-status-badge--confirmed'
      : 'sdm-status-badge--pending';
    const requestedAtLabel = fmtDate(refund?.requestedAt);
    const clientFirstName = String(refund?.client?.firstName || '').trim();
    const clientLastName = String(refund?.client?.lastName || '').trim();
    const clientFullName = `${clientFirstName} ${clientLastName}`.trim() || 'Client';
    const clientEmail = String(refund?.client?.email || '').trim() || 'Email indisponible';
    const hasSessionDate = !Number.isNaN(new Date(refund?.sessionStartAt || '').getTime());
    const formationTypeLabel = hasSessionDate ? 'Presentielle' : 'Distancielle';
    const formationTypeIcon = hasSessionDate ? 'bi-people-fill' : 'bi-laptop';
    const stripeStatusLabel = getRefundSubStatusLabel(stripeStatus);
    const giftStatusLabel = getRefundSubStatusLabel(giftStatus);
    const stripeStatusChipClass = getRefundSubStatusChipClass(stripeStatus);
    const giftStatusChipClass = getRefundSubStatusChipClass(giftStatus);
    const stripeConfirmationDate = stripeStatus === 'succeeded'
      ? refund?.refundedAt || refund?.processedAt || null
      : null;
    const trackingUrl = buildRefundTrackingUrl(refund?.trackingToken);
    const creditNotePdfUrl = String(refund?.creditNotePdfUrl || '').trim();
    const showCreditNotePending = !creditNotePdfUrl && stripeStatus === 'succeeded';
    const showStripeSection =
      stripeStatus !== 'not_applicable' ||
      Boolean(String(refund?.stripeRefundId || '').trim()) ||
      (stripeAmount !== null && stripeAmount > 0);
    const showGiftCardButton = giftStatus === 'succeeded';

    ui.refundModalBody.innerHTML = `
      <div class="srm-header-section">
        <div class="sdm-id-row">
          <span class="sdm-id-label">Remboursement</span>
          <code class="sales-detail-stripe-id">${escapeHtml(refund?.refundId || 'N/A')}</code>
          ${refund?.refundId ? `<button type="button" class="sales-detail-copy-button" data-copy-stripe-id="${escapeHtml(refund.refundId)}">Copier</button>` : ''}
        </div>
        <div class="sdm-date-status-row">
          <span class="sdm-date-text"><i class="bi bi-calendar3"></i> ${escapeHtml(requestedAtLabel)}</span>
          <span class="sdm-status-badge ${escapeHtml(globalStatusClass)}">${escapeHtml(globalStatusLabel)}</span>
        </div>
      </div>

      <div class="sdm-section">
        <p class="sdm-section-title">Client</p>
        <p class="sdm-item-name">${escapeHtml(clientFullName)}</p>
        <a class="sdm-client-email" href="mailto:${escapeHtml(clientEmail)}">${escapeHtml(clientEmail)}</a>
      </div>

      <div class="sdm-section">
        <p class="sdm-section-title">Formation concernee</p>
        <p class="sdm-item-name">${escapeHtml(refund?.formationTitle || 'Formation')}</p>
        <div class="sdm-formation-meta">
          <span class="sdm-formation-type-chip"><i class="bi ${escapeHtml(formationTypeIcon)}"></i>${escapeHtml(formationTypeLabel)}</span>
          ${hasSessionDate ? `<span class="sdm-meta-date"><i class="bi bi-clock-history"></i>Session: ${escapeHtml(fmtDate(refund?.sessionStartAt))}</span>` : ''}
        </div>
        ${
          refund?.saleId
            ? `<button type="button" class="sales-detail-copy-button srm-sale-link" data-open-sale-from-refund="${escapeHtml(refund.saleId)}">Voir la vente ${escapeHtml(refund.saleId)}</button>`
            : ''
        }
      </div>

      <div class="sdm-section sdm-section--finance">
        <p class="sdm-section-title">Montants rembourses</p>
        <div class="srm-amount-table">
          <div class="srm-amount-row srm-amount-row--total">
            <span class="srm-amount-label">Montant total rembourse</span>
            <strong class="srm-amount-value">${fmtCurrency(amount)}</strong>
          </div>
          <div class="srm-amount-row">
            <span class="srm-amount-label">Remboursement bancaire</span>
            <strong class="srm-amount-value">${stripeAmount !== null ? fmtCurrency(stripeAmount) : 'Non applicable'}</strong>
          </div>
          <div class="srm-status-row">
            <span class="srm-status-spacer"></span>
            <span class="${escapeHtml(stripeStatusChipClass)}">${escapeHtml(stripeStatusLabel)}</span>
          </div>
          <div class="srm-amount-row">
            <span class="srm-amount-label">Recredit carte cadeau</span>
            <strong class="srm-amount-value">${giftAmount !== null ? fmtCurrency(giftAmount) : 'Non applicable'}</strong>
          </div>
          <div class="srm-status-row">
            <span class="srm-status-spacer"></span>
            <span class="${escapeHtml(giftStatusChipClass)}">${escapeHtml(giftStatusLabel)}</span>
            ${
              showGiftCardButton
                ? trackingUrl
                  ? `<a class="secondary-button srm-inline-action" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noreferrer noopener">Voir la carte</a>`
                  : '<button type="button" class="secondary-button srm-inline-action" disabled>Voir la carte</button>'
                : ''
            }
          </div>
        </div>
      </div>

      ${
        showStripeSection
          ? `<div class="sdm-section">
              <p class="sdm-section-title">Transaction Stripe</p>
              ${
                refund?.stripeRefundId
                  ? `<div class="sdm-stripe-id-row">
                       <code class="sales-detail-stripe-id">${escapeHtml(refund.stripeRefundId)}</code>
                       <button type="button" class="sales-detail-copy-button" data-copy-stripe-id="${escapeHtml(refund.stripeRefundId)}">Copier</button>
                     </div>`
                  : '<p class="muted">Identifiant Stripe indisponible</p>'
              }
              ${
                stripeConfirmationDate
                  ? `<span class="sdm-payment-status"><i class="bi bi-check-circle-fill sdm-icon--success"></i>Confirmation Stripe: ${escapeHtml(fmtDate(stripeConfirmationDate))}</span>`
                  : ''
              }
            </div>`
          : ''
      }

      ${
        creditNotePdfUrl || showCreditNotePending
          ? `<div class="sdm-section">
              <p class="sdm-section-title">Document comptable</p>
              ${
                creditNotePdfUrl
                  ? `<button type="button" class="secondary-button srm-inline-action" data-open-credit-note="${escapeHtml(creditNotePdfUrl)}">
                       <i class="bi bi-file-earmark-arrow-down"></i>
                       <span>Telecharger l'avoir</span>
                     </button>`
                  : '<p class="muted">Avoir en cours de generation</p>'
              }
            </div>`
          : ''
      }

      <div class="sdm-section">
        <p class="sdm-section-title">Suivi client</p>
        ${
          trackingUrl
            ? `<a class="srm-tracking-link" href="${escapeHtml(trackingUrl)}" target="_blank" rel="noreferrer noopener">Voir la page de suivi client <i class="bi bi-arrow-up-right"></i></a>`
            : '<p class="muted">Lien de suivi indisponible</p>'
        }
      </div>

      ${
        stripeStatus === 'failed'
          ? `<div class="sales-refund-alert srm-alert-block" role="alert">
               <p>Echec du remboursement Stripe — intervention manuelle requise.</p>
               <p>Verifier Stripe, corriger le moyen de remboursement si necessaire, puis relancer le flux.</p>
             </div>`
          : ''
      }
    `;
    ui.refundModal.removeAttribute('hidden');
    requestAnimationFrame(() => ui.refundModal.classList.add('is-visible'));
  };
  root.addEventListener('click', event => {
    const mainTab = event.target.closest('[data-main-tab]');
    if (mainTab) {
      if (mainTab.dataset.mainTab === TAB_RECORDS) {
        state.mainTab = TAB_RECORDS;
      } else if (mainTab.dataset.mainTab === TAB_REFUNDS) {
        state.mainTab = TAB_REFUNDS;
      } else {
        state.mainTab = TAB_ANALYTICS;
      }
      renderTabs();
      if (state.mainTab === TAB_RECORDS) loadRecords();
      if (state.mainTab === TAB_REFUNDS) loadRefunds();
      if (state.mainTab === TAB_ANALYTICS) {
        loadStats();
        loadPendingStripeCount();
      }
      return;
    }
    const periodBtn = event.target.closest('[data-period]');
    if (periodBtn) {
      state.period = periodBtn.dataset.period;
      state.bounds = bounds(state.period, state.reference);
      state.reference = state.bounds.start;
      renderPeriod();
      loadStats();
      return;
    }
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      if (Number(nav.dataset.nav) === 1 && root.querySelector('[data-nav="1"]').disabled) return;
      state.reference = move(state.period, state.reference, Number(nav.dataset.nav));
      state.bounds = bounds(state.period, state.reference);
      renderPeriod();
      loadStats();
      return;
    }
    const view = event.target.closest('[data-view]');
    if (view) {
      state.view = view.dataset.view === VIEW_CARTS ? VIEW_CARTS : VIEW_SALES;
      renderRecordView();
      return;
    }
    const toggleCardDetails = event.target.closest('[data-toggle-card-details]');
    if (toggleCardDetails) {
      const card = toggleCardDetails.closest('.sales-record-card');
      if (!card) return;
      const isExpanded = card.classList.contains('is-expanded');
      const container = card.parentElement;
      if (container) {
        container.querySelectorAll('.sales-record-card.is-expanded').forEach(openCard => {
          if (openCard === card) return;
          setRecordCardExpandedState(openCard, false);
        });
      }
      setRecordCardExpandedState(card, !isExpanded);
      return;
    }
    const detail = event.target.closest('[data-open-sale]');
    if (detail) return openModal(detail.dataset.openSale);
    const openRefund = event.target.closest('[data-open-refund]');
    if (openRefund) return openRefundModal(openRefund.dataset.openRefund);
    const openCreditNote = event.target.closest('[data-open-credit-note]');
    if (openCreditNote) {
      const url = String(openCreditNote.dataset.openCreditNote || '').trim();
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    const copyStripeId = event.target.closest('[data-copy-stripe-id]');
    if (copyStripeId) {
      const stripeId = String(copyStripeId.dataset.copyStripeId || '').trim();
      if (!stripeId) return;
      const fallbackCopy = () => {
        const input = document.createElement('textarea');
        input.value = stripeId;
        input.setAttribute('readonly', '');
        input.style.position = 'absolute';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      };
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(stripeId).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
      copyStripeId.textContent = 'Copié';
      window.setTimeout(() => {
        if (copyStripeId.isConnected) copyStripeId.textContent = 'Copier';
      }, 1200);
      return;
    }
    const close = event.target.closest('[data-action="close-modal"]');
    if (close || event.target === ui.modal) return closeModal();
    const closeRefund = event.target.closest('[data-action="close-refund-modal"]');
    if (closeRefund || event.target === ui.refundModal) return closeRefundModal();
    const saleFromRefund = event.target.closest('[data-open-sale-from-refund]');
    if (saleFromRefund) {
      const saleId = String(saleFromRefund.dataset.openSaleFromRefund || '').trim();
      if (!saleId) return;
      if (!state.sales) {
        void loadRecords().then(() => {
          closeRefundModal();
          openModal(saleId);
        });
      } else {
        closeRefundModal();
        openModal(saleId);
      }
      return;
    }
    const download = event.target.closest('[data-action="download"]');
    if (download && !download.disabled) {
      const link = document.createElement('a');
      link.href = download.dataset.url || '';
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  });

  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!ui.modal.hasAttribute('hidden')) {
      closeModal();
    }
    if (ui.refundModal && !ui.refundModal.hasAttribute('hidden')) {
      closeRefundModal();
    }
  });

  ui.searchInput.addEventListener('input', event => {
    state.search = String(event.target.value || '');
    scheduleSearchRender();
  });

  // Type filter buttons
  root.querySelectorAll('[data-type-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.salesTypeFilter = btn.dataset.typeFilter || 'all';
      root.querySelectorAll('[data-type-filter]').forEach(b => b.classList.toggle('is-active', b === btn));
      renderSalesList();
    });
  });

  ui.refundSearchInput?.addEventListener('input', event => {
    state.refundSearch = String(event.target.value || '');
    scheduleRefundSearchRender();
  });

  renderTabs();
  renderRecordView();
  renderPeriod();
  await loadStats();
  await loadPendingStripeCount();
}




