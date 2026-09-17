
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { buildGestionLineGraph } from '../helpers/graphStylePreset.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API = {
  stats:         '/api/gestion/commissions/stats',
  transactions:  '/api/gestion/commissions',
  configStats:   '/api/gestion/commissions/config/stats',
  configCreate:  '/api/gestion/commissions/config',
  configDelete:  '/api/gestion/commissions/config/active',
  configHistory: '/api/gestion/commissions/config/history'
};

const PERIODS = [
  { label: 'Jour',    value: 'day' },
  { label: 'Semaine', value: 'week' },
  { label: 'Mois',    value: 'month' },
  { label: 'Annee',   value: 'year' }
];

const MIN_LOADER_MS  = 1000;
const SEARCH_LOADER_MS = 500;

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2
});

// ─── State ────────────────────────────────────────────────

const state = {
  container: null,
  activeTab: 'dashboard',
  // Dashboard
  period: 'day',
  customStart: '',
  customEnd: '',
  searchTerm: '',
  stats: null,
  transactions: [],
  visibleTransactions: [],
  statsLoading: true,
  transactionsLoading: true,
  searchLoading: false,
  searchVersion: 0,
  // Config tab
  configData: null,
  configLoading: false,
  configLoaded: false,
  // History tab
  historyConfigs: [],
  historyLoading: false,
  historyLoaded: false,
  historyError: '',
  // Misc
  missingEmailWarned: new Set(),
  metricsWarned: new Set()
};

const nodes = {
  periodTabs: null,
  customRange: null,
  customStart: null,
  customEnd: null,
  customApply: null,
  statsRoot: null,
  statsError: null,
  transactionsRoot: null,
  transactionsError: null,
  searchInput: null,
  configRoot: null,
  historyRoot: null,
  historyError: null
};

// ─── Helpers ──────────────────────────────────────────────

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatCurrency(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return currencyFormatter.format(amount);
}

function formatDate(value, opts = null) {
  if (!value) return 'Date indisponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date indisponible';
  return date.toLocaleString('fr-FR', opts || {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatShortDate(value) {
  return formatDate(value, { day: '2-digit', month: 'long', year: 'numeric' });
}

function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : Promise.resolve({});
}

function createHttpError(message, response, payload, endpoint) {
  const error = new Error(message || 'Operation impossible.');
  error.status = response?.status || null;
  error.payload = payload || null;
  error.endpoint = endpoint || null;
  return error;
}

function logModuleError(context, error, extra = {}) {
  logUiError(`CommissionModule:${context}`, error, {
    status: error?.status || null, endpoint: error?.endpoint || null,
    payload: error?.payload || null, message: error?.message || null, ...extra
  });
}

function loaderMarkup(label = 'Chargement...') {
  return `
    <div class="gcg-inline-loader cmm-inline-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

function normalizeCommissionType(type) {
  if (type === 'percentage') return 'Pourcentage';
  if (type === 'fixed') return 'Montant fixe';
  return escapeHtml(type || 'Inconnu');
}

function normalizeCommissionSourceType(type) {
  const normalized = String(type || 'sale').trim().toLowerCase();
  if (normalized === 'refund_adjustment') return 'Ajustement remboursement';
  if (normalized === 'refund_reversal') return 'Reversal remboursement';
  return 'Vente';
}

// ─── API ──────────────────────────────────────────────────

async function fetchStats(params) {
  const query = new URLSearchParams(params);
  const endpoint = `${API.stats}?${query}`;
  const response = await fetch(endpoint, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) throw createHttpError(payload?.error || 'Impossible de charger les statistiques.', response, payload, endpoint);
  return payload;
}

async function fetchTransactions(params = {}) {
  const query = new URLSearchParams(params);
  const endpoint = `${API.transactions}?${query}`;
  const response = await fetch(endpoint, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) throw createHttpError(payload?.error || 'Impossible de lire les transactions.', response, payload, endpoint);
  return payload;
}

async function fetchConfigStats() {
  const response = await fetch(API.configStats, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) throw createHttpError(payload?.error || 'Erreur stats config.', response, payload, API.configStats);
  return payload;
}

async function fetchConfigHistory() {
  const response = await fetch(API.configHistory, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) throw createHttpError(payload?.error || "Impossible de lire l'historique.", response, payload, API.configHistory);
  return payload;
}

async function postConfig(payload) {
  const response = await fetch(API.configCreate, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await getJson(response);
  if (!response.ok) throw createHttpError(data?.error || 'Impossible de sauvegarder la configuration.', response, data, API.configCreate);
  return data;
}

async function apiDeleteActiveConfig() {
  const response = await fetch(API.configDelete, { method: 'DELETE', credentials: 'include' });
  const data = await getJson(response);
  if (!response.ok) {
    const err = new Error(data?.error || 'Impossible de supprimer la configuration.');
    err.blocked = data?.blocked;
    err.reason = data?.reason;
    throw err;
  }
  return data;
}

// ─── Dashboard ────────────────────────────────────────────

function buildStatsParams() {
  if (state.period === 'custom') return { period: 'custom', start: state.customStart, end: state.customEnd };
  return { period: state.period };
}

function buildTransactionsParams() {
  const params = { limit: 1000 };
  if (state.period === 'custom') { params.period = 'custom'; params.start = state.customStart; params.end = state.customEnd; }
  else params.period = state.period;
  return params;
}

function buildGraphMarkup(series = []) {
  const points = (Array.isArray(series) ? series : []).map(item => ({
    label: String(item?.label || ''),
    value: Number.isFinite(Number(item?.totalCommission)) ? Number(item.totalCommission) : 0
  }));
  if (!points.length) {
    return '<article class="cmm-empty"><span class="cmm-empty__icon"><i class="bi bi-bar-chart"></i></span><p>Aucune donnée sur cette période.</p></article>';
  }
  return buildGestionLineGraph({
    points, intent: 'accent', ariaLabel: 'Evolution des commissions',
    width: 760, height: 220, pointRadius: 3.5, labelStep: 'auto', allowNegative: true
  });
}

function computeDisplayedTotal(statsPayload) {
  const raw = Number(statsPayload?.totalCommission);
  if (Number.isFinite(raw)) return raw;
  const series = Array.isArray(statsPayload?.series) ? statsPayload.series : [];
  return series.reduce((sum, item) => sum + (Number.isFinite(Number(item?.totalCommission)) ? Number(item.totalCommission) : 0), 0);
}

function renderStatsCard() {
  if (!nodes.statsRoot) return;
  if (state.statsLoading) { nodes.statsRoot.innerHTML = loaderMarkup('Chargement des statistiques...'); return; }

  const payload = state.stats || {};
  const total = computeDisplayedTotal(payload);
  const signedLabel = total > 0 ? `+ ${formatCurrency(total)}` : total < 0 ? `- ${formatCurrency(Math.abs(total))}` : formatCurrency(0);
  const totalClass = total > 0 ? 'is-positive' : total < 0 ? 'is-negative' : '';
  const totalTransactions = Number.isFinite(Number(payload?.totalTransactions)) ? Number(payload.totalTransactions) : 0;

  nodes.statsRoot.innerHTML = `
    <div class="cmm-stats-body">
      ${buildGraphMarkup(payload?.series || [])}
      <p class="cmm-period-total ${totalClass}">Total commissions sur la période : <strong>${escapeHtml(signedLabel)}</strong></p>
      <p class="cmm-period-meta">Transactions sur la période : <strong>${escapeHtml(String(totalTransactions))}</strong></p>
    </div>
  `;
}

function renderTransactionsList() {
  if (!nodes.transactionsRoot) return;
  if (state.transactionsLoading) { nodes.transactionsRoot.innerHTML = loaderMarkup('Chargement des transactions...'); return; }
  if (state.searchLoading) { nodes.transactionsRoot.innerHTML = loaderMarkup('Recherche des transactions...'); return; }

  const items = Array.isArray(state.visibleTransactions) ? state.visibleTransactions : [];

  if (!items.length) {
    const hasSearch = String(state.searchTerm || '').trim().length > 0;
    nodes.transactionsRoot.innerHTML = `
      <article class="cmm-empty">
        <span class="cmm-empty__icon"><i class="bi bi-search"></i></span>
        <p>${hasSearch ? 'Aucune vente pour cette recherche.' : 'Aucune transaction sur cette période.'}</p>
        ${hasSearch ? '<button type="button" class="cmm-link-button" data-clear-search>Effacer recherche</button>' : ''}
      </article>
    `;
    nodes.transactionsRoot.querySelector('[data-clear-search]')?.addEventListener('click', () => {
      state.searchTerm = '';
      if (nodes.searchInput) nodes.searchInput.value = '';
      runSearchFilter({ showLoader: false });
    });
    return;
  }

  nodes.transactionsRoot.innerHTML = `
    <div class="cmm-transaction-grid">
      ${items.map(txn => {
        const saleId = String(txn?.saleId || 'N/A');
        const formationLabel = String(txn?.formationName || '').trim() || 'Formation inconnue';
        const amount = Number(txn?.commissionAmount || 0);
        const amountLabel = amount > 0 ? `+ ${formatCurrency(amount)}` : amount < 0 ? `- ${formatCurrency(Math.abs(amount))}` : formatCurrency(0);
        const amountClass = amount > 0 ? 'is-positive' : amount < 0 ? 'is-negative' : '';
        return `
          <article class="cmm-transaction-card">
            <span class="cmm-transaction-card__icon" aria-hidden="true"><i class="bi bi-currency-dollar"></i></span>
            <div class="cmm-transaction-card__body">
              <h4>${escapeHtml(formationLabel)}</h4>
              <p>Date : ${escapeHtml(formatDate(txn?.createdAt))}</p>
              <p>Vente : <code>${escapeHtml(saleId)}</code></p>
              <p>Nature : ${escapeHtml(normalizeCommissionSourceType(txn?.sourceType))}</p>
              <p>Type : ${escapeHtml(normalizeCommissionType(txn?.commissionType))} (${escapeHtml(String(txn?.commissionValue ?? '0'))})</p>
            </div>
            <p class="cmm-transaction-card__amount ${amountClass}">${escapeHtml(amountLabel)}</p>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderPeriodTabs() {
  if (!nodes.periodTabs) return;
  nodes.periodTabs.querySelectorAll('[data-period-button]').forEach(button => {
    const active = button.dataset.periodButton === state.period;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderCustomRangeVisibility() {
  const isCustom = state.period === 'custom';
  if (nodes.customRange) { nodes.customRange.classList.toggle('is-open', isCustom); nodes.customRange.setAttribute('aria-hidden', isCustom ? 'false' : 'true'); }
  if (nodes.customStart) nodes.customStart.disabled = !isCustom;
  if (nodes.customEnd) nodes.customEnd.disabled = !isCustom;
  if (nodes.customApply) nodes.customApply.disabled = !isCustom;
}

function renderUi() {
  renderPeriodTabs();
  renderCustomRangeVisibility();
  renderStatsCard();
  renderTransactionsList();
  if (nodes.statsError) nodes.statsError.textContent = '';
  if (nodes.transactionsError) nodes.transactionsError.textContent = '';
}

async function loadStatsAndTransactions({ showLoader = true } = {}) {
  const isCustomInvalid = state.period === 'custom' && (!state.customStart || !state.customEnd);
  if (isCustomInvalid) {
    if (nodes.statsError) nodes.statsError.textContent = 'Sélectionnez une plage personnalisée valide.';
    if (nodes.transactionsError) nodes.transactionsError.textContent = 'Sélectionnez une plage personnalisée valide.';
    return;
  }

  const startedAt = Date.now();
  if (showLoader) { state.statsLoading = true; state.transactionsLoading = true; renderUi(); }

  try {
    const [statsPayload, transactionsPayload] = await Promise.all([
      fetchStats(buildStatsParams()),
      fetchTransactions(buildTransactionsParams())
    ]);
    state.stats = statsPayload;
    state.transactions = Array.isArray(transactionsPayload?.transactions) ? transactionsPayload.transactions : [];
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (showLoader && remaining > 0) await wait(remaining);
    state.statsLoading = false;
    state.transactionsLoading = false;
    await runSearchFilter({ showLoader: false });
    renderUi();
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (showLoader && remaining > 0) await wait(remaining);
    state.statsLoading = false;
    state.transactionsLoading = false;
    state.visibleTransactions = [];
    renderUi();
    showToast({ type: 'error', message: 'Erreur de chargement', durationMs: 1000 });
    logModuleError('LoadStatsTransactions', error, { params: { stats: buildStatsParams(), transactions: buildTransactionsParams() } });
  }
}

async function runSearchFilter({ showLoader = true } = {}) {
  state.searchVersion += 1;
  const callVersion = state.searchVersion;
  const term = String(state.searchTerm || '').trim().toLowerCase();
  if (showLoader) {
    state.searchLoading = true;
    renderTransactionsList();
    await wait(SEARCH_LOADER_MS);
    if (callVersion !== state.searchVersion) return;
  }
  state.visibleTransactions = Array.isArray(state.transactions)
    ? state.transactions.filter(txn => {
        if (!term) return true;
        return String(txn?.saleId || '').toLowerCase().includes(term);
      })
    : [];
  state.searchLoading = false;
  renderTransactionsList();
}

// ─── Config tab ───────────────────────────────────────────

async function loadConfigData() {
  state.configLoading = true;
  renderConfigTab();
  try {
    const data = await fetchConfigStats();
    state.configData = {
      config: data.config || null,
      stats: data.stats || null,
      hasActiveContract: Boolean(data.hasActiveContract)
    };
    state.configLoaded = true;
  } catch (err) {
    state.configData = null;
    state.configLoaded = true;
    showToast({ type: 'error', message: 'Erreur chargement config', durationMs: 1000 });
    logModuleError('LoadConfig', err);
  } finally {
    state.configLoading = false;
    renderConfigTab();
  }
}

function renderConfigTab() {
  if (!nodes.configRoot) return;
  if (state.configLoading) { nodes.configRoot.innerHTML = loaderMarkup('Chargement de la configuration...'); return; }
  if (!state.configData?.config) { renderConfigEmpty(); return; }
  renderConfigActive();
}

function renderConfigEmpty() {
  nodes.configRoot.innerHTML = `
    <div class="cmm-config-empty">
      <i class="bi bi-sliders cmm-config-empty__icon" aria-hidden="true"></i>
      <p class="cmm-config-empty__label">Aucune configuration de commission</p>
      <button type="button" class="cmm-create-config-btn" data-create-config>
        <i class="bi bi-plus" aria-hidden="true"></i> Créer une configuration
      </button>
    </div>
  `;
  nodes.configRoot.querySelector('[data-create-config]')?.addEventListener('click', openCreateConfigModal);
}

function renderConfigActive() {
  const { config, stats, hasActiveContract } = state.configData;
  const typeLabel  = config.type === 'percentage' ? 'Pourcentage' : 'Fixe';
  const valueLabel = config.type === 'percentage'
    ? `${Number(config.value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}% par vente`
    : `${formatCurrency(config.value)} par vente`;
  const gross      = stats?.gross ?? 0;
  const deductions = stats?.deductions ?? 0;
  const net        = stats?.net ?? 0;

  nodes.configRoot.innerHTML = `
    <div class="cmm-config-card">
      <div class="cmm-config-section-title">
        <i class="bi bi-gear" aria-hidden="true"></i> Configuration actuelle
      </div>
      <div class="cmm-config-row">
        <span class="cmm-config-label">Type</span>
        <span class="cmm-config-value">${escapeHtml(typeLabel)}</span>
      </div>
      <div class="cmm-config-row">
        <span class="cmm-config-label">Valeur</span>
        <span class="cmm-config-value">${escapeHtml(valueLabel)}</span>
      </div>
      <div class="cmm-config-row">
        <span class="cmm-config-label">Active depuis</span>
        <span class="cmm-config-value">${escapeHtml(formatShortDate(config.createdAt))}</span>
      </div>

      <div class="cmm-config-divider"></div>

      <div class="cmm-config-section-title">
        <i class="bi bi-graph-up" aria-hidden="true"></i> Revenus avec cette configuration
      </div>
      <div class="cmm-config-row">
        <span class="cmm-config-label">Commissions brutes</span>
        <span class="cmm-config-value">${escapeHtml(formatCurrency(gross))}</span>
      </div>
      <div class="cmm-config-row">
        <span class="cmm-config-label">Remboursements déduits</span>
        <span class="cmm-config-value is-negative">−${escapeHtml(formatCurrency(deductions))}</span>
      </div>
      <div class="cmm-config-row cmm-config-row--total">
        <span class="cmm-config-label">Total net</span>
        <span class="cmm-config-value ${net >= 0 ? 'is-positive' : 'is-negative'}">${escapeHtml(formatCurrency(net))}</span>
      </div>

      <div class="cmm-config-divider"></div>

      <div class="cmm-config-actions">
        <button type="button" class="cmm-delete-config-btn" data-delete-config>
          <i class="bi bi-trash" aria-hidden="true"></i> Supprimer la configuration
        </button>
      </div>
    </div>
  `;

  const deleteBtn = nodes.configRoot.querySelector('[data-delete-config]');
  if (deleteBtn && hasActiveContract) {
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.4';
    deleteBtn.style.cursor = 'not-allowed';
    deleteBtn.title = 'Configuration liée à un contrat actif — résiliez d\'abord le contrat';
    const actionsEl = nodes.configRoot.querySelector('.cmm-config-actions');
    if (actionsEl && !actionsEl.querySelector('.cmm-config-blocked-note')) {
      const note = document.createElement('p');
      note.className = 'cmm-config-blocked-note';
      note.textContent = 'Configuration liée à un contrat actif — résiliez d\'abord le contrat';
      actionsEl.appendChild(note);
    }
  }
  deleteBtn?.addEventListener('click', handleDeleteConfig);
}

async function handleDeleteConfig() {
  const btn = nodes.configRoot?.querySelector('[data-delete-config]');
  if (!btn || btn.disabled) return;
  if (!confirm('Supprimer définitivement cette configuration de commission ?')) return;

  btn.disabled = true;
  btn.innerHTML = `<i class="bi bi-hourglass-split" aria-hidden="true"></i> Suppression…`;

  try {
    await apiDeleteActiveConfig();
    state.configData = null;
    state.configLoaded = false;
    state.historyLoaded = false;
    showToast({ type: 'success', message: 'Configuration supprimée', durationMs: 1000 });
    await loadConfigData();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i> Supprimer la configuration';
    if (err.blocked) {
      const actionsEl = nodes.configRoot?.querySelector('.cmm-config-actions');
      if (actionsEl && !actionsEl.querySelector('.cmm-config-blocked-note')) {
        const note = document.createElement('p');
        note.className = 'cmm-config-blocked-note';
        note.innerHTML = '<i class="bi bi-lock" aria-hidden="true"></i> Configuration liée à un contrat actif — résiliez d\'abord le contrat.';
        actionsEl.appendChild(note);
        setTimeout(() => note.remove(), 6000);
      }
    } else {
      showToast({ type: 'error', message: err.message || 'Erreur suppression', durationMs: 1000 });
    }
    logModuleError('DeleteConfig', err);
  }
}

// ─── Config create modal ──────────────────────────────────

function openCreateConfigModal() {
  const overlay = document.createElement('div');
  overlay.className = 'cmm-create-overlay';
  overlay.innerHTML = `
    <div class="cmm-create-modal" role="dialog" aria-modal="true" aria-labelledby="cmm-create-title">
      <header class="cmm-create-modal__header">
        <h3 id="cmm-create-title"><i class="bi bi-sliders" aria-hidden="true"></i> Nouvelle configuration</h3>
        <button type="button" class="cmm-create-modal__close" data-modal-close aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <div class="cmm-create-modal__body">
        <div class="cmm-form-group">
          <label class="cmm-form-label">Type de commission</label>
          <div class="cmm-custom-select" data-custom-select>
            <button type="button" class="cmm-custom-select__trigger" aria-haspopup="listbox">
              <span data-select-label>Pourcentage</span>
              <i class="bi bi-chevron-down" aria-hidden="true"></i>
            </button>
            <div class="cmm-custom-select__dropdown" role="listbox" hidden>
              <button type="button" class="cmm-custom-select__option cmm-custom-select__option--active" role="option" aria-selected="true" data-value="percentage">Pourcentage</button>
              <button type="button" class="cmm-custom-select__option" role="option" aria-selected="false" data-value="fixed">Fixe par vente</button>
            </div>
          </div>
        </div>
        <div class="cmm-form-group">
          <label class="cmm-form-label">Valeur</label>
          <div class="cmm-stepper">
            <button type="button" class="cmm-stepper__btn" data-stepper-dec aria-label="Diminuer">
              <i class="bi bi-dash" aria-hidden="true"></i>
            </button>
            <input type="number" class="cmm-stepper__input" min="0.01" step="0.01" value="9.00" data-stepper-input>
            <button type="button" class="cmm-stepper__btn" data-stepper-inc aria-label="Augmenter">
              <i class="bi bi-plus" aria-hidden="true"></i>
            </button>
            <span class="cmm-stepper__unit" data-stepper-unit>%</span>
          </div>
        </div>
        <div class="cmm-config-preview" data-config-preview aria-live="polite">
          9,00% prélevé sur chaque vente de formation
        </div>
        <p class="cmm-form-error" data-form-error hidden></p>
      </div>
      <footer class="cmm-create-modal__footer">
        <button type="button" class="cmm-create-modal__cancel" data-modal-cancel>Annuler</button>
        <button type="button" class="cmm-create-modal__confirm" data-modal-confirm>
          <i class="bi bi-check2" aria-hidden="true"></i> Créer
        </button>
      </footer>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('cmm-create-overlay--visible'));

  let selectedType = 'percentage';
  let saving = false;

  const stepperInput  = overlay.querySelector('[data-stepper-input]');
  const stepperUnit   = overlay.querySelector('[data-stepper-unit]');
  const preview       = overlay.querySelector('[data-config-preview]');
  const customSelect  = overlay.querySelector('[data-custom-select]');
  const selectTrigger = customSelect.querySelector('.cmm-custom-select__trigger');
  const selectDropdown = customSelect.querySelector('.cmm-custom-select__dropdown');
  const selectLabel   = customSelect.querySelector('[data-select-label]');
  const formError     = overlay.querySelector('[data-form-error]');
  const confirmBtn    = overlay.querySelector('[data-modal-confirm]');
  const cancelBtn     = overlay.querySelector('[data-modal-cancel]');
  const closeBtn      = overlay.querySelector('[data-modal-close]');

  function updatePreview() {
    const v = parseFloat(stepperInput.value) || 0;
    if (selectedType === 'percentage') {
      preview.textContent = `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% prélevé sur chaque vente de formation`;
    } else {
      preview.textContent = `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € prélevé sur chaque vente de formation`;
    }
  }

  function toggleDropdown(open) {
    selectDropdown.hidden = !open;
    selectTrigger.classList.toggle('cmm-custom-select__trigger--open', open);
  }

  selectTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown(selectDropdown.hidden);
  });

  customSelect.querySelectorAll('.cmm-custom-select__option').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedType = opt.dataset.value;
      selectLabel.textContent = opt.textContent.trim();
      customSelect.querySelectorAll('.cmm-custom-select__option').forEach(o => {
        o.classList.toggle('cmm-custom-select__option--active', o === opt);
        o.setAttribute('aria-selected', o === opt ? 'true' : 'false');
      });
      stepperUnit.textContent = selectedType === 'percentage' ? '%' : '€';
      if (selectedType === 'percentage' && parseFloat(stepperInput.value) > 100) {
        stepperInput.value = '100.00';
      }
      toggleDropdown(false);
      updatePreview();
    });
  });

  document.addEventListener('click', function outsideClick(e) {
    if (!customSelect.contains(e.target)) {
      toggleDropdown(false);
      document.removeEventListener('click', outsideClick);
    }
  });

  overlay.querySelector('[data-stepper-dec]').addEventListener('click', () => {
    const v = parseFloat(stepperInput.value) || 0;
    const step = selectedType === 'percentage' ? 0.5 : 5;
    stepperInput.value = Math.max(0.01, Math.round((v - step) * 100) / 100).toFixed(2);
    updatePreview();
  });

  overlay.querySelector('[data-stepper-inc]').addEventListener('click', () => {
    const v = parseFloat(stepperInput.value) || 0;
    const step = selectedType === 'percentage' ? 0.5 : 5;
    const max  = selectedType === 'percentage' ? 100 : 999999;
    stepperInput.value = Math.min(max, Math.round((v + step) * 100) / 100).toFixed(2);
    updatePreview();
  });

  stepperInput.addEventListener('input', updatePreview);

  let closed = false;
  function closeModal() {
    if (closed || saving) return;
    closed = true;
    overlay.classList.remove('cmm-create-overlay--visible');
    setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 250);
  }

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape' && !saving) { closeModal(); document.removeEventListener('keydown', onKey); }
  });

  confirmBtn.addEventListener('click', async () => {
    const value = parseFloat(stepperInput.value);
    formError.hidden = true;
    if (!value || value <= 0) {
      formError.textContent = 'La valeur doit être supérieure à 0.';
      formError.hidden = false;
      return;
    }
    if (selectedType === 'percentage' && value > 100) {
      formError.textContent = 'Le pourcentage ne peut pas dépasser 100%.';
      formError.hidden = false;
      return;
    }

    saving = true;
    confirmBtn.disabled = true;
    closeBtn.disabled   = true;
    cancelBtn.disabled  = true;
    confirmBtn.innerHTML = loaderMarkup('Création...');

    try {
      await postConfig({ type: selectedType, value });
      saving = false;
      closed = true;
      overlay.classList.remove('cmm-create-overlay--visible');
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 250);
      showToast({ type: 'success', message: 'Configuration créée', durationMs: 1000 });
      state.configLoaded  = false;
      state.historyLoaded = false;
      await loadConfigData();
    } catch (err) {
      saving = false;
      confirmBtn.disabled = false;
      closeBtn.disabled   = false;
      cancelBtn.disabled  = false;
      confirmBtn.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i> Créer';
      formError.textContent = err.message || 'Erreur lors de la création.';
      formError.hidden = false;
      logModuleError('CreateConfig', err);
    }
  });

  updatePreview();
}

// ─── History tab ──────────────────────────────────────────

async function loadHistoryData() {
  if (state.historyLoaded) { renderHistoryTab(); return; }
  state.historyLoading = true;
  state.historyError   = '';
  renderHistoryTab();
  try {
    const data = await fetchConfigHistory();
    state.historyConfigs = Array.isArray(data.configs) ? data.configs : [];
    state.historyLoaded  = true;
  } catch (err) {
    state.historyConfigs = [];
    state.historyError   = err.message || 'Erreur historique.';
    logModuleError('LoadHistory', err);
    showToast({ type: 'error', message: 'Erreur historique', durationMs: 1000 });
  } finally {
    state.historyLoading = false;
    renderHistoryTab();
    if (nodes.historyError) nodes.historyError.textContent = state.historyError || '';
  }
}

function renderHistoryTab() {
  if (!nodes.historyRoot) return;

  if (state.historyLoading) { nodes.historyRoot.innerHTML = loaderMarkup("Chargement de l'historique..."); return; }

  const configs = state.historyConfigs;
  if (!configs.length) {
    nodes.historyRoot.innerHTML = `
      <article class="cmm-empty">
        <span class="cmm-empty__icon"><i class="bi bi-clock-history"></i></span>
        <p>Aucune configuration archivée.</p>
      </article>
    `;
    return;
  }

  nodes.historyRoot.innerHTML = `
    <div class="cmm-history-list">
      ${configs.map((config, i) => {
        const num        = configs.length - i;
        const typeLabel  = config.type === 'percentage' ? 'Pourcentage' : 'Fixe';
        const valueLabel = config.type === 'percentage'
          ? `${Number(config.value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}%`
          : formatCurrency(config.value);
        const net = config.stats?.net ?? 0;
        return `
          <article class="cmm-history-card">
            <div class="cmm-history-card__header">
              <span class="cmm-history-card__num">Configuration #${num}</span>
              <span class="cmm-history-card__deleted">Supprimée le ${escapeHtml(formatShortDate(config.deletedAt))}</span>
            </div>
            <p class="cmm-history-card__meta">
              Type : ${escapeHtml(typeLabel)} · Valeur : <strong>${escapeHtml(valueLabel)}</strong>
            </p>
            <p class="cmm-history-card__period">
              Active du ${escapeHtml(formatShortDate(config.createdAt))} au ${escapeHtml(formatShortDate(config.deletedAt))}
            </p>
            <p class="cmm-history-card__revenue">
              Revenus générés : <strong>${escapeHtml(formatCurrency(net))} net</strong>
            </p>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

// ─── Tab switching ────────────────────────────────────────

function switchTab(tabName) {
  state.activeTab = tabName;

  if (!state.container) return;
  state.container.querySelectorAll('.cmm-tab').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('cmm-tab--active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  state.container.querySelectorAll('.cmm-tab-panel').forEach(panel => {
    panel.hidden = panel.dataset.panel !== tabName;
  });

  if (tabName === 'config'   && !state.configLoaded)  loadConfigData();
  if (tabName === 'history'  && !state.historyLoaded) loadHistoryData();
}

// ─── Shell ────────────────────────────────────────────────

function renderShell(container) {
  container.innerHTML = `
    <section class="module-panel cmm-module">
      <header class="cmm-header">
        <div>
          <h2>Commissions</h2>
          <p>Suivez les gains, configurez les commissions et consultez l'historique.</p>
        </div>
      </header>

      <div class="cmm-tabs" role="tablist">
        <button type="button" class="cmm-tab cmm-tab--active" role="tab" data-tab="dashboard" aria-selected="true">
          <i class="bi bi-bar-chart" aria-hidden="true"></i> Dashboard
        </button>
        <button type="button" class="cmm-tab" role="tab" data-tab="config" aria-selected="false">
          <i class="bi bi-gear" aria-hidden="true"></i> Configuration
        </button>
        <button type="button" class="cmm-tab" role="tab" data-tab="history" aria-selected="false">
          <i class="bi bi-clock-history" aria-hidden="true"></i> Historique
        </button>
      </div>

      <!-- Onglet 1 — Dashboard -->
      <div class="cmm-tab-panel" data-panel="dashboard">
        <section class="manager-section cmm-section">
          <article class="cmm-card">
            <header class="cmm-card__header">
              <strong>Évolution des commissions</strong>
              <div class="cmm-period-tabs" data-period-tabs>
                ${PERIODS.map(p => `<button type="button" class="cmm-period-tab" data-period-button="${p.value}" aria-pressed="false">${p.label}</button>`).join('')}
                <button type="button" class="cmm-period-tab" data-period-button="custom" aria-pressed="false">Personnalisée</button>
              </div>
            </header>
            <div class="cmm-custom-range" data-custom-range aria-hidden="true">
              <label class="form-label">Début<input type="date" class="gcg-minimal-input" data-custom-start /></label>
              <label class="form-label">Fin<input type="date" class="gcg-minimal-input" data-custom-end /></label>
              <button type="button" class="secondary-button" data-custom-apply>Appliquer</button>
            </div>
            <div data-stats-root></div>
            <p class="form-message" data-stats-error></p>
          </article>
        </section>
        <section class="manager-section cmm-section">
          <article class="cmm-card">
            <header class="cmm-card__header cmm-card__header--split">
              <strong>Transactions commissions</strong>
              <label class="cmm-search-field">
                <span>Recherche ID vente</span>
                <input type="search" class="gcg-minimal-input" data-search-sale-id placeholder="Ex: SAL-2026-001" />
              </label>
            </header>
            <div data-transactions-root></div>
            <p class="form-message" data-transactions-error></p>
          </article>
        </section>
      </div>

      <!-- Onglet 2 — Configuration -->
      <div class="cmm-tab-panel" data-panel="config" hidden>
        <section class="manager-section cmm-section">
          <div data-config-root></div>
        </section>
      </div>

      <!-- Onglet 3 — Historique -->
      <div class="cmm-tab-panel" data-panel="history" hidden>
        <section class="manager-section cmm-section">
          <div data-history-root></div>
          <p class="form-message" data-history-error></p>
        </section>
      </div>
    </section>
  `;
}

// ─── Init ─────────────────────────────────────────────────

export async function renderModule(container) {
  if (!container) return;

  state.container = container;
  state.activeTab = 'dashboard';
  state.period = 'day';
  state.customStart = '';
  state.customEnd = '';
  state.searchTerm = '';
  state.stats = null;
  state.transactions = [];
  state.visibleTransactions = [];
  state.statsLoading = true;
  state.transactionsLoading = true;
  state.searchLoading = false;
  state.searchVersion = 0;
  state.configData = null;
  state.configLoading = false;
  state.configLoaded = false;
  state.historyConfigs = [];
  state.historyLoading = false;
  state.historyLoaded = false;
  state.historyError = '';
  state.missingEmailWarned = new Set();
  state.metricsWarned = new Set();

  renderShell(container);

  nodes.periodTabs        = container.querySelector('[data-period-tabs]');
  nodes.customRange       = container.querySelector('[data-custom-range]');
  nodes.customStart       = container.querySelector('[data-custom-start]');
  nodes.customEnd         = container.querySelector('[data-custom-end]');
  nodes.customApply       = container.querySelector('[data-custom-apply]');
  nodes.statsRoot         = container.querySelector('[data-stats-root]');
  nodes.statsError        = container.querySelector('[data-stats-error]');
  nodes.transactionsRoot  = container.querySelector('[data-transactions-root]');
  nodes.transactionsError = container.querySelector('[data-transactions-error]');
  nodes.searchInput       = container.querySelector('[data-search-sale-id]');
  nodes.configRoot        = container.querySelector('[data-config-root]');
  nodes.historyRoot       = container.querySelector('[data-history-root]');
  nodes.historyError      = container.querySelector('[data-history-error]');

  // Tab clicks
  container.querySelectorAll('.cmm-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Period tabs
  nodes.periodTabs?.addEventListener('click', event => {
    const button = event.target.closest('[data-period-button]');
    if (!button) return;
    const period = String(button.dataset.periodButton || '');
    if (!period || period === state.period) return;
    state.period = period;
    if (period !== 'custom') {
      state.customStart = '';
      state.customEnd = '';
      if (nodes.customStart) nodes.customStart.value = '';
      if (nodes.customEnd)   nodes.customEnd.value   = '';
      renderUi();
      loadStatsAndTransactions({ showLoader: true });
      return;
    }
    renderUi();
  });

  nodes.customApply?.addEventListener('click', () => {
    const start = nodes.customStart?.value || '';
    const end   = nodes.customEnd?.value   || '';
    if (!start || !end) { showToast({ type: 'error', message: 'Sélectionnez les deux dates', durationMs: 1000 }); return; }
    if (new Date(start) > new Date(end)) { showToast({ type: 'error', message: 'Période invalide', durationMs: 1000 }); return; }
    state.customStart = start;
    state.customEnd   = end;
    state.period = 'custom';
    renderPeriodTabs();
    loadStatsAndTransactions({ showLoader: true });
  });

  nodes.searchInput?.addEventListener('input', () => {
    state.searchTerm = nodes.searchInput?.value || '';
    runSearchFilter({ showLoader: true });
  });

  renderUi();
  await loadStatsAndTransactions({ showLoader: true });
}

export default { renderModule };
