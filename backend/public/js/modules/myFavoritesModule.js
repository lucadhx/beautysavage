import { addItem, getItems } from './cartService.js';
import { renderEmptyState } from './emptyStateHelper.js';
import { triggerFlyToTarget } from '../ui/acquisitionAnimationService.js';
import { isAddToCartButtonAdded, setAddToCartButtonState } from '../ui/addToCartButtonState.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';

const FAVORITES_ENDPOINT = '/api/client/favorites';
const CART_TARGET_SELECTOR = '.header-icon-button[data-header-icon="panier"]';

function isAlreadyInCart(type, id) {
  return getItems().some(entry => entry.type === type && entry.id === id);
}

function requireAuthAction(actionLabel) {
  const guard = window.ensureAuthForAction;
  if (typeof guard === 'function') {
    return guard(actionLabel);
  }
  return true;
}

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
  return `${price.toFixed(2)} â‚¬`;
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

async function fetchFavorites() {
  const response = await fetch(FAVORITES_ENDPOINT, { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || 'Impossible de charger les favoris.');
  }
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload.favorites) ? payload.favorites : [];
}

function buildFavoriteCard(favorite) {
  if (!favorite?.target) return '';
  const target = favorite.target;
  const typeLine =
    favorite.targetType === 'formation'
      ? `Formation â€” ${target.formationType === 'presentiel' ? 'PrÃ©sentiel' : 'distanciel'}`
      : 'Produit';
  const needsSession = target.sessionRequired === true;
  const detailUrl = favorite.detailUrl || `/vitrine.html?page=item-detail&type=${favorite.targetType}&id=${favorite.targetId}`;
  return `
    <article
      class="favorite-card"
      data-favorite-card
      data-target-type="${escapeHtml(favorite.targetType)}"
      data-target-id="${escapeHtml(favorite.targetId)}"
      data-session-required="${needsSession ? 'true' : 'false'}"
      data-detail-url="${escapeHtml(detailUrl)}"
      data-target-name="${escapeHtml(target.name)}"
      data-target-price="${escapeHtml(Number(target.price || 0))}"
      data-target-image="${escapeHtml(target.coverImage || '')}"
    >
      <div class="favorite-card-media">
        ${target.coverImage ? `<img src="${escapeHtml(target.coverImage)}" alt="${escapeHtml(target.name)}" loading="lazy" data-acquisition-image>` : "<div class=\"module-placeholder\">Pas d'image</div>"}
      </div>
      <div class="favorite-card-body">
        <strong>${escapeHtml(target.name)}</strong>
        <p class="favorite-card-type">${escapeHtml(typeLine)}</p>
        <p class="favorite-card-price">${formatPrice(target.price)}</p>
      </div>
      <div class="favorite-card-actions">
        <button class="btn btn-secondary" type="button" data-favorite-add ${needsSession ? 'disabled' : ''}>
          Ajouter au panier
        </button>
        <button class="primary-button" type="button" data-favorite-buy ${needsSession ? 'disabled' : ''}>
          Acheter
        </button>
      </div>
      <p class="form-message" data-favorite-feedback></p>
    </article>
  `;
}

function renderFavoritesList(container, favorites) {
  if (!container) return;
  if (!favorites.length) {
    renderEmptyState(container, {
      iconClass: 'bi bi-heart',
      title: 'Aucun favori pour le moment',
      description: 'Ajoutez des articles Ã  vos favoris pour les retrouver facilement.',
      action: { label: 'Explorer les produits', slug: 'shop' }
    });
    return;
  }
  container.innerHTML = favorites.map(buildFavoriteCard).join('');
}

function handleFavoriteAdd(button) {
  const card = button.closest('[data-favorite-card]');
  if (!card) return;
  const needsSession = card.dataset.sessionRequired === 'true';
  const type = card.dataset.targetType;
  const id = card.dataset.targetId;
  const name = card.dataset.targetName || '';
  const price = Number(card.dataset.targetPrice || 0);
  const feedback = card.querySelector('[data-favorite-feedback]');
  if (needsSession) {
    if (feedback) {
      feedback.textContent = 'Choisissez une session sur la fiche pour finaliser.';
    }
    window.location.href = card.dataset.detailUrl;
    return;
  }
  if (!requireAuthAction('Ajouter au panier')) {
    return;
  }
  if (isAddToCartButtonAdded(button) || isAlreadyInCart(type, id)) {
    setAddToCartButtonState(button, 'added');
    return;
  }
  setAddToCartButtonState(button, 'loading');
  const added = addItem({ type, id, name, price });
  if (added) {
    const sourceElement = card.querySelector('.favorite-card-media') || card;
    triggerFlyToTarget({
      sourceElement,
      targetSelector: CART_TARGET_SELECTOR,
      mode: 'cart'
    });
    setAddToCartButtonState(button, 'added');
  } else {
    setAddToCartButtonState(button, 'default');
  }
  if (feedback) {
    feedback.textContent = added ? 'Article ajoute au panier.' : "Impossible d'ajouter le panier.";
  }
}

function handleFavoriteBuy(button) {
  const card = button.closest('[data-favorite-card]');
  if (!card) return;
  const needsSession = card.dataset.sessionRequired === 'true';
  const type = card.dataset.targetType;
  const id = card.dataset.targetId;
  if (!type || !id) return;
  if (needsSession) {
    window.location.href = card.dataset.detailUrl;
    return;
  }
  requestVitrineNavigation('checkout', {
    source: 'favorites-buy',
    skipThrottle: true,
    query: {
      type,
      id,
      originSlug: 'myfavorites',
      originType: type,
      originId: id
    }
  });
}

function hydrateAddToCartButtons(container) {
  if (!container) return;
  container.querySelectorAll('[data-favorite-card]').forEach(card => {
    const button = card.querySelector('[data-favorite-add]');
    if (!button) return;
    const type = card.dataset.targetType;
    const id = card.dataset.targetId;
    const needsSession = card.dataset.sessionRequired === 'true';
    if (needsSession) {
      setAddToCartButtonState(button, 'default');
      button.disabled = true;
      return;
    }
    if (isAlreadyInCart(type, id)) {
      setAddToCartButtonState(button, 'added');
      return;
    }
    setAddToCartButtonState(button, 'default');
    button.disabled = false;
  });
}

function attachFavoritesInteractions(container) {
  if (!container) return;
  container.addEventListener('click', event => {
    const addButton = event.target.closest('[data-favorite-add]');
    if (addButton) {
      event.stopPropagation();
      handleFavoriteAdd(addButton);
      return;
    }
    const buyButton = event.target.closest('[data-favorite-buy]');
    if (buyButton) {
      event.stopPropagation();
      handleFavoriteBuy(buyButton);
      return;
    }
    const card = event.target.closest('[data-favorite-card]');
    if (!card) return;
    if (event.target.closest('button')) return;
    const detailUrl = card.dataset.detailUrl;
    if (detailUrl) {
      window.location.href = detailUrl;
    }
  });
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  if (!context.user) {
    renderStatus(container, 'Connectez-vous pour afficher vos favoris.');
    return;
  }
  container.innerHTML = `
    <div class="module-panel favorites-page">
      <header>
        <h2>Mes favoris</h2>
        <p>Retrouvez vos produits et formations sauvegardes.</p>
      </header>
      <section class="favorites-grid" data-favorites-list>
        <p class="module-placeholder">Chargement des favoris...</p>
      </section>
    </div>
  `;
  const list = container.querySelector('[data-favorites-list]');
  if (!list) return;
  try {
    const favorites = await fetchFavorites();
    renderFavoritesList(list, favorites);
    hydrateAddToCartButtons(list);
    attachFavoritesInteractions(list);
  } catch (error) {
    console.error('Erreur chargement favoris', error);
    renderStatus(list, 'Impossible de charger vos favoris.');
  }
}

