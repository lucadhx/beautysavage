import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API_ROOT = '/api/gestion/clients';
const DETAIL_CARD_ENDPOINT = id => `/api/gestion/gift-cards/${encodeURIComponent(String(id || '').trim())}`;
const MIN_LOADER_MS = 400;
const MODAL_CLOSE_MS = 180;

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  view: 'list',           // 'list' | 'detail'
  clients: [],
  search: '',
  searchTimer: null,
  selectedClientId: null,
  detail: null,
  tab: 'sales',
  loading: false,
  detailLoading: false,
  detailError: '',
  chartPeriod: '7d',
  chartData: null,
  chartInstance: null
};

const TABS = [
  { key: 'sales', label: 'Achats' },
  { key: 'bookings', label: 'Prestations' },
  { key: 'noshows', label: 'No-shows' },
  { key: 'refunds', label: 'Remboursements' },
  { key: 'giftcards', label: 'Cartes cadeaux' },
  { key: 'reviews', label: 'Avis' }
];

let root = null;
let listAbort = null;
let detailAbort = null;
let searchDebounceTimer = null;

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return 'Date inconnue';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(value) {
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return 'Date inconnue';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    Number.isFinite(Number(value)) ? Number(value) : 0
  );
}

function debounce(fn, delay) {
  return (...args) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => fn(...args), delay);
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : Promise.resolve({});
}

async function request(endpoint, options = {}) {
  const response = await fetch(endpoint, { credentials: 'include', ...options });
  const payload = await getJson(response);
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error || payload?.message || 'Requête impossible.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload || {};
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function buildAvatar(displayName) {
  const parts = String(displayName || '').trim().split(' ').filter(Boolean);
  const initials = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : (parts[0] || '?')[0];
  return `<div class="clm-avatar">${escapeHtml(initials.toUpperCase())}</div>`;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

function loaderMarkup(label = 'Chargement...') {
  return `
    <div class="clm-loader" role="status" aria-live="polite">
      <div class="clm-loader__paws" aria-hidden="true">
        <span>${PAW_ICON_SVG}</span>
        <span>${PAW_ICON_SVG}</span>
        <span>${PAW_ICON_SVG}</span>
      </div>
      <p>${escapeHtml(label)}</p>
    </div>
  `;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function bookingStatusLabel(status) {
  const map = {
    pending_payment: 'En attente',
    confirmed: 'Confirmée',
    cancelled: 'Annulée',
    no_show: 'No-show',
    completed: 'Terminée'
  };
  return map[status] || status || '';
}

function refundStatusLabel(status) {
  const map = {
    requested: 'Demandé',
    pending: 'En cours',
    succeeded: 'Validé',
    failed: 'Échoué',
    canceled: 'Annulé'
  };
  return map[status] || status || '';
}

function refundStatusClass(status) {
  if (status === 'succeeded') return 'clm-badge--succeeded';
  if (status === 'failed') return 'clm-badge--failed';
  return 'clm-badge--pending';
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function mountModal(markup) {
  document.body.querySelector('[data-clm-modal]')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'gcg-modal-overlay clm-modal-overlay';
  overlay.setAttribute('data-clm-modal', 'true');
  overlay.innerHTML = markup;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return overlay;
}

function bindModalClose(overlay, close) {
  const onEsc = event => { if (event.key !== 'Escape') return; event.preventDefault(); close(); };
  const onOutside = event => { if (event.target === overlay) close(); };
  window.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', onOutside);
  return () => { window.removeEventListener('keydown', onEsc); overlay.removeEventListener('click', onOutside); };
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  setTimeout(() => overlay.remove(), MODAL_CLOSE_MS);
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function openSaleModal(saleId) {
  const sales = Array.isArray(state.detail?.sales) ? state.detail.sales : [];
  const sale = sales.find(entry => String(entry?.saleId || entry?.id || '') === String(saleId || ''));
  if (!sale) return;
  const overlay = mountModal(`
    <div class="gcg-modal-panel clm-modal-panel" role="dialog" aria-modal="true">
      <header class="gcg-modal-panel__header">
        <h3>Détail vente</h3>
        <button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button>
      </header>
      <div class="gcg-modal-panel__body clm-modal-scroll">
        <p><strong>ID vente :</strong> ${escapeHtml(sale?.saleId || sale?.id || 'N/A')}</p>
        <p><strong>Date :</strong> ${escapeHtml(formatDateTime(sale?.createdAt))}</p>
        <p><strong>Montant total :</strong> ${escapeHtml(formatCurrency(sale?.amount ?? sale?.totalAmount ?? 0))}</p>
        <h4>Articles</h4>
        ${Array.isArray(sale?.items) && sale.items.length
          ? `<ul class="clm-sale-items">${sale.items.map(item => `<li><span>${escapeHtml(item?.name || item?.type || 'Article')}</span><strong>${escapeHtml(formatCurrency(item?.finalPrice ?? item?.price ?? 0))}</strong></li>`).join('')}</ul>`
          : '<p class="clm-empty">Aucun article.</p>'}
        <section class="clm-proof-block">
          <h4>Preuves d\'achat</h4>
          <p><strong>Adresse IP :</strong> ${escapeHtml(String(sale?.client_ip || '').trim() || 'Non disponible')}</p>
          <p><strong>Renonciation :</strong></p>
          <p class="clm-proof-text">${escapeHtml(String(sale?.consumerWaiverAcceptedText || '').trim() || 'Non applicable')}</p>
        </section>
      </div>
      <div class="gcg-modal-panel__actions">
        ${sale?.invoice?.downloadUrl
          ? `<a class="gcg-outline-button" href="${escapeHtml(sale.invoice.downloadUrl)}" target="_blank" rel="noreferrer noopener"><i class="bi bi-download"></i><span>Facture</span></a>`
          : ''}
        <button type="button" class="gcg-accent-button" data-close>Fermer</button>
      </div>
    </div>
  `);
  const close = () => { cleanup(); closeModal(overlay); };
  const cleanup = bindModalClose(overlay, close);
  overlay.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));
}

function openReviewModal(reviewId) {
  const reviews = Array.isArray(state.detail?.reviews) ? state.detail.reviews : [];
  const review = reviews.find(entry => String(entry?.id || '') === String(reviewId || ''));
  if (!review || !String(review?.comment || '').trim()) return;
  const overlay = mountModal(`
    <div class="gcg-modal-panel clm-modal-panel clm-modal-panel--comment" role="dialog" aria-modal="true">
      <header class="gcg-modal-panel__header">
        <h3>Commentaire client</h3>
        <button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button>
      </header>
      <div class="gcg-modal-panel__body clm-modal-scroll">
        <p><strong>${escapeHtml(review?.formation || 'Formation')}</strong></p>
        <p>${escapeHtml(review.comment)}</p>
      </div>
      <div class="gcg-modal-panel__actions">
        <button type="button" class="gcg-accent-button" data-close>Fermer</button>
      </div>
    </div>
  `);
  const close = () => { cleanup(); closeModal(overlay); };
  const cleanup = bindModalClose(overlay, close);
  overlay.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));
}

function openGiftCardModal(cardId) {
  const id = String(cardId || '').trim();
  if (!id) return;
  const overlay = mountModal(`
    <div class="gcg-modal-panel clm-modal-panel" role="dialog" aria-modal="true">
      <header class="gcg-modal-panel__header">
        <h3>Détail carte cadeau</h3>
        <button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button>
      </header>
      <div class="gcg-modal-panel__body clm-modal-scroll" data-body>${loaderMarkup('Chargement...')}</div>
      <div class="gcg-modal-panel__actions">
        <button type="button" class="gcg-accent-button" data-close>Fermer</button>
      </div>
    </div>
  `);
  const close = () => { cleanup(); closeModal(overlay); };
  const cleanup = bindModalClose(overlay, close);
  overlay.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));
  const body = overlay.querySelector('[data-body]');
  request(DETAIL_CARD_ENDPOINT(id))
    .then(payload => {
      if (!body) return;
      const card = payload?.card || {};
      const transactions = Array.isArray(payload?.transactions) ? payload.transactions : [];
      body.innerHTML = `
        <div class="clm-gift-detail-grid">
          <p>Date d'achat : <strong>${escapeHtml(formatDateTime(card?.purchasedAt || card?.createdAt))}</strong></p>
          <p>Acheteur : <strong>${escapeHtml(card?.ownerEmail || 'Non renseigné')}</strong></p>
          <p>Solde initial : <strong>${escapeHtml(formatCurrency(card?.amount || 0))}</strong></p>
          <p>Solde restant : <strong>${escapeHtml(formatCurrency(card?.balance || 0))}</strong></p>
        </div>
        <h4>Transactions</h4>
        ${transactions.length
          ? transactions.map(entry => `
              <article class="clm-gift-transaction">
                <p><strong>${escapeHtml(entry?.transactionType === 'manual_debit' ? 'Débit manuel' : 'Utilisation checkout')}</strong> — ${escapeHtml(formatDateTime(entry?.createdAt))}</p>
                <p>Montant : ${escapeHtml(formatCurrency(entry?.amount || 0))}</p>
                <p>Avant : ${escapeHtml(formatCurrency(entry?.balanceBefore || 0))} | Après : ${escapeHtml(formatCurrency(entry?.balanceAfter || 0))}</p>
                ${entry?.note ? `<p>Note : ${escapeHtml(entry.note)}</p>` : ''}
              </article>`).join('')
          : '<p class="clm-empty">Aucune transaction.</p>'}
      `;
    })
    .catch(error => {
      if (body) body.innerHTML = `<p class="clm-empty clm-empty--error">${escapeHtml(error?.message || 'Impossible de charger la carte.')}</p>`;
      showToast({ type: 'error', message: 'Erreur chargement carte cadeau', durationMs: 1500 });
      logUiError('ClientManager:GiftCardDetail', error, { cardId: id });
    });
}

// ─── Chart.js ─────────────────────────────────────────────────────────────────

async function ensureChart() {
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function loadChartData(period = '7d') {
  const payload = await request(`${API_ROOT}/stats?period=${encodeURIComponent(period)}`);
  return payload;
}

async function renderChart(period = state.chartPeriod) {
  await ensureChart();
  const canvas = root?.querySelector('[data-clm-chart-canvas]');
  if (!canvas) return;

  let payload;
  try {
    payload = await loadChartData(period);
  } catch (_) {
    canvas.closest('[data-clm-chart-section]')?.querySelector('.clm-chart-wrap')
      ?.insertAdjacentHTML('beforeend', '<p class="clm-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">Données indisponibles</p>');
    return;
  }

  // Destroy previous instance
  if (state.chartInstance) {
    state.chartInstance.destroy();
    state.chartInstance = null;
  }

  const ctx = canvas.getContext('2d');
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--theme-accent').trim() || '#6366f1';

  // Dégradé fill
  const canvasHeight = canvas.offsetHeight || 180;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  // Build rgba from hex or css var fallback
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    if (h.length === 6) {
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return `rgba(99,102,241,${alpha})`;
  }
  const colorStart = accentColor.startsWith('#') ? hexToRgba(accentColor, 0.18) : 'rgba(99,102,241,0.18)';
  const colorEnd = accentColor.startsWith('#') ? hexToRgba(accentColor, 0) : 'rgba(99,102,241,0)';
  gradient.addColorStop(0, colorStart);
  gradient.addColorStop(1, colorEnd);

  state.chartInstance = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: payload.labels || [],
      datasets: [{
        data: payload.data || [],
        borderColor: accentColor,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: accentColor,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.05)' }
        }
      }
    }
  });
}

// ─── Render: List view ────────────────────────────────────────────────────────

function renderListView() {
  const listWrap = root?.querySelector('[data-clm-list]');
  if (!listWrap) return;

  const clients = Array.isArray(state.clients) ? state.clients : [];

  if (state.loading) {
    listWrap.innerHTML = loaderMarkup('Chargement des clients...');
    return;
  }

  if (!clients.length) {
    listWrap.innerHTML = `
      <div class="clm-table-header">
        <span>Nom</span>
        <span class="clm-col--email">Email</span>
        <span class="clm-col--date">Inscrit le</span>
        <span>Statut</span>
        <span></span>
      </div>
      <p class="clm-empty">${escapeHtml(state.search ? 'Aucun client trouvé pour cette recherche.' : 'Aucun client enregistré.')}</p>
    `;
    return;
  }

  const rows = clients.map(client => {
    const suspended = Boolean(client?.bookingSuspended);
    const noShowCount = Number(client?.noShowCount) || 0;
    const displayName = escapeHtml(client?.displayName || client?.email || 'Client');
    const email = escapeHtml(client?.email || '');
    const registeredAt = escapeHtml(formatDate(client?.createdAt || client?.registeredAt));
    const clientId = escapeHtml(client?.id || '');

    const statusBadges = [
      suspended ? `<span class="clm-badge clm-badge--suspended">Suspendu</span>` : '',
      noShowCount > 0 ? `<span class="clm-badge clm-badge--noshows">${noShowCount} no-show${noShowCount > 1 ? 's' : ''}</span>` : ''
    ].filter(Boolean).join('');

    return `
      <div class="clm-table-row" data-action="open-client-detail" data-client-id="${clientId}" role="button" tabindex="0">
        <span class="clm-col--name">${displayName}</span>
        <span class="clm-col--email">${email}</span>
        <span class="clm-col--date">${registeredAt}</span>
        <span class="clm-col--status">${statusBadges || ''}</span>
        <span class="clm-col--action"><i class="bi bi-chevron-right clm-chevron" aria-hidden="true"></i></span>
      </div>
    `;
  }).join('');

  listWrap.innerHTML = `
    <div class="clm-table-header">
      <span>Nom</span>
      <span class="clm-col--email">Email</span>
      <span class="clm-col--date">Inscrit le</span>
      <span>Statut</span>
      <span></span>
    </div>
    ${rows}
  `;
}

// ─── Render: Detail header ────────────────────────────────────────────────────

function renderDetailHeader() {
  const container = root?.querySelector('[data-clm-detail-header]');
  if (!container) return;
  const client = state.detail?.client || {};
  const suspended = Boolean(client?.bookingSuspended);
  const noShowCount = Number(client?.noShowCount || state.detail?.noShowCount) || 0;
  const sales = Array.isArray(state.detail?.sales) ? state.detail.sales : [];
  const serviceBookings = Array.isArray(state.detail?.serviceBookings) ? state.detail.serviceBookings : [];
  const totalSpent = sales.reduce((sum, s) => sum + Number(s?.totalAmount || s?.amount || 0), 0);
  const displayName = String(client?.displayName || `${client?.firstName || ''} ${client?.lastName || ''}`.trim() || client?.email || 'Client');
  const email = escapeHtml(client?.email || '');
  const registeredAt = escapeHtml(formatDate(client?.createdAt));

  container.innerHTML = `
    <div class="clm-detail-shell">
      <button type="button" class="clm-back-btn" data-action="back-to-client-list">
        <i class="bi bi-arrow-left" aria-hidden="true"></i> Retour
      </button>

      <div class="clm-client-header">
        ${buildAvatar(displayName)}
        <div class="clm-client-info">
          <div class="clm-client-name">
            ${escapeHtml(displayName)}
            ${suspended ? '<span class="clm-badge clm-badge--suspended">Suspendu</span>' : ''}
          </div>
          <div class="clm-client-email">${email}</div>
          <div class="clm-client-since">Inscrit le ${registeredAt}</div>
        </div>
      </div>

      <div class="clm-kpi-grid">
        <div class="clm-kpi">
          <div class="clm-kpi__value">${noShowCount}</div>
          <div class="clm-kpi__label">No-shows</div>
        </div>
        <div class="clm-kpi">
          <div class="clm-kpi__value">${serviceBookings.length}</div>
          <div class="clm-kpi__label">Prestations</div>
        </div>
        <div class="clm-kpi">
          <div class="clm-kpi__value">${escapeHtml(formatCurrency(totalSpent))}</div>
          <div class="clm-kpi__label">Total achats</div>
        </div>
      </div>

      <div class="clm-suspension-action">
        ${suspended
          ? `<button type="button" class="clm-btn-unsuspend" data-action="toggle-suspension" data-suspended="true">
              <i class="bi bi-check-circle" aria-hidden="true"></i> Lever la suspension
             </button>`
          : `<button type="button" class="clm-btn-suspend" data-action="toggle-suspension" data-suspended="false">
              <i class="bi bi-slash-circle" aria-hidden="true"></i> Suspendre
             </button>`}
      </div>
    </div>
  `;
}

// ─── Render: Tabs ─────────────────────────────────────────────────────────────

function renderTabs() {
  const nav = root?.querySelector('[data-clm-tabs]');
  if (!nav) return;
  nav.innerHTML = TABS.map(tab => `
    <button
      type="button"
      class="clm-tab-btn${state.tab === tab.key ? ' is-active' : ''}"
      data-action="set-tab"
      data-tab="${escapeHtml(tab.key)}"
      aria-selected="${state.tab === tab.key}"
    >${escapeHtml(tab.label)}</button>
  `).join('');
}

// ─── Render: Tab panels ───────────────────────────────────────────────────────

function renderTabPanel() {
  const panel = root?.querySelector('[data-clm-tab-panel]');
  if (!panel) return;

  if (state.detailLoading) {
    panel.innerHTML = loaderMarkup('Chargement de la fiche client...');
    return;
  }
  if (state.detailError) {
    panel.innerHTML = `<p class="clm-empty clm-empty--error">${escapeHtml(state.detailError)}</p>`;
    return;
  }
  if (!state.detail) {
    panel.innerHTML = '<p class="clm-empty">Aucune donnée disponible.</p>';
    return;
  }

  const { tab } = state;

  if (tab === 'sales') {
    const sales = Array.isArray(state.detail.sales) ? state.detail.sales : [];
    panel.innerHTML = sales.length
      ? `<div class="clm-item-list">${sales.map(entry => `
          <div class="clm-item">
            <div class="clm-item__main">
              <p class="clm-item__title">${escapeHtml(entry?.saleId || entry?.id || 'Vente')}</p>
              <p class="clm-item__meta">${escapeHtml(formatDateTime(entry?.createdAt))} · <strong>${escapeHtml(formatCurrency(entry?.amount ?? entry?.totalAmount ?? 0))}</strong></p>
            </div>
            <div class="clm-item__actions">
              <button type="button" class="clm-detail-btn" data-action="open-sale-detail" data-sale-id="${escapeHtml(entry?.saleId || entry?.id || '')}">
                <i class="bi bi-receipt" aria-hidden="true"></i> Détail
              </button>
            </div>
          </div>`).join('')}</div>`
      : '<p class="clm-empty">Aucun achat enregistré.</p>';
    return;
  }

  if (tab === 'bookings') {
    const bookings = Array.isArray(state.detail.serviceBookings) ? state.detail.serviceBookings : [];
    panel.innerHTML = bookings.length
      ? `<div class="clm-item-list">${bookings.map(bk => {
          const statusClass = `clm-badge--${String(bk?.status || '').toLowerCase()}`;
          return `
            <div class="clm-item">
              <div class="clm-item__main">
                <p class="clm-item__title">
                  ${escapeHtml(bk?.serviceName || 'Prestation')}
                  <span class="clm-badge ${escapeHtml(statusClass)}">${escapeHtml(bookingStatusLabel(bk?.status))}</span>
                </p>
                <p class="clm-item__meta">${escapeHtml(bk?.startAt ? formatDateTime(bk.startAt) : 'Date inconnue')} · Acompte : ${escapeHtml(formatCurrency(bk?.depositAmount))} · Total : ${escapeHtml(formatCurrency(bk?.totalPrice))}</p>
                ${bk?.cancelledAt ? `<p class="clm-item__meta">Annulée le ${escapeHtml(formatDateTime(bk.cancelledAt))} par ${escapeHtml(bk?.cancelledBy || '?')}</p>` : ''}
              </div>
            </div>`;
        }).join('')}</div>`
      : '<p class="clm-empty">Aucune prestation enregistrée.</p>';
    return;
  }

  if (tab === 'noshows') {
    const noshows = Array.isArray(state.detail.noShowRecords) ? state.detail.noShowRecords : [];
    panel.innerHTML = noshows.length
      ? `<div class="clm-item-list">${noshows.map(ns => `
          <div class="clm-item">
            <div class="clm-item__main">
              <p class="clm-item__title">${escapeHtml(ns?.serviceName || 'Prestation')}</p>
              <p class="clm-item__meta">${ns?.scheduledAt ? escapeHtml(formatDateTime(ns.scheduledAt)) : ''} · Enregistré le ${escapeHtml(formatDateTime(ns?.recordedAt))}</p>
            </div>
          </div>`).join('')}</div>`
      : '<p class="clm-empty">Aucun no-show enregistré.</p>';
    return;
  }

  if (tab === 'refunds') {
    const refunds = Array.isArray(state.detail.refundRequests) ? state.detail.refundRequests : [];
    panel.innerHTML = refunds.length
      ? `<div class="clm-item-list">${refunds.map(rr => {
          const badgeClass = refundStatusClass(rr?.status);
          return `
            <div class="clm-item">
              <div class="clm-item__main">
                <p class="clm-item__title">
                  ${escapeHtml(formatCurrency(rr?.amount))}
                  <span class="clm-badge ${escapeHtml(badgeClass)}">${escapeHtml(refundStatusLabel(rr?.status))}</span>
                </p>
                <p class="clm-item__meta">Type : ${escapeHtml(rr?.itemType || '?')} · Demandé le ${escapeHtml(formatDate(rr?.requestedAt))}${rr?.refundedAt ? ` · Remboursé le ${escapeHtml(formatDate(rr.refundedAt))}` : ''}</p>
              </div>
            </div>`;
        }).join('')}</div>`
      : '<p class="clm-empty">Aucune demande de remboursement.</p>';
    return;
  }

  if (tab === 'giftcards') {
    const giftCards = Array.isArray(state.detail.giftCards) ? state.detail.giftCards : [];
    panel.innerHTML = giftCards.length
      ? `<div class="clm-item-list">${giftCards.map(entry => {
          const isRedeemed = String(entry?.status || '').toLowerCase() === 'redeemed';
          return `
            <div class="clm-item">
              <div class="clm-item__main">
                <p class="clm-item__title">
                  ${escapeHtml(entry?.code || 'Carte')}
                  <span class="clm-badge ${isRedeemed ? 'clm-badge--cancelled' : 'clm-badge--confirmed'}">${isRedeemed ? 'Épuisée' : 'Active'}</span>
                </p>
                <p class="clm-item__meta">Montant initial : ${escapeHtml(formatCurrency(entry?.amount))} · Solde : ${escapeHtml(formatCurrency(entry?.balance))}</p>
              </div>
              <div class="clm-item__actions">
                <button type="button" class="clm-detail-btn" data-action="open-gift-card-detail" data-card-id="${escapeHtml(entry?.id || '')}">
                  <i class="bi bi-info-circle" aria-hidden="true"></i> Détail
                </button>
              </div>
            </div>`;
        }).join('')}</div>`
      : '<p class="clm-empty">Aucune carte cadeau.</p>';
    return;
  }

  if (tab === 'reviews') {
    const reviews = Array.isArray(state.detail.reviews) ? state.detail.reviews : [];
    panel.innerHTML = reviews.length
      ? `<div class="clm-item-list">${reviews.map(entry => {
          const stars = Array.from({ length: 5 }, (_, i) => `<i class="bi ${i < Number(entry?.rating || 0) ? 'bi-star-fill' : 'bi-star'}" aria-hidden="true"></i>`).join('');
          return `
            <div class="clm-item">
              <div class="clm-item__main">
                <p class="clm-item__title">${escapeHtml(entry?.formation || 'Formation')}</p>
                <p class="clm-item__meta">${stars} · ${escapeHtml(formatDate(entry?.createdAt))}${String(entry?.comment || '').trim() ? ' · avec commentaire' : ''}</p>
              </div>
              ${String(entry?.comment || '').trim()
                ? `<div class="clm-item__actions"><button type="button" class="clm-detail-btn" data-action="open-review-comment" data-review-id="${escapeHtml(entry?.id || '')}"><i class="bi bi-chat-left-text" aria-hidden="true"></i> Voir</button></div>`
                : ''}
            </div>`;
        }).join('')}</div>`
      : '<p class="clm-empty">Aucun avis.</p>';
    return;
  }

  panel.innerHTML = '<p class="clm-empty">Onglet inconnu.</p>';
}

// ─── Render: Full detail ──────────────────────────────────────────────────────

function renderDetail() {
  renderDetailHeader();
  renderTabs();
  renderTabPanel();
}

// ─── Render: View switching ───────────────────────────────────────────────────

function renderView() {
  const listSection = root?.querySelector('[data-clm-list-section]');
  const detailSection = root?.querySelector('[data-clm-detail-section]');
  if (!listSection || !detailSection) return;
  const isList = state.view === 'list';
  listSection.style.display = isList ? '' : 'none';
  detailSection.style.display = isList ? 'none' : '';
  listSection.hidden = !isList;
  detailSection.hidden = isList;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadClients(search = '') {
  const startedAt = Date.now();
  state.loading = true;
  const listWrap = root?.querySelector('[data-clm-list]');
  if (listWrap) listWrap.innerHTML = loaderMarkup('Chargement des clients...');

  if (listAbort) listAbort.abort();
  listAbort = new AbortController();

  const endpoint = search ? `${API_ROOT}?search=${encodeURIComponent(search)}` : API_ROOT;

  try {
    const payload = await request(endpoint, { signal: listAbort.signal });
    const remain = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remain > 0) await wait(remain);
    state.clients = Array.isArray(payload?.clients) ? payload.clients : [];
    state.loading = false;
    renderListView();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    const remain = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remain > 0) await wait(remain);
    state.clients = [];
    state.loading = false;
    if (listWrap) listWrap.innerHTML = `<p class="clm-empty clm-empty--error">${escapeHtml(error?.message || 'Impossible de charger les clients.')}</p>`;
    showToast({ type: 'error', message: 'Impossible de charger les clients', durationMs: 1500 });
    logUiError('ClientManager:ListClients', error, { endpoint });
  }
}

async function openDetail(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return;
  state.view = 'detail';
  state.selectedClientId = id;
  state.detail = null;
  state.detailError = '';
  state.detailLoading = true;
  state.tab = 'sales';
  renderView();
  renderDetail();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (detailAbort) detailAbort.abort();
  detailAbort = new AbortController();
  const startedAt = Date.now();
  try {
    const payload = await request(`${API_ROOT}/${encodeURIComponent(id)}`, { signal: detailAbort.signal });
    const remain = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remain > 0) await wait(remain);
    state.detail = payload || null;
    state.detailLoading = false;
    state.detailError = '';
    renderDetail();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    const remain = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remain > 0) await wait(remain);
    state.detail = null;
    state.detailLoading = false;
    state.detailError = error?.message || 'Impossible de charger la fiche client.';
    renderDetail();
    showToast({ type: 'error', message: 'Échec chargement fiche client', durationMs: 1500 });
    logUiError('ClientManager:ClientDetail', error, { endpoint: `${API_ROOT}/${id}` });
  }
}

async function toggleSuspension(clientId, currentlySuspended) {
  const id = String(clientId || '').trim();
  if (!id) return;
  const newSuspended = !currentlySuspended;
  try {
    await request(`${API_ROOT}/${encodeURIComponent(id)}/suspension`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspended: newSuspended })
    });
    showToast({
      type: 'success',
      message: newSuspended ? 'Client suspendu' : 'Suspension levée',
      durationMs: 1500
    });
    await openDetail(id);
  } catch (error) {
    showToast({ type: 'error', message: error?.message || 'Impossible de modifier la suspension', durationMs: 2000 });
    logUiError('ClientManager:ToggleSuspension', error, { clientId: id });
  }
}

// ─── Event handling ───────────────────────────────────────────────────────────

const debouncedSearch = debounce(async (value) => {
  state.search = value;
  await loadClients(value);
}, 300);

function onSearchInput(event) {
  const value = String(event.target?.value || '').trim();
  debouncedSearch(value);
}

function onClick(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger || !root?.contains(trigger)) return;
  const action = String(trigger.dataset.action || '').trim();

  if (action === 'open-client-detail') {
    void openDetail(String(trigger.dataset.clientId || '').trim());
    return;
  }
  if (action === 'back-to-client-list') {
    if (detailAbort) { detailAbort.abort(); detailAbort = null; }
    state.view = 'list';
    state.selectedClientId = null;
    state.detail = null;
    state.detailLoading = false;
    state.detailError = '';
    state.tab = 'sales';
    renderView();
    renderListView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (action === 'set-tab') {
    state.tab = String(trigger.dataset.tab || '').trim();
    renderTabs();
    renderTabPanel();
    return;
  }
  if (action === 'toggle-suspension') {
    const currentlySuspended = trigger.dataset.suspended === 'true';
    void toggleSuspension(state.selectedClientId, currentlySuspended);
    return;
  }
  if (action === 'open-sale-detail') {
    openSaleModal(String(trigger.dataset.saleId || '').trim());
    return;
  }
  if (action === 'open-gift-card-detail') {
    openGiftCardModal(String(trigger.dataset.cardId || '').trim());
    return;
  }
  if (action === 'open-review-comment') {
    openReviewModal(String(trigger.dataset.reviewId || '').trim());
    return;
  }
  if (action === 'set-chart-period') {
    const period = String(trigger.dataset.period || '7d').trim();
    state.chartPeriod = period;
    // Update active button
    root?.querySelectorAll('[data-clm-period-tabs] .clm-period-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.period === period);
    });
    void renderChart(period);
    return;
  }
}

// ─── Markup ───────────────────────────────────────────────────────────────────

function markup() {
  return `
    <section class="clm-shell" data-clm-module>

      <!-- List view -->
      <section data-clm-list-section>

        <header class="clm-page-header">
          <h2 class="clm-page-title">Clients</h2>
        </header>

        <!-- Graphe nouveaux clients -->
        <div class="clm-chart-card" data-clm-chart-section>
          <div class="clm-chart-card__head">
            <span class="clm-chart-card__title">Nouveaux clients</span>
            <div class="clm-period-tabs" data-clm-period-tabs>
              <button class="clm-period-btn is-active" data-action="set-chart-period" data-period="7d">7j</button>
              <button class="clm-period-btn" data-action="set-chart-period" data-period="30d">30j</button>
              <button class="clm-period-btn" data-action="set-chart-period" data-period="3m">3m</button>
              <button class="clm-period-btn" data-action="set-chart-period" data-period="12m">12m</button>
            </div>
          </div>
          <div class="clm-chart-wrap">
            <canvas data-clm-chart-canvas></canvas>
          </div>
        </div>

        <!-- Barre de recherche -->
        <div class="clm-search-bar">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input
            type="search"
            class="clm-search-input"
            data-clm-search
            placeholder="Rechercher un client..."
            autocomplete="off"
            aria-label="Rechercher un client"
          >
        </div>

        <!-- Table clients -->
        <div class="clm-table-wrap" data-clm-list>
          ${loaderMarkup('Chargement des clients...')}
        </div>

      </section>

      <!-- Detail view -->
      <section data-clm-detail-section hidden>
        <div data-clm-detail-header></div>
        <nav class="clm-tabs" data-clm-tabs role="tablist"></nav>
        <div class="clm-tab-panel" data-clm-tab-panel></div>
      </section>

    </section>
  `;
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function reset() {
  if (state.chartInstance) {
    state.chartInstance.destroy();
  }
  state = {
    view: 'list',
    clients: [],
    search: '',
    searchTimer: null,
    selectedClientId: null,
    detail: null,
    tab: 'sales',
    loading: false,
    detailLoading: false,
    detailError: '',
    chartPeriod: '7d',
    chartData: null,
    chartInstance: null
  };
  if (listAbort) { listAbort.abort(); listAbort = null; }
  if (detailAbort) { detailAbort.abort(); detailAbort = null; }
  clearTimeout(searchDebounceTimer);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderModule(container) {
  if (!container) return;
  root = container;
  reset();
  container.innerHTML = markup();
  renderView();

  // Bind events
  root.removeEventListener('click', onClick);
  root.addEventListener('click', onClick);

  const searchInput = root.querySelector('[data-clm-search]');
  if (searchInput) {
    searchInput.removeEventListener('input', onSearchInput);
    searchInput.addEventListener('input', onSearchInput);
  }

  // Load data in parallel
  await Promise.all([
    loadClients(),
    renderChart('7d')
  ]);
}

export default { renderModule };
