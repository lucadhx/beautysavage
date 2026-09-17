import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const SALES_ENDPOINT = '/api/client/sales';
const PROFILE_ENDPOINT = '/api/client/profile';
const RESET_PASSWORD_ENDPOINT = '/auth/password-reset/request';
const LOGOUT_ENDPOINT = '/auth/logout';
const LOGIN_URL = '/login.html';
const HOME_URL = '/vitrine.html';
const NAME_MAX_LENGTH = 64;
const MIN_LOADER_MS = 500;
const NOTICE_AUTO_HIDE_MS = 7000;
const MODAL_CLOSE_DELAY_MS = 180;

const TYPE_LABELS = {
  product: 'Produit',
  formation: 'Formation',
  'gift-card': 'Carte cadeau'
};

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
});

const state = {
  container: null,
  context: null,
  activeTab: 'info',
  sales: [],
  salesLoaded: false,
  salesLoading: false,
  resetNoticeTimer: null,
  detailsModal: null,
  boundTabsClick: null,
  boundContainerClick: null
};

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampName(value) {
  const normalized = String(value || '').trim();
  return normalized.slice(0, NAME_MAX_LENGTH);
}

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Prix indisponible';
  return currencyFormatter.format(amount);
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function buildLoader(message = 'Chargement...') {
  return `
    <div class="gcg-inline-loader myacc-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(message)}</p>
    </div>
  `;
}

function logModuleError(context, error, extra = {}) {
  logUiError(`MyAccountModule:${context}`, error, {
    status: error?.status || null,
    endpoint: error?.endpoint || null,
    payload: error?.payload || null,
    message: error?.message || null,
    ...extra
  });
}

function createHttpError(message, response, payload, endpoint) {
  const error = new Error(message || 'Action impossible.');
  error.status = response?.status || null;
  error.payload = payload || null;
  error.endpoint = endpoint || null;
  return error;
}

async function requestJson(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    credentials: 'include',
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw createHttpError(payload?.error || 'Action impossible.', response, payload, endpoint);
  }
  return payload || {};
}

function getTabButton(tab) {
  return state.container?.querySelector(`[data-myacc-tab="${tab}"]`) || null;
}

function getTabPanel(tab) {
  return state.container?.querySelector(`[data-myacc-panel="${tab}"]`) || null;
}

function setActiveTab(tab) {
  state.activeTab = tab === 'sales' ? 'sales' : 'info';
  ['info', 'sales'].forEach(key => {
    const button = getTabButton(key);
    const panel = getTabPanel(key);
    const isActive = key === state.activeTab;
    if (button) {
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.tabIndex = isActive ? 0 : -1;
    }
    if (panel) {
      panel.hidden = !isActive;
      panel.classList.toggle('is-active', isActive);
      panel.classList.toggle('is-hidden', !isActive);
      panel.style.display = isActive ? '' : 'none';
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    }
  });

  const indicator = state.container?.querySelector('[data-myacc-tab-indicator]');
  const activeButton = getTabButton(state.activeTab);
  const tabs = state.container?.querySelector('[data-myacc-tabs]');
  if (indicator && activeButton && tabs) {
    const left = activeButton.offsetLeft - tabs.scrollLeft;
    indicator.style.width = `${activeButton.offsetWidth}px`;
    indicator.style.transform = `translateX(${left}px)`;
  }
}

function renderLoggedOutView(container) {
  container.innerHTML = `
    <section class="module-panel myacc-page">
      <header class="myacc-header myacc-header--logged-out">
        <div class="myacc-header__icon" aria-hidden="true">
          <i class="bi bi-person-circle"></i>
        </div>
        <div>
          <h2>Mon compte</h2>
          <p>Connectez-vous pour accéder à vos informations et à vos achats.</p>
        </div>
      </header>
      <div class="myacc-logged-out">
        <p>Vous n'êtes pas connecté.</p>
        <div class="myacc-logged-out__actions">
          <button class="primary-button" type="button" data-myacc-login>Se connecter</button>
        </div>
      </div>
    </section>
  `;
  container.querySelector('[data-myacc-login]')?.addEventListener('click', () => {
    window.location.href = LOGIN_URL;
  });
}

function renderShell(container, context) {
  const email = String(context?.user?.email || 'Utilisateur');
  container.innerHTML = `
    <section class="module-panel myacc-page">
      <header class="myacc-header">
        <div class="myacc-header__icon" aria-hidden="true">
          <i class="bi bi-person-circle"></i>
        </div>
        <div class="myacc-header__content">
          <p class="myacc-header__label">Mon compte</p>
          <h2>${escapeHtml(email)}</h2>
        </div>
      </header>

      <nav class="myacc-tabs" aria-label="Sections du compte" data-myacc-tabs>
        <button type="button" class="myacc-tab is-active" data-myacc-tab="info" aria-selected="true">
          <i class="bi bi-person-lines-fill" aria-hidden="true"></i>
          <span>Informations</span>
        </button>
        <button type="button" class="myacc-tab" data-myacc-tab="sales" aria-selected="false" tabindex="-1">
          <i class="bi bi-bag-check" aria-hidden="true"></i>
          <span>Mes achats</span>
        </button>
        <span class="myacc-tabs__indicator" data-myacc-tab-indicator aria-hidden="true"></span>
      </nav>

      <div class="myacc-main" data-myacc-main>
        <section class="myacc-panel" data-myacc-panel="info"></section>
        <section class="myacc-panel" data-myacc-panel="sales" hidden></section>
      </div>
    </section>
  `;
}

function renderInfoPanel() {
  const panel = getTabPanel('info');
  if (!panel) return;
  const user = state.context?.user || {};
  const firstName = String(user.firstName || '');
  const lastName = String(user.lastName || '');
  const email = String(user.email || '');

  panel.innerHTML = `
    <form class="myacc-info-form" data-myacc-profile-form>
      <div class="myacc-fields-grid">
        <label class="myacc-field">
          <span>Prenom</span>
          <input
            class="gcg-minimal-input"
            type="text"
            maxlength="${NAME_MAX_LENGTH}"
            autocomplete="given-name"
            value="${escapeHtml(firstName)}"
            data-myacc-first-name
          >
        </label>
        <label class="myacc-field">
          <span>Nom</span>
          <input
            class="gcg-minimal-input"
            type="text"
            maxlength="${NAME_MAX_LENGTH}"
            autocomplete="family-name"
            value="${escapeHtml(lastName)}"
            data-myacc-last-name
          >
        </label>
      </div>

      <label class="myacc-field myacc-field--readonly">
        <span>Email</span>
        <input class="gcg-minimal-input" type="text" value="${escapeHtml(email)}" readonly aria-readonly="true">
      </label>

      <div class="myacc-info-actions">
        <button type="submit" class="myacc-save-button" data-myacc-save-button>Enregistrer</button>
        <button type="button" class="myacc-inline-action" data-myacc-reset-password>
          <i class="bi bi-key" aria-hidden="true"></i>
          <span>Modifier mon mot de passe</span>
        </button>
        <button type="button" class="myacc-inline-action" data-myacc-logout>
          <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
          <span>Se deconnecter</span>
        </button>
      </div>

      <p class="form-message" data-myacc-form-feedback></p>
      <div data-myacc-reset-notice-slot></div>
    </form>
  `;
}

function renderSalesPanelShell() {
  const panel = getTabPanel('sales');
  if (!panel) return;
  panel.innerHTML = `
    <div class="myacc-sales-wrap">
      <div class="myacc-sales-list" data-myacc-sales-list>
        ${buildLoader('Chargement de vos achats...')}
      </div>
    </div>
  `;
}

function describeSaleType(items = []) {
  const labels = new Set();
  items.forEach(item => {
    const type = TYPE_LABELS[item?.type] || item?.type;
    if (type) labels.add(type);
  });
  return labels.size ? Array.from(labels).join(' · ') : 'Achat';
}

function getSaleItemCount(sale = {}) {
  const count = Number(sale.itemCount);
  if (Number.isFinite(count)) return count;
  return Array.isArray(sale.items) ? sale.items.length : 0;
}

function renderSalesList() {
  const root = state.container?.querySelector('[data-myacc-sales-list]');
  if (!root) return;
  if (!state.sales.length) {
    root.innerHTML = `
      <div class="myacc-empty-state">
        <div class="myacc-empty-state__icon"><i class="bi bi-bag"></i></div>
        <h3>Aucun achat pour le moment</h3>
        <p>Vos commandes apparaitront ici apres paiement.</p>
      </div>
    `;
    return;
  }

  root.innerHTML = state.sales
    .map((sale, index) => {
      const saleId = String(sale.id || `VENTE-${index + 1}`);
      const amount = formatPrice(sale.totalAmount);
      const date = formatDate(sale.createdAt);
      const itemCount = getSaleItemCount(sale);
      const typeLabel = describeSaleType(Array.isArray(sale.items) ? sale.items : []);
      return `
        <article class="myacc-sale-card" data-myacc-sale-id="${escapeHtml(saleId)}">
          <div class="myacc-sale-card__icon" aria-hidden="true">
            <i class="bi bi-cart-check"></i>
          </div>
          <div class="myacc-sale-card__content">
            <p class="myacc-sale-card__type">${escapeHtml(typeLabel)}</p>
            <p class="myacc-sale-card__date">${escapeHtml(date)}</p>
            <p class="myacc-sale-card__meta">${escapeHtml(String(itemCount))} article${itemCount > 1 ? 's' : ''}</p>
          </div>
          <div class="myacc-sale-card__right">
            <p class="myacc-sale-card__amount">${escapeHtml(amount)}</p>
            <button type="button" class="myacc-sale-card__detail" data-myacc-open-sale="${escapeHtml(saleId)}">
              <i class="bi bi-info-circle" aria-hidden="true"></i>
              <span>Details</span>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

function setFormFeedback(message = '', status = '') {
  const feedback = state.container?.querySelector('[data-myacc-form-feedback]');
  if (!feedback) return;
  feedback.textContent = message;
  if (status) {
    feedback.dataset.status = status;
  } else {
    delete feedback.dataset.status;
  }
}

function clearResetNoticeTimer() {
  if (state.resetNoticeTimer) {
    window.clearTimeout(state.resetNoticeTimer);
    state.resetNoticeTimer = null;
  }
}

function hideResetNotice() {
  const slot = state.container?.querySelector('[data-myacc-reset-notice-slot]');
  if (!slot) return;
  clearResetNoticeTimer();
  slot.innerHTML = '';
}

function showResetNotice({ type = 'success', message = '' } = {}) {
  const slot = state.container?.querySelector('[data-myacc-reset-notice-slot]');
  if (!slot) return;
  const safeType = type === 'error' ? 'error' : 'success';
  slot.innerHTML = `
    <div class="myacc-reset-notice myacc-reset-notice--${safeType}">
      <div class="myacc-reset-notice__icon" aria-hidden="true">
        <i class="bi ${safeType === 'success' ? 'bi-check-circle' : 'bi-exclamation-triangle'}"></i>
      </div>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="myacc-reset-notice__close" data-myacc-close-reset-notice aria-label="Fermer">
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
    </div>
  `;
  slot.querySelector('[data-myacc-close-reset-notice]')?.addEventListener('click', hideResetNotice);
  clearResetNoticeTimer();
  state.resetNoticeTimer = window.setTimeout(() => {
    hideResetNotice();
  }, NOTICE_AUTO_HIDE_MS);
}

async function handleProfileSave(event) {
  event.preventDefault();
  const firstInput = state.container?.querySelector('[data-myacc-first-name]');
  const lastInput = state.container?.querySelector('[data-myacc-last-name]');
  const saveButton = state.container?.querySelector('[data-myacc-save-button]');
  if (!firstInput || !lastInput || !saveButton) return;

  const nextFirstName = clampName(firstInput.value);
  const nextLastName = clampName(lastInput.value);
  const currentFirstName = clampName(state.context?.user?.firstName || '');
  const currentLastName = clampName(state.context?.user?.lastName || '');

  if (nextFirstName === currentFirstName && nextLastName === currentLastName) {
    setFormFeedback('Aucune modification detectee.', 'info');
    return;
  }

  firstInput.disabled = true;
  lastInput.disabled = true;
  saveButton.disabled = true;
  setFormFeedback('');

  try {
    const payload = await requestJson(PROFILE_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: nextFirstName,
        lastName: nextLastName
      })
    });
    const user = payload?.user || {};
    const finalFirst = clampName(user.firstName || nextFirstName);
    const finalLast = clampName(user.lastName || nextLastName);
    firstInput.value = finalFirst;
    lastInput.value = finalLast;
    if (state.context?.user) {
      state.context.user.firstName = finalFirst;
      state.context.user.lastName = finalLast;
    }
    setFormFeedback('Modifications enregistrées.', 'success');
    showToast({ type: 'success', message: 'Modifications enregistrées', durationMs: 1000 });
  } catch (error) {
    setFormFeedback(error?.message || "Échec de l'enregistrement.", 'error');
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('SaveProfile', error, {
      firstNameLength: nextFirstName.length,
      lastNameLength: nextLastName.length
    });
  } finally {
    firstInput.disabled = false;
    lastInput.disabled = false;
    saveButton.disabled = false;
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();
  const resetButton = state.container?.querySelector('[data-myacc-reset-password]');
  if (!resetButton) return;
  resetButton.disabled = true;

  try {
    await requestJson(RESET_PASSWORD_ENDPOINT, {
      method: 'POST'
    });
    showToast({ type: 'success', message: 'Email de réinitialisation envoyé', durationMs: 1000 });
    showResetNotice({
      type: 'success',
      message: "Un email de réinitialisation vient de vous être envoyé."
    });
  } catch (error) {
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    showResetNotice({
      type: 'error',
      message: error?.message || "Impossible d’envoyer l’email de réinitialisation."
    });
    logModuleError('PasswordResetRequest', error);
  } finally {
    resetButton.disabled = false;
  }
}

async function handleLogout(event) {
  event.preventDefault();
  const logoutButton = state.container?.querySelector('[data-myacc-logout]');
  if (!logoutButton) return;
  logoutButton.disabled = true;
  try {
    await requestJson(LOGOUT_ENDPOINT, { method: 'POST' });
    window.location.href = HOME_URL;
  } catch (error) {
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('Logout', error);
    logoutButton.disabled = false;
  }
}

async function loadSales() {
  if (state.salesLoading || state.salesLoaded) return;
  state.salesLoading = true;
  renderSalesPanelShell();
  const startedAt = Date.now();
  try {
    const payload = await requestJson(SALES_ENDPOINT);
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    state.sales = Array.isArray(payload.sales) ? payload.sales : [];
    state.salesLoaded = true;
    renderSalesList();
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) await wait(remaining);
    const root = state.container?.querySelector('[data-myacc-sales-list]');
    if (root) {
      root.innerHTML = `
        <div class="status-banner status-empty">
          <p>${escapeHtml(error?.message || 'Impossible de charger vos achats.')}</p>
        </div>
      `;
    }
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('LoadSales', error);
  } finally {
    state.salesLoading = false;
  }
}

function getSaleById(saleId) {
  const normalizedId = String(saleId || '').trim();
  if (!normalizedId) return null;
  return state.sales.find(sale => String(sale?.id || '').trim() === normalizedId) || null;
}

function buildSaleItemsMarkup(items = []) {
  if (!Array.isArray(items) || !items.length) {
    return `<p class="module-placeholder">Aucun article detaille pour cette commande.</p>`;
  }
  return `
    <div class="myacc-order-items">
      ${items
        .map(item => {
          const name = escapeHtml(item?.name || 'Article');
          const typeLabel = escapeHtml(TYPE_LABELS[item?.type] || item?.type || 'Article');
          const price = escapeHtml(formatPrice(item?.price));
          return `
            <article class="myacc-order-item">
              <div>
                <strong>${name}</strong>
                <p>${typeLabel}</p>
              </div>
              <strong>${price}</strong>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function buildGiftCardUsageMarkup(giftCardUsage = []) {
  const entries = Array.isArray(giftCardUsage) ? giftCardUsage : [];
  if (!entries.length) return '';
  const rows = entries
    .map((entry, index) => {
      const amountUsed = Number(entry?.amountUsed);
      const label = Number.isFinite(amountUsed) ? `-${formatPrice(amountUsed)}` : 'Montant indisponible';
      return `<li>Carte ${index + 1} : <strong>${escapeHtml(label)}</strong></li>`;
    })
    .join('');
  return `
    <section class="myacc-detail-block">
      <h4>Carte cadeau utilisee</h4>
      <ul class="myacc-detail-gift-list">${rows}</ul>
    </section>
  `;
}

function buildWaiverMarkup(sale = {}) {
  const waiverText = String(
    sale?.renonciation_text || sale?.consumerWaiverAcceptedText || sale?.waiverAcceptedText || sale?.consumerWaiverText || ''
  ).trim();
  if (!waiverText) return '';
  return `
    <section class="myacc-detail-block">
      <h4>Renonciation</h4>
      <p>Vous avez renonce a votre droit de retractation pour les contenus numeriques concernes.</p>
      <p class="myacc-detail-waiver-text">${escapeHtml(waiverText)}</p>
    </section>
  `;
}

function closeSaleModal() {
  const modal = state.detailsModal;
  if (!modal) return;
  const { overlay, onEsc, onOutside } = modal;
  window.removeEventListener('keydown', onEsc);
  overlay.removeEventListener('click', onOutside);
  overlay.classList.remove('is-visible');
  window.setTimeout(() => {
    overlay.remove();
  }, MODAL_CLOSE_DELAY_MS);
  state.detailsModal = null;
}

function openSaleModal(saleId) {
  const sale = getSaleById(saleId);
  if (!sale) return;
  closeSaleModal();
  const overlay = document.createElement('div');
  overlay.className = 'myacc-modal-overlay';
  overlay.innerHTML = `
    <div class="myacc-modal" role="dialog" aria-modal="true" aria-labelledby="myacc-order-modal-title">
      <header class="myacc-modal__header">
        <div>
          <h3 id="myacc-order-modal-title">Details de la commande</h3>
          <p>ID ${escapeHtml(String(sale.id || 'N/A'))} · ${escapeHtml(formatDate(sale.createdAt))}</p>
        </div>
        <button type="button" class="myacc-modal__close" data-myacc-close-sale-modal aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <div class="myacc-modal__body">
        <section class="myacc-detail-block">
          <h4>Articles achetes</h4>
          ${buildSaleItemsMarkup(sale.items)}
        </section>
        ${buildGiftCardUsageMarkup(sale.giftCardUsage)}
        ${buildWaiverMarkup(sale)}
        ${
          sale?.invoice?.downloadUrl
            ? `
              <section class="myacc-detail-block">
                <h4>Facture</h4>
                <a class="myacc-link-button" href="${escapeHtml(sale.invoice.downloadUrl)}">
                  <i class="bi bi-download" aria-hidden="true"></i>
                  <span>Télécharger la facture</span>
                </a>
              </section>
            `
            : ''
        }
      </div>
    </div>
  `;

  const onEsc = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeSaleModal();
  };

  const onOutside = event => {
    if (event.target === overlay) {
      closeSaleModal();
    }
  };

  overlay.querySelector('[data-myacc-close-sale-modal]')?.addEventListener('click', closeSaleModal);
  overlay.addEventListener('click', onOutside);
  window.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
  state.detailsModal = { overlay, onEsc, onOutside };
}

function bindEvents() {
  const tabs = state.container?.querySelector('[data-myacc-tabs]');
  if (tabs) {
    if (state.boundTabsClick) {
      tabs.removeEventListener('click', state.boundTabsClick);
    }
    state.boundTabsClick = event => {
      const button = event.target?.closest?.('[data-myacc-tab]');
      if (!button) return;
      const nextTab = String(button.dataset.myaccTab || 'info');
      setActiveTab(nextTab);
      if (nextTab === 'sales') {
        loadSales();
      }
    };
    tabs.addEventListener('click', state.boundTabsClick);
  }

  state.container?.querySelector('[data-myacc-profile-form]')?.addEventListener('submit', handleProfileSave);
  state.container?.querySelector('[data-myacc-reset-password]')?.addEventListener('click', handlePasswordReset);
  state.container?.querySelector('[data-myacc-logout]')?.addEventListener('click', handleLogout);

  if (state.container && state.boundContainerClick) {
    state.container.removeEventListener('click', state.boundContainerClick);
  }
  state.boundContainerClick = event => {
    const detailsButton = event.target?.closest?.('[data-myacc-open-sale]');
    if (!detailsButton) return;
    const saleId = String(detailsButton.dataset.myaccOpenSale || '').trim();
    if (!saleId) return;
    openSaleModal(saleId);
  };
  state.container?.addEventListener('click', state.boundContainerClick);
}

function resolveInitialTab(context = {}) {
  const rawTab = String(context?.query?.tab || context?.query?.section || '').trim().toLowerCase();
  if (rawTab === 'sales' || rawTab === 'purchases' || rawTab === 'achats') {
    return 'sales';
  }
  return 'info';
}

async function renderConnectedPage(container, context) {
  container.innerHTML = buildLoader('Chargement de votre compte...');
  const startedAt = Date.now();
  const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
  if (remaining > 0) await wait(remaining);

  state.container = container;
  state.context = context || {};
  state.activeTab = 'info';
  state.sales = [];
  state.salesLoaded = false;
  state.salesLoading = false;
  clearResetNoticeTimer();
  closeSaleModal();

  renderShell(container, context);
  renderInfoPanel();
  renderSalesPanelShell();
  bindEvents();
  const initialTab = resolveInitialTab(context);
  setActiveTab(initialTab);
  if (initialTab === 'sales') {
    loadSales();
  }
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  if (state.container && state.boundContainerClick) {
    state.container.removeEventListener('click', state.boundContainerClick);
  }
  const previousTabs = state.container?.querySelector('[data-myacc-tabs]');
  if (previousTabs && state.boundTabsClick) {
    previousTabs.removeEventListener('click', state.boundTabsClick);
  }
  state.boundContainerClick = null;
  state.boundTabsClick = null;

  if (!context?.user) {
    state.container = container;
    state.context = context;
    clearResetNoticeTimer();
    closeSaleModal();
    renderLoggedOutView(container);
    return;
  }
  await renderConnectedPage(container, context);
}

export default { renderPage };
