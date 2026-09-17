import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { getSiteStatus, isSiteBlockedForUser } from '../helpers/siteStatusClient.js';

const SHOP_ENDPOINT = '/api/vitrine/shop';
const GIFT_CARD_ENDPOINT = '/api/vitrine/gift-cards';
const FAVORITES_ENDPOINT = '/api/client/favorites';
const FAVORITE_ACTIVE_ICON = '<i class="bi bi-suit-heart-fill" aria-hidden="true"></i>';
const FAVORITE_INACTIVE_ICON = '<i class="bi bi-suit-heart" aria-hidden="true"></i>';
const LOGIN_PAGE = '/login.html';


function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) {
    return 'Prix indisponible';
  }
  return `${price.toFixed(2)} €`;
}


function buildPromotionBadge(promotion) {
  if (!promotion) return '';
  const label =
    promotion.discountType === 'percentage'
      ? `-${promotion.discountValue}%`
      : `-${formatPrice(promotion.discountValue)}`;
  return `<span class="promotion-badge">${label}</span>`;
}

const REVIEW_STATS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/reviews/stats`;
const MIN_LOADER_DURATION = 500;
const DROPDOWN_ANIMATION_DURATION = 180;
const TYPE_LABELS = {
  product: 'Produits',
  formation: 'Formations',
  'gift-card': 'Cartes cadeaux'
};
const SORT_OPTIONS = [
  { value: 'price-desc', label: 'Prix décroissant' },
  { value: 'price-asc', label: 'Prix croissant' },
  { value: 'recent', label: 'Récent' },
  { value: 'oldest', label: 'Moins récent' }
];

function buildPawIcons(averageRating) {
  const normalized = Number.isFinite(averageRating) ? Math.min(Math.max(averageRating, 0), 5) : 0;
  const activeCount = Math.round(normalized);
  return Array.from({ length: 5 })
    .map(
      (_value, index) =>
        `<span class="paw-icon${index < activeCount ? ' is-active' : ''}">${PAW_ICON_SVG}</span>`
    )
    .join('');
}

async function fetchFormationReviewStats(formationId) {
  if (!formationId) return null;
  try {
    const response = await fetch(REVIEW_STATS_ENDPOINT(formationId));
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    if (!payload?.ok) return null;
    return {
      averageRating: Number.isFinite(Number(payload.averageRating))
        ? Number(payload.averageRating)
        : 0,
      reviewCount: Number.isFinite(Number(payload.reviewCount))
        ? Number(payload.reviewCount)
        : 0
    };
  } catch (error) {
    console.error('Erreur chargement avis formation', error);
    return null;
  }
}

function renderRatingSummary(target, stats) {
  if (!target) return;
  const count = Number(stats?.reviewCount || 0);
  if (count <= 0) {
    target.innerHTML = '';
    return;
  }
  const average = Number.isFinite(Number(stats.averageRating)) ? Number(stats.averageRating) : 0;
  const accessibleLabel = `${average.toFixed(1)} sur 5 pour ${count} avis`;
  target.innerHTML = `
    <div class="paw-row paw-row--compact" role="img" aria-label="${escapeHtml(accessibleLabel)}">
      ${buildPawIcons(average)}
    </div>
    <span class="sr-only">${escapeHtml(accessibleLabel)}</span>
  `;
}



async function hydrateFormationRatings(container, items) {
  if (!container || !items?.length) return;
  const formations = items.filter(entry => entry.kind === 'formation' && entry.id);
  await Promise.all(
    formations.map(async formation => {
      const target = container.querySelector(`[data-formation-rating="${formation.id}"]`);
      if (!target) return;
      const stats = await fetchFormationReviewStats(formation.id);
      renderRatingSummary(target, stats);
    })
  );
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}


function renderShopItems(container, items, favoritesMap = new Map()) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = '<p class="module-placeholder">Aucun article disponible pour le moment.</p>';
    return;
  }
  container.innerHTML = items
    .map(item => {
      const imageHtml = item.coverImage
        ? `<img src="${escapeHtml(item.coverImage)}" alt="${escapeHtml(item.name)}" loading="lazy">`
        : "<div class=\"shop-card-placeholder module-placeholder\">Pas d'image</div>";
      const hasPromotion = Boolean(item.activePromotion);
      const promotionBadge = hasPromotion ? buildPromotionBadge(item.activePromotion) : '';
      const typeLabel =
        item.kind === 'formation'
          ? escapeHtml(item.type || 'Formation')
          : item.kind === 'product'
            ? 'Produit'
            : 'Carte cadeau';
      const description =
        item.kind === 'gift-card' && item.description
          ? `<p class="muted">${escapeHtml(item.description)}</p>`
          : '';
      const minAmountInfo =
        item.kind === 'gift-card'
          ? `<p class="muted">A partir de ${formatPrice(item.minAmount)}</p>`
          : '';
      const priceHtml = item.activePromotion
        ? `<div class="shop-card-price">
            <span class="shop-price-base"><s>${formatPrice(item.price)}</s></span>
            <span class="shop-price-final">${formatPrice(item.finalPrice)}</span>
          </div>`
        : `<div class="shop-card-price">
            <span class="shop-price-final">${formatPrice(item.finalPrice || item.price)}</span>
          </div>`;
      const isFavoriteEligible = item.kind === 'product' || item.kind === 'formation';
      const normalizedType = item.kind === 'formation' ? 'formation' : item.kind === 'product' ? 'product' : null;
      const favoriteKey = normalizedType ? createFavoriteKey(normalizedType, item.id) : null;
      const isFavorite = favoriteKey ? favoritesMap.has(favoriteKey) : false;
      const favoriteLabel = isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris';
      const favoriteButton =
        isFavoriteEligible && normalizedType
          ? `
            <button
              class="favorite-toggle${isFavorite ? ' is-active' : ''}"
              type="button"
              data-favorite-toggle
              data-target-type="${escapeHtml(normalizedType)}"
              data-target-id="${escapeHtml(item.id)}"
              aria-pressed="${isFavorite ? 'true' : 'false'}"
              aria-label="${escapeHtml(favoriteLabel)}"
            >
              <span class="favorite-icon" aria-hidden="true">${isFavorite ? FAVORITE_ACTIVE_ICON : FAVORITE_INACTIVE_ICON}</span>
            </button>
          `
          : '';
      const mediaHtml = `<div class="shop-card-media">
          ${hasPromotion ? promotionBadge : ''}
          ${imageHtml}
        </div>`;
      const ratingRow =
        item.kind === 'formation'
          ? `
            <div class="shop-card-meta">
              <div class="paw-row" data-formation-rating="${escapeHtml(item.id)}"></div>
              ${favoriteButton}
            </div>
          `
          : isFavoriteEligible && normalizedType
            ? `<div class="shop-card-meta shop-card-meta--no-rating">${favoriteButton}</div>`
            : '';
      return `
        <article class="shop-card clickable-card" data-shop-card data-shop-id="${escapeHtml(item.id)}" data-shop-kind="${escapeHtml(item.kind)}">
          ${mediaHtml}
          <div class="shop-card-body">
            <p class="shop-card-type">${typeLabel}</p>
            <h3 class="shop-card-title">${escapeHtml(item.name)}</h3>
            ${ratingRow}
            <div class="shop-card-price-row">
              ${priceHtml}
            </div>
            ${description ? `<p class="shop-card-text">${description}</p>` : ''}
            ${minAmountInfo ? `<p class="shop-card-text">${minAmountInfo}</p>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

async function fetchShop() {
  const response = await fetch(SHOP_ENDPOINT);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || 'Impossible de charger la boutique.');
  }
  const payload = await response.json().catch(() => ({}));
  const formations = Array.isArray(payload.formations)
    ? payload.formations.map(entry => ({ ...entry, kind: 'formation' }))
    : [];
  const products = Array.isArray(payload.products)
    ? payload.products.map(entry => ({ ...entry, kind: 'product' }))
    : [];
  return [...formations, ...products];
}

async function fetchGiftCardConfig() {
  const response = await fetch(GIFT_CARD_ENDPOINT);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || 'Impossible de charger les cartes cadeau.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload?.ok) {
    throw new Error(payload?.error || 'Erreur configuration carte cadeau.');
  }
  return payload.config || null;
}

function buildGiftCardEntry(config) {
  if (!config) return null;
  return {
    id: 'gift-card',
    kind: 'gift-card',
    name: 'Carte cadeau',
    minAmount: Number.isFinite(Number(config.minAmount)) ? Number(config.minAmount) : 0,
    description: config.description || '',
    coverImage: config.image || '',
    price: Number.isFinite(Number(config.minAmount)) ? Number(config.minAmount) : 0
  };
}

function attachCardHandler(container) {
  if (!container) return;
  container.addEventListener('click', event => {
    const card = event.target.closest('[data-shop-card]');
    if (!card) return;
    const itemId = card.dataset.shopId;
    const itemKind = card.dataset.shopKind;
    if (!itemId || !itemKind) return;
    if (itemKind === 'gift-card') {
      requestVitrineNavigation('gift-card', { source: 'shop-gift-card' });
      return;
    }
    requestVitrineNavigation('item-detail', {
      source: 'shop-item',
      query: { type: itemKind, id: itemId }
    });
  });
}

function createFavoriteKey(type, id) {
  if (!type || !id) return null;
  return `${type}:${id}`;
}

function redirectToLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `${LOGIN_PAGE}?next=${next}`;
}

function requireAuthAction(actionLabel) {
  const guard = window.ensureAuthForAction;
  if (typeof guard === 'function') {
    return guard(actionLabel);
  }
  redirectToLogin();
  return false;
}

async function loadClientFavorites(user) {
  if (!user) return new Map();
  try {
    const response = await fetch(FAVORITES_ENDPOINT, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Favoris indisponibles');
    }
    const payload = await response.json().catch(() => ({}));
    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const map = new Map();
    for (const favorite of favorites) {
      const key = createFavoriteKey(favorite.targetType, favorite.targetId);
      if (key && favorite.id) {
        map.set(key, favorite.id);
      }
    }
    return map;
  } catch (error) {
    console.error('Erreur chargement favoris', error);
    return new Map();
  }
}

function updateFavoriteButton(button, isActive) {
  if (!button) return;
  button.classList.toggle('is-active', Boolean(isActive));
  button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  const icon = button.querySelector('.favorite-icon');
  if (icon) {
    icon.innerHTML = isActive ? FAVORITE_ACTIVE_ICON : FAVORITE_INACTIVE_ICON;
  }
  // micro-animation visuelle après mise à jour
  button.classList.remove('favorite-toggle--pulse');
  // forcer un reflow pour redéclencher l’animation si on reclique
  // eslint-disable-next-line no-unused-expressions
  void button.offsetWidth;
  button.classList.add('favorite-toggle--pulse');
}

async function toggleFavorite(button, favoritesMap) {
  if (!button) return;
  const targetType = button.dataset.targetType;
  const targetId = button.dataset.targetId;
  if (!targetType || !targetId) return;
  const key = createFavoriteKey(targetType, targetId);
  if (!key) return;
  const existingId = favoritesMap.get(key);
  const isRemoval = Boolean(existingId);
  const endpoint = isRemoval ? `${FAVORITES_ENDPOINT}/${existingId}` : FAVORITES_ENDPOINT;
  const options = {
    method: isRemoval ? 'DELETE' : 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  };
  if (!isRemoval) {
    options.body = JSON.stringify({ targetType, targetId });
  }
  const previousDisabled = button.disabled;
  button.disabled = true;
  try {
    const response = await fetch(endpoint, options);
    if (!response.ok) {
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      const payload = await response.text().catch(() => '');
      console.error('Erreur favoris', payload);
      return;
    }
    if (isRemoval) {
      favoritesMap.delete(key);
      updateFavoriteButton(button, false);
    } else {
      const payload = await response.json().catch(() => ({}));
      const favoriteId = payload?.favorite?.id;
      if (favoriteId) {
        favoritesMap.set(key, favoriteId);
      }
      updateFavoriteButton(button, true);
    }
  } catch (error) {
    console.error('Erreur toggle favoris', error);
  } finally {
    button.disabled = previousDisabled;
  }
}

function attachFavoriteHandlers(container, favoritesMap, user) {
  if (!container) return;
  container.addEventListener('click', async event => {
    const button = event.target.closest('[data-favorite-toggle]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!user && !requireAuthAction('Ajouter aux favoris')) {
      return;
    }
    await toggleFavorite(button, favoritesMap);
  });
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeFormationSubtype(value) {
  const normalized = normalizeText(value);
  if (normalized.includes('present')) return 'presentiel';
  if (normalized.includes('distanc')) return 'distanciel';
  return null;
}

function getPriceValue(item) {
  const price = Number(item?.finalPrice ?? item?.price);
  return Number.isFinite(price) ? price : 0;
}

function getDateValue(item) {
  if (!item?.createdAt) return 0;
  const time = new Date(item.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortItems(items, sortBy) {
  const sorted = [...items];
  switch (sortBy) {
    case 'price-desc':
      return sorted.sort((a, b) => getPriceValue(b) - getPriceValue(a));
    case 'price-asc':
      return sorted.sort((a, b) => getPriceValue(a) - getPriceValue(b));
    case 'recent':
      return sorted.sort((a, b) => getDateValue(b) - getDateValue(a));
    case 'oldest':
      return sorted.sort((a, b) => getDateValue(a) - getDateValue(b));
    default:
      return sorted;
  }
}

function applySearchAndFilters(entries, state) {
  const query = normalizeText(state.searchTerm);
  const filtered = entries.filter(item => {
    if (state.filterType !== 'all' && item.kind !== state.filterType) {
      return false;
    }
    if (state.formationSubtype && state.formationSubtype !== 'all') {
      if (item.kind !== 'formation') return false;
      const itemSubtype = normalizeFormationSubtype(item.type);
      if (itemSubtype !== state.formationSubtype) return false;
    }
    if (!query) return true;
    const haystack = normalizeText(`${item.name || ''} ${item.type || ''} ${item.description || ''}`);
    return haystack.includes(query);
  });
  return sortItems(filtered, state.sortBy);
}

function buildTypeOptions(entries) {
  const counts = entries.reduce((acc, item) => {
    if (!item?.kind) return acc;
    acc[item.kind] = (acc[item.kind] || 0) + 1;
    return acc;
  }, {});
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const order = ['product', 'formation', 'gift-card'];
  const options = order
    .filter(kind => counts[kind])
    .map(kind => ({
      value: kind,
      label: TYPE_LABELS[kind] || kind,
      count: counts[kind]
    }));
  return { total, options };
}

function renderFilterOptions(listEl, options, total, currentValue) {
  if (!listEl) return;
  const entries = [{ value: 'all', label: 'Tous', count: total }, ...options];
  listEl.innerHTML = entries
    .map(
      option => `
        <button
          type="button"
          class="shop-dropdown-option${option.value === currentValue ? ' is-active' : ''}"
          data-filter-value="${option.value}"
        >
          <span>${escapeHtml(option.label)}</span>
          ${typeof option.count === 'number' ? `<span class="option-pill">${option.count}</span>` : ''}
        </button>
      `
    )
    .join('');
}

function renderSortOptions(listEl, currentValue) {
  if (!listEl) return;
  listEl.innerHTML = SORT_OPTIONS.map(
    option => `
      <button
        type="button"
        class="shop-dropdown-option${option.value === currentValue ? ' is-active' : ''}"
        data-sort-value="${option.value}"
      >
        <span>${escapeHtml(option.label)}</span>
      </button>
    `
  ).join('');
}

function buildShopLoader(message = 'Recherche en cours...') {
  return `
    <div class="shop-loader" role="status" aria-live="polite">
      <div class="shop-loader__paws">
        <span class="shop-loader__paw">${PAW_ICON_SVG}</span>
        <span class="shop-loader__paw shop-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="shop-loader__paw shop-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="shop-loader__text">${escapeHtml(message)}</p>
    </div>
  `;
}

function setDropdownState(toggle, panel, isOpen) {
  if (!toggle || !panel) return;
  toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  if (isOpen) {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('is-open'));
  } else {
    panel.classList.remove('is-open');
    setTimeout(() => {
      panel.hidden = true;
    }, DROPDOWN_ANIMATION_DURATION);
  }
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  const user = context.user || null;
  const query = context?.query || {};
  const favoritesPromise = loadClientFavorites(user);
  const siteStatusPromise = getSiteStatus();
  const uiState = {
    searchTerm: '',
    filterType: 'all',
    formationSubtype: 'all',
    sortBy: 'recent',
    entries: [],
    favoritesMap: new Map()
  };

  const presetSubtype =
    normalizeFormationSubtype(query?.formationType) || normalizeFormationSubtype(query?.type);
  if (presetSubtype) {
    uiState.filterType = 'formation';
    uiState.formationSubtype = presetSubtype;
  }

  container.innerHTML = `
    <div class="module-panel shop-module">
      <header class="shop-header">
        <p class="shop-site-status" data-shop-site-status hidden>
          <i class="bi bi-exclamation-circle" aria-hidden="true"></i>
          <span>Achats indisponibles</span>
        </p>
        <div class="shop-toolbar">
          <div class="shop-search" data-shop-search>
            <i class="bi bi-search shop-search-icon" aria-hidden="true"></i>
            <input
              type="search"
              class="shop-search-input"
              placeholder="Rechercher"
              aria-label="Rechercher dans la boutique"
              data-shop-search-input
            >
          </div>
          <div class="shop-actions">
            <div class="shop-dropdown">
              <button
                type="button"
                class="shop-menu-trigger icon-only"
                data-filter-toggle
                aria-expanded="false"
                aria-controls="shop-filter-panel"
                aria-label="Filtrer les articles"
              >
                <i class="bi bi-funnel" aria-hidden="true"></i>
              </button>
              <div class="shop-dropdown-panel" id="shop-filter-panel" data-filter-panel hidden>
                <p class="shop-dropdown-title">Types disponibles</p>
                <div class="shop-dropdown-list" data-filter-options></div>
              </div>
            </div>
            <div class="shop-dropdown">
              <button
                type="button"
                class="shop-menu-trigger icon-only"
                data-sort-toggle
                aria-expanded="false"
                aria-controls="shop-sort-panel"
                aria-label="Trier les articles"
              >
                <i class="bi bi-arrow-down-up" aria-hidden="true"></i>
              </button>
              <div class="shop-dropdown-panel" id="shop-sort-panel" data-sort-panel hidden>
                <p class="shop-dropdown-title">Ordre d'affichage</p>
                <div class="shop-dropdown-list" data-sort-options></div>
              </div>
            </div>
          </div>
        </div>
      </header>
      <section class="shop-grid-section">
        <div class="shop-grid" data-shop-list>
          <p class="module-placeholder">Chargement de la boutique...</p>
        </div>
      </section>
    </div>
  `;

  const list = container.querySelector('[data-shop-list]');
  const searchInput = container.querySelector('[data-shop-search-input]');
  const filterOptions = container.querySelector('[data-filter-options]');
  const sortOptions = container.querySelector('[data-sort-options]');
  const filterToggle = container.querySelector('[data-filter-toggle]');
  const sortToggle = container.querySelector('[data-sort-toggle]');
  const filterPanel = container.querySelector('[data-filter-panel]');
  const sortPanel = container.querySelector('[data-sort-panel]');
  const siteStatusNotice = container.querySelector('[data-shop-site-status]');
  let typeOptions = [];
  let totalCount = 0;

  const dropdowns = [
    { toggle: filterToggle, panel: filterPanel },
    { toggle: sortToggle, panel: sortPanel }
  ];

  const closeAllDropdowns = except => {
    dropdowns.forEach(dropdown => {
      if (!dropdown.toggle || !dropdown.panel) return;
      if (except && dropdown === except) return;
      setDropdownState(dropdown.toggle, dropdown.panel, false);
    });
  };

  dropdowns.forEach(dropdown => {
    if (!dropdown.toggle || !dropdown.panel) return;
    dropdown.toggle.addEventListener('click', () => {
      const isOpen = dropdown.toggle.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        setDropdownState(dropdown.toggle, dropdown.panel, false);
      } else {
        closeAllDropdowns(dropdown);
        setDropdownState(dropdown.toggle, dropdown.panel, true);
      }
    });
  });

  document.addEventListener('click', event => {
    const isInsideDropdown = dropdowns.some(
      dropdown =>
        dropdown.toggle?.contains(event.target) || dropdown.panel?.contains(event.target)
    );
    if (!container.contains(event.target) || !isInsideDropdown) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeAllDropdowns();
    }
  });

  const updateFilterLabel = () => {
    const label =
      uiState.filterType === 'all'
        ? 'Tous les articles'
        : TYPE_LABELS[uiState.filterType] || 'Filtrer';
    // icon-only trigger, label kept for potential aria announcements if needed
  };

  const updateSortLabel = () => {
    const current = SORT_OPTIONS.find(option => option.value === uiState.sortBy);
    // icon-only trigger, label hidden
  };

  const renderListContent = itemsToRender => {
    renderShopItems(list, itemsToRender, uiState.favoritesMap);
    hydrateFormationRatings(list, itemsToRender).catch(error =>
      console.error('Erreur avis boutique', error)
    );
  };

  let renderToken = 0;
  const renderResults = (useLoader = false, message = 'Mise a jour...') => {
    if (!list) return;
    const computed = applySearchAndFilters(uiState.entries, uiState);
    if (!useLoader) {
      renderListContent(computed);
      return;
    }
    const currentToken = ++renderToken;
    const start = performance.now();
    list.dataset.loading = 'true';
    list.innerHTML = buildShopLoader(message);
    const remaining = Math.max(0, MIN_LOADER_DURATION - (performance.now() - start));
    setTimeout(() => {
      if (currentToken !== renderToken) return;
      list.dataset.loading = 'false';
      renderListContent(computed);
    }, remaining);
  };

  let searchDebounce;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const value = searchInput.value || '';
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        uiState.searchTerm = value;
        renderResults(true, 'Recherche en cours...');
      }, 180);
    });
  }

  if (filterOptions) {
    filterOptions.addEventListener('click', event => {
      const option = event.target.closest('[data-filter-value]');
      if (!option) return;
      uiState.filterType = option.dataset.filterValue || 'all';
      if (uiState.filterType !== 'formation') {
        uiState.formationSubtype = 'all';
      }
      renderFilterOptions(filterOptions, typeOptions, totalCount, uiState.filterType);
      updateFilterLabel();
      renderResults(true, 'Filtrage en cours...');
      closeAllDropdowns();
    });
  }

  if (sortOptions) {
    sortOptions.addEventListener('click', event => {
      const option = event.target.closest('[data-sort-value]');
      if (!option) return;
      uiState.sortBy = option.dataset.sortValue || 'recent';
      renderSortOptions(sortOptions, uiState.sortBy);
      updateSortLabel();
      renderResults(true, 'Tri en cours...');
      closeAllDropdowns();
    });
  }

  try {
    const siteBlocked = isSiteBlockedForUser(await siteStatusPromise, user);
    if (siteStatusNotice) {
      siteStatusNotice.hidden = !siteBlocked;
    }
    const items = await fetchShop();
    let giftCardConfig = null;
    try {
      giftCardConfig = await fetchGiftCardConfig();
    } catch (error) {
      console.warn('Carte cadeau indisponible', error);
    }
    const giftCardEntry = buildGiftCardEntry(giftCardConfig);
    const entries = giftCardEntry ? [giftCardEntry, ...items] : items;
    uiState.entries = entries;
    uiState.favoritesMap = await favoritesPromise;

    const { total, options } = buildTypeOptions(entries);
    typeOptions = options;
    totalCount = total;

    renderFilterOptions(filterOptions, typeOptions, totalCount, uiState.filterType);
    renderSortOptions(sortOptions, uiState.sortBy);
    updateFilterLabel();
    updateSortLabel();

    renderResults(false);
    attachFavoriteHandlers(list, uiState.favoritesMap, user);
    attachCardHandler(list);
  } catch (error) {
    console.error('Erreur boutique', error);
    renderStatus(list, 'Impossible de charger la boutique.');
  }
}
