import { clearCart, getItems, isCartStorageEvent, removeItem, toggleSelect } from './cartService.js';
import { renderEmptyState } from './emptyStateHelper.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { openUiConfirmModal } from './uiConfirmModal.js';
import { getSiteStatus, isSiteBlockedForUser } from '../helpers/siteStatusClient.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const DETAILS_ENDPOINTS = {
  formation: formationId => `/api/vitrine/formations/${formationId}`,
  product: productId => `/api/vitrine/products/${productId}`
};
const SESSIONS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/sessions`;
const SUSPENDED_PURCHASE_MESSAGE =
  'Nous rencontrons quelques soucis, l achat est temporairement indisponible.';
const MIN_LOADER_MS = 500;
const ACTION_LOADER_MS = 500;
const REMOVE_ANIM_MS = 180;

const euroFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
});

const sessionCache = new Map();

const moduleState = {
  container: null,
  user: null,
  entries: [],
  siteBlocked: false,
  renderCounter: 0
};

let feedbackMessage = '';
let storageListenerBound = false;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function logCartError(context, error, extra = {}) {
  logUiError(`CartModule:${context}`, error, {
    status: error?.status || null,
    endpoint: error?.endpoint || null,
    payload: error?.payload || null,
    message: error?.message || null,
    ...extra
  });
}

function formatPrice(value) {
  const price = Number.parseFloat(value);
  if (!Number.isFinite(price)) return 'Prix indisponible';
  return euroFormatter.format(price);
}

function formatDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString();
}

function formatTypeLabel(type, detail) {
  if (type === 'product') return 'Produit';
  if (String(detail?.type || '').toLowerCase() === 'presentiel') return 'Formation présentielle';
  return 'Formation distancielle';
}

function resolveImage(detail = {}, type = '') {
  if (!detail || typeof detail !== 'object') return '';
  if (type === 'product') {
    return String(detail.coverImage || detail.image || detail.photos?.[0] || '').trim();
  }
  return String(detail.coverImage || detail.coverUrl || detail.image || '').trim();
}

function getPricing(detail = {}, cartItem = {}) {
  const base = Number.isFinite(Number(detail?.price))
    ? Number(detail.price)
    : Number.isFinite(Number(cartItem?.price))
    ? Number(cartItem.price)
    : 0;
  const candidateFinal = Number(detail?.finalPrice);
  const final = Number.isFinite(candidateFinal) ? candidateFinal : base;
  return {
    base,
    final,
    hasDiscount: final < base
  };
}

function buildLoader(message = 'Chargement...') {
  return `
    <div class="gcg-inline-loader cartp-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(message)}</p>
    </div>
  `;
}

function buildSessionSummary(session) {
  if (!session) return '';
  const label = `${formatDate(session.startDate)} - ${
    session.durationLabel || `${session.durationDays || 1} jour(s)`
  }`;
  return `<p class="cartp-item__session">Session: ${escapeHtml(label)}</p>`;
}

function renderEmptyCart(container) {
  renderEmptyState(container, {
    iconClass: 'bi bi-bag',
    title: 'Votre panier est vide',
    description: 'Ajoutez des produits ou des formations pour les retrouver ici.',
    action: { label: 'Decouvrir la boutique', slug: 'boutique' }
  });
}

function renderError(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-forbidden">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function applyFeedback(container) {
  if (!container) return;
  const target = container.querySelector('[data-cart-feedback]');
  if (!target) return;
  target.textContent = feedbackMessage;
}

function setFeedback(message, container) {
  feedbackMessage = message || '';
  applyFeedback(container);
}

function computeViewModel(entries = moduleState.entries) {
  const selectedEntries = entries.filter(entry => entry?.cartItem?.selected);
  const selectedCount = selectedEntries.length;
  const selectedBaseTotal = selectedEntries.reduce(
    (sum, entry) => sum + getPricing(entry.detail, entry.cartItem).base,
    0
  );
  const selectedTotal = selectedEntries.reduce(
    (sum, entry) => sum + getPricing(entry.detail, entry.cartItem).final,
    0
  );
  const selectedSavings = Math.max(0, selectedBaseTotal - selectedTotal);
  return {
    totalCount: entries.length,
    selectedCount,
    selectedBaseTotal,
    selectedTotal,
    selectedSavings,
    hasSelectedItems: selectedCount > 0
  };
}

function syncCartPayButtonState(button, viewModel) {
  if (!button || !viewModel) return;
  button.disabled = Boolean(moduleState.siteBlocked || !viewModel.hasSelectedItems);
  button.setAttribute(
    'aria-disabled',
    moduleState.siteBlocked || !viewModel.hasSelectedItems ? 'true' : 'false'
  );
  button.textContent = moduleState.siteBlocked
    ? 'Achats indisponibles'
    : `Acheter la selection${viewModel.selectedCount ? ` (${viewModel.selectedCount})` : ''}`;
}

async function loadSessions(formationId) {
  const cached = sessionCache.get(formationId);
  if (cached) return cached;
  try {
    const response = await fetch(SESSIONS_ENDPOINT(formationId), { credentials: 'include' });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => ({}));
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    sessionCache.set(formationId, sessions);
    return sessions;
  } catch (error) {
    logCartError('LoadSessions', error, { formationId });
    return [];
  }
}

async function loadItemMetadata(cartItem) {
  const endpoint = DETAILS_ENDPOINTS[cartItem.type];
  if (!endpoint) throw new Error('Type non supporte');
  const response = await fetch(endpoint(cartItem.id), { credentials: 'include' });
  if (!response.ok) throw new Error('Article introuvable');
  const payload = await response.json().catch(() => ({}));
  const detail = cartItem.type === 'product' ? payload.product || null : payload.formation || null;
  if (!detail) throw new Error('Article introuvable');

  let session = null;
  if (cartItem.type === 'formation' && detail.type === 'presentiel' && cartItem.sessionId) {
    const sessions = await loadSessions(cartItem.id);
    session = sessions.find(entry => entry.id === cartItem.sessionId) || null;
  }

  return { cartItem, detail, session };
}

function buildItemMarkup(entry) {
  const { cartItem, detail, session } = entry;
  const checkboxId = `cart-item-check-${escapeHtml(cartItem.type)}-${escapeHtml(cartItem.id)}`;
  const image = resolveImage(detail, cartItem.type);
  const typeLabel = formatTypeLabel(cartItem.type, detail);
  const pricing = getPricing(detail, cartItem);
  const savingsAmount = Math.max(0, pricing.base - pricing.final);
  const discountPercent =
    pricing.hasDiscount && pricing.base > 0
      ? Math.round((savingsAmount / pricing.base) * 100)
      : 0;
  const queryPayload = encodeURIComponent(
    JSON.stringify({
      type: cartItem.type,
      id: cartItem.id,
      ...(cartItem.sessionId ? { sessionId: cartItem.sessionId } : {})
    })
  );

  return `
    <article class="cartp-item" data-item-id="${escapeHtml(cartItem.id)}">
      <div class="cartp-item__line">
        <div class="cart-item-left cartp-item__select">
          <label class="cartp-check" for="${checkboxId}">
            <input
              id="${checkboxId}"
              class="cartp-check__input"
              type="checkbox"
              role="checkbox"
              aria-checked="${cartItem.selected ? 'true' : 'false'}"
              data-cart-checkbox
              data-item-id="${escapeHtml(cartItem.id)}"
              ${cartItem.selected ? 'checked' : ''}
            >
            <span class="cartp-check__box" aria-hidden="true">
              <i class="bi bi-check2"></i>
            </span>
          </label>
        </div>
        <div class="cart-item-media cartp-item__media" aria-hidden="true">
          ${
            image
              ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">`
              : '<span class="cartp-item__media-fallback"><i class="bi bi-image"></i></span>'
          }
        </div>
        <div class="cart-item-main cartp-item__body">
          <h3 class="cartp-item__title">${escapeHtml(detail.name || cartItem.name || 'Article')}</h3>
          <div class="cartp-item__meta">
            <p class="cartp-item__type">${escapeHtml(typeLabel)}</p>
            ${
              pricing.hasDiscount
                ? `<p class="cartp-item__promo-badge">Reduction ${
                    discountPercent > 0
                      ? `-${escapeHtml(String(discountPercent))}%`
                      : `-${escapeHtml(formatPrice(savingsAmount))}`
                  }</p>`
                : ''
            }
          </div>
          ${cartItem.type === 'formation' ? buildSessionSummary(session) : ''}
          <div class="cartp-item__actions">
            <button
              class="cartp-item__view"
              type="button"
              data-cart-view
              data-item-query="${escapeHtml(queryPayload)}"
            >
              <i class="bi bi-arrow-right-circle" aria-hidden="true"></i>
              <span>Voir le produit</span>
            </button>
          </div>
        </div>
        <div class="cart-item-right cartp-item__right">
          <div class="cartp-item__price">
            ${
              pricing.hasDiscount
                ? `
                  <span class="cartp-item__price-base"><s>${escapeHtml(formatPrice(pricing.base))}</s></span>
                  <strong class="cartp-item__price-final">${escapeHtml(formatPrice(pricing.final))}</strong>
                `
                : `<strong class="cartp-item__price-final">${escapeHtml(formatPrice(pricing.final))}</strong>`
            }
          </div>
          <button
            class="cartp-item__delete"
            type="button"
            data-cart-remove
            data-item-id="${escapeHtml(cartItem.id)}"
            aria-label="Supprimer cet élément du panier"
            title="Supprimer"
          >
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </div>
    </article>
  `;
}

function buildSelectionSummaryMarkup(viewModel) {
  if (!viewModel) return '';
  return `
    <div class="cartp-selection-summary" data-cart-selection-summary>
      <p>
        Total selection :
        <strong data-cart-selected-total-inline>${escapeHtml(formatPrice(viewModel.selectedTotal))}</strong>
      </p>
      ${
        viewModel.selectedSavings > 0
          ? `<p>Economies : <strong data-cart-selected-savings>-${escapeHtml(
              formatPrice(viewModel.selectedSavings)
            )}</strong></p>`
          : ''
      }
    </div>
  `;
}

function buildCartMarkup(entries, viewModel) {
  return `
    <section class="module-panel cartp-module">
      <header class="cartp-header">
        <div>
          <h2>Mon panier</h2>
          <p data-cart-subtitle>${viewModel.totalCount} article(s) dans votre panier</p>
        </div>
        <div class="cartp-summary">
          <span>Total selection</span>
          <strong data-cart-selected-total>${escapeHtml(formatPrice(viewModel.selectedTotal))}</strong>
        </div>
      </header>
      <section class="manager-section cartp-section">
        <div class="cartp-list" data-cart-list>
          ${entries.map(buildItemMarkup).join('')}
        </div>
        <div class="form-message cartp-feedback" data-cart-feedback></div>
        ${
          moduleState.siteBlocked
            ? `<p class="cartp-muted">${escapeHtml(SUSPENDED_PURCHASE_MESSAGE)}</p>`
            : ''
        }
        <div class="form-actions cartp-actions">
          <button class="primary-button cartp-pay-button" type="button" data-cart-pay-button>
            Acheter la selection
          </button>
        </div>
        <div data-cart-selection-summary-slot>
          ${buildSelectionSummaryMarkup(viewModel)}
        </div>
      </section>
    </section>
  `;
}

function parseItemQuery(encoded) {
  try {
    const raw = decodeURIComponent(String(encoded || '').trim());
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const type = String(parsed.type || '').trim();
    const id = String(parsed.id || '').trim();
    if (!type || !id) return null;
    const payload = { type, id };
    if (parsed.sessionId) {
      payload.sessionId = String(parsed.sessionId).trim();
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

function updateSummaryUI(container, viewModel) {
  const subtitle = container.querySelector('[data-cart-subtitle]');
  if (subtitle) {
    subtitle.textContent = `${viewModel.totalCount} article(s) dans votre panier`;
  }
  const total = container.querySelector('[data-cart-selected-total]');
  if (total) {
    total.textContent = formatPrice(viewModel.selectedTotal);
  }
}

function refreshSelectionSummaryUI(container, viewModel) {
  const slot = container.querySelector('[data-cart-selection-summary-slot]');
  if (!slot) return;
  slot.innerHTML = buildSelectionSummaryMarkup(viewModel);
}

function syncCartUI(container) {
  if (!container) return;
  if (!moduleState.entries.length) {
    renderEmptyCart(container);
    return;
  }
  const viewModel = computeViewModel();
  updateSummaryUI(container, viewModel);
  refreshSelectionSummaryUI(container, viewModel);
  const payButton = container.querySelector('[data-cart-pay-button]');
  syncCartPayButtonState(payButton, viewModel);
  applyFeedback(container);
}

function showListActionLoader(container, message = 'Mise a jour...') {
  const list = container?.querySelector('[data-cart-list]');
  if (!list) return () => {};
  const overlay = document.createElement('div');
  overlay.className = 'cartp-list-loader';
  overlay.innerHTML = buildLoader(message);
  list.classList.add('is-busy');
  list.appendChild(overlay);
  return () => {
    list.classList.remove('is-busy');
    overlay.remove();
  };
}

async function runListAction(container, message, actionFn) {
  const hideLoader = showListActionLoader(container, message);
  const startedAt = Date.now();
  try {
    await actionFn();
    const remaining = ACTION_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
  } finally {
    hideLoader();
  }
}

function openRemoveConfirmModal(itemLabel) {
  return openUiConfirmModal({
    title: 'Retirer cet article ?',
    message: `Voulez-vous retirer <strong>${escapeHtml(itemLabel || 'cet article')}</strong> du panier ?`,
    allowHtml: true,
    confirmLabel: 'Supprimer',
    cancelLabel: 'Annuler',
    intent: 'danger'
  });
}

async function handleToggleSelection(container, input) {
  const itemId = String(input?.dataset?.itemId || '').trim();
  if (!itemId) return;
  const entry = moduleState.entries.find(candidate => String(candidate?.cartItem?.id) === itemId);
  if (!entry) return;

  try {
    await runListAction(container, 'Mise a jour de la selection...', async () => {
      const toggled = toggleSelect(itemId);
      if (!toggled) {
        throw new Error('Impossible de mettre a jour la selection.');
      }
      entry.cartItem.selected = Boolean(input.checked);
      input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    });
    syncCartUI(container);
    showToast({ type: 'success', message: 'OK', durationMs: 1000 });
  } catch (error) {
    input.checked = !input.checked;
    input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logCartError('ToggleSelection', error, { itemId });
  }
}

async function handleRemoveItem(container, button) {
  const itemId = String(button?.dataset?.itemId || '').trim();
  if (!itemId) return;
  const entry = moduleState.entries.find(candidate => String(candidate?.cartItem?.id) === itemId);
  if (!entry) return;

  const confirmed = await openRemoveConfirmModal(entry?.detail?.name || entry?.cartItem?.name || 'Article');
  if (!confirmed) return;

  try {
    await runListAction(container, 'Suppression de l article...', async () => {
      const removed = removeItem(itemId);
      if (!removed) {
        throw new Error('Suppression impossible.');
      }
      moduleState.entries = moduleState.entries.filter(
        candidate => String(candidate?.cartItem?.id) !== itemId
      );
    });

    const row = container.querySelector(`.cartp-item[data-item-id="${itemId}"]`);
    if (row) {
      row.classList.add('is-leaving');
      await wait(REMOVE_ANIM_MS);
      row.remove();
    }

    syncCartUI(container);
    showToast({ type: 'success', message: 'Article retire du panier', durationMs: 1000 });
  } catch (error) {
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logCartError('RemoveItem', error, { itemId });
  }
}

function handlePurchase(container, button) {
  if (!container || !button) return;
  const viewModel = computeViewModel();

  if (moduleState.siteBlocked) {
    setFeedback(SUSPENDED_PURCHASE_MESSAGE, container);
    showToast({ type: 'error', message: 'Achats indisponibles', durationMs: 1000 });
    return;
  }
  if (!viewModel.hasSelectedItems) {
    setFeedback('Selectionnez au moins un article.', container);
    return;
  }

  requestVitrineNavigation('checkout', {
    source: 'cart-purchase',
    skipThrottle: true,
    query: { cart: 'true' }
  });
}

function bindItemHandlers(container) {
  if (!container) return;

  container.querySelectorAll('[data-cart-checkbox]').forEach(input => {
    input.onchange = () => {
      handleToggleSelection(container, input);
    };
  });

  container.querySelectorAll('[data-cart-remove]').forEach(button => {
    button.onclick = () => {
      handleRemoveItem(container, button);
    };
  });

  container.querySelectorAll('[data-cart-view]').forEach(button => {
    button.onclick = () => {
      const payload = parseItemQuery(button.dataset.itemQuery);
      if (!payload) return;
      requestVitrineNavigation('item-detail', {
        source: 'cart-item-view',
        skipThrottle: true,
        query: payload
      });
    };
  });

  const payButton = container.querySelector('[data-cart-pay-button]');
  if (payButton) {
    payButton.onclick = () => {
      handlePurchase(container, payButton);
    };
  }
}

async function renderCart(container, user = null, options = {}) {
  if (!container) return;
  const currentToken = ++moduleState.renderCounter;
  const items = getItems();
  if (!items.length) {
    moduleState.entries = [];
    renderEmptyCart(container);
    return;
  }

  const loadingMessage = options.loadingMessage || 'Chargement du panier...';
  container.innerHTML = buildLoader(loadingMessage);
  const startedAt = Date.now();

  try {
    moduleState.siteBlocked = isSiteBlockedForUser(await getSiteStatus(), user);
    const settled = await Promise.allSettled(items.map(entry => loadItemMetadata(entry)));
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    if (currentToken !== moduleState.renderCounter) return;

    const validEntries = [];
    const invalidEntries = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        validEntries.push(result.value);
      } else {
        invalidEntries.push(items[index]);
      }
    });

    if (invalidEntries.length) {
      invalidEntries.forEach(item => removeItem(item.id));
      showToast({ type: 'info', message: 'Panier mis a jour', durationMs: 1000 });
      setFeedback('Certains articles ont ete retires car ils ne sont plus disponibles.', container);
    }
    if (!validEntries.length) {
      moduleState.entries = [];
      renderEmptyCart(container);
      return;
    }

    moduleState.entries = validEntries;
    const viewModel = computeViewModel(validEntries);
    container.innerHTML = buildCartMarkup(validEntries, viewModel);
    applyFeedback(container);
    bindItemHandlers(container);
    syncCartPayButtonState(container.querySelector('[data-cart-pay-button]'), viewModel);
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    if (currentToken !== moduleState.renderCounter) return;
    logCartError('RenderCart', error);
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    renderError(container, 'Impossible de charger le panier.');
  }
}

function ensureStorageListener() {
  if (storageListenerBound || typeof window === 'undefined') return;
  window.addEventListener('storage', event => {
    if (!moduleState.container) return;
    if (isCartStorageEvent(event)) {
      renderCart(moduleState.container, moduleState.user, {
        loadingMessage: 'Mise a jour du panier...'
      });
    }
  });
  storageListenerBound = true;
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  moduleState.container = container;
  moduleState.user = context?.user || null;
  container.innerHTML = buildLoader('Chargement du panier...');
  ensureStorageListener();
  await renderCart(container, moduleState.user, { loadingMessage: 'Chargement du panier...' });
}
