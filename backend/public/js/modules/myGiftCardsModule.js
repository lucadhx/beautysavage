import { renderEmptyState } from './emptyStateHelper.js';
import {
  ACQUISITION_PAGES,
  resetAcquisitionNotifications
} from './acquisitionNotificationService.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const MY_CARDS_ENDPOINT = '/api/client/gift-cards/my';
const CARD_DETAIL_ENDPOINT = cardId => `/api/client/gift-cards/${encodeURIComponent(String(cardId || '').trim())}`;
const MIN_LOADER_MS = 500;
const MODAL_CLOSE_DELAY_MS = 180;

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
});

const state = {
  container: null,
  cards: [],
  boundClickHandler: null,
  modal: null,
  detailRequestId: 0
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

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickFirstNonEmptyString(values = [], fallback = '') {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return fallback;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoney(value) {
  return currencyFormatter.format(toFiniteNumber(value, 0));
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return 'Date indisponible';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function normalizeCard(rawCard = {}, fallbackIndex = 0) {
  const id = pickFirstNonEmptyString([rawCard.id, rawCard._id, rawCard.cardId], `gift-card-${fallbackIndex}`);
  const code = pickFirstNonEmptyString(
    [rawCard.code, rawCard.cardCode, rawCard.identifier, rawCard.number],
    'Code indisponible'
  );
  const remainingAmount = toFiniteNumber(
    rawCard.balance ??
      rawCard.remainingAmount ??
      rawCard.remaining ??
      rawCard.balanceRemaining ??
      rawCard.balanceAmount,
    0
  );
  const initialAmount = toFiniteNumber(
    rawCard.amount ?? rawCard.initialAmount ?? rawCard.amountAtPurchase ?? rawCard.purchaseAmount,
    0
  );
  const status = pickFirstNonEmptyString([rawCard.status, rawCard.state], '');
  const purchasedAt = pickFirstNonEmptyString(
    [rawCard.purchasedAt, rawCard.purchaseDate, rawCard.createdAt, rawCard.date],
    ''
  );
  const password = pickFirstNonEmptyString([rawCard.password, rawCard.cardPassword], '');

  return {
    id,
    code,
    status,
    remainingAmount,
    initialAmount,
    purchasedAt,
    password
  };
}

function normalizeCards(rawCards = []) {
  return (Array.isArray(rawCards) ? rawCards : [])
    .map((card, index) => normalizeCard(card, index))
    .filter(card => String(card.id || '').trim());
}

function normalizeTransaction(rawTransaction = {}, fallbackIndex = 0) {
  return {
    id: pickFirstNonEmptyString(
      [rawTransaction.id, rawTransaction._id, rawTransaction.transactionId],
      `gift-card-transaction-${fallbackIndex}`
    ),
    amount: toFiniteNumber(rawTransaction.amount ?? rawTransaction.value ?? rawTransaction.total, 0),
    type: pickFirstNonEmptyString(
      [rawTransaction.transactionType, rawTransaction.type, rawTransaction.kind],
      'usage'
    ).toLowerCase(),
    saleId: pickFirstNonEmptyString([rawTransaction.saleId, rawTransaction.orderId, rawTransaction.reference], ''),
    createdAt: pickFirstNonEmptyString(
      [rawTransaction.createdAt, rawTransaction.date, rawTransaction.executedAt],
      ''
    ),
    usedByYou:
      typeof rawTransaction.usedByYou === 'boolean'
        ? rawTransaction.usedByYou
        : rawTransaction.usedByYou === 'true'
        ? true
        : rawTransaction.usedByYou === 'false'
        ? false
        : null,
    usedByLabel: pickFirstNonEmptyString([rawTransaction.usedByLabel, rawTransaction.actorLabel], ''),
    note: pickFirstNonEmptyString([rawTransaction.note, rawTransaction.description], '')
  };
}

function normalizeTransactions(rawTransactions = []) {
  return (Array.isArray(rawTransactions) ? rawTransactions : []).map((transaction, index) =>
    normalizeTransaction(transaction, index)
  );
}

function isActiveCard(card = {}) {
  return toFiniteNumber(card.remainingAmount, 0) > 0;
}

function getStatusLabel(card = {}) {
  if (!isActiveCard(card)) return 'Épuisée';
  const status = String(card.status || '').trim().toLowerCase();
  return status === 'redeemed' ? 'Épuisée' : 'Active';
}

function computeTotalRemaining(cards = []) {
  return cards.reduce((total, card) => total + Math.max(0, toFiniteNumber(card.remainingAmount, 0)), 0);
}

function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : Promise.resolve({});
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
  const payload = await getJson(response);
  if (!response.ok || payload?.ok === false) {
    throw createHttpError(payload?.error || 'Action impossible.', response, payload, endpoint);
  }
  return payload || {};
}

function logModuleError(context, error, extra = {}) {
  logUiError(`MyGiftCardsModule:${context}`, error, {
    status: error?.status || null,
    endpoint: error?.endpoint || null,
    payload: error?.payload || null,
    message: error?.message || null,
    ...extra
  });
}

function buildLoader(message = 'Chargement...') {
  return `
    <div class="mygc-inline-loader" role="status" aria-live="polite">
      <div class="mygc-inline-loader__paws" aria-hidden="true">
        <span class="mygc-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="mygc-inline-loader__paw mygc-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="mygc-inline-loader__paw mygc-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="mygc-inline-loader__label">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderStatus(container, message = 'Une erreur est survenue.') {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderList(container) {
  if (!container) return;
  if (!state.cards.length) {
    renderEmptyState(container, {
      iconClass: 'bi bi-gift',
      title: 'Aucune carte cadeau',
      description: 'Vos cartes cadeaux apparaitront ici apres achat.',
      action: { label: 'Decouvrir la boutique', slug: 'boutique' }
    });
    return;
  }

  container.innerHTML = `
    <div class="giftcards-grid">
      ${state.cards
        .map(card => {
          const active = isActiveCard(card);
          const statusClass = active ? 'giftcard-status--active' : 'giftcard-status--empty';
          return `
            <article class="giftcard-card">
              <div class="giftcard-card__icon" aria-hidden="true">
                <i class="bi bi-gift"></i>
              </div>
              <div class="giftcard-card__body">
                <div class="giftcard-card__header">
                  <strong class="giftcard-card__code">${escapeHtml(card.code)}</strong>
                  <span class="giftcard-status ${statusClass}">${escapeHtml(getStatusLabel(card))}</span>
                </div>
                <p class="giftcard-card__remaining-label">Solde restant</p>
                <p class="giftcard-card__remaining">${escapeHtml(formatMoney(card.remainingAmount))}</p>
                <p class="giftcard-card__meta">Date d achat: ${escapeHtml(formatDate(card.purchasedAt))}</p>
              </div>
              <div class="giftcard-card__actions">
                <button
                  type="button"
                  class="giftcard-card__cta"
                  data-action="open-gift-card"
                  data-card-id="${escapeHtml(card.id)}"
                >
                  <i class="bi bi-eye" aria-hidden="true"></i>
                  <span>Voir ma carte</span>
                </button>
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderContent(container) {
  if (!container) return;
  const totalRemaining = computeTotalRemaining(state.cards);
  container.innerHTML = `
    <section class="giftcards-summary">
      <p class="giftcards-summary__label">Solde total restant</p>
      <p class="giftcards-summary__amount">${escapeHtml(formatMoney(totalRemaining))}</p>
      <p class="giftcards-summary__meta">Sur ${escapeHtml(String(state.cards.length))} carte(s)</p>
    </section>
    <section class="giftcards-list" data-gift-card-list></section>
  `;
  const list = container.querySelector('[data-gift-card-list]');
  renderList(list);
}

function getCardById(cardId) {
  const normalizedId = String(cardId || '').trim();
  if (!normalizedId) return null;
  return state.cards.find(card => String(card.id) === normalizedId) || null;
}

function closeGiftCardModal() {
  const modalState = state.modal;
  if (!modalState) return;
  const { overlay, onEscape, onOutside } = modalState;
  window.removeEventListener('keydown', onEscape);
  overlay.removeEventListener('click', onOutside);
  overlay.classList.remove('is-visible');
  window.setTimeout(() => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }, MODAL_CLOSE_DELAY_MS);
  state.modal = null;
}

async function copyToClipboard(value, contextLabel = 'value') {
  const text = String(value || '').trim();
  if (!text) {
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) {
        throw new Error('Clipboard command failed.');
      }
    }
    showToast({ type: 'success', message: 'Copie', durationMs: 1000 });
  } catch (error) {
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('CopyToClipboard', error, { field: contextLabel });
  }
}

function resolveTransactionTypeLabel(transaction = {}) {
  const type = String(transaction.type || '').toLowerCase();
  if (type === 'manual_debit') return 'Debit manuel';
  if (type === 'redeem' || type === 'checkout') return 'Utilisation checkout';
  if (type === 'credit') {
    const note = String(transaction.note || '').trim();
    return note || 'Remboursement';
  }
  if (type === 'purchase') return 'Achat';
  return 'Utilisation';
}

function resolveTransactionActorLabel(transaction = {}) {
  if (transaction.usedByYou === true) return 'Vous';
  if (transaction.usedByYou === false) return 'Autre utilisateur';
  const rawLabel = String(transaction.usedByLabel || '').trim().toLowerCase();
  if (rawLabel.includes('vous')) return 'Vous';
  if (rawLabel.includes('autre')) return 'Autre utilisateur';
  return '';
}

function formatTransactionAmount(transaction = {}) {
  const type = String(transaction.type || '').toLowerCase();
  const amount = Math.abs(toFiniteNumber(transaction.amount, 0));
  const isPositive = type === 'purchase' || type === 'credit';
  return {
    label: `${isPositive ? '+' : '-'} ${formatMoney(amount)}`,
    className: isPositive ? 'giftcard-modal__amount--positive' : 'giftcard-modal__amount--negative'
  };
}

function renderModalBody(modalBody, card, transactions) {
  if (!modalBody) return;
  const password = String(card.password || '').trim();
  modalBody.innerHTML = `
    <section class="giftcard-modal__remaining">
      <p class="giftcard-modal__remaining-label">Solde restant</p>
      <p class="giftcard-modal__remaining-value">${escapeHtml(formatMoney(card.remainingAmount))}</p>
    </section>
    <section class="giftcard-modal__section">
      <h4>Details</h4>
      <div class="giftcard-modal__detail-grid">
        <p><span>Solde initial</span><strong>${escapeHtml(formatMoney(card.initialAmount))}</strong></p>
        <p><span>Date d achat</span><strong>${escapeHtml(formatDate(card.purchasedAt))}</strong></p>
        <p class="giftcard-modal__detail-with-copy">
          <span>Code de carte</span>
          <strong>${escapeHtml(card.code)}</strong>
          <button
            type="button"
            class="giftcard-modal__copy-button"
            data-action="copy-value"
            data-copy-value="${escapeHtml(card.code)}"
            data-copy-label="code"
            aria-label="Copier le code"
          >
            <i class="bi bi-clipboard" aria-hidden="true"></i>
          </button>
        </p>
        <p class="giftcard-modal__detail-with-copy">
          <span>Mot de passe</span>
          <strong>${escapeHtml(password || 'Indisponible')}</strong>
          <button
            type="button"
            class="giftcard-modal__copy-button"
            data-action="copy-value"
            data-copy-value="${escapeHtml(password)}"
            data-copy-label="password"
            aria-label="Copier le mot de passe"
            ${password ? '' : 'disabled'}
          >
            <i class="bi bi-clipboard" aria-hidden="true"></i>
          </button>
        </p>
      </div>
    </section>
    <section class="giftcard-modal__section">
      <h4>Transactions</h4>
      ${
        transactions.length
          ? `
            <ul class="giftcard-modal__transaction-list">
              ${transactions
                .map(transaction => {
                  const formattedAmount = formatTransactionAmount(transaction);
                  const actorLabel = resolveTransactionActorLabel(transaction);
                  return `
                    <li class="giftcard-modal__transaction-item">
                      <div class="giftcard-modal__transaction-top">
                        <span>${escapeHtml(formatDate(transaction.createdAt))}</span>
                        <strong class="${escapeHtml(formattedAmount.className)}">${escapeHtml(
                    formattedAmount.label
                  )}</strong>
                      </div>
                      <p>${escapeHtml(resolveTransactionTypeLabel(transaction))}</p>
                      <div class="giftcard-modal__transaction-meta">
                        ${transaction.saleId ? `<small>ID vente: ${escapeHtml(transaction.saleId)}</small>` : ''}
                        ${actorLabel ? `<small>${escapeHtml(actorLabel)}</small>` : ''}
                      </div>
                    </li>
                  `;
                })
                .join('')}
            </ul>
          `
          : '<p class="giftcard-modal__empty">Aucune utilisation</p>'
      }
    </section>
  `;

  modalBody.querySelectorAll('[data-action="copy-value"]').forEach(button => {
    button.addEventListener('click', () => {
      const value = String(button.dataset.copyValue || '').trim();
      const label = String(button.dataset.copyLabel || 'field').trim();
      copyToClipboard(value, label);
    });
  });
}

async function openGiftCardModal(cardId) {
  const cardPreview = getCardById(cardId);
  if (!cardPreview) return;

  closeGiftCardModal();

  const overlay = document.createElement('div');
  overlay.className = 'giftcard-modal-overlay';
  overlay.innerHTML = `
    <div class="giftcard-modal" role="dialog" aria-modal="true" aria-labelledby="giftcard-modal-title">
      <header class="giftcard-modal__header">
        <h3 id="giftcard-modal-title">Ma carte cadeau</h3>
        <button type="button" class="giftcard-modal__close" data-action="close-modal" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <div class="giftcard-modal__body" data-modal-body>
        ${buildLoader('Chargement des details...')}
      </div>
    </div>
  `;

  const onEscape = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeGiftCardModal();
  };
  const onOutside = event => {
    if (event.target === overlay) {
      closeGiftCardModal();
    }
  };

  overlay.querySelector('[data-action="close-modal"]')?.addEventListener('click', closeGiftCardModal);
  overlay.addEventListener('click', onOutside);
  window.addEventListener('keydown', onEscape);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));

  state.modal = { overlay, onEscape, onOutside };
  const modalBody = overlay.querySelector('[data-modal-body]');
  const requestId = ++state.detailRequestId;
  const startedAt = Date.now();

  try {
    const payload = await requestJson(CARD_DETAIL_ENDPOINT(cardId));
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    if (!state.modal || requestId !== state.detailRequestId) return;

    const card = normalizeCard(payload.card || cardPreview, 0);
    const transactions = normalizeTransactions(payload.transactions);
    renderModalBody(modalBody, card, transactions);
    showToast({ type: 'success', message: 'Details charges', durationMs: 1000 });
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    if (!state.modal || requestId !== state.detailRequestId) return;
    if (modalBody) {
      modalBody.innerHTML = `<p class="giftcard-modal__error">${escapeHtml(
        error.message || 'Impossible de charger cette carte.'
      )}</p>`;
    }
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('OpenGiftCardModal', error, { cardId });
  }
}

function bindEvents(container) {
  if (!container) return;
  if (state.boundClickHandler) {
    container.removeEventListener('click', state.boundClickHandler);
  }

  state.boundClickHandler = event => {
    if (!(event.target instanceof Element)) return;
    const openButton = event.target.closest('[data-action="open-gift-card"]');
    if (openButton) {
      const cardId = String(openButton.dataset.cardId || '').trim();
      if (cardId) {
        openGiftCardModal(cardId);
      }
      return;
    }
  };

  container.addEventListener('click', state.boundClickHandler);
}

async function loadCards(contentContainer) {
  if (!contentContainer) return;
  contentContainer.innerHTML = buildLoader('Chargement de vos cartes cadeaux...');
  const startedAt = Date.now();

  try {
    const payload = await requestJson(MY_CARDS_ENDPOINT);
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    state.cards = normalizeCards(payload.cards);
    renderContent(contentContainer);
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    renderStatus(contentContainer, error.message || 'Impossible de charger vos cartes.');
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logModuleError('LoadCards', error);
  }
}

function renderShell(container) {
  container.innerHTML = `
    <section class="module-panel giftcards-page">
      <header class="giftcards-page__header">
        <h2>Mes cartes cadeaux</h2>
        <p>Suivez vos cartes actives et consultez leurs details en un clic.</p>
      </header>
      <div class="giftcards-content" data-giftcards-content>
        ${buildLoader('Chargement de vos cartes cadeaux...')}
      </div>
    </section>
  `;
}

export async function renderPage(container) {
  if (!container) return;
  resetAcquisitionNotifications(ACQUISITION_PAGES.MY_GIFT_CARDS);
  const previousContainer = state.container;

  closeGiftCardModal();
  if (state.boundClickHandler && previousContainer && previousContainer !== container) {
    previousContainer.removeEventListener('click', state.boundClickHandler);
  }
  state.container = container;
  state.cards = [];
  renderShell(container);
  bindEvents(container);
  const content = container.querySelector('[data-giftcards-content]');
  await loadCards(content);
}

export async function renderModule(container) {
  await renderPage(container);
}

export default { renderPage, renderModule };
