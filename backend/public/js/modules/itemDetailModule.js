import { createBookingCalendar } from './bookingCalendarComponent.js';
import { addItem, getItems } from './cartService.js';
import { triggerFlyToTarget } from '../ui/acquisitionAnimationService.js';
import { isAddToCartButtonAdded, setAddToCartButtonState } from '../ui/addToCartButtonState.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { showToast } from '../helpers/toastService.js';
import { getSiteStatus, isSiteBlockedForUser } from '../helpers/siteStatusClient.js';
import {
  buildSessionCardsMarkup,
  buildSessionSelectionLabel,
  buildSessionTimeRangeLabel,
  findFirstSelectableSessionId,
  normalizeTimeLabel,
  isSessionComplete,
  getSessionRemainingSlots
} from '../helpers/sessionCardsRenderer.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import { consumeCheckoutResult } from './purchaseFlowService.js';

const DETAILS_ENDPOINTS = {
  formation: formationId => `/api/vitrine/formations/${formationId}`,
  product: productId => `/api/vitrine/products/${productId}`
};
const SESSIONS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/sessions`;
const FORMATION_SESSION_OPTIONS_ENDPOINT = (formationId, sessionId) =>
  `/api/vitrine/formations/${formationId}/sessions/${sessionId}/options`;
const PURCHASE_STATUS_ENDPOINT = '/api/client/purchase-status';
const CART_TARGET_SELECTOR = '.header-icon-button[data-header-icon="panier"]';
const REVIEWS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/reviews`;
const FAVORITES_ENDPOINT = '/api/client/favorites';
const SUSPENDED_PURCHASE_MESSAGE =
  'Nous rencontrons quelques soucis, l achat est temporairement indisponible.';

function isAlreadyInCart(type, id) {
  return getItems().some(entry => entry.type === type && entry.id === id);
}

function getDetailCardSource(container) {
  if (!container) return null;
  return container.querySelector('[data-item-detail-card]') || container;
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
  return `${price.toFixed(2)} €`;
}

function capitalizeLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function formatPromotionLabel(promotion) {
  if (!promotion) return '';
  const valueLabel =
    promotion.discountType === 'percentage'
      ? `-${promotion.discountValue}%`
      : formatPrice(promotion.discountValue);
  const endDate = promotion.endAt ? new Date(promotion.endAt) : null;
  if (endDate && !Number.isNaN(endDate.getTime())) {
    const endStr = endDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${valueLabel} · Jusqu'au ${endStr}`;
  }
  return valueLabel;
}

/* ── Stars (detail page) ── */
function buildStarIcons(rating) {
  const normalized = Math.min(
    Math.max(Number.isFinite(Number(rating)) ? Number(rating) : 0, 0),
    5
  );
  const full = Math.floor(normalized);
  const hasHalf = normalized - full >= 0.5;
  return Array.from({ length: 5 })
    .map((_, i) => {
      let icon = 'bi-star';
      if (i < full) icon = 'bi-star-fill';
      else if (i === full && hasHalf) icon = 'bi-star-half';
      return `<i class="bi ${icon} idd-star" aria-hidden="true"></i>`;
    })
    .join('');
}

/* ── Price block (new) ── */
function buildPriceBlock(item) {
  const basePrice = Number.isFinite(Number(item?.price)) ? Number(item.price) : 0;
  const finalPrice = Number.isFinite(Number(item?.finalPrice)) ? Number(item.finalPrice) : basePrice;
  const hasPromo = finalPrice < basePrice;
  const discountPct = hasPromo ? Math.round((1 - finalPrice / basePrice) * 100) : 0;
  const promoText = hasPromo
    ? item.activePromotion
      ? formatPromotionLabel(item.activePromotion)
      : `-${discountPct}%`
    : '';
  return `
    <div class="idd-price-block">
      ${hasPromo ? `<span class="idd-promo-badge">${escapeHtml(promoText)}</span>` : ''}
      <div class="idd-price-row">
        <span class="idd-price-final">${formatPrice(finalPrice)}</span>
        ${hasPromo ? `<span class="idd-price-original">${formatPrice(basePrice)}</span>` : ''}
      </div>
    </div>
  `;
}

/* ── Kept for backward compat (not used in new renderDetail) ── */
function buildPriceMarkup(detail) {
  const basePrice = Number.isFinite(Number(detail?.price)) ? Number(detail.price) : 0;
  const finalPrice = Number.isFinite(Number(detail?.finalPrice)) ? Number(detail.finalPrice) : basePrice;
  if (finalPrice < basePrice) {
    return `
      <p class="muted">Prix : <s>${formatPrice(basePrice)}</s></p>
      <p class="muted">Prix final : ${formatPrice(finalPrice)}</p>
    `;
  }
  return `<p class="muted">Prix : ${formatPrice(finalPrice)}</p>`;
}

function formatDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString();
}

function formatDateOnly(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleDateString();
}

/* ── Paw icons (kept for backward compat) ── */
const REVIEW_STATS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/reviews/stats`;
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

function buildReviewCardMarkup(review) {
  const rating = review.rating || 0;
  const rawName = review.authorName || review.userName || '';
  const nameParts = rawName.trim().split(' ').filter(Boolean);
  let displayName = '';
  if (nameParts.length >= 2) {
    displayName = `${capitalizeLabel(nameParts[0])} ${nameParts[1].charAt(0).toUpperCase()}.`;
  } else if (nameParts.length === 1) {
    displayName = capitalizeLabel(nameParts[0]);
  }
  const authorMarkup = displayName
    ? `<span class="idd-review-author">${escapeHtml(displayName)}</span><span class="idd-review-sep">·</span>`
    : '';
  return `
    <article class="item-detail-review idd-review-card">
      <div class="item-detail-review__meta">
        ${authorMarkup}
        <span class="paw-row paw-row--compact">${buildPawIcons(rating)}</span>
        <span class="idd-review-sep">·</span>
        <span class="item-detail-review__date">${escapeHtml(formatReviewDate(review.createdAt))}</span>
      </div>
      <p class="item-detail-review__comment">${escapeHtml(review.comment || 'Avis sans commentaire.')}</p>
    </article>
  `;
}

async function hydrateReviewsSection(container, formationId) {
  const section = container.querySelector('[data-reviews-section]');
  const list = container.querySelector('[data-reviews-list]');
  const loadMoreButton = container.querySelector('[data-reviews-load-more]');
  const sortSelect = container.querySelector('[data-reviews-sort]');
  if (!section || !list || !loadMoreButton || !sortSelect) return;
  section.hidden = false;
  let currentPage = 1;
  let currentSort = sortSelect.value || 'recent';
  let isLoading = false;

  const appendReviews = reviews => {
    list.insertAdjacentHTML('beforeend', reviews.map(buildReviewCardMarkup).join(''));
  };

  const loadPage = async (page, { append } = { append: false }) => {
    if (isLoading) return;
    isLoading = true;
    if (!append) renderReviewsState(list, 'loading');
    try {
      const payload = await fetchFormationReviews(formationId, page, currentSort);
      const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
      if (!append) {
        renderReviewList(list, reviews);
      } else {
        appendReviews(reviews);
      }
      currentPage = payload.page || page;
      loadMoreButton.hidden = !payload.hasMore;
      loadMoreButton.disabled = !payload.hasMore;
    } catch (error) {
      console.error('Erreur avis formation', error);
      renderReviewsState(list, 'error');
      loadMoreButton.hidden = true;
    } finally {
      isLoading = false;
    }
  };

  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value || 'recent';
    currentPage = 1;
    loadMoreButton.hidden = true;
    loadPage(1, { append: false });
  });

  loadMoreButton.addEventListener('click', () => {
    loadPage(currentPage + 1, { append: true });
  });

  await loadPage(1, { append: false });
}

function renderRatingSummary(target, stats) {
  if (!target) return;
  const count = Number(stats?.reviewCount || 0);
  const average = Number.isFinite(Number(stats?.averageRating)) ? Number(stats.averageRating) : 0;
  target.innerHTML = `
    <div class="paw-row">${buildPawIcons(average)}</div>
    <p class="rating-label">${average.toFixed(1)} / 5 Â· ${count} avis</p>
  `;
}

function renderReviewsState(container, state) {
  if (!container) return;
  if (state === 'loading') {
    container.innerHTML = '<p class="module-placeholder">Chargement des avis...</p>';
    return;
  }
  if (state === 'empty') {
    container.innerHTML = '<p class="module-placeholder">Aucun avis pour le moment.</p>';
    return;
  }
  if (state === 'error') {
    container.innerHTML = '<p class="form-message error">Impossible de charger les avis.</p>';
  }
}

function renderReviewList(container, reviews = []) {
  if (!container) return;
  if (!reviews.length) {
    renderReviewsState(container, 'empty');
    return;
  }
  container.innerHTML = reviews.map(buildReviewCardMarkup).join('');
}

async function fetchFormationReviews(formationId, page = 1, sort = 'recent') {
  const url = new URL(REVIEWS_ENDPOINT(formationId), window.location.origin);
  url.searchParams.set('page', page);
  url.searchParams.set('sort', sort);
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error('reviews');
  const payload = await response.json().catch(() => ({}));
  return {
    reviews: Array.isArray(payload.reviews) ? payload.reviews : [],
    hasMore: Boolean(payload.hasMore),
    page: Number(payload.page) || page
  };
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function showDetailMessage(container, message) {
  if (!container) return;
  const target = container.querySelector('[data-detail-feedback]');
  if (!target) return;
  target.textContent = message || '';
}

function buildPurchaseResultMarkup(result) {
  if (!result?.status) return '';
  const failed = result.status === 'failed';
  const icon = failed ? 'bi-x-circle' : 'bi-check-circle';
  const title = failed ? 'Paiement non valide' : 'Paiement valide';
  const message = failed
    ? 'Paiement non valide. Aucun debit n a ete effectue et votre achat n est pas confirme.'
    : String(result.message || 'Paiement valide. Votre achat est confirme.');
  return `
    <article class="item-detail-purchase-result ${failed ? 'is-failed' : 'is-success'}" data-purchase-result>
      <div class="item-detail-purchase-result__icon">
        <i class="bi ${icon}" aria-hidden="true"></i>
      </div>
      <div class="item-detail-purchase-result__content">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${
          failed
            ? '<button type="button" class="secondary-button" data-retry-checkout>Reessayer</button>'
            : ''
        }
      </div>
    </article>
  `;
}

function buildItemSessionScheduleDetails(session) {
  if (!session) {
    return '<p class="module-placeholder">Choisissez une session.</p>';
  }
  const startLabel = formatDateOnly(session.startDate);
  const durationLabel = session.durationLabel || `${session.durationDays || 1} jour${session.durationDays > 1 ? 's' : ''}`;
  const entries = Array.isArray(session.schedule) && session.schedule.length
    ? session.schedule
      .map(
        entry =>
          `<p class="muted">Jour ${entry.dayIndex} : ${escapeHtml(normalizeTimeLabel(entry.startTime) || '--:--')} - ${escapeHtml(normalizeTimeLabel(entry.endTime) || '--:--')}</p>`
      )
      .join('')
    : '<p class="muted">Horaires non definis.</p>';
  return `
    <p class="muted">Début : ${escapeHtml(startLabel)} - ${escapeHtml(durationLabel)}</p>
    <p class="muted">Horaires : ${escapeHtml(buildSessionTimeRangeLabel(session))}</p>
    ${entries}
  `;
}

function buildSessionModalCardsMarkup(sessions = [], selectedSessionId = '') {
  return buildSessionCardsMarkup({
    sessions,
    selectedSessionId,
    emptyMessage: 'Aucune session presentielle disponible.'
  });
}

function renderItemSessionScheduleDetails(container, sessions, sessionId) {
  const target = container.querySelector('[data-session-schedule-details]');
  if (!target) return;
  const session =
    sessions.find(entry => String(entry?.id || '') === String(sessionId || ''));
  target.innerHTML = buildItemSessionScheduleDetails(session);
}

function syncPresentielCancellationNotice(container, itemType, item, sessions, sessionId) {
  const target = container?.querySelector('[data-presentiel-cancel-notice]');
  if (!target) return;
  const isPresentielFormation = itemType === 'formation' && String(item?.type || '').toLowerCase() === 'presentiel';
  if (!isPresentielFormation) {
    target.hidden = true;
    target.textContent = '';
    return;
  }
  const session = Array.isArray(sessions)
    ? sessions.find(entry => String(entry?.id || '') === String(sessionId || ''))
    : null;
  if (!session?.startDate) {
    target.hidden = true;
    target.textContent = '';
    return;
  }
  const parsedRefundDays = Number(item?.refundDays);
  const refundDays = Number.isFinite(parsedRefundDays) ? Math.max(0, Math.floor(parsedRefundDays)) : 7;
  target.hidden = false;
  target.innerHTML = `<i class="bi bi-info-circle" aria-hidden="true"></i> Vous pouvez annuler gratuitement jusqu'à ${refundDays} jours calendaires avant la date de la formation.`;
}

function renderPhotoGallery(photos) {
  if (!photos || !photos.length) {
    return '';
  }
  return `
    <div class="data-list">
      ${photos
        .map(
          photo => `
            <article class="data-item">
              <img src="${escapeHtml(photo)}" alt="Photo" loading="lazy">
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function buildVideoSection(videoUrl) {
  if (!videoUrl) {
    return '';
  }
  return `
    <div class="module-panel">
      <header>
        <h3>Vidéo</h3>
      </header>
      <div class="module-video">
        <iframe src="${escapeHtml(videoUrl)}" title="Bande-annonce" loading="lazy" allowfullscreen></iframe>
      </div>
    </div>
  `;
}

function formatSalesCount(count = 0) {
  const safe = Number.isFinite(Number(count)) ? Number(count) : 0;
  if (safe <= 0) return "Aucune personne n'a encore suivi cette formation";
  if (safe === 1) return '1 personne a déjà suivi cette formation';
  return `${safe} personnes ont déjà suivi cette formation`;
}

function formatReviewLabel(stats) {
  const count = Number(stats?.reviewCount || 0);
  return `${count} ${count === 1 ? 'avis' : 'avis'}`;
}

function formatReviewDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildDescriptionBlock(item, itemType) {
  const subtype = String(item?.type || '').trim().toLowerCase();
  const badgeLabel =
    itemType === 'product'
      ? 'Produit'
      : subtype === 'presentiel'
        ? 'Formation présentielle'
        : subtype === 'distanciel'
          ? 'Formation distancielle'
          : 'Article';
  const iconClass =
    itemType === 'product'
      ? 'bi-bag-heart'
      : subtype === 'presentiel'
        ? 'bi-calendar2-week'
        : subtype === 'distanciel'
          ? 'bi-play-circle'
          : 'bi-stars';
  const bodyMarkup = item.editorialHtml
    ? `<div class="idd-about-section__body editorial-detail">${item.editorialHtml}</div>`
    : `<div class="idd-about-section__body"><p>${escapeHtml(item.description || 'Aucune description fournie.')}</p></div>`;

  return `
    <section class="item-detail-description idd-description-full idd-about-section">
      <div class="idd-about-section__header">
        <i class="bi bi-file-text" aria-hidden="true"></i>
        <h3>À propos de cette formation</h3>
      </div>
      ${bodyMarkup}
    </section>
  `;
}

/* ── Calendar helpers ── */


function initCalendar(areaEl, sessions, getSelected, onSelect) {
  // Destroy previous instance if any
  if (areaEl._bkcInstance) {
    areaEl._bkcInstance.destroy();
    areaEl._bkcInstance = null;
  }
  if (!sessions || sessions.length === 0) {
    areaEl.innerHTML = '<p class="muted" style="padding:1rem 0;">Aucune session disponible.</p>';
    return;
  }
  const initialSelectedId = getSelected ? getSelected() : null;
  const initialSession = initialSelectedId
    ? sessions.find(s => s.id === initialSelectedId)
    : null;
  const calendar = createBookingCalendar({
    mode: 'formation',
    sessions,
    initialDate: initialSession?.startDate ?? null,
    onSessionSelected: (session) => {
      onSelect(session.id);
    }
  });
  calendar.mount(areaEl);
  areaEl._bkcInstance = calendar;
}

/* ── Image modal ── */
function initImageModal(container) {
  const modal = container.querySelector('[data-image-modal]');
  if (!modal) return;
  const openBtn = container.querySelector('[data-open-image-modal]');
  const closeBtn = modal.querySelector('[data-close-image-modal]');
  const backdrop = modal.querySelector('[data-image-modal-backdrop]');

  const open = () => {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => modal.classList.add('is-open'));
    closeBtn?.focus();
  };
  const close = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    setTimeout(() => {
      if (!modal.classList.contains('is-open')) modal.hidden = true;
    }, 200);
    openBtn?.focus();
  };

  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.contains(modal) && !modal.hidden) close();
  });
}

/* ── Favorites (detail page) ── */
function createFavoriteKey(type, id) {
  if (!type || !id) return null;
  return `${type}:${id}`;
}

async function loadDetailFavoriteStatus(itemType, itemId, user) {
  if (!user) return null;
  try {
    const response = await fetch(FAVORITES_ENDPOINT, { credentials: 'include' });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const match = favorites.find(
      f => f.targetType === itemType && String(f.targetId) === String(itemId)
    );
    return match ? (match.id || match._id || null) : null;
  } catch {
    return null;
  }
}

function updateDetailFavoriteButton(button, isActive) {
  if (!button) return;
  button.classList.toggle('is-active', isActive);
  button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  button.setAttribute('aria-label', isActive ? 'Retirer des favoris' : 'Ajouter aux favoris');
  const icon = button.querySelector('i');
  if (icon) {
    icon.className = `bi ${isActive ? 'bi-suit-heart-fill' : 'bi-suit-heart'}`;
  }
}

async function initFavoriteButton(container, itemType, itemId, user) {
  const button = container.querySelector('[data-favorite-toggle]');
  if (!button) return;
  const favoritesMap = new Map();
  const existingFavId = await loadDetailFavoriteStatus(itemType, itemId, user);
  if (existingFavId) {
    favoritesMap.set(createFavoriteKey(itemType, itemId), existingFavId);
    updateDetailFavoriteButton(button, true);
  }
  button.addEventListener('click', async () => {
    if (!requireAuthAction('Ajouter aux favoris')) return;
    const key = createFavoriteKey(itemType, itemId);
    const isCurrentlyFav = favoritesMap.has(key);
    button.disabled = true;
    try {
      const endpoint = isCurrentlyFav
        ? `${FAVORITES_ENDPOINT}/${favoritesMap.get(key)}`
        : FAVORITES_ENDPOINT;
      const opts = {
        method: isCurrentlyFav ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      };
      if (!isCurrentlyFav) {
        opts.body = JSON.stringify({ targetType: itemType, targetId: itemId });
      }
      const response = await fetch(endpoint, opts);
      if (!response.ok) {
        if (response.status === 401) requireAuthAction('Ajouter aux favoris');
        return;
      }
      if (isCurrentlyFav) {
        favoritesMap.delete(key);
        updateDetailFavoriteButton(button, false);
      } else {
        const payload = await response.json().catch(() => ({}));
        const favId = payload?.favorite?.id;
        if (favId) favoritesMap.set(key, favId);
        updateDetailFavoriteButton(button, true);
      }
    } catch (err) {
      console.error('Erreur toggle favoris', err);
    } finally {
      button.disabled = false;
    }
  });
}

/* ── Options section (grid cards) ── */
function renderOptionsSection(container, options) {
  const target = container.querySelector('[data-session-options]');
  if (!target) return;
  const validOptions = Array.isArray(options) ? options.filter(Boolean) : [];
  if (!validOptions.length) {
    target.innerHTML = '';
    target.hidden = true;
    return;
  }
  target.hidden = false;
  target.innerHTML = `
    <div class="idd-options-wrap">
      <p class="idd-options-hint">
        <i class="bi bi-info-circle" aria-hidden="true"></i>
        Options disponibles — sélection lors de l'achat
      </p>
      <div class="idd-options-grid">
        ${validOptions.map(opt => {
          const isUnavailable = !opt.available;
          return `
            <article class="idd-option-card${isUnavailable ? ' is-unavailable' : ''}">
              <div class="idd-option-card__icon">
                <i class="bi bi-box" aria-hidden="true"></i>
              </div>
              <p class="idd-option-card__name">${escapeHtml(opt.name || 'Option')}</p>
              <p class="idd-option-card__price">${isUnavailable ? 'Non disponible' : `+${formatPrice(opt.price || 0)}`}</p>
            </article>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/* ── Main render ── */
function renderDetail(
  container,
  item,
  itemType,
  sessions,
  selectedSessionId,
  ratingStats = null,
  siteBlocked = false,
  purchaseResult = null,
  alreadyPurchased = false
) {
  if (!container || !item) return;

  const coverImage = String(item.coverImage || item.photos?.[0] || '').trim();
  const coverImageMarkup = coverImage
    ? `<img src="${escapeHtml(coverImage)}" alt="${escapeHtml(item.name || 'Article')}" loading="lazy" data-acquisition-image>`
    : `<div class="idd-image-placeholder"><i class="bi bi-image" aria-hidden="true"></i></div>`;

  const stats = ratingStats || { averageRating: 0, reviewCount: 0 };

  const ratingMarkup =
    itemType === 'formation'
      ? `
        <button type="button" class="idd-rating-link" data-scroll-to-reviews aria-label="Voir les ${stats.reviewCount} avis">
          <span class="paw-row paw-row--compact">${buildPawIcons(stats.averageRating)}</span>
          <span class="idd-rating-count">(${stats.reviewCount} avis)</span>
        </button>
      `
      : '';

  const subtype = String(item?.type || '').trim().toLowerCase();
  const kickerLabel =
    itemType === 'product'
      ? 'Produit'
      : subtype === 'presentiel'
        ? 'Formation présentielle'
        : subtype === 'distanciel'
          ? 'Formation distancielle'
          : 'Article';

  const shortDesc = item.description
    ? `<p class="idd-short-desc">${escapeHtml(
        item.description.length > 200 ? item.description.slice(0, 200) + '…' : item.description
      )}</p>`
    : '';

  const sessionAreaMarkup =
    itemType === 'formation' && item.type === 'presentiel'
      ? sessions.length
        ? `<div class="idd-sessions-area" data-sessions-area></div>`
        : '<p class="module-placeholder idd-no-sessions">Aucune session présentielle disponible.</p>'
      : '';

  const addButtonDisabled =
    itemType === 'formation' && item.type === 'presentiel' && !selectedSessionId;

  const itemId = String(item._id || item.id || '');

  const favoriteButton =
    itemType === 'formation' || itemType === 'product'
      ? `
        <button
          type="button"
          class="idd-fav-btn"
          data-favorite-toggle
          data-target-type="${escapeHtml(itemType)}"
          data-target-id="${escapeHtml(itemId)}"
          aria-label="Ajouter aux favoris"
          aria-pressed="false"
        >
          <i class="bi bi-suit-heart" aria-hidden="true"></i>
          <span>Favoris</span>
        </button>
      `
      : '';

  const purchasedUsersCount = Number.isFinite(Number(item.purchasedUsersCount))
    ? Number(item.purchasedUsersCount)
    : Number(item.salesCount || 0);

  const fullDescMarkup = buildDescriptionBlock(item, itemType);
  const gallery = renderPhotoGallery(item.photos);
  const video = buildVideoSection(item.trailerVideoUrl);
  const purchaseResultMarkup = buildPurchaseResultMarkup(purchaseResult);

  const reviewsSectionMarkup =
    itemType === 'formation'
      ? `
        <section class="item-detail-reviews idd-reviews" data-reviews-section hidden>
          <div class="idd-reviews-head">
            <h2 class="idd-reviews-title">Avis clients</h2>
            <div class="idd-reviews-summary">
              <span class="paw-row paw-row--compact">${buildPawIcons(stats.averageRating)}</span>
              <span class="idd-reviews-avg">${stats.averageRating.toFixed(1)}/5</span>
              <span class="idd-reviews-count">· ${stats.reviewCount} avis</span>
            </div>
          </div>
          <hr class="idd-divider">
          <div class="idd-reviews-sort">
            <label class="item-detail-reviews__sort">
              <span class="sr-only">Trier les avis</span>
              <select data-reviews-sort>
                <option value="recent">Les plus récents</option>
                <option value="best">Les mieux notés</option>
              </select>
            </label>
          </div>
          <div class="item-detail-reviews__list" data-reviews-list></div>
          <button class="idd-btn-more" type="button" data-reviews-load-more hidden>
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
            Voir plus d'avis
          </button>
        </section>
      `
      : '';

  container.innerHTML = `
    <div class="module-panel item-detail-panel">
      <!-- Two-column hero -->
      <div class="idd-hero-layout">

        <!-- Image column -->
        <div class="idd-image-col">
          <div class="idd-image-wrap" data-item-detail-card>
            ${coverImageMarkup}
            ${
              coverImage
                ? `<button type="button" class="idd-zoom-btn" data-open-image-modal aria-label="Voir l'image en grand">
                    <i class="bi bi-eye" aria-hidden="true"></i>
                  </button>`
                : ''
            }
          </div>
        </div>

        <!-- Info column -->
        <div class="idd-info-col">
          <span class="idd-kicker">${escapeHtml(capitalizeLabel(kickerLabel))}</span>
          <h1 class="idd-title">${escapeHtml(item.name || 'Détail')}</h1>

          ${siteBlocked ? '<p class="item-detail-site-status">Achats indisponibles</p>' : ''}

          ${buildPriceBlock(item)}

          ${ratingMarkup}

          ${shortDesc}

          ${sessionAreaMarkup}

          <!-- CTA buttons -->
          <div class="idd-actions">
            <button class="idd-btn-cart" type="button" data-add-to-cart-button ${addButtonDisabled ? 'disabled' : ''}>
              <i class="bi bi-cart-plus" aria-hidden="true"></i>
              Ajouter au panier
            </button>
            <button class="idd-btn-buy" type="button" data-buy-button ${siteBlocked ? 'disabled' : ''} ${alreadyPurchased ? 'hidden' : ''}>
              ${siteBlocked ? 'Achats indisponibles' : 'Acheter maintenant'}
            </button>
            <span class="badge badge-active" data-already-purchased-badge ${alreadyPurchased ? '' : 'hidden'}>Déjà inscrit</span>
          </div>

          ${favoriteButton}

          <p class="item-detail-cancel-notice" data-presentiel-cancel-notice hidden></p>

          <!-- Options (loaded dynamically after session selection) -->
          <div data-session-options hidden></div>

          <div class="idd-trust">
            <span class="idd-trust__item">
              <i class="bi bi-people" aria-hidden="true"></i>
              ${escapeHtml(formatSalesCount(purchasedUsersCount))}
            </span>
            <span class="idd-trust__item">
              <i class="bi bi-gift" aria-hidden="true"></i>
              Cartes cadeaux acceptées
            </span>
          </div>

          ${siteBlocked ? `<p class="muted idd-suspended">${escapeHtml(SUSPENDED_PURCHASE_MESSAGE)}</p>` : ''}
        </div>
      </div>

      <!-- Full description -->
      ${fullDescMarkup}

      <!-- Purchase result -->
      ${purchaseResultMarkup}

      <!-- Reviews -->
      ${reviewsSectionMarkup}

      <!-- Photo gallery & video -->
      ${gallery}
      ${video}

      <div class="form-message" data-detail-feedback></div>
    </div>

    <!-- Fullscreen image modal (fixed, outside panel flow) -->
    ${
      coverImage
        ? `
      <div class="idd-image-modal" data-image-modal hidden aria-hidden="true" role="dialog" aria-label="Image agrandie" aria-modal="true">
        <div class="idd-image-modal__backdrop" data-image-modal-backdrop></div>
        <div class="idd-image-modal__inner">
          <button type="button" class="idd-image-modal__close" data-close-image-modal aria-label="Fermer">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
          <img src="${escapeHtml(coverImage)}" alt="${escapeHtml(item.name || 'Image')}" class="idd-image-modal__img">
        </div>
      </div>
    `
        : ''
    }
  `;
}

async function fetchSessionOptions(formationId, sessionId) {
  try {
    const response = await fetch(FORMATION_SESSION_OPTIONS_ENDPOINT(formationId, sessionId));
    if (!response.ok) return [];
    const payload = await response.json().catch(() => ({}));
    return Array.isArray(payload.options) ? payload.options : [];
  } catch {
    return [];
  }
}

async function loadItem(type, id) {
  const endpoint = DETAILS_ENDPOINTS[type] ? DETAILS_ENDPOINTS[type](id) : null;
  if (!endpoint) throw new Error('Type invalide.');
  const response = await fetch(endpoint);
  if (!response.ok) {
    if (response.status === 404) throw new Error('not-found');
    throw new Error('network');
  }
  const payload = await response.json().catch(() => ({}));
  return type === 'product' ? payload.product || null : payload.formation || null;
}

async function loadSessions(formationId) {
  const response = await fetch(SESSIONS_ENDPOINT(formationId));
  if (!response.ok) {
    throw new Error('sessions-unavailable');
  }
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload.sessions) ? payload.sessions : [];
}

async function fetchPurchaseStatus(formationId, sessionId = '') {
  const url = new URL(PURCHASE_STATUS_ENDPOINT, window.location.origin);
  url.searchParams.set('formationId', String(formationId || '').trim());
  const normalizedSessionId = String(sessionId || '').trim();
  if (normalizedSessionId) {
    url.searchParams.set('sessionId', normalizedSessionId);
  }
  try {
    const response = await fetch(url.toString(), { credentials: 'include' });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    return Boolean(payload?.purchased);
  } catch (_error) {
    return false;
  }
}

function syncAlreadyPurchasedUi(container, alreadyPurchased) {
  const buyButton = container.querySelector('[data-buy-button]');
  const purchasedBadge = container.querySelector('[data-already-purchased-badge]');
  if (buyButton) {
    buyButton.hidden = Boolean(alreadyPurchased);
  }
  if (purchasedBadge) {
    purchasedBadge.hidden = !alreadyPurchased;
  }
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  const contextQuery = context?.query || {};
  const params = new URLSearchParams(window.location.search);
  const rawType = String(contextQuery.type || params.get('type') || 'formation').toLowerCase();
  const itemType = rawType === 'product' ? 'product' : 'formation';
  const itemId = contextQuery.id || params.get('id');
  if (!itemId) {
    renderStatus(container, "Article manquant dans l'URL.");
    return;
  }
  container.innerHTML = '<p class="module-placeholder">Chargement...</p>';
  try {
    const [item, ratingStats, siteStatus] = await Promise.all([
      loadItem(itemType, itemId),
      itemType === 'formation' ? fetchFormationReviewStats(itemId).catch(() => null) : Promise.resolve(null),
      getSiteStatus()
    ]);
    const siteBlocked = isSiteBlockedForUser(siteStatus, context?.user);
    if (!item) {
      renderStatus(container, 'Article introuvable.');
      return;
    }
    let sessions = [];
    let selectedSessionId = null;
    if (itemType === 'formation' && item.type === 'presentiel') {
      sessions = await loadSessions(itemId);
      if (sessions.length) {
        selectedSessionId = findFirstSelectableSessionId(sessions) || null;
      }
    }
    let alreadyPurchased = false;
    if (context?.user && itemType === 'formation') {
      alreadyPurchased = await fetchPurchaseStatus(
        itemId,
        item.type === 'presentiel' ? selectedSessionId : ''
      );
    }
    const purchaseResult = consumeCheckoutResult({ itemType, itemId });
    renderDetail(
      container,
      item,
      itemType,
      sessions,
      selectedSessionId,
      ratingStats,
      siteBlocked,
      purchaseResult,
      alreadyPurchased
    );

    /* ── Post-render hydration ── */
    if (itemType === 'formation') {
      hydrateReviewsSection(container, itemId);
    }

    initImageModal(container);
    initFavoriteButton(container, itemType, itemId, context?.user || null);

    // Scroll to reviews on rating click
    container.querySelector('[data-scroll-to-reviews]')?.addEventListener('click', () => {
      const reviewsSection = container.querySelector('[data-reviews-section]');
      if (reviewsSection) reviewsSection.scrollIntoView({ behavior: 'smooth' });
    });

    /* ── Session schedule details (no-op if element absent) ── */
    const updateSessionDetails = () => renderItemSessionScheduleDetails(container, sessions, selectedSessionId);
    const syncSelectedSessionLabel = () => {
      const node = container.querySelector('[data-selected-session-label]');
      if (!node) return;
      const session = sessions.find(entry => String(entry?.id || '') === String(selectedSessionId || ''));
      node.textContent = buildSessionSelectionLabel(session);
    };
    updateSessionDetails();
    syncSelectedSessionLabel();
    syncPresentielCancellationNotice(container, itemType, item, sessions, selectedSessionId);

    const loadSessionOptionsAndRender = async (sessionId) => {
      renderOptionsSection(container, []);
      if (!sessionId || itemType !== 'formation' || item.type !== 'presentiel') return;
      const opts = await fetchSessionOptions(itemId, sessionId);
      renderOptionsSection(container, opts);
    };

    const refreshAlreadyPurchasedState = async () => {
      if (!(context?.user && itemType === 'formation')) {
        alreadyPurchased = false;
        syncAlreadyPurchasedUi(container, alreadyPurchased);
        return;
      }
      alreadyPurchased = await fetchPurchaseStatus(
        itemId,
        item.type === 'presentiel' ? selectedSessionId : ''
      );
      syncAlreadyPurchasedUi(container, alreadyPurchased);
    };

    /* ── Calendar (replaces session modal for presentiel) ── */
    const sessionsArea = container.querySelector('[data-sessions-area]');
    if (sessionsArea && itemType === 'formation' && item.type === 'presentiel' && sessions.length) {
      initCalendar(
        sessionsArea,
        sessions,
        () => selectedSessionId,
        newSessionId => {
          selectedSessionId = newSessionId;
          updateSessionDetails();
          syncSelectedSessionLabel();
          syncPresentielCancellationNotice(container, itemType, item, sessions, selectedSessionId);
          updateAddButtonState();
          loadSessionOptionsAndRender(selectedSessionId).catch(() => {});
          refreshAlreadyPurchasedState().catch(() => {});
        }
      );
    }

    if (selectedSessionId) {
      loadSessionOptionsAndRender(selectedSessionId).catch(() => {});
    }

    /* ── Add-to-cart button ── */
    const addButton = container.querySelector('[data-add-to-cart-button]');
    const updateAddButtonState = () => {
      if (!addButton) return;
      const needsSession = itemType === 'formation' && item.type === 'presentiel';
      const missingSession = needsSession && !selectedSessionId;
      if (isAlreadyInCart(itemType, itemId)) {
        setAddToCartButtonState(addButton, 'added');
        return;
      }
      setAddToCartButtonState(addButton, 'default');
      addButton.disabled = missingSession;
    };
    updateAddButtonState();
    showDetailMessage(container, '');

    /* ── Retry checkout ── */
    const retryButton = container.querySelector('[data-retry-checkout]');
    if (retryButton) {
      retryButton.addEventListener('click', () => {
        const checkoutQuery = {
          type: itemType,
          id: itemId,
          originSlug: 'item-detail',
          originType: itemType,
          originId: itemId
        };
        if (itemType === 'formation' && selectedSessionId) {
          checkoutQuery.sessionId = selectedSessionId;
          checkoutQuery.originSessionId = selectedSessionId;
        }
        requestVitrineNavigation('checkout', {
          source: 'item-detail-retry',
          skipThrottle: true,
          query: checkoutQuery
        });
      });
    }

    /* ── Cart button ── */
    if (addButton) {
      addButton.addEventListener('click', () => {
        if (itemType === 'formation' && item.type === 'presentiel' && !selectedSessionId) {
          showDetailMessage(container, "Sélectionnez une session avant d'ajouter.");
          return;
        }
        if (!requireAuthAction('Ajouter au panier')) {
          return;
        }
        if (isAddToCartButtonAdded(addButton) || isAlreadyInCart(itemType, itemId)) {
          setAddToCartButtonState(addButton, 'added');
          return;
        }
        const payload = {
          type: itemType,
          id: itemId,
          name: item.name || '',
          price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0
        };
        if (itemType === 'formation' && selectedSessionId) {
          payload.sessionId = selectedSessionId;
        }
        setAddToCartButtonState(addButton, 'loading');
        const added = addItem(payload);
        if (added) {
          const sourceElement = getDetailCardSource(container);
          triggerFlyToTarget({
            sourceElement,
            targetSelector: CART_TARGET_SELECTOR,
            mode: 'cart'
          });
          setAddToCartButtonState(addButton, 'added');
        } else {
          setAddToCartButtonState(addButton, 'default');
          updateAddButtonState();
        }
        showDetailMessage(
          container,
          added ? 'Article ajoute au panier.' : "Impossible d'ajouter l'article au panier."
        );
      });
    }

    /* ── Buy button ── */
    const button = container.querySelector('[data-buy-button]');
    if (!button) return;
    button.addEventListener('click', () => {
      if (alreadyPurchased) {
        showDetailMessage(container, 'Vous etes deja inscrit a cette formation.');
        return;
      }
      if (siteBlocked) {
        showDetailMessage(container, SUSPENDED_PURCHASE_MESSAGE);
        showToast({ type: 'error', message: 'Achats indisponibles', durationMs: 1000 });
        return;
      }
      if (itemType === 'formation' && item.type === 'presentiel' && !selectedSessionId) {
        renderStatus(container, "Sélectionnez une session avant d'acheter.");
        return;
      }
      const checkoutQuery = {
        type: itemType,
        id: itemId,
        originSlug: 'item-detail',
        originType: itemType,
        originId: itemId
      };
      if (itemType === 'formation' && selectedSessionId) {
        checkoutQuery.sessionId = selectedSessionId;
        checkoutQuery.originSessionId = selectedSessionId;
      }
      requestVitrineNavigation('checkout', {
        source: 'item-detail-buy',
        skipThrottle: true,
        query: checkoutQuery
      });
    });
  } catch (error) {
    if (error.message === 'not-found') {
      renderStatus(container, 'Article introuvable.');
    } else {
      renderStatus(container, 'Impossible de charger lâ€™article.');
      console.error('Erreur fiche article', error);
    }
  }
}
