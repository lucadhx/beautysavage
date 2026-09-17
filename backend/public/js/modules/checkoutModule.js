import { showToast } from '../helpers/toastService.js';
import { getSiteStatus, isSiteBlockedForUser } from '../helpers/siteStatusClient.js';
import { openConsumerWaiverInfoModal } from '../helpers/consumerWaiverModal.js';
import { openUiConfirmModal } from './uiConfirmModal.js';
import { createBookingCalendar } from './bookingCalendarComponent.js';
import {
  CHECKOUT_CGV_TEXT,
  DISTANT_LEARNING_WAIVER_TEXT,
  PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
  PRESENTIEL_WAIVER_WITHIN_7_TEXT,
  RETRACTATION_DAYS,
  isWaiverRequired
} from '../constants/consumerWaiver.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';
import {
  buildCheckoutState,
  buildCartCheckoutState,
  createCheckoutStateToken
} from './purchaseFlowService.js';
import { getItems } from './cartService.js';

const DETAILS_ENDPOINTS = {
  formation: id => `/api/vitrine/formations/${id}`,
  product: id => `/api/vitrine/products/${id}`
};
const SESSIONS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/sessions`;
const PURCHASE_STATUS_ENDPOINT = '/api/client/purchase-status';
const VALIDATE_CARD_ENDPOINT = '/api/client/gift-cards/validate';
const VALIDATE_CREDENTIALS_ENDPOINT = '/api/client/gift-cards/validate-credentials';
const VALIDATION_MIN_MS = 500;
const FINALIZE_MIN_MS = 1000;
const SUSPENDED_PURCHASE_MESSAGE =
  'Nous rencontrons quelques soucis, l achat est temporairement indisponible.';
const CONDITIONS_REQUIRED_MESSAGE = 'Veuillez accepter les conditions pour continuer.';
const ALREADY_PURCHASED_MESSAGE = 'Vous etes deja inscrit a cette formation.';

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
const toAmount = value => Math.round(Math.max(0, Number(value || 0)) * 100) / 100;
const normalizeCode = value => String(value || '').trim().toUpperCase();
const sanitizeSlug = value =>
  /^[a-z0-9_-]+$/.test(String(value || '').trim().toLowerCase())
    ? String(value).trim().toLowerCase()
    : '';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  return `${toAmount(value).toFixed(2)} EUR`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString();
}

function formatDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleDateString();
}

function normalizeTimeLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;
  const hours = String(Math.max(0, Math.min(23, Number(match[1])))).padStart(2, '0');
  const minutes = String(Math.max(0, Math.min(59, Number(match[2])))).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildSessionTimeRangeLabel(session) {
  const schedule = Array.isArray(session?.schedule) ? session.schedule : [];
  if (!schedule.length) return 'Horaires non definis';
  const normalized = schedule
    .map(entry => ({
      dayIndex: Number(entry?.dayIndex || 0),
      startTime: normalizeTimeLabel(entry?.startTime),
      endTime: normalizeTimeLabel(entry?.endTime)
    }))
    .filter(entry => entry.startTime && entry.endTime)
    .sort((a, b) => a.dayIndex - b.dayIndex);
  if (!normalized.length) return 'Horaires non definis';
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (normalized.length === 1) {
    return `${first.startTime} - ${first.endTime}`;
  }
  return `${first.startTime} - ${last.endTime}`;
}

function buildSessionScheduleDetails(session) {
  if (!session) {
    return '<p class="module-placeholder">Sélectionnez une session.</p>';
  }
  const schedule = Array.isArray(session.schedule) ? session.schedule : [];
  if (!schedule.length) {
    return `<p class="muted">Session: ${escapeHtml(formatDateOnly(session.startDate))} - Horaires non definis.</p>`;
  }
  const rows = schedule
    .slice()
    .sort((a, b) => Number(a?.dayIndex || 0) - Number(b?.dayIndex || 0))
    .map(entry => {
      const day = Number(entry?.dayIndex || 0) || 1;
      const start = normalizeTimeLabel(entry?.startTime) || '--:--';
      const end = normalizeTimeLabel(entry?.endTime) || '--:--';
      return `<p class="muted">Jour ${day}: ${escapeHtml(start)} - ${escapeHtml(end)}</p>`;
    })
    .join('');
  return `
    <p class="muted">Session: ${escapeHtml(formatDateOnly(session.startDate))}</p>
    ${rows}
  `;
}

async function waitMin(startedAt, minMs) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) await wait(minMs - elapsed);
}

function buildLoaderMarkup(label) {
  return `
    <div class="gcg-inline-loader checkoutp-inline-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

function setInlineLoader(container, visible, label) {
  const host = container.querySelector('[data-checkout-inline-loader]');
  const panel = container.querySelector('[data-checkout-panel]');
  if (!host || !panel) return;
  host.hidden = !visible;
  host.innerHTML = visible ? buildLoaderMarkup(label) : '';
  panel.classList.toggle('checkoutp-panel--loading', Boolean(visible));
}

function renderStatus(container, message) {
  container.innerHTML = `
    <div class="status-banner status-forbidden">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function computePromotionSnapshot(item) {
  const basePrice = toAmount(item?.price);
  const promo = item?.activePromotion || null;
  const apiFinal = Number.isFinite(Number(item?.finalPrice)) ? toAmount(item.finalPrice) : null;
  let final = apiFinal;
  if (final === null) {
    if (promo?.discountType === 'percentage') {
      final = toAmount(basePrice * (1 - Number(promo.discountValue || 0) / 100));
    } else if (promo?.discountType === 'fixed') {
      final = toAmount(basePrice - Number(promo.discountValue || 0));
    } else {
      final = basePrice;
    }
  }
  final = Math.min(basePrice, Math.max(0, final));
  return {
    basePrice,
    finalBeforeGift: final,
    discountAmount: toAmount(basePrice - final),
    promotionType: String(promo?.discountType || ''),
    promotionValue: Number(promo?.discountValue || 0)
  };
}

function computeTotals(pricing, appliedGiftCards, selectedOptions = []) {
  const baseAfterPromo = toAmount(pricing.finalBeforeGift);
  const optionsTotal = toAmount(
    (Array.isArray(selectedOptions) ? selectedOptions : []).reduce(
      (sum, o) => sum + toAmount(o?.price || 0),
      0
    )
  );
  const subtotal = toAmount(baseAfterPromo + optionsTotal);
  const giftCardUsed = toAmount(
    Math.min(
      subtotal,
      (Array.isArray(appliedGiftCards) ? appliedGiftCards : []).reduce(
        (sum, entry) => sum + toAmount(entry.amountUsed),
        0
      )
    )
  );
  return {
    basePrice: toAmount(pricing.basePrice),
    discountAmount: toAmount(pricing.discountAmount),
    optionsTotal,
    subtotal,
    giftCardUsed,
    remainingToPay: toAmount(subtotal - giftCardUsed)
  };
}

function getSessionStartMs(session) {
  const raw = session?.startAt || session?.startDate || null;
  if (!raw) return Number.NaN;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeCheckoutOption(entry) {
  const optionId = String(entry?.id || entry?.optionId || '').trim();
  if (!optionId) return null;
  return {
    optionId,
    name: String(entry?.name || 'Option').trim() || 'Option',
    description: String(entry?.description || '').trim(),
    image: String(entry?.image || '').trim(),
    price: toAmount(entry?.price || 0),
    deadlineDays: Math.max(0, Number(entry?.deadlineDays || 0))
  };
}

function collectCheckoutOptions(item = {}) {
  if (!Array.isArray(item?.options)) return [];
  return item.options
    .map(normalizeCheckoutOption)
    .filter(Boolean);
}

function isOptionAvailableForSession(option, session) {
  if (!option || !session) return false;
  const startMs = getSessionStartMs(session);
  if (!Number.isFinite(startMs)) return false;
  const deadlineMs = Math.max(0, Number(option.deadlineDays || 0)) * 86400000;
  return startMs - Date.now() > deadlineMs;
}

function getAvailableOptionsForSession(allOptions, session) {
  if (!Array.isArray(allOptions) || !session) return [];
  return allOptions.filter(option => isOptionAvailableForSession(option, session));
}

function getSelectedSession(state) {
  return (
    state.sessions.find(entry => String(entry?.id || '') === String(state.selectedSessionId || '')) || null
  );
}

function sanitizeSelectedOptions(rawSelectedOptions, allOptions, selectedSession) {
  const availableById = new Map(
    getAvailableOptionsForSession(allOptions, selectedSession).map(option => [option.optionId, option])
  );
  const normalized = Array.isArray(rawSelectedOptions) ? rawSelectedOptions : [];
  const seen = new Set();
  return normalized
    .map(entry => String(entry?.optionId || entry?.id || '').trim())
    .filter(optionId => optionId && availableById.has(optionId) && !seen.has(optionId))
    .map(optionId => {
      seen.add(optionId);
      const option = availableById.get(optionId);
      return {
        optionId: option.optionId,
        name: option.name,
        price: option.price
      };
    });
}

function removeUnavailableSelectedOptions(state) {
  const selectedSession = getSelectedSession(state);
  const availableIds = new Set(
    getAvailableOptionsForSession(state.allOptions, selectedSession).map(option => option.optionId)
  );
  const removed = [];
  state.selectedOptions = (Array.isArray(state.selectedOptions) ? state.selectedOptions : []).filter(option => {
    const keep = availableIds.has(String(option?.optionId || '').trim());
    if (!keep) {
      removed.push(option);
    }
    return keep;
  });
  return removed;
}

function buildRemovedOptionsMessage(removedOptions = []) {
  if (!removedOptions.length) {
    return 'Certaines options ne sont plus disponibles pour cette session.';
  }
  const items = removedOptions
    .map(option => `<li>${escapeHtml(option?.name || 'Option')}</li>`)
    .join('');
  return `
    <p>La session sélectionnée ne permet plus certaines options. Elles ont été retirées du total :</p>
    <ul>${items}</ul>
  `;
}

function getTypeLabel(itemType, item) {
  if (itemType === 'product') return 'produit';
  const subtype = String(item?.type || '').toLowerCase();
  if (subtype === 'distanciel') return 'formation distancielle';
  if (subtype === 'presentiel') return 'formation présentielle';
  return 'formation';
}

function normalizeRefundDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(0, parsed);
}

function buildLegalContext({ itemType, item, sessions = [], selectedSessionId = '' } = {}) {
  const context = {
    requiresCgv: true,
    waiverRequired: false,
    waiverText: '',
    waiverKind: 'none',
    dateFormation: null,
    dateFormationLabel: '',
    refundDays: normalizeRefundDays(item?.refundDays)
  };
  if (itemType !== 'formation') return context;

  const subtype = String(item?.type || '').toLowerCase();
  if (subtype === 'distanciel') {
    context.waiverRequired = true;
    context.waiverText = DISTANT_LEARNING_WAIVER_TEXT;
    context.waiverKind = 'distanciel';
    return context;
  }
  if (subtype !== 'presentiel') return context;

  const session =
    sessions.find(entry => String(entry?.id || '') === String(selectedSessionId || '')) || null;
  const formationDate = session?.startDate ? new Date(session.startDate) : null;
  if (!formationDate || Number.isNaN(formationDate.getTime())) return context;

  context.dateFormation = formationDate.toISOString();
  context.dateFormationLabel = formatDate(formationDate);
  const daysBeforeFormation = (formationDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (!isWaiverRequired({ daysBeforeFormation, refundDays: context.refundDays })) {
    return context;
  }
  if (daysBeforeFormation < RETRACTATION_DAYS) {
    context.waiverRequired = true;
    context.waiverText = PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT;
    context.waiverKind = 'presentiel-retractation';
    return context;
  }
  context.waiverRequired = true;
  context.waiverText = PRESENTIEL_WAIVER_WITHIN_7_TEXT;
  context.waiverKind = 'presentiel-institut';
  return context;
}

function maskCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return 'Carte';
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function capitalizeLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function resolveCheckoutMedia(itemType, item = {}) {
  if (itemType === 'product') {
    return String(item?.coverImage || item?.image || item?.photos?.[0] || '').trim();
  }
  return String(item?.coverImage || item?.coverUrl || item?.image || '').trim();
}

function getCheckoutDescription(itemType, item = {}) {
  const raw = String(item?.description || item?.shortDescription || '').trim();
  if (raw) return raw;
  if (itemType === 'product') return 'Produit selectionne pour votre commande.';
  if (itemType === 'gift-card') return 'Carte cadeau utilisable sur la boutique.';
  const subtype = String(item?.type || '').trim().toLowerCase();
  if (subtype === 'presentiel') return 'Formation presentielle avec reservation sur une session.';
  if (subtype === 'distanciel') return 'Formation video accessible apres validation de votre achat.';
  return 'Article selectionne pour votre commande.';
}

function buildCheckoutFocusMarkup(state) {
  const image = resolveCheckoutMedia(state.itemType, state.item);
  const typeLabel = capitalizeLabel(getTypeLabel(state.itemType, state.item));
  const description = getCheckoutDescription(state.itemType, state.item);
  const selectedSession =
    state.itemType === 'formation' && String(state.item?.type || '').toLowerCase() === 'presentiel'
      ? state.sessions.find(entry => String(entry?.id || '') === String(state.selectedSessionId || '')) || null
      : null;

  return `
    <article class="checkoutp-focus">
      <div class="checkoutp-focus__media${image ? '' : ' is-placeholder'}">
        ${
          image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(state.item?.name || 'Article')}" loading="lazy">`
            : `
              <div class="checkoutp-focus__fallback" aria-hidden="true">
                <i class="bi ${state.itemType === 'product' ? 'bi-bag-heart' : state.itemType === 'gift-card' ? 'bi-gift' : 'bi-mortarboard'}"></i>
              </div>
            `
        }
      </div>
      <div class="checkoutp-focus__content">
        <div class="checkoutp-focus__eyebrow">
          <span class="checkoutp-focus__badge" data-checkout-focus-type>${escapeHtml(typeLabel)}</span>
          <span class="checkoutp-focus__price" data-checkout-focus-price></span>
        </div>
        <h3 class="checkoutp-focus__title" data-checkout-focus-title>${escapeHtml(state.item?.name || 'Article')}</h3>
        <p class="checkoutp-focus__description" data-checkout-focus-description>${escapeHtml(description)}</p>
        <div class="checkoutp-focus__meta">
          <span class="checkoutp-focus__meta-chip" data-checkout-focus-savings hidden></span>
          <span class="checkoutp-focus__meta-chip" data-checkout-focus-session ${selectedSession ? '' : 'hidden'}></span>
        </div>
      </div>
    </article>
  `;
}

function renderCheckout(container, state) {
  const sessionControl =
    state.itemType === 'formation' && String(state.item?.type || '').toLowerCase() === 'presentiel'
      ? `
        <div class="checkout-session-picker" data-session-picker>
          <div class="checkout-session-picker__selected" data-session-display>
            <span class="module-placeholder">Aucune session sélectionnée.</span>
          </div>
          <button type="button" class="secondary-button checkout-session-picker__edit" data-open-session-calendar>
            <i class="bi bi-pencil" aria-hidden="true"></i> Modifier
          </button>
        </div>
        <div class="checkout-session-calendar-modal" data-session-calendar-modal hidden aria-hidden="true">
          <div class="checkout-session-calendar-modal__inner" role="dialog" aria-modal="true" aria-label="Choisir une session">
            <header class="checkout-session-calendar-modal__header">
              <h4>Choisir une session</h4>
              <button type="button" data-close-session-calendar aria-label="Fermer">&times;</button>
            </header>
            <div class="checkout-session-calendar-modal__body" data-session-calendar-body></div>
          </div>
        </div>
        <div data-session-schedule-details class="session-schedule-details"></div>
      `
      : '';
  const optionsControl =
    state.itemType === 'formation' && String(state.item?.type || '').toLowerCase() === 'presentiel'
      ? `
        <article class="checkoutp-options" data-checkout-options>
          <header class="checkoutp-options__header">
            <h3>Options de formation</h3>
            <p>Sélectionnez les options souhaitées pour la session choisie.</p>
          </header>
          <div class="checkoutp-options__list" data-checkout-options-list></div>
        </article>
      `
      : '';

  container.innerHTML = `
    <section class="checkoutp" data-checkout-panel>
      <header class="checkoutp__header">
        <h2>Checkout</h2>
        <p>Appliquez vos cartes cadeaux puis validez votre achat.</p>
      </header>

      ${buildCheckoutFocusMarkup(state)}

      <article class="checkoutp-summary">
        <div class="checkoutp-summary__row"><span>Article</span><strong data-summary-title></strong></div>
        <div class="checkoutp-summary__row"><span>Type</span><small data-summary-type></small></div>
        <div class="checkoutp-summary__row"><span>Prix de base</span><strong data-summary-base></strong></div>
        <div data-summary-options-container></div>
        <div class="checkoutp-summary__row" data-summary-promo-row hidden><span>Promotion</span><strong data-summary-promo></strong></div>
        <div class="checkoutp-summary__row" data-summary-subtotal-row hidden><span>Sous-total</span><strong data-summary-subtotal></strong></div>
        <div class="checkoutp-summary__row" data-summary-gift-row hidden><span>Carte cadeau</span><strong data-summary-gift></strong></div>
        <div class="checkoutp-summary__divider"></div>
        <div class="checkoutp-summary__row checkoutp-summary__row--total"><span>Total final</span><strong data-summary-total></strong></div>
      </article>

      <article class="checkoutp-gift-applied">
        <span class="checkoutp-gift-applied__decor" aria-hidden="true"><i class="bi bi-gift-fill"></i></span>
        <header>
          <h3>Cartes cadeaux appliquées</h3>
          <button type="button" class="checkoutp-gift-applied__add" data-open-gift-flow>Ajouter une carte</button>
        </header>
        <div data-applied-gift-list><p class="module-placeholder">Aucune carte appliquée.</p></div>
      </article>

      <div class="checkoutp-gift-modal" data-gift-modal hidden tabindex="-1" aria-hidden="true">
        <article class="checkoutp-gift-flow" data-gift-flow role="dialog" aria-modal="true" aria-label="Utiliser une carte cadeau">
          <header class="checkoutp-gift-flow__header">
            <h3>Utiliser une carte cadeau</h3>
            <button type="button" class="checkoutp-gift-flow__close" data-close-gift-flow aria-label="Fermer">&times;</button>
          </header>
          <div data-gift-step-code>
            <label>Code<input data-gift-code class="gcg-minimal-input" maxlength="32" placeholder="XXXX-XXXX"></label>
            <button type="button" class="secondary-button" data-gift-code-validate>Valider le code</button>
          </div>
          <div data-gift-step-password hidden>
            <label>Mot de passe<input type="password" data-gift-password class="gcg-minimal-input" placeholder="Mot de passe"></label>
            <button type="button" class="secondary-button" data-gift-password-validate>Valider le mot de passe</button>
          </div>
          <div data-gift-step-confirm hidden>
            <p data-gift-confirm-title></p>
            <div class="checkoutp-gift-flow__amount-shell">
              <button type="button" class="checkoutp-gift-flow__amount-btn" data-gift-minus aria-label="Diminuer le montant">
                <i class="bi bi-dash-lg" aria-hidden="true"></i>
              </button>
              <div class="checkoutp-gift-flow__amount-box">
                <input
                  type="number"
                  data-gift-amount
                  class="checkoutp-gift-flow__amount-input"
                  step="10"
                  inputmode="decimal"
                  aria-label="Montant à débiter"
                >
              </div>
              <button type="button" class="checkoutp-gift-flow__amount-btn" data-gift-plus aria-label="Augmenter le montant">
                <i class="bi bi-plus-lg" aria-hidden="true"></i>
              </button>
            </div>
            <div class="checkoutp-gift-flow__preview">
              <article class="checkoutp-gift-flow__preview-card">
                <small>Sur la carte apres debit</small>
                <p>
                  <span class="checkoutp-gift-flow__preview-old" data-gift-preview-card-before></span>
                  <strong data-gift-preview-card-after></strong>
                </p>
              </article>
              <article class="checkoutp-gift-flow__preview-card">
                <small>Reste a payer apres debit</small>
                <p>
                  <span class="checkoutp-gift-flow__preview-old" data-gift-preview-pay-before></span>
                  <strong data-gift-preview-pay-after></strong>
                </p>
              </article>
            </div>
            <button type="button" class="primary-button" data-gift-confirm>Confirmer l utilisation</button>
          </div>
          <p class="muted" data-gift-feedback></p>
        </article>
      </div>

      ${sessionControl}
      ${optionsControl}
      <div class="checkoutp-option-modal" data-option-modal hidden tabindex="-1" aria-hidden="true">
        <article class="checkoutp-option-modal__panel" role="dialog" aria-modal="true" aria-label="Détail option">
          <header class="checkoutp-option-modal__header">
            <h3 data-option-modal-title>Option</h3>
            <button type="button" class="checkoutp-option-modal__close" data-option-modal-close aria-label="Fermer">&times;</button>
          </header>
          <div class="checkoutp-option-modal__media" data-option-modal-media hidden>
            <img data-option-modal-image src="" alt="">
          </div>
          <p class="checkoutp-option-modal__price" data-option-modal-price></p>
          <p class="checkoutp-option-modal__description" data-option-modal-description></p>
        </article>
      </div>
      <div class="checkoutp-legal">
        <p class="checkoutp-formation-date" data-formation-date-row hidden>
          <i class="bi bi-calendar-event" aria-hidden="true"></i>
          <span>Date de formation : <strong data-formation-date-value></strong></span>
        </p>
        <div class="checkout-waiver-box" data-cgv-box>
          <label class="checkout-waiver-box__label">
            <input class="checkout-waiver-box__checkbox-input" type="checkbox" data-cgv-checkbox>
            <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true">
              <i class="bi bi-check2"></i>
            </span>
            <span>${escapeHtml(CHECKOUT_CGV_TEXT)}</span>
          </label>
          <button type="button" class="checkout-waiver-box__info" data-cgv-info>
            plus d informations <i class="bi bi-link-45deg" aria-hidden="true"></i>
          </button>
        </div>
        <div class="checkout-waiver-box" data-waiver-box hidden>
          <label class="checkout-waiver-box__label">
            <input class="checkout-waiver-box__checkbox-input" type="checkbox" data-waiver-checkbox>
            <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true">
              <i class="bi bi-check2"></i>
            </span>
            <span data-waiver-label></span>
          </label>
          <button type="button" class="checkout-waiver-box__info" data-waiver-info>
            plus d informations ici
          </button>
        </div>
      </div>

      <p class="form-message" data-checkout-feedback></p>
      <div class="checkoutp__actions">
        
        <button type="button" class="primary-button" data-proceed ${state.siteBlocked ? 'disabled' : ''}></button>
      </div>
      <p class="checkoutp__blocked-hint muted" data-conditions-hint hidden>${CONDITIONS_REQUIRED_MESSAGE}</p>
      <p class="muted">${state.siteBlocked ? escapeHtml(SUSPENDED_PURCHASE_MESSAGE) : 'Paiement simule - Stripe a venir.'}</p>
      <div data-checkout-inline-loader hidden></div>
    </section>
  `;
}

function buildOrigin(itemType, itemId, sessionId, query) {
  const slug = sanitizeSlug(query.originSlug) || 'item-detail';
  const type = String(query.originType || itemType || '').toLowerCase() === 'product' ? 'product' : 'formation';
  const id = String(query.originId || itemId || '').trim();
  const origin = { slug, query: { type, id } };
  const originSession = String(query.originSessionId || sessionId || '').trim();
  if (originSession) origin.query.sessionId = originSession;
  return origin;
}

function buildFreeCheckoutStateFingerprint(checkoutState) {
  const stripVolatileFields = value => {
    if (Array.isArray(value)) return value.map(stripVolatileFields);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['acceptedAt', 'createdAt', 'waiverAcceptedAt'].includes(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, stripVolatileFields(nestedValue)])
    );
  };
  try {
    return JSON.stringify(stripVolatileFields(checkoutState));
  } catch (_error) {
    return '';
  }
}

function getOrCreateFreeCheckoutToken(state, checkoutState) {
  const fingerprint = buildFreeCheckoutStateFingerprint(checkoutState);
  if (
    state &&
    state.freeCheckoutToken &&
    state.freeCheckoutFingerprint &&
    state.freeCheckoutFingerprint === fingerprint
  ) {
    return state.freeCheckoutToken;
  }
  const token = createCheckoutStateToken(checkoutState);
  if (state && token) {
    state.freeCheckoutToken = token;
    state.freeCheckoutFingerprint = fingerprint;
  }
  return token;
}

function setFeedback(container, message, status = '') {
  const node = container.querySelector('[data-checkout-feedback]');
  if (!node) return;
  node.textContent = message || '';
  node.dataset.status = status;
}

function flashLegalRequired(container, selector = '[data-cgv-box]') {
  const box = container.querySelector(selector);
  if (box) {
    box.classList.remove('is-error-flash');
    void box.offsetWidth;
    box.classList.add('is-error-flash');
    window.setTimeout(() => box.classList.remove('is-error-flash'), 560);
  }
  setFeedback(container, CONDITIONS_REQUIRED_MESSAGE, 'error');
}

function isProceedBlockedByLegal(state) {
  if (!state.cgvAccepted) return true;
  if (state.legalContext?.waiverRequired && !state.waiverAccepted) return true;
  return false;
}

function syncProceedButton(container, state) {
  const button = container.querySelector('[data-proceed]');
  const hint = container.querySelector('[data-conditions-hint]');
  if (!button || !hint) return;
  const blockedByLegal = isProceedBlockedByLegal(state);
  const blockedByPurchase = Boolean(state.alreadyPurchased);
  button.disabled = Boolean(state.siteBlocked || blockedByLegal || blockedByPurchase);
  button.classList.toggle('is-waiver-blocked', blockedByLegal && !blockedByPurchase);
  hint.hidden = blockedByPurchase || !(blockedByLegal && !state.siteBlocked);
}

function syncLegalUI(container, state) {
  const context = state.legalContext || {};
  const formationDateRow = container.querySelector('[data-formation-date-row]');
  const formationDateValue = container.querySelector('[data-formation-date-value]');
  const cgvCheckbox = container.querySelector('[data-cgv-checkbox]');
  const waiverBox = container.querySelector('[data-waiver-box]');
  const waiverCheckbox = container.querySelector('[data-waiver-checkbox]');
  const waiverLabel = container.querySelector('[data-waiver-label]');

  if (formationDateRow && formationDateValue) {
    const hasDate = Boolean(context.dateFormationLabel);
    formationDateRow.hidden = !hasDate;
    formationDateValue.textContent = hasDate ? context.dateFormationLabel : '';
  }
  if (cgvCheckbox) cgvCheckbox.checked = Boolean(state.cgvAccepted);
  if (waiverBox && waiverCheckbox && waiverLabel) {
    waiverBox.hidden = !context.waiverRequired;
    waiverLabel.textContent = context.waiverRequired ? context.waiverText : '';
    if (!context.waiverRequired) state.waiverAccepted = false;
    waiverCheckbox.checked = Boolean(state.waiverAccepted);
  }
  syncProceedButton(container, state);
}

function renderCheckoutOptions(container, state) {
  const optionsPanel = container.querySelector('[data-checkout-options]');
  const list = container.querySelector('[data-checkout-options-list]');
  if (!optionsPanel || !list) return;

  const isPresentiel =
    state.itemType === 'formation' && String(state.item?.type || '').toLowerCase() === 'presentiel';
  if (!isPresentiel || !Array.isArray(state.allOptions) || !state.allOptions.length) {
    optionsPanel.hidden = true;
    list.innerHTML = '';
    return;
  }

  const selectedSession = getSelectedSession(state);
  const availableOptions = getAvailableOptionsForSession(state.allOptions, selectedSession);
  optionsPanel.hidden = false;
  if (!availableOptions.length) {
    list.innerHTML = '<p class="module-placeholder">Aucune option disponible pour cette session.</p>';
    return;
  }

  const selectedIds = new Set(
    (Array.isArray(state.selectedOptions) ? state.selectedOptions : []).map(option =>
      String(option?.optionId || '').trim()
    )
  );
  list.innerHTML = availableOptions
    .map(option => {
      const optionId = escapeHtml(option.optionId);
      const inputId = `checkout-option-${optionId}`;
      const checked = selectedIds.has(option.optionId);
      const hasImage = Boolean(option.image);
      return `
        <article class="checkoutp-option-card is-entering ${checked ? 'is-selected' : ''}" data-option-card-id="${optionId}">
          <input
            id="${inputId}"
            class="checkoutp-option-card__input"
            type="checkbox"
            data-option-checkbox
            data-option-id="${optionId}"
            ${checked ? 'checked' : ''}
          >
          <label class="checkoutp-option-card__label" for="${inputId}">
            <span class="checkoutp-option-card__check" aria-hidden="true">
              <span class="checkoutp-option-card__check-icon"><i class="bi bi-check2"></i></span>
            </span>
            <span class="checkoutp-option-card__thumb ${hasImage ? '' : 'is-empty'}" aria-hidden="true">
              ${hasImage ? `<img class="checkoutp-option-card__thumb-image" src="${escapeHtml(option.image)}" alt="">` : '<i class="bi bi-card-image"></i>'}
            </span>
            <span class="checkoutp-option-card__name">${escapeHtml(option.name)}</span>
            <span class="checkoutp-option-card__meta">
              <strong class="checkoutp-option-card__price">+${formatPrice(option.price)}</strong>
            </span>
          </label>
          <button type="button" class="checkoutp-option-card__view" data-option-view data-option-id="${optionId}">Voir l option</button>
        </article>
      `;
    })
    .join('');
}

function playOptionToggleAnimation(container, optionId, checked) {
  if (!container || !optionId) return;
  const cards = Array.from(container.querySelectorAll('[data-option-card-id]'));
  const card = cards.find(node => String(node.dataset.optionCardId || '') === String(optionId));
  if (!card) return;
  card.classList.remove('is-anim-check', 'is-anim-uncheck');
  void card.offsetWidth;
  card.classList.add(checked ? 'is-anim-check' : 'is-anim-uncheck');
  window.setTimeout(() => {
    card.classList.remove('is-anim-check', 'is-anim-uncheck');
  }, 340);
}

function findOptionById(options, optionId) {
  if (!Array.isArray(options) || !optionId) return null;
  return options.find(option => String(option?.optionId || '') === String(optionId)) || null;
}

function syncSessionDisplay(container, state) {
  const display = container.querySelector('[data-session-display]');
  if (!display) return;
  const session = (state.sessions || []).find(s => String(s.id) === String(state.selectedSessionId));
  if (!session) {
    display.innerHTML = '<span class="module-placeholder">Aucune session sélectionnée.</span>';
    return;
  }
  const available = session.isAvailable
    ? `${(session.maxClients || 0) - (session.reservedCount || 0)} place(s) disponible(s)`
    : 'Complet';
  display.innerHTML = `
    <span class="checkout-session-picker__date">${escapeHtml(formatDateOnly(session.startDate))}</span>
    <span class="checkout-session-picker__time">${escapeHtml(buildSessionTimeRangeLabel(session))}</span>
    <span class="checkout-session-picker__avail">${escapeHtml(available)}</span>
  `;
}

function updateSummary(container, state) {
  state.totals = computeTotals(state.pricingSnapshot, state.appliedGiftCards, state.selectedOptions);
  const focusType = container.querySelector('[data-checkout-focus-type]');
  const focusTitle = container.querySelector('[data-checkout-focus-title]');
  const focusDescription = container.querySelector('[data-checkout-focus-description]');
  const focusPrice = container.querySelector('[data-checkout-focus-price]');
  const focusSavings = container.querySelector('[data-checkout-focus-savings]');
  const focusSession = container.querySelector('[data-checkout-focus-session]');

  if (focusType) focusType.textContent = capitalizeLabel(getTypeLabel(state.itemType, state.item));
  if (focusTitle) focusTitle.textContent = state.item.name || 'Article';
  if (focusDescription) focusDescription.textContent = getCheckoutDescription(state.itemType, state.item);
  if (focusPrice) focusPrice.textContent = formatPrice(state.totals.remainingToPay);
  if (focusSavings) {
    if (state.pricingSnapshot.discountAmount > 0) {
      focusSavings.hidden = false;
      focusSavings.textContent = `Economie ${formatPrice(state.pricingSnapshot.discountAmount)}`;
    } else {
      focusSavings.hidden = true;
      focusSavings.textContent = '';
    }
  }
  if (focusSession) {
    const selectedSession =
      state.itemType === 'formation' && String(state.item?.type || '').toLowerCase() === 'presentiel'
        ? state.sessions.find(entry => String(entry?.id || '') === String(state.selectedSessionId || '')) || null
        : null;
    if (selectedSession) {
      focusSession.hidden = false;
      focusSession.textContent = `Session ${formatDateOnly(selectedSession.startDate)} · ${buildSessionTimeRangeLabel(selectedSession)}`;
    } else {
      focusSession.hidden = true;
      focusSession.textContent = '';
    }
  }

  container.querySelector('[data-summary-title]').textContent = state.item.name || 'Article';
  container.querySelector('[data-summary-type]').textContent = getTypeLabel(state.itemType, state.item);
  container.querySelector('[data-summary-base]').textContent = formatPrice(state.pricingSnapshot.basePrice);
  const optionsContainer = container.querySelector('[data-summary-options-container]');
  if (optionsContainer) {
    optionsContainer.innerHTML = (Array.isArray(state.selectedOptions) ? state.selectedOptions : [])
      .map(o => `<div class="checkoutp-summary__row"><span>${escapeHtml(String(o.name || 'Option'))}</span><strong>+${formatPrice(Number(o.price || 0))}</strong></div>`)
      .join('');
  }
  const promoRow = container.querySelector('[data-summary-promo-row]');
  const subtotalRow = container.querySelector('[data-summary-subtotal-row]');
  const giftRow = container.querySelector('[data-summary-gift-row]');
  const hasDiscount = state.pricingSnapshot.discountAmount > 0;
  const hasOptions = Array.isArray(state.selectedOptions) && state.selectedOptions.length > 0;
  if (hasDiscount) {
    promoRow.hidden = false;
    promoRow.querySelector('[data-summary-promo]').textContent = state.pricingSnapshot.promotionType === 'percentage'
      ? `-${formatPrice(state.pricingSnapshot.discountAmount)} (-${state.pricingSnapshot.promotionValue}%)`
      : `-${formatPrice(state.pricingSnapshot.discountAmount)}`;
  } else {
    promoRow.hidden = true;
  }
  if (hasDiscount || hasOptions) {
    subtotalRow.hidden = false;
    subtotalRow.querySelector('[data-summary-subtotal]').textContent = formatPrice(state.totals.subtotal);
  } else {
    subtotalRow.hidden = true;
  }
  if (state.totals.giftCardUsed > 0) {
    giftRow.hidden = false;
    giftRow.querySelector('[data-summary-gift]').textContent = `-${formatPrice(state.totals.giftCardUsed)}`;
  } else {
    giftRow.hidden = true;
  }
  container.querySelector('[data-summary-total]').textContent = formatPrice(state.totals.remainingToPay);
  container.querySelector('[data-proceed]').textContent = state.alreadyPurchased
    ? 'Deja inscrit'
    : state.totals.remainingToPay > 0
      ? 'Proceder au paiement'
      : 'Valider mon achat';

  const list = container.querySelector('[data-applied-gift-list]');
  if (!state.appliedGiftCards.length) {
    list.innerHTML = '<p class="module-placeholder">Aucune carte appliquée.</p>';
  } else {
    list.innerHTML = state.appliedGiftCards
      .map(
        entry => `
          <article class="checkoutp-gift-applied__item is-entering" data-code="${escapeHtml(entry.code)}">
            <div><strong>${escapeHtml(maskCode(entry.code))}</strong><p>${formatPrice(entry.amountUsed)}</p></div>
            <button type="button" class="checkoutp-gift-applied__remove" data-remove-card aria-label="Retirer"><i class="bi bi-trash"></i></button>
          </article>
        `
      )
      .join('');
  }
  syncProceedButton(container, state);
}

function maxGiftUsage(state, code, balance) {
  const subtotal = toAmount(state.totals.subtotal);
  const withoutCurrent = toAmount(
    state.appliedGiftCards
      .filter(entry => normalizeCode(entry.code) !== normalizeCode(code))
      .reduce((sum, entry) => sum + toAmount(entry.amountUsed), 0)
  );
  return toAmount(Math.min(toAmount(balance), subtotal - withoutCurrent));
}

async function fetchItem(itemType, itemId) {
  const response = await fetch(DETAILS_ENDPOINTS[itemType](itemId), { credentials: 'include' });
  if (!response.ok) {
    if (response.status === 404) throw new Error('not-found');
    if (response.status === 401) throw new Error('unauth');
    throw new Error('network');
  }
  const payload = await response.json().catch(() => ({}));
  return itemType === 'product' ? payload.product || null : payload.formation || null;
}

async function fetchSessions(itemId) {
  const response = await fetch(SESSIONS_ENDPOINT(itemId));
  if (!response.ok) throw new Error('sessions');
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload.sessions) ? payload.sessions : [];
}

async function fetchFormationPurchaseStatus(formationId, sessionId = '') {
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

function syncAlreadyPurchasedFeedback(container, state) {
  const node = container.querySelector('[data-checkout-feedback]');
  if (!node) return;
  if (state.alreadyPurchased) {
    setFeedback(container, `${ALREADY_PURCHASED_MESSAGE} Ouvrez Mes formations pour y acceder.`, 'error');
    return;
  }
  const current = String(node.textContent || '').trim();
  if (current.startsWith(ALREADY_PURCHASED_MESSAGE)) {
    setFeedback(container, '', '');
  }
}

async function validateCode(code) {
  const response = await fetch(VALIDATE_CARD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code: normalizeCode(code) })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.card) throw new Error(payload?.error || 'Carte introuvable.');
  return payload.card;
}

async function validateCredentials(code, password) {
  const response = await fetch(VALIDATE_CREDENTIALS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code: normalizeCode(code), password: String(password || '').trim() })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.card) throw new Error(payload?.error || 'Mot de passe invalide.');
  return payload.card;
}

// ── Cart checkout mode ──────────────────────────────────────────────────────

function buildCartItemWaiver(formationId, detail, session) {
  const formationType = String(detail?.type || '').toLowerCase();
  const refundDays = Number(detail?.refundDays || 0);
  if (formationType === 'distanciel') {
    return { formationId, waiverType: 'legal', waiverText: DISTANT_LEARNING_WAIVER_TEXT, refundDays: null, daysBeforeFormation: null };
  }
  if (formationType === 'presentiel' && session?.startDate) {
    const daysBeforeFormation = Math.floor((new Date(session.startDate).getTime() - Date.now()) / 86400000);
    const effectiveRefundDays = Math.max(RETRACTATION_DAYS, refundDays);
    if (daysBeforeFormation >= effectiveRefundDays) {
      return { formationId, waiverType: null, waiverText: null, refundDays, daysBeforeFormation };
    }
    if (daysBeforeFormation < RETRACTATION_DAYS) {
      const waiverType = refundDays > RETRACTATION_DAYS ? 'both' : 'legal';
      const waiverText = daysBeforeFormation < 7 ? PRESENTIEL_WAIVER_WITHIN_7_TEXT : PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT;
      return { formationId, waiverType, waiverText, refundDays, daysBeforeFormation };
    }
    const institutText = `Je reconnais que la formation a lieu dans moins de ${refundDays} jours et accepte la politique de remboursement de l etablissement.`;
    return { formationId, waiverType: 'institut', waiverText: institutText, refundDays, daysBeforeFormation };
  }
  return null;
}

function buildCartWaiverContext(entries) {
  const waivers = entries
    .filter(e => e.itemType === 'formation')
    .map(e => buildCartItemWaiver(String(e.cartItem?.id || '').trim(), e.detail, e.session))
    .filter(Boolean);
  const legalWaivers = waivers.filter(w => w.waiverType === 'legal' || w.waiverType === 'both');
  const institutWaivers = waivers.filter(w => w.waiverType === 'institut');
  const refundPolicySnapshots = {};
  waivers.forEach(w => {
    refundPolicySnapshots[w.formationId] = {
      refundDays: w.refundDays,
      daysBeforeFormation: w.daysBeforeFormation,
      waiverType: w.waiverType,
      waiverText: w.waiverText,
      acceptedAt: null
    };
  });
  return {
    legalWaivers,
    institutWaivers,
    refundPolicySnapshots,
    requiresLegal: legalWaivers.length > 0,
    requiresInstitut: institutWaivers.length > 0
  };
}

function computeCartTotals(entries, appliedGiftCards) {
  const subtotal = toAmount(entries.reduce((sum, e) => sum + toAmount(e.finalPrice), 0));
  const giftCardUsed = toAmount(
    Math.min(
      subtotal,
      (Array.isArray(appliedGiftCards) ? appliedGiftCards : []).reduce(
        (sum, gc) => sum + toAmount(gc.amountUsed),
        0
      )
    )
  );
  return {
    basePrice: toAmount(entries.reduce((sum, e) => sum + toAmount(e.basePrice), 0)),
    discountAmount: toAmount(entries.reduce((sum, e) => sum + toAmount(e.discountAmount), 0)),
    subtotal,
    giftCardUsed,
    remainingToPay: toAmount(subtotal - giftCardUsed)
  };
}

async function fetchCartEntry(cartItem) {
  const type = String(cartItem.type || '').toLowerCase() === 'product' ? 'product' : 'formation';
  const response = await fetch(DETAILS_ENDPOINTS[type](cartItem.id), { credentials: 'include' });
  if (!response.ok) throw new Error(`Article introuvable (${cartItem.id})`);
  const payload = await response.json().catch(() => ({}));
  const detail = type === 'product' ? payload.product : payload.formation;
  if (!detail) throw new Error('Article introuvable');
  let session = null;
  if (type === 'formation' && String(detail.type || '').toLowerCase() === 'presentiel' && cartItem.sessionId) {
    const sr = await fetch(SESSIONS_ENDPOINT(cartItem.id));
    if (sr.ok) {
      const sp = await sr.json().catch(() => ({}));
      const sessions = Array.isArray(sp.sessions) ? sp.sessions : [];
      session = sessions.find(s => s.id === cartItem.sessionId) || null;
    }
  }
  const pricing = computePromotionSnapshot(detail);
  const optionTotal = toAmount(
    (Array.isArray(cartItem.selectedOptions) ? cartItem.selectedOptions : []).reduce(
      (sum, o) => sum + toAmount(o?.price || 0),
      0
    )
  );
  return {
    cartItem,
    detail,
    session,
    itemType: type,
    basePrice: toAmount(pricing.basePrice + optionTotal),
    finalPrice: toAmount(pricing.finalBeforeGift + optionTotal),
    discountAmount: pricing.discountAmount
  };
}

function renderCartItemRow(entry) {
  const { cartItem, detail, session } = entry;
  const typeLabel =
    entry.itemType === 'product' ? 'Produit' :
    String(detail?.type || '').toLowerCase() === 'presentiel' ? 'Formation présentielle' :
    'Formation distancielle';
  const sessionLabel = session
    ? `${formatDateOnly(session.startDate)} · ${buildSessionTimeRangeLabel(session)}`
    : '';
  const hasDiscount = entry.finalPrice < entry.basePrice;
  const options = Array.isArray(cartItem.selectedOptions) ? cartItem.selectedOptions : [];
  return `
    <div class="checkoutp-summary__row">
      <div style="flex:1;min-width:0;">
        <strong>${escapeHtml(detail?.name || cartItem.name || 'Article')}</strong>
        <br><small class="muted">${escapeHtml(typeLabel)}${sessionLabel ? ` · ${escapeHtml(sessionLabel)}` : ''}</small>
        ${options.map(o => `<br><small class="muted">+ ${escapeHtml(o.name || 'Option')} (+${formatPrice(o.price || 0)})</small>`).join('')}
      </div>
      <div style="text-align:right;white-space:nowrap;">
        ${hasDiscount ? `<s class="muted" style="font-size:0.85em;display:block;">${formatPrice(entry.basePrice)}</s>` : ''}
        <strong>${formatPrice(entry.finalPrice)}</strong>
      </div>
    </div>
  `;
}

function renderCartCheckoutMarkup(state) {
  const { siteBlocked, waiverContext } = state;
  const legalWaiverHtml = waiverContext.requiresLegal ? `
    <div class="checkout-waiver-box" data-cart-waiver-box="legal">
      <label class="checkout-waiver-box__label">
        <input class="checkout-waiver-box__checkbox-input" type="checkbox" data-cart-waiver-checkbox="legal">
        <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true"><i class="bi bi-check2"></i></span>
        <span>${escapeHtml(waiverContext.legalWaivers[0]?.waiverText || DISTANT_LEARNING_WAIVER_TEXT)}</span>
      </label>
      <button type="button" class="checkout-waiver-box__info" data-cart-waiver-info="legal">plus d informations ici</button>
    </div>
  ` : '';
  const institutWaiverHtml = waiverContext.requiresInstitut ? `
    <div class="checkout-waiver-box" data-cart-waiver-box="institut">
      <label class="checkout-waiver-box__label">
        <input class="checkout-waiver-box__checkbox-input" type="checkbox" data-cart-waiver-checkbox="institut">
        <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true"><i class="bi bi-check2"></i></span>
        <span>${escapeHtml(waiverContext.institutWaivers[0]?.waiverText || '')}</span>
      </label>
      <button type="button" class="checkout-waiver-box__info" data-cart-waiver-info="institut">plus d informations ici</button>
    </div>
  ` : '';
  return `
    <section class="checkoutp" data-checkout-panel>
      <header class="checkoutp__header">
        <h2>Votre commande</h2>
        <p>Verifiez votre selection puis finalisez votre achat.</p>
      </header>

      <article class="checkoutp-summary">
        ${state.entries.map(renderCartItemRow).join('')}
        <div class="checkoutp-summary__divider"></div>
        <div class="checkoutp-summary__row" data-summary-gift-row hidden>
          <span>Carte cadeau</span><strong data-summary-gift></strong>
        </div>
        <div class="checkoutp-summary__row checkoutp-summary__row--total">
          <span>Total</span><strong data-summary-total>${formatPrice(state.totals.remainingToPay)}</strong>
        </div>
      </article>

      <article class="checkoutp-gift-applied">
        <span class="checkoutp-gift-applied__decor" aria-hidden="true"><i class="bi bi-gift-fill"></i></span>
        <header>
          <h3>Cartes cadeaux appliquées</h3>
          <button type="button" class="checkoutp-gift-applied__add" data-open-gift-flow>Ajouter une carte</button>
        </header>
        <div data-applied-gift-list><p class="module-placeholder">Aucune carte appliquée.</p></div>
      </article>

      <div class="checkoutp-gift-modal" data-gift-modal hidden tabindex="-1" aria-hidden="true">
        <article class="checkoutp-gift-flow" data-gift-flow role="dialog" aria-modal="true" aria-label="Utiliser une carte cadeau">
          <header class="checkoutp-gift-flow__header">
            <h3>Utiliser une carte cadeau</h3>
            <button type="button" class="checkoutp-gift-flow__close" data-close-gift-flow aria-label="Fermer">&times;</button>
          </header>
          <div data-gift-step-code>
            <label>Code<input data-gift-code class="gcg-minimal-input" maxlength="32" placeholder="XXXX-XXXX"></label>
            <button type="button" class="secondary-button" data-gift-code-validate>Valider le code</button>
          </div>
          <div data-gift-step-password hidden>
            <label>Mot de passe<input type="password" data-gift-password class="gcg-minimal-input" placeholder="Mot de passe"></label>
            <button type="button" class="secondary-button" data-gift-password-validate>Valider le mot de passe</button>
          </div>
          <div data-gift-step-confirm hidden>
            <p data-gift-confirm-title></p>
            <div class="checkoutp-gift-flow__amount-shell">
              <button type="button" class="checkoutp-gift-flow__amount-btn" data-gift-minus aria-label="Diminuer le montant"><i class="bi bi-dash-lg" aria-hidden="true"></i></button>
              <div class="checkoutp-gift-flow__amount-box"><input type="number" data-gift-amount class="checkoutp-gift-flow__amount-input" step="10" inputmode="decimal" aria-label="Montant à débiter"></div>
              <button type="button" class="checkoutp-gift-flow__amount-btn" data-gift-plus aria-label="Augmenter le montant"><i class="bi bi-plus-lg" aria-hidden="true"></i></button>
            </div>
            <div class="checkoutp-gift-flow__preview">
              <article class="checkoutp-gift-flow__preview-card"><small>Sur la carte apres debit</small><p><span class="checkoutp-gift-flow__preview-old" data-gift-preview-card-before></span><strong data-gift-preview-card-after></strong></p></article>
              <article class="checkoutp-gift-flow__preview-card"><small>Reste a payer apres debit</small><p><span class="checkoutp-gift-flow__preview-old" data-gift-preview-pay-before></span><strong data-gift-preview-pay-after></strong></p></article>
            </div>
            <button type="button" class="primary-button" data-gift-confirm>Confirmer l utilisation</button>
          </div>
          <p class="muted" data-gift-feedback></p>
        </article>
      </div>

      <div class="checkoutp-legal">
        <div class="checkout-waiver-box" data-cgv-box>
          <label class="checkout-waiver-box__label">
            <input class="checkout-waiver-box__checkbox-input" type="checkbox" data-cgv-checkbox>
            <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true"><i class="bi bi-check2"></i></span>
            <span>${escapeHtml(CHECKOUT_CGV_TEXT)}</span>
          </label>
          <button type="button" class="checkout-waiver-box__info" data-cgv-info>plus d informations <i class="bi bi-link-45deg" aria-hidden="true"></i></button>
        </div>
        ${legalWaiverHtml}
        ${institutWaiverHtml}
      </div>

      <p class="form-message" data-checkout-feedback></p>
      <div class="checkoutp__actions">
        <button type="button" class="primary-button" data-proceed ${siteBlocked ? 'disabled' : ''}>Proceder au paiement</button>
      </div>
      <p class="checkoutp__blocked-hint muted" data-conditions-hint hidden>${CONDITIONS_REQUIRED_MESSAGE}</p>
      ${siteBlocked ? `<p class="muted">${escapeHtml(SUSPENDED_PURCHASE_MESSAGE)}</p>` : ''}
      <div data-checkout-inline-loader hidden></div>
    </section>
  `;
}

function syncCartProceedButton(container, state) {
  const button = container.querySelector('[data-proceed]');
  const hint = container.querySelector('[data-conditions-hint]');
  if (!button || !hint) return;
  const legalBlocked =
    !state.cgvAccepted ||
    (state.waiverContext.requiresLegal && !state.legalAccepted) ||
    (state.waiverContext.requiresInstitut && !state.institutAccepted);
  button.disabled = Boolean(state.siteBlocked || legalBlocked);
  button.classList.toggle('is-waiver-blocked', legalBlocked && !state.siteBlocked);
  hint.hidden = !legalBlocked || state.siteBlocked;
}

function updateCartSummaryDisplay(container, state) {
  state.totals = computeCartTotals(state.entries, state.appliedGiftCards);
  const giftRow = container.querySelector('[data-summary-gift-row]');
  const giftDisplay = container.querySelector('[data-summary-gift]');
  const totalDisplay = container.querySelector('[data-summary-total]');
  const proceedButton = container.querySelector('[data-proceed]');
  if (giftRow && giftDisplay) {
    if (state.totals.giftCardUsed > 0) {
      giftRow.hidden = false;
      giftDisplay.textContent = `-${formatPrice(state.totals.giftCardUsed)}`;
    } else {
      giftRow.hidden = true;
    }
  }
  if (totalDisplay) totalDisplay.textContent = formatPrice(state.totals.remainingToPay);
  if (proceedButton && !state.siteBlocked) {
    proceedButton.textContent =
      state.totals.remainingToPay > 0
        ? `Proceder au paiement (${formatPrice(state.totals.remainingToPay)})`
        : 'Valider mon achat';
  }
  const list = container.querySelector('[data-applied-gift-list]');
  if (list) {
    if (!state.appliedGiftCards.length) {
      list.innerHTML = '<p class="module-placeholder">Aucune carte appliquée.</p>';
    } else {
      list.innerHTML = state.appliedGiftCards
        .map(
          entry => `
            <article class="checkoutp-gift-applied__item is-entering" data-code="${escapeHtml(entry.code)}">
              <div><strong>${escapeHtml(maskCode(entry.code))}</strong><p>${formatPrice(entry.amountUsed)}</p></div>
              <button type="button" class="checkoutp-gift-applied__remove" data-remove-card aria-label="Retirer"><i class="bi bi-trash"></i></button>
            </article>
          `
        )
        .join('');
    }
  }
  syncCartProceedButton(container, state);
}

async function runCartCheckout(container, context) {
  const user = context?.user || null;
  const rawItems = getItems(user);
  const selectedItems = rawItems.filter(item => item?.selected);
  if (!selectedItems.length) {
    renderStatus(container, 'Aucun article sélectionné. Retournez au panier pour sélectionner des articles.');
    return;
  }
  container.innerHTML = `<p class="module-placeholder">Chargement de votre commande...</p>`;
  try {
    const [siteStatus, ...entries] = await Promise.all([
      getSiteStatus(),
      ...selectedItems.map(cartItem => fetchCartEntry(cartItem))
    ]);
    const siteBlocked = isSiteBlockedForUser(siteStatus, user);
    const waiverContext = buildCartWaiverContext(entries);
    const state = {
      entries,
      siteBlocked,
      waiverContext,
      cgvAccepted: false,
      legalAccepted: false,
      institutAccepted: false,
      appliedGiftCards: [],
      totals: computeCartTotals(entries, []),
      flowOpen: false,
      step: 'code',
      pendingCard: null,
      pendingPassword: '',
      pendingAmount: 0
    };

    container.innerHTML = renderCartCheckoutMarkup(state);
    updateCartSummaryDisplay(container, state);

    const flowModal = container.querySelector('[data-gift-modal]');
    const stepCode = container.querySelector('[data-gift-step-code]');
    const stepPwd = container.querySelector('[data-gift-step-password]');
    const stepConfirm = container.querySelector('[data-gift-step-confirm]');
    const giftFeedback = container.querySelector('[data-gift-feedback]');
    const closeFlowButton = container.querySelector('[data-close-gift-flow]');
    const giftAmountInput = container.querySelector('[data-gift-amount]');
    const giftConfirmButton = container.querySelector('[data-gift-confirm]');
    const previewCardBefore = container.querySelector('[data-gift-preview-card-before]');
    const previewCardAfter = container.querySelector('[data-gift-preview-card-after]');
    const previewPayBefore = container.querySelector('[data-gift-preview-pay-before]');
    const previewPayAfter = container.querySelector('[data-gift-preview-pay-after]');

    const cartSyncFlow = () => {
      stepCode.hidden = state.step !== 'code';
      stepPwd.hidden = state.step !== 'password';
      stepConfirm.hidden = state.step !== 'confirm';
    };
    const setGiftFeedback = msg => { if (giftFeedback) giftFeedback.textContent = msg || ''; };
    const cartMaxGift = (code, balance) => {
      const sub = toAmount(state.totals.subtotal);
      const without = toAmount(
        state.appliedGiftCards
          .filter(e => normalizeCode(e.code) !== normalizeCode(code))
          .reduce((s, e) => s + toAmount(e.amountUsed), 0)
      );
      return toAmount(Math.min(toAmount(balance), sub - without));
    };
    const syncGiftPreview = () => {
      const max = cartMaxGift(state.pendingCard?.code, state.pendingCard?.balance);
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, Number(state.pendingAmount || 0))));
      if (giftAmountInput) {
        giftAmountInput.max = max.toFixed(2);
        giftAmountInput.value = state.pendingAmount.toFixed(2);
      }
      if (!state.pendingCard) {
        if (previewCardBefore) previewCardBefore.textContent = '';
        if (previewCardAfter) previewCardAfter.textContent = '';
        if (previewPayBefore) previewPayBefore.textContent = '';
        if (previewPayAfter) previewPayAfter.textContent = '';
        giftConfirmButton?.toggleAttribute('disabled', true);
        return;
      }
      const cardBefore = toAmount(state.pendingCard.balance);
      const cardAfter = toAmount(cardBefore - state.pendingAmount);
      const payBefore = toAmount(state.totals.remainingToPay);
      const payAfter = toAmount(Math.max(0, payBefore - state.pendingAmount));
      if (previewCardBefore) previewCardBefore.textContent = formatPrice(cardBefore);
      if (previewCardAfter) previewCardAfter.textContent = formatPrice(cardAfter);
      if (previewPayBefore) previewPayBefore.textContent = formatPrice(payBefore);
      if (previewPayAfter) previewPayAfter.textContent = formatPrice(payAfter);
      giftConfirmButton?.toggleAttribute('disabled', state.pendingAmount <= 0);
    };
    const resetFlowState = () => {
      state.step = 'code';
      state.pendingCard = null;
      state.pendingPassword = '';
      state.pendingAmount = 0;
      const codeInput = container.querySelector('[data-gift-code]');
      const passwordInput = container.querySelector('[data-gift-password]');
      if (codeInput) codeInput.value = '';
      if (passwordInput) passwordInput.value = '';
      setGiftFeedback('');
      cartSyncFlow();
      syncGiftPreview();
    };
    const closeGiftFlow = () => {
      state.flowOpen = false;
      if (!flowModal) return;
      flowModal.classList.remove('is-visible');
      flowModal.setAttribute('aria-hidden', 'true');
      flowModal.hidden = true;
    };
    const openGiftFlow = () => {
      state.flowOpen = true;
      resetFlowState();
      if (!flowModal) return;
      flowModal.hidden = false;
      flowModal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => { flowModal.classList.add('is-visible'); flowModal.focus(); });
    };

    const cartRunValidation = async (label, fn) => {
      const startedAt = Date.now();
      setInlineLoader(container, true, label);
      try { return await fn(); }
      finally {
        await waitMin(startedAt, VALIDATION_MIN_MS);
        if (container.isConnected) setInlineLoader(container, false, '');
      }
    };

    container.querySelectorAll('[data-open-gift-flow]').forEach(btn => btn.addEventListener('click', openGiftFlow));
    closeFlowButton?.addEventListener('click', closeGiftFlow);
    flowModal?.addEventListener('click', e => { if (e.target === flowModal) closeGiftFlow(); });
    flowModal?.addEventListener('keydown', e => { if (e.key === 'Escape') closeGiftFlow(); });

    container.querySelector('[data-gift-code-validate]')?.addEventListener('click', async () => {
      const code = container.querySelector('[data-gift-code]')?.value || '';
      if (!normalizeCode(code)) return setGiftFeedback('Veuillez saisir un code.');
      try {
        state.pendingCard = await cartRunValidation('Validation du code...', () => validateCode(code));
        state.step = 'password';
        cartSyncFlow();
        showToast({ type: 'success', message: 'Code valide', durationMs: 1000 });
      } catch (error) {
        setGiftFeedback(error.message || 'Code invalide.');
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      }
    });

    container.querySelector('[data-gift-password-validate]')?.addEventListener('click', async () => {
      const password = container.querySelector('[data-gift-password]')?.value || '';
      if (!state.pendingCard) return;
      if (!String(password).trim()) return setGiftFeedback('Veuillez saisir le mot de passe.');
      try {
        const validated = await cartRunValidation(
          'Validation du mot de passe...',
          () => validateCredentials(state.pendingCard.code, password)
        );
        state.pendingCard = validated;
        state.pendingPassword = String(password).trim();
        state.pendingAmount = cartMaxGift(validated.code, validated.balance);
        state.step = 'confirm';
        container.querySelector('[data-gift-confirm-title]').textContent =
          `Carte trouvée (${maskCode(validated.code)}) - utiliser combien ?`;
        cartSyncFlow();
        syncGiftPreview();
        showToast({ type: 'success', message: 'Mot de passe valide', durationMs: 1000 });
      } catch (error) {
        setGiftFeedback(error.message || 'Mot de passe invalide.');
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      }
    });

    const adjustAmount = delta => {
      if (!state.pendingCard) return;
      const max = cartMaxGift(state.pendingCard.code, state.pendingCard.balance);
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, state.pendingAmount + delta)));
      syncGiftPreview();
    };
    container.querySelector('[data-gift-minus]')?.addEventListener('click', () => adjustAmount(-10));
    container.querySelector('[data-gift-plus]')?.addEventListener('click', () => adjustAmount(10));
    giftAmountInput?.addEventListener('input', event => {
      const max = cartMaxGift(state.pendingCard?.code, state.pendingCard?.balance);
      const raw = String(event.currentTarget.value || '').replace(',', '.');
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, Number(raw || 0))));
      syncGiftPreview();
    });

    giftConfirmButton?.addEventListener('click', () => {
      if (!state.pendingCard || !state.pendingAmount) return setGiftFeedback('Montant invalide.');
      state.appliedGiftCards = state.appliedGiftCards
        .filter(e => normalizeCode(e.code) !== normalizeCode(state.pendingCard.code))
        .concat({
          giftCardId: state.pendingCard.id || '',
          code: normalizeCode(state.pendingCard.code),
          password: state.pendingPassword,
          amountUsed: toAmount(state.pendingAmount)
        });
      closeGiftFlow();
      resetFlowState();
      updateCartSummaryDisplay(container, state);
      showToast({ type: 'success', message: 'Carte appliquée', durationMs: 1000 });
    });

    container.addEventListener('click', event => {
      if (!event.target.closest('[data-remove-card]')) return;
      const row = event.target.closest('[data-code]');
      const code = row?.dataset.code;
      state.appliedGiftCards = state.appliedGiftCards.filter(e => normalizeCode(e.code) !== normalizeCode(code));
      updateCartSummaryDisplay(container, state);
      showToast({ type: 'info', message: 'Carte retirée', durationMs: 1000 });
    });

    container.querySelector('[data-cgv-info]')?.addEventListener('click', () => {
      requestVitrineNavigation('cgv', { source: 'cart-checkout-cgv-info', skipThrottle: true });
    });
    container.querySelector('[data-cgv-checkbox]')?.addEventListener('change', event => {
      state.cgvAccepted = Boolean(event.currentTarget.checked);
      if (state.cgvAccepted) setFeedback(container, '');
      syncCartProceedButton(container, state);
    });

    container.querySelector('[data-cart-waiver-checkbox="legal"]')?.addEventListener('change', event => {
      state.legalAccepted = Boolean(event.currentTarget.checked);
      if (state.legalAccepted) setFeedback(container, '');
      syncCartProceedButton(container, state);
    });
    container.querySelector('[data-cart-waiver-checkbox="institut"]')?.addEventListener('change', event => {
      state.institutAccepted = Boolean(event.currentTarget.checked);
      if (state.institutAccepted) setFeedback(container, '');
      syncCartProceedButton(container, state);
    });

    container.querySelector('[data-cart-waiver-info="legal"]')?.addEventListener('click', () => {
      openConsumerWaiverInfoModal({
        concernedCount: waiverContext.legalWaivers.length,
        concernedItems: waiverContext.legalWaivers.map(w => w.formationId)
      });
    });
    container.querySelector('[data-cart-waiver-info="institut"]')?.addEventListener('click', () => {
      openConsumerWaiverInfoModal({
        concernedCount: waiverContext.institutWaivers.length,
        concernedItems: waiverContext.institutWaivers.map(w => w.formationId)
      });
    });

    container.querySelector('[data-proceed]')?.addEventListener('click', async () => {
      if (state.siteBlocked) {
        setFeedback(container, SUSPENDED_PURCHASE_MESSAGE, 'error');
        return showToast({ type: 'error', message: 'Achats indisponibles', durationMs: 1000 });
      }
      if (!state.cgvAccepted) { flashLegalRequired(container, '[data-cgv-box]'); return; }
      if (state.waiverContext.requiresLegal && !state.legalAccepted) {
        flashLegalRequired(container, '[data-cart-waiver-box="legal"]'); return;
      }
      if (state.waiverContext.requiresInstitut && !state.institutAccepted) {
        flashLegalRequired(container, '[data-cart-waiver-box="institut"]'); return;
      }

      const acceptedAt = new Date().toISOString();
      const consumerWaivers = [];
      if (state.waiverContext.requiresLegal) {
        consumerWaivers.push({
          type: 'legal',
          text: state.waiverContext.legalWaivers[0]?.waiverText || DISTANT_LEARNING_WAIVER_TEXT,
          accepted: true,
          formationIds: state.waiverContext.legalWaivers.map(w => w.formationId)
        });
      }
      if (state.waiverContext.requiresInstitut) {
        consumerWaivers.push({
          type: 'institut',
          text: state.waiverContext.institutWaivers[0]?.waiverText || '',
          accepted: true,
          formationIds: state.waiverContext.institutWaivers.map(w => w.formationId)
        });
      }
      const refundPolicySnapshots = {};
      Object.entries(state.waiverContext.refundPolicySnapshots).forEach(([fid, snap]) => {
        refundPolicySnapshots[fid] = { ...snap, acceptedAt };
      });
      const cartItems = state.entries.map(e => ({
        type: e.cartItem.type,
        id: e.cartItem.id,
        name: e.detail?.name || e.cartItem.name || 'Article',
        sessionId: e.cartItem.sessionId || null,
        selectedOptions: Array.isArray(e.cartItem.selectedOptions) ? e.cartItem.selectedOptions : []
      }));
      state.totals = computeCartTotals(state.entries, state.appliedGiftCards);
      const checkoutState = buildCartCheckoutState(
        cartItems,
        state.appliedGiftCards,
        state.totals,
        consumerWaivers,
        refundPolicySnapshots,
        { acceptedCgv: true }
      );

      if (state.totals.remainingToPay > 0) {
        const token = createCheckoutStateToken(checkoutState);
        if (!token) return setFeedback(container, 'Impossible d ouvrir le paiement.', 'error');
        return requestVitrineNavigation('payment', {
          source: 'cart-checkout-payment',
          skipThrottle: true,
          query: { checkoutToken: token }
        });
      }

      const token = getOrCreateFreeCheckoutToken(state, checkoutState);
      if (!token) return setFeedback(container, 'Impossible d ouvrir le paiement.', 'error');
      return requestVitrineNavigation('payment', {
        source: 'cart-checkout-free',
        skipThrottle: true,
        query: { checkoutToken: token, freeCheckout: '1' }
      });
    });
  } catch (error) {
    console.error('Erreur checkout panier', error);
    renderStatus(container, 'Impossible de charger votre commande. Veuillez reessayer.');
  }
}

// ── Service checkout mode ────────────────────────────────────────────────────

function buildServiceCheckoutMarkup(state, slotDateLabel, slotTimeStart, slotTimeEnd) {
  const { service, effectivePrice, availableOptions, waiverRequired, waiverText, waiverType } = state;

  const optionsHtml = availableOptions.length ? `
    <article class="checkoutp-options" data-svc-options>
      <header class="checkoutp-options__header">
        <h3>Options</h3>
        <p>Ajoutez des options à votre prestation.</p>
      </header>
      <div class="checkoutp-options__list" data-svc-options-list>
        ${availableOptions.map(o => {
          const oid = escapeHtml(o.optionId);
          return `
            <article class="checkoutp-option-card" data-svc-option-card="${oid}">
              <input id="svc-opt-${oid}" class="checkoutp-option-card__input" type="checkbox"
                data-svc-option-checkbox data-option-id="${oid}">
              <label class="checkoutp-option-card__label" for="svc-opt-${oid}">
                <span class="checkoutp-option-card__check" aria-hidden="true">
                  <span class="checkoutp-option-card__check-icon"><i class="bi bi-check2"></i></span>
                </span>
                <span class="checkoutp-option-card__name">${escapeHtml(o.name)}</span>
                <span class="checkoutp-option-card__meta">
                  <strong class="checkoutp-option-card__price">+${formatPrice(o.price)}</strong>
                </span>
              </label>
            </article>
          `;
        }).join('')}
      </div>
    </article>
  ` : '';

  const cancellationDays = service?.cancellationDays || 7;
  const waiverHtml = `
    <div data-svc-waiver-section${!waiverRequired ? ' hidden' : ''}>
      <div class="checkout-waiver-box" data-waiver-box>
        <label class="checkout-waiver-box__label">
          <input class="checkout-waiver-box__checkbox-input" type="checkbox" data-waiver-checkbox>
          <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true"><i class="bi bi-check2"></i></span>
          <span data-waiver-label>${escapeHtml(waiverText)}</span>
        </label>
      </div>
      <p class="checkout-waiver-legal-note" data-svc-waiver-note${waiverType !== 'legal' ? ' hidden' : ''}>
        <i class="bi bi-info-circle"></i>
        Vous conservez néanmoins la possibilité d'annuler gratuitement jusqu'à ${cancellationDays} jour(s) avant votre prestation.
      </p>
    </div>
  `;

  return `
    <section class="checkoutp" data-checkout-panel>
      <header class="checkoutp__header">
        <h2>Finaliser la réservation</h2>
        <p>Vérifiez votre créneau puis finalisez votre réservation.</p>
      </header>

      <div class="checkoutp-service-header">
        <div class="checkoutp-service-header__info">
          <h2 class="checkoutp-service-header__name">${escapeHtml(service.name)}</h2>
          <div class="checkoutp-service-header__meta">
            <span class="checkoutp-service-header__meta-item">
              <i class="bi bi-calendar3" aria-hidden="true"></i>
              <span data-svc-slot-date>${escapeHtml(slotDateLabel)}</span>
            </span>
            <span class="checkoutp-service-header__meta-item">
              <i class="bi bi-clock" aria-hidden="true"></i>
              <span data-svc-slot-time>${escapeHtml(slotTimeStart)} → ${escapeHtml(slotTimeEnd)}</span>
            </span>
          </div>
        </div>
        <button type="button" class="checkoutp-service-header__modify" data-svc-modify-slot>
          <i class="bi bi-pencil" aria-hidden="true"></i>
          <span>Modifier</span>
        </button>
      </div>

      <article class="checkoutp-summary">
        <div class="checkoutp-summary__row">
          <span>${escapeHtml(service.name)}</span>
          <strong data-svc-summary-base>${formatPrice(effectivePrice)}</strong>
        </div>
        <div data-svc-summary-options></div>
        <div class="checkoutp-summary__divider" data-svc-deposit-divider hidden></div>
        <div class="checkoutp-summary__row" data-svc-deposit-row hidden>
          <span>Acompte à régler maintenant</span><strong data-svc-deposit-val></strong>
        </div>
        <div class="checkoutp-summary__row" data-svc-gift-row hidden>
          <span>Carte cadeau</span><strong data-svc-gift-val></strong>
        </div>
        <div class="checkoutp-summary__divider"></div>
        <div class="checkoutp-summary__row checkoutp-summary__row--total">
          <span data-svc-total-label>Total</span><strong data-svc-total>${formatPrice(effectivePrice)}</strong>
        </div>
      </article>
      <p class="checkoutp-deposit-info" data-svc-deposit-info hidden>
        <i class="bi bi-info-circle" aria-hidden="true"></i>
        Il restera <strong data-svc-remaining-val></strong> à régler directement auprès de l'institut le jour de la prestation.
      </p>

      ${optionsHtml}

      <article class="checkoutp-gift-applied">
        <span class="checkoutp-gift-applied__decor" aria-hidden="true"><i class="bi bi-gift-fill"></i></span>
        <header>
          <h3>Cartes cadeaux appliquées</h3>
          <button type="button" class="checkoutp-gift-applied__add" data-open-gift-flow>Ajouter une carte</button>
        </header>
        <div data-applied-gift-list><p class="module-placeholder">Aucune carte appliquée.</p></div>
      </article>

      <div class="checkoutp-gift-modal" data-gift-modal hidden tabindex="-1" aria-hidden="true">
        <article class="checkoutp-gift-flow" data-gift-flow role="dialog" aria-modal="true" aria-label="Utiliser une carte cadeau">
          <header class="checkoutp-gift-flow__header">
            <h3>Utiliser une carte cadeau</h3>
            <button type="button" class="checkoutp-gift-flow__close" data-close-gift-flow aria-label="Fermer">&times;</button>
          </header>
          <div data-gift-step-code>
            <label>Code<input data-gift-code class="gcg-minimal-input" maxlength="32" placeholder="XXXX-XXXX"></label>
            <button type="button" class="secondary-button" data-gift-code-validate>Valider le code</button>
          </div>
          <div data-gift-step-password hidden>
            <label>Mot de passe<input type="password" data-gift-password class="gcg-minimal-input" placeholder="Mot de passe"></label>
            <button type="button" class="secondary-button" data-gift-password-validate>Valider le mot de passe</button>
          </div>
          <div data-gift-step-confirm hidden>
            <p data-gift-confirm-title></p>
            <div class="checkoutp-gift-flow__amount-shell">
              <button type="button" class="checkoutp-gift-flow__amount-btn" data-gift-minus aria-label="Diminuer"><i class="bi bi-dash-lg"></i></button>
              <div class="checkoutp-gift-flow__amount-box">
                <input type="number" data-gift-amount class="checkoutp-gift-flow__amount-input" step="10" inputmode="decimal" aria-label="Montant">
              </div>
              <button type="button" class="checkoutp-gift-flow__amount-btn" data-gift-plus aria-label="Augmenter"><i class="bi bi-plus-lg"></i></button>
            </div>
            <div class="checkoutp-gift-flow__preview">
              <article class="checkoutp-gift-flow__preview-card">
                <small>Sur la carte après débit</small>
                <p><span class="checkoutp-gift-flow__preview-old" data-gift-preview-card-before></span><strong data-gift-preview-card-after></strong></p>
              </article>
              <article class="checkoutp-gift-flow__preview-card">
                <small>Reste à payer après débit</small>
                <p><span class="checkoutp-gift-flow__preview-old" data-gift-preview-pay-before></span><strong data-gift-preview-pay-after></strong></p>
              </article>
            </div>
            <button type="button" class="primary-button" data-gift-confirm>Confirmer l utilisation</button>
          </div>
          <p class="muted" data-gift-feedback></p>
        </article>
      </div>

      <div class="checkoutp-legal">
        <div class="checkout-waiver-box" data-cgv-box>
          <label class="checkout-waiver-box__label">
            <input class="checkout-waiver-box__checkbox-input" type="checkbox" data-cgv-checkbox>
            <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true"><i class="bi bi-check2"></i></span>
            <span>${escapeHtml(CHECKOUT_CGV_TEXT)}</span>
          </label>
          <button type="button" class="checkout-waiver-box__info" data-cgv-info>
            plus d informations <i class="bi bi-link-45deg" aria-hidden="true"></i>
          </button>
        </div>
        ${waiverHtml}
      </div>

      <p class="form-message" data-checkout-feedback></p>
      <div class="checkoutp__actions">
        <button type="button" class="primary-button" data-proceed ${state.siteBlocked ? 'disabled' : ''}></button>
      </div>
      <p class="checkoutp__blocked-hint muted" data-conditions-hint hidden>${CONDITIONS_REQUIRED_MESSAGE}</p>
      ${state.siteBlocked ? `<p class="muted">${escapeHtml(SUSPENDED_PURCHASE_MESSAGE)}</p>` : ''}
      <div data-checkout-inline-loader hidden></div>
    </section>
  `;
}

function updateServiceSummary(container, state) {
  const paymentType = state.service?.paymentType || 'full';
  const depositType = state.service?.depositType || 'percentage';
  const depositValue = Number(state.service?.depositValue || 0);

  const optionsTotal = toAmount(state.selectedOptions.reduce((s, o) => s + o.price, 0));
  const subtotal = toAmount(state.effectivePrice + optionsTotal);

  let depositAmount = 0;
  if (paymentType === 'deposit') {
    depositAmount = depositType === 'percentage'
      ? toAmount(Math.round(subtotal * depositValue / 100 * 100) / 100)
      : toAmount(Math.min(depositValue, subtotal));
  }

  // Gift card is capped at the amount actually due now (deposit or full subtotal)
  const baseForPayment = paymentType === 'deposit' ? depositAmount : subtotal;
  const giftCardUsed = toAmount(
    Math.min(baseForPayment, state.appliedGiftCards.reduce((s, gc) => s + toAmount(gc.amountUsed), 0))
  );

  const amountToPay = toAmount(Math.max(0, baseForPayment - giftCardUsed));
  const remainingOnSite = paymentType === 'deposit' ? toAmount(subtotal - depositAmount) : 0;

  state.totals = {
    basePrice: state.effectivePrice,
    optionsTotal,
    subtotal,
    giftCardUsed,
    depositAmount,
    amountToPay,
    remainingOnSite,
    totalAmount: toAmount(subtotal - giftCardUsed)
  };

  const isDeposit = paymentType === 'deposit';

  const optionsContainer = container.querySelector('[data-svc-summary-options]');
  if (optionsContainer) {
    optionsContainer.innerHTML = state.selectedOptions
      .map(o => `<div class="checkoutp-summary__row"><span>${escapeHtml(o.name)}</span><strong>+${formatPrice(o.price)}</strong></div>`)
      .join('');
  }

  // In deposit mode: hide the service base price, show deposit amount row instead
  const basePriceEl = container.querySelector('[data-svc-summary-base]');
  if (basePriceEl) basePriceEl.hidden = isDeposit;
  const depositDivider = container.querySelector('[data-svc-deposit-divider]');
  if (depositDivider) depositDivider.hidden = !isDeposit;
  const depositRow = container.querySelector('[data-svc-deposit-row]');
  const depositValEl = container.querySelector('[data-svc-deposit-val]');
  if (depositRow) depositRow.hidden = !isDeposit;
  if (depositValEl) depositValEl.textContent = formatPrice(depositAmount);

  // Gift card row
  const giftRow = container.querySelector('[data-svc-gift-row]');
  const giftVal = container.querySelector('[data-svc-gift-val]');
  if (giftRow && giftVal) {
    giftRow.hidden = giftCardUsed <= 0;
    giftVal.textContent = giftCardUsed > 0 ? `-${formatPrice(giftCardUsed)}` : '';
  }

  // Total row
  const totalLabelEl = container.querySelector('[data-svc-total-label]');
  const totalEl = container.querySelector('[data-svc-total]');
  if (totalLabelEl) totalLabelEl.textContent = isDeposit ? 'Total dû maintenant' : 'Total';
  if (totalEl) totalEl.textContent = formatPrice(amountToPay);

  // Info note: "Il restera X € à régler sur place"
  const depositInfoEl = container.querySelector('[data-svc-deposit-info]');
  const remainingValEl = container.querySelector('[data-svc-remaining-val]');
  if (depositInfoEl) depositInfoEl.hidden = !isDeposit || remainingOnSite <= 0;
  if (remainingValEl) remainingValEl.textContent = formatPrice(remainingOnSite);

  // Focus price (eyebrow) — show amount due now
  const priceEl = container.querySelector('[data-svc-price]');
  if (priceEl) priceEl.textContent = formatPrice(amountToPay);

  const list = container.querySelector('[data-applied-gift-list]');
  if (list) {
    if (!state.appliedGiftCards.length) {
      list.innerHTML = '<p class="module-placeholder">Aucune carte appliquée.</p>';
    } else {
      list.innerHTML = state.appliedGiftCards
        .map(entry => `
          <article class="checkoutp-gift-applied__item is-entering" data-code="${escapeHtml(entry.code)}">
            <div><strong>${escapeHtml(maskCode(entry.code))}</strong><p>${formatPrice(entry.amountUsed)}</p></div>
            <button type="button" class="checkoutp-gift-applied__remove" data-remove-card aria-label="Retirer"><i class="bi bi-trash"></i></button>
          </article>
        `).join('');
    }
  }

  const proceedBtn = container.querySelector('[data-proceed]');
  if (proceedBtn && !state.siteBlocked) {
    proceedBtn.textContent = amountToPay > 0
      ? `Payer ${formatPrice(amountToPay)}`
      : 'Confirmer la réservation';
  }
  syncServiceProceedButton(container, state);
}

function syncServiceProceedButton(container, state) {
  const button = container.querySelector('[data-proceed]');
  const hint = container.querySelector('[data-conditions-hint]');
  if (!button || !hint) return;
  const legalBlocked = !state.cgvAccepted || (state.waiverRequired && !state.waiverAccepted);
  button.disabled = Boolean(state.siteBlocked || legalBlocked);
  button.classList.toggle('is-waiver-blocked', legalBlocked && !state.siteBlocked);
  hint.hidden = !legalBlocked || state.siteBlocked;
}

function computeServiceWaiver(slotStart, service) {
  const slotMs = new Date(slotStart).getTime();
  const daysBeforeService = (slotMs - Date.now()) / (1000 * 60 * 60 * 24);
  const cancellationDays = service.cancellationDays || 7;
  const legalNeeded = daysBeforeService < 14;
  const institutNeeded = daysBeforeService < cancellationDays;
  let waiverType = null;
  if (legalNeeded && institutNeeded) waiverType = 'both';
  else if (legalNeeded) waiverType = 'legal';
  else if (institutNeeded) waiverType = 'institut';
  const waiverRequired = waiverType !== null;
  const waiverText = waiverType === 'legal'
    ? `Je renonce à mon droit de rétractation légal de 14 jours pour cette prestation.`
    : waiverType === 'both'
      ? `Je renonce à mon droit de rétractation légal et au délai d'annulation gratuit de ${cancellationDays} jours.`
      : waiverType === 'institut'
        ? `Je renonce au délai d'annulation gratuit de ${cancellationDays} jour(s).`
        : '';
  return { waiverType, waiverRequired, waiverText };
}

function buildSlotLabels(slotStart, slotEnd) {
  const pad2 = n => String(n).padStart(2, '0');
  const slotDate = new Date(slotStart);
  const slotDateLabel = slotDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const slotTimeStart = `${pad2(slotDate.getHours())}:${pad2(slotDate.getMinutes())}`;
  const slotEndDate = new Date(slotEnd);
  const slotTimeEnd = `${pad2(slotEndDate.getHours())}:${pad2(slotEndDate.getMinutes())}`;
  return { slotDateLabel, slotTimeStart, slotTimeEnd };
}

function syncServiceSlotDisplay(container, state) {
  const { slotDateLabel, slotTimeStart, slotTimeEnd } = buildSlotLabels(state.slotStart, state.slotEnd);
  const dateEl = container.querySelector('[data-svc-slot-date]');
  const timeEl = container.querySelector('[data-svc-slot-time]');
  if (dateEl) dateEl.textContent = slotDateLabel;
  if (timeEl) timeEl.textContent = `${slotTimeStart} → ${slotTimeEnd}`;
}

function syncServiceWaiverUI(container, state) {
  const section = container.querySelector('[data-svc-waiver-section]');
  if (!section) return;
  section.hidden = !state.waiverRequired;
  const labelEl = section.querySelector('[data-waiver-label]');
  const checkbox = section.querySelector('[data-waiver-checkbox]');
  const noteEl = section.querySelector('[data-svc-waiver-note]');
  if (labelEl) labelEl.textContent = state.waiverText;
  if (checkbox) checkbox.checked = state.waiverAccepted;
  if (noteEl) noteEl.hidden = state.waiverType !== 'legal';
}

function openServiceSlotCalendarModal(container, state, service, onUpdated) {
  const modal = document.createElement('div');
  modal.className = 'checkout-session-calendar-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Modifier le créneau');
  modal.innerHTML = `
    <div class="checkout-session-calendar-modal__inner">
      <header class="checkout-session-calendar-modal__header">
        <h4>Modifier le créneau</h4>
        <button type="button" data-close-slot-modal aria-label="Fermer">&times;</button>
      </header>
      <div class="checkout-session-calendar-modal__body" data-slot-calendar-body></div>
      <div class="checkout-session-calendar-modal__footer">
        <button type="button" class="primary-button" data-confirm-slot disabled>Confirmer ce créneau</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let pendingSlot = null;

  const calendar = createBookingCalendar({
    mode: 'service',
    serviceId: String(service.id || service._id || ''),
    leadDays: service.bookingLeadDays || 0,
    onSlotSelected: (slot) => {
      pendingSlot = slot;
      const confirmBtn = modal.querySelector('[data-confirm-slot]');
      if (confirmBtn) confirmBtn.disabled = false;
    }
  });
  calendar.mount(modal.querySelector('[data-slot-calendar-body]'));

  const close = () => {
    calendar.destroy();
    modal.remove();
  };

  modal.querySelector('[data-close-slot-modal]').addEventListener('click', close);
  modal.addEventListener('click', event => {
    if (event.target === modal) close();
  });

  modal.querySelector('[data-confirm-slot]').addEventListener('click', () => {
    if (!pendingSlot) return;
    state.slotStart = pendingSlot.start;
    state.slotEnd = pendingSlot.end;
    if (pendingSlot.practitionerId) state.practitionerId = pendingSlot.practitionerId;
    const previousWaiverType = state.waiverType;
    const waiver = computeServiceWaiver(state.slotStart, service);
    state.waiverType = waiver.waiverType;
    state.waiverRequired = waiver.waiverRequired;
    state.waiverText = waiver.waiverText;
    if (previousWaiverType !== state.waiverType) {
      state.waiverAccepted = false;
    }
    close();
    onUpdated();
  });
}

async function runServiceCheckout(container, context, { serviceSlug, slotStart, slotEnd, practitionerId }) {
  container.innerHTML = '<p class="module-placeholder">Chargement de la prestation...</p>';

  // Vérification suspension avant d'afficher quoi que ce soit
  if (context?.user) {
    try {
      const suspRes = await fetch('/api/client/me/booking-status', { credentials: 'include', cache: 'no-store' });
      const suspData = await suspRes.json();
      if (suspData.bookingSuspended) {
        container.innerHTML = `
          <div class="checkout-suspended-notice">
            <i class="bi bi-exclamation-triangle-fill"></i>
            <h2>Compte suspendu</h2>
            <p>Votre compte est temporairement suspendu suite à des absences non signalées. Contactez l'institut pour régulariser votre situation.</p>
          </div>
        `;
        return;
      }
    } catch (_) {
      // Non bloquant
    }
  }

  try {
    const [siteStatus, serviceRes] = await Promise.all([
      getSiteStatus(),
      fetch(`/api/vitrine/services/${encodeURIComponent(serviceSlug)}`, { credentials: 'include' })
    ]);

    if (!serviceRes.ok) {
      const errData = await serviceRes.json().catch(() => ({}));
      return renderStatus(container, errData.error || 'Prestation introuvable.');
    }
    const { service } = await serviceRes.json();
    if (!service) return renderStatus(container, 'Prestation introuvable.');

    const siteBlocked = isSiteBlockedForUser(siteStatus, context.user);
    const effectivePrice = toAmount(service.effectivePrice ?? service.price);

    const availableOptions = (service.options || [])
      .filter(o => o.isActive !== false)
      .map(o => ({
        optionId: String(o.id || o._id || '').trim(),
        name: String(o.name || '').trim(),
        description: String(o.description || '').trim(),
        price: toAmount(o.price || 0)
      }))
      .filter(o => o.optionId);

    // Waiver computation
    const { waiverType, waiverRequired, waiverText } = computeServiceWaiver(slotStart, service);

    // Slot labels
    const { slotDateLabel, slotTimeStart, slotTimeEnd } = buildSlotLabels(slotStart, slotEnd);

    const state = {
      siteBlocked,
      service,
      effectivePrice,
      availableOptions,
      selectedOptions: [],
      slotStart,
      slotEnd,
      practitionerId,
      waiverType,
      waiverRequired,
      waiverText,
      cgvAccepted: false,
      waiverAccepted: false,
      appliedGiftCards: [],
      totals: { basePrice: effectivePrice, optionsTotal: 0, subtotal: effectivePrice, giftCardUsed: 0, depositAmount: 0, amountToPay: effectivePrice, remainingOnSite: 0, totalAmount: effectivePrice },
      flowOpen: false,
      step: 'code',
      pendingCard: null,
      pendingPassword: '',
      pendingAmount: 0
    };

    container.innerHTML = buildServiceCheckoutMarkup(state, slotDateLabel, slotTimeStart, slotTimeEnd);
    updateServiceSummary(container, state);

    // ── Gift card flow ─────────────────────────────────────────────────────
    const flowModal = container.querySelector('[data-gift-modal]');
    const stepCode = container.querySelector('[data-gift-step-code]');
    const stepPwd = container.querySelector('[data-gift-step-password]');
    const stepConfirm = container.querySelector('[data-gift-step-confirm]');
    const giftFeedback = container.querySelector('[data-gift-feedback]');
    const closeFlowButton = container.querySelector('[data-close-gift-flow]');
    const giftAmountInput = container.querySelector('[data-gift-amount]');
    const giftConfirmButton = container.querySelector('[data-gift-confirm]');
    const previewCardBefore = container.querySelector('[data-gift-preview-card-before]');
    const previewCardAfter = container.querySelector('[data-gift-preview-card-after]');
    const previewPayBefore = container.querySelector('[data-gift-preview-pay-before]');
    const previewPayAfter = container.querySelector('[data-gift-preview-pay-after]');

    const svcSyncFlow = () => {
      stepCode.hidden = state.step !== 'code';
      stepPwd.hidden = state.step !== 'password';
      stepConfirm.hidden = state.step !== 'confirm';
    };
    const setGiftFeedback = msg => { if (giftFeedback) giftFeedback.textContent = msg || ''; };
    const svcMaxGift = (code, balance) => {
      // Cap at depositAmount for deposit payments, subtotal for full payments
      const baseForPayment = (state.service?.paymentType === 'deposit')
        ? toAmount(state.totals.depositAmount)
        : toAmount(state.totals.subtotal);
      const without = toAmount(
        state.appliedGiftCards
          .filter(e => normalizeCode(e.code) !== normalizeCode(code))
          .reduce((s, e) => s + toAmount(e.amountUsed), 0)
      );
      return toAmount(Math.min(toAmount(balance), baseForPayment - without));
    };
    const syncGiftPreview = () => {
      const max = svcMaxGift(state.pendingCard?.code, state.pendingCard?.balance);
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, Number(state.pendingAmount || 0))));
      if (giftAmountInput) { giftAmountInput.max = max.toFixed(2); giftAmountInput.value = state.pendingAmount.toFixed(2); }
      if (!state.pendingCard) {
        if (previewCardBefore) previewCardBefore.textContent = '';
        if (previewCardAfter) previewCardAfter.textContent = '';
        if (previewPayBefore) previewPayBefore.textContent = '';
        if (previewPayAfter) previewPayAfter.textContent = '';
        giftConfirmButton?.toggleAttribute('disabled', true);
        return;
      }
      const cardBefore = toAmount(state.pendingCard.balance);
      const cardAfter = toAmount(cardBefore - state.pendingAmount);
      const payBefore = toAmount(state.totals.amountToPay);
      const payAfter = toAmount(Math.max(0, payBefore - state.pendingAmount));
      if (previewCardBefore) previewCardBefore.textContent = formatPrice(cardBefore);
      if (previewCardAfter) previewCardAfter.textContent = formatPrice(cardAfter);
      if (previewPayBefore) previewPayBefore.textContent = formatPrice(payBefore);
      if (previewPayAfter) previewPayAfter.textContent = formatPrice(payAfter);
      giftConfirmButton?.toggleAttribute('disabled', state.pendingAmount <= 0);
    };
    const resetFlowState = () => {
      state.step = 'code';
      state.pendingCard = null;
      state.pendingPassword = '';
      state.pendingAmount = 0;
      const ci = container.querySelector('[data-gift-code]');
      const pi = container.querySelector('[data-gift-password]');
      if (ci) ci.value = '';
      if (pi) pi.value = '';
      setGiftFeedback('');
      svcSyncFlow();
      syncGiftPreview();
    };
    const closeGiftFlow = () => {
      state.flowOpen = false;
      if (!flowModal) return;
      flowModal.classList.remove('is-visible');
      flowModal.setAttribute('aria-hidden', 'true');
      flowModal.hidden = true;
    };
    const openGiftFlow = () => {
      state.flowOpen = true;
      resetFlowState();
      if (!flowModal) return;
      flowModal.hidden = false;
      flowModal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => { flowModal.classList.add('is-visible'); flowModal.focus(); });
    };
    const svcRunValidation = async (label, fn) => {
      const startedAt = Date.now();
      setInlineLoader(container, true, label);
      try { return await fn(); }
      finally {
        await waitMin(startedAt, VALIDATION_MIN_MS);
        if (container.isConnected) setInlineLoader(container, false, '');
      }
    };

    container.querySelectorAll('[data-open-gift-flow]').forEach(btn => btn.addEventListener('click', openGiftFlow));
    closeFlowButton?.addEventListener('click', closeGiftFlow);
    flowModal?.addEventListener('click', e => { if (e.target === flowModal) closeGiftFlow(); });
    flowModal?.addEventListener('keydown', e => { if (e.key === 'Escape') closeGiftFlow(); });

    container.querySelector('[data-gift-code-validate]')?.addEventListener('click', async () => {
      const code = container.querySelector('[data-gift-code]')?.value || '';
      if (!normalizeCode(code)) return setGiftFeedback('Veuillez saisir un code.');
      try {
        state.pendingCard = await svcRunValidation('Validation du code...', () => validateCode(code));
        state.step = 'password';
        svcSyncFlow();
        showToast({ type: 'success', message: 'Code valide', durationMs: 1000 });
      } catch (error) {
        setGiftFeedback(error.message || 'Code invalide.');
        showToast({ type: 'error', message: 'Échec', durationMs: 1000 });
      }
    });

    container.querySelector('[data-gift-password-validate]')?.addEventListener('click', async () => {
      const password = container.querySelector('[data-gift-password]')?.value || '';
      if (!state.pendingCard) return;
      if (!String(password).trim()) return setGiftFeedback('Veuillez saisir le mot de passe.');
      try {
        const validated = await svcRunValidation('Validation du mot de passe...', () => validateCredentials(state.pendingCard.code, password));
        state.pendingCard = validated;
        state.pendingPassword = String(password).trim();
        state.pendingAmount = svcMaxGift(validated.code, validated.balance);
        state.step = 'confirm';
        container.querySelector('[data-gift-confirm-title]').textContent = `Carte trouvée (${maskCode(validated.code)}) - utiliser combien ?`;
        svcSyncFlow();
        syncGiftPreview();
        showToast({ type: 'success', message: 'Mot de passe valide', durationMs: 1000 });
      } catch (error) {
        setGiftFeedback(error.message || 'Mot de passe invalide.');
        showToast({ type: 'error', message: 'Échec', durationMs: 1000 });
      }
    });

    const adjustAmount = delta => {
      if (!state.pendingCard) return;
      const max = svcMaxGift(state.pendingCard.code, state.pendingCard.balance);
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, state.pendingAmount + delta)));
      syncGiftPreview();
    };
    container.querySelector('[data-gift-minus]')?.addEventListener('click', () => adjustAmount(-10));
    container.querySelector('[data-gift-plus]')?.addEventListener('click', () => adjustAmount(10));
    giftAmountInput?.addEventListener('input', event => {
      const max = svcMaxGift(state.pendingCard?.code, state.pendingCard?.balance);
      const raw = String(event.currentTarget.value || '').replace(',', '.');
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, Number(raw || 0))));
      syncGiftPreview();
    });

    giftConfirmButton?.addEventListener('click', () => {
      if (!state.pendingCard || !state.pendingAmount) return setGiftFeedback('Montant invalide.');
      state.appliedGiftCards = state.appliedGiftCards
        .filter(e => normalizeCode(e.code) !== normalizeCode(state.pendingCard.code))
        .concat({
          giftCardId: state.pendingCard.id || '',
          code: normalizeCode(state.pendingCard.code),
          password: state.pendingPassword,
          amountUsed: toAmount(state.pendingAmount)
        });
      closeGiftFlow();
      resetFlowState();
      updateServiceSummary(container, state);
      showToast({ type: 'success', message: 'Carte appliquée', durationMs: 1000 });
    });

    container.addEventListener('click', event => {
      if (!event.target.closest('[data-remove-card]')) return;
      const row = event.target.closest('[data-code]');
      const code = row?.dataset.code;
      state.appliedGiftCards = state.appliedGiftCards.filter(e => normalizeCode(e.code) !== normalizeCode(code));
      updateServiceSummary(container, state);
      showToast({ type: 'info', message: 'Carte retirée', durationMs: 1000 });
    });

    // ── Options ────────────────────────────────────────────────────────────
    container.addEventListener('change', event => {
      const cb = event.target.closest('[data-svc-option-checkbox]');
      if (!cb) return;
      const optionId = String(cb.dataset.optionId || '').trim();
      const option = state.availableOptions.find(o => o.optionId === optionId);
      if (!option) { cb.checked = false; return; }
      if (cb.checked) {
        if (!state.selectedOptions.some(o => o.optionId === optionId)) {
          state.selectedOptions.push({ optionId: option.optionId, name: option.name, price: option.price });
        }
      } else {
        state.selectedOptions = state.selectedOptions.filter(o => o.optionId !== optionId);
      }
      cb.closest('[data-svc-option-card]')?.classList.toggle('is-selected', cb.checked);
      updateServiceSummary(container, state);
    });

    // ── Legal ──────────────────────────────────────────────────────────────
    container.querySelector('[data-cgv-info]')?.addEventListener('click', () => {
      requestVitrineNavigation('cgv', { source: 'service-checkout-cgv-info', skipThrottle: true });
    });
    container.querySelector('[data-cgv-checkbox]')?.addEventListener('change', event => {
      state.cgvAccepted = Boolean(event.currentTarget.checked);
      if (state.cgvAccepted) setFeedback(container, '');
      syncServiceProceedButton(container, state);
    });
    container.querySelector('[data-waiver-checkbox]')?.addEventListener('change', event => {
      state.waiverAccepted = Boolean(event.currentTarget.checked);
      if (state.waiverAccepted) setFeedback(container, '');
      syncServiceProceedButton(container, state);
    });

    // ── Modify slot ────────────────────────────────────────────────────────
    container.querySelector('[data-svc-modify-slot]')?.addEventListener('click', () => {
      openServiceSlotCalendarModal(container, state, service, () => {
        syncServiceSlotDisplay(container, state);
        syncServiceWaiverUI(container, state);
        updateServiceSummary(container, state);
      });
    });

    // ── Proceed ────────────────────────────────────────────────────────────
    container.querySelector('[data-proceed]')?.addEventListener('click', async () => {
      if (state.siteBlocked) {
        setFeedback(container, SUSPENDED_PURCHASE_MESSAGE, 'error');
        return showToast({ type: 'error', message: 'Achats indisponibles', durationMs: 1000 });
      }
      if (!state.cgvAccepted) { flashLegalRequired(container, '[data-cgv-box]'); return; }
      if (state.waiverRequired && !state.waiverAccepted) { flashLegalRequired(container, '[data-waiver-box]'); return; }

      updateServiceSummary(container, state);

      const waiverAcceptedAt = state.waiverRequired && state.waiverAccepted ? new Date().toISOString() : null;
      const normalizedGiftCards = state.appliedGiftCards.map(gc => ({
        giftCardId: gc.giftCardId || '',
        code: gc.code,
        password: gc.password,
        amount: toAmount(gc.amountUsed)
      }));

      const checkoutState = {
        version: 1,
        createdAt: new Date().toISOString(),
        itemType: 'service',
        item: { type: 'service', id: service.id, name: service.name },
        service: {
          serviceId: service.id,
          slotStart: state.slotStart,
          slotEnd: state.slotEnd,
          practitionerId: state.practitionerId || null,
          selectedOptions: state.selectedOptions.map(o => ({ optionId: o.optionId, name: o.name, price: o.price }))
        },
        paymentType: state.service?.paymentType || 'full',
        depositAmount: state.totals.depositAmount,
        appliedGiftCards: normalizedGiftCards,
        totals: {
          basePrice: state.totals.basePrice,
          optionsTotal: state.totals.optionsTotal,
          subtotal: state.totals.subtotal,
          giftCardUsed: state.totals.giftCardUsed,
          depositAmount: state.totals.depositAmount,
          amountToPay: state.totals.amountToPay,
          remainingOnSite: state.totals.remainingOnSite,
          totalAmount: state.totals.totalAmount
        },
        legal: {
          acceptedCgv: true,
          waiverRequired: state.waiverRequired,
          waiverAccepted: state.waiverAccepted,
          waiverType: state.waiverType,
          waiverText: state.waiverText,
          waiverAcceptedAt
        },
        origin: {
          slug: 'checkout',
          query: {
            serviceSlug,
            slotStart: state.slotStart,
            slotEnd: state.slotEnd,
            practitionerId: state.practitionerId || ''
          }
        },
        paymentProvider: 'stripe'
      };

      if (state.totals.amountToPay > 0) {
        const token = createCheckoutStateToken(checkoutState);
        if (!token) return setFeedback(container, 'Impossible d\'ouvrir le paiement.', 'error');
        return requestVitrineNavigation('payment', {
          source: 'service-checkout-payment',
          skipThrottle: true,
          query: { checkoutToken: token }
        });
      }

      // Free service → finalize directly
      const token = getOrCreateFreeCheckoutToken(state, checkoutState);
      if (!token) return setFeedback(container, 'Impossible d\'ouvrir le paiement.', 'error');
      return requestVitrineNavigation('payment', {
        source: 'service-checkout-free',
        skipThrottle: true,
        query: { checkoutToken: token, freeCheckout: '1' }
      });
    });

  } catch (error) {
    console.error('Erreur service checkout', error);
    renderStatus(container, 'Impossible de charger le checkout.');
  }
}

// ── Single-item checkout ─────────────────────────────────────────────────────

export async function renderPage(container, context = {}) {
  const params = new URLSearchParams(window.location.search);
  const query = { ...context.query };
  Object.keys(query).forEach(key => (query[key] = String(query[key] || '')));

  // Mode panier : cart=true
  const isCartMode = String(query.cart || params.get('cart') || '').toLowerCase() === 'true';
  if (isCartMode) return runCartCheckout(container, context);

  // Mode prestation : serviceSlug présent
  const serviceSlug = query.serviceSlug || params.get('serviceSlug') || '';
  if (serviceSlug) {
    const slotStart = query.slotStart || params.get('slotStart') || '';
    const slotEnd = query.slotEnd || params.get('slotEnd') || '';
    const practitionerId = query.practitionerId || params.get('practitionerId') || '';
    if (!slotStart || !slotEnd) return renderStatus(container, 'Créneau manquant pour la réservation.');
    return runServiceCheckout(container, context, { serviceSlug, slotStart, slotEnd, practitionerId });
  }

  const itemType = (query.type || params.get('type') || 'formation').toLowerCase() === 'product' ? 'product' : 'formation';
  const itemId = query.id || params.get('id') || '';
  if (!itemId) return renderStatus(container, "Article manquant dans l URL.");

  container.innerHTML = '<p class="module-placeholder">Chargement du checkout...</p>';

  let pendingSelectedOptions = [];
  try {
    const rawPending = sessionStorage.getItem('beautysavage_pending_options');
    if (rawPending) {
      sessionStorage.removeItem('beautysavage_pending_options');
      const parsed = JSON.parse(rawPending);
      if (Array.isArray(parsed)) {
        pendingSelectedOptions = parsed.filter(o => o && String(o.optionId || '').trim());
      }
    }
  } catch (_e) {}

  try {
    const [siteStatus, item] = await Promise.all([getSiteStatus(), fetchItem(itemType, itemId)]);
    if (!item) return renderStatus(container, 'Article introuvable.');
    const siteBlocked = isSiteBlockedForUser(siteStatus, context.user);
    const pricingSnapshot = computePromotionSnapshot(item);
    let sessions = [];
    let selectedSessionId = query.sessionId || params.get('sessionId') || '';
    if (itemType === 'formation' && String(item.type || '').toLowerCase() === 'presentiel') {
      sessions = await fetchSessions(itemId);
      if (!sessions.length) return renderStatus(container, 'Aucune session présentielle disponible.');
      if (!sessions.some(entry => String(entry?.id || '') === String(selectedSessionId || ''))) {
        selectedSessionId = sessions[0].id;
      }
    }

    let alreadyPurchased = false;
    if (context?.user && itemType === 'formation') {
      alreadyPurchased = await fetchFormationPurchaseStatus(
        itemId,
        String(item.type || '').toLowerCase() === 'presentiel' ? selectedSessionId : ''
      );
    }

    const allOptions =
      itemType === 'formation' && String(item.type || '').toLowerCase() === 'presentiel'
        ? collectCheckoutOptions(item)
        : [];
    const selectedSession =
      sessions.find(entry => String(entry?.id || '') === String(selectedSessionId || '')) || null;
    const selectedOptions = sanitizeSelectedOptions(pendingSelectedOptions, allOptions, selectedSession);

    const legalContext = buildLegalContext({
      itemType,
      item,
      sessions,
      selectedSessionId
    });
    const state = {
      itemType,
      itemId,
      item,
      pricingSnapshot,
      sessions,
      selectedSessionId,
      allOptions,
      siteBlocked,
      alreadyPurchased,
      legalContext,
      cgvAccepted: false,
      waiverAccepted: false,
      appliedGiftCards: [],
      selectedOptions,
      totals: computeTotals(pricingSnapshot, [], selectedOptions),
      flowOpen: false,
      step: 'code',
      pendingCard: null,
      pendingPassword: '',
      pendingAmount: 0
    };
    renderCheckout(container, state);
    renderCheckoutOptions(container, state);
    updateSummary(container, state);
    syncLegalUI(container, state);
    syncAlreadyPurchasedFeedback(container, state);
    syncSessionDisplay(container, state);
    const syncSessionDetails = () => {
      if (!sessions.length) return;
      const target = container.querySelector('[data-session-schedule-details]');
      const selectedSession =
        sessions.find(entry => String(entry?.id || '') === String(state.selectedSessionId || ''));
      if (target) {
        target.innerHTML = buildSessionScheduleDetails(selectedSession);
      }
    };
    syncSessionDetails();

    // ── Session calendar modal ────────────────────────────────────────────
    let _sessionCalendarInstance = null;

    function openSessionCalendarModal() {
      const modal = container.querySelector('[data-session-calendar-modal]');
      if (!modal) return;
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      const bodyEl = modal.querySelector('[data-session-calendar-body]');
      if (bodyEl && !_sessionCalendarInstance) {
        _sessionCalendarInstance = createBookingCalendar({
          mode: 'formation',
          sessions: state.sessions,
          onSessionSelected: async (session) => {
            const previousWaiverKey = `${state.legalContext?.waiverKind || ''}:${state.legalContext?.waiverText || ''}`;
            state.selectedSessionId = String(session.id || '');
            closeSessionCalendarModal();
            state.legalContext = buildLegalContext({
              itemType: state.itemType,
              item: state.item,
              sessions: state.sessions,
              selectedSessionId: state.selectedSessionId
            });
            const nextWaiverKey = `${state.legalContext?.waiverKind || ''}:${state.legalContext?.waiverText || ''}`;
            if (previousWaiverKey !== nextWaiverKey) {
              state.waiverAccepted = false;
            }
            const removedOptions = removeUnavailableSelectedOptions(state);
            syncSessionDetails();
            syncSessionDisplay(container, state);
            state.alreadyPurchased = context?.user
              ? await fetchFormationPurchaseStatus(
                  state.itemId,
                  String(state.item?.type || '').toLowerCase() === 'presentiel' ? state.selectedSessionId : ''
                )
              : false;
            syncLegalUI(container, state);
            renderCheckoutOptions(container, state);
            updateSummary(container, state);
            syncAlreadyPurchasedFeedback(container, state);
            if (removedOptions.length) {
              await openUiConfirmModal({
                title: 'Options retirées',
                message: buildRemovedOptionsMessage(removedOptions),
                allowHtml: true,
                confirmLabel: 'Compris',
                cancelLabel: 'Fermer'
              });
            }
          }
        });
        _sessionCalendarInstance.mount(bodyEl);
      }
    }

    function closeSessionCalendarModal() {
      const modal = container.querySelector('[data-session-calendar-modal]');
      if (!modal) return;
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      _sessionCalendarInstance?.destroy();
      _sessionCalendarInstance = null;
    }

    container.querySelector('[data-open-session-calendar]')?.addEventListener('click', openSessionCalendarModal);
    container.querySelector('[data-close-session-calendar]')?.addEventListener('click', closeSessionCalendarModal);
    container.querySelector('[data-session-calendar-modal]')?.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeSessionCalendarModal();
    });

    const flowModal = container.querySelector('[data-gift-modal]');
    const stepCode = container.querySelector('[data-gift-step-code]');
    const stepPwd = container.querySelector('[data-gift-step-password]');
    const stepConfirm = container.querySelector('[data-gift-step-confirm]');
    const giftFeedback = container.querySelector('[data-gift-feedback]');
    const closeFlowButton = container.querySelector('[data-close-gift-flow]');
    const giftAmountInput = container.querySelector('[data-gift-amount]');
    const giftConfirmButton = container.querySelector('[data-gift-confirm]');
    const previewCardBefore = container.querySelector('[data-gift-preview-card-before]');
    const previewCardAfter = container.querySelector('[data-gift-preview-card-after]');
    const previewPayBefore = container.querySelector('[data-gift-preview-pay-before]');
    const previewPayAfter = container.querySelector('[data-gift-preview-pay-after]');
    const optionModal = container.querySelector('[data-option-modal]');
    const optionModalTitle = container.querySelector('[data-option-modal-title]');
    const optionModalMedia = container.querySelector('[data-option-modal-media]');
    const optionModalImage = container.querySelector('[data-option-modal-image]');
    const optionModalPrice = container.querySelector('[data-option-modal-price]');
    const optionModalDescription = container.querySelector('[data-option-modal-description]');

    const syncFlow = () => {
      stepCode.hidden = state.step !== 'code';
      stepPwd.hidden = state.step !== 'password';
      stepConfirm.hidden = state.step !== 'confirm';
    };
    const setGiftFeedback = message => { if (giftFeedback) giftFeedback.textContent = message || ''; };
    const syncGiftConfirmPreview = () => {
      const max = maxGiftUsage(state, state.pendingCard?.code, state.pendingCard?.balance);
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, Number(state.pendingAmount || 0))));
      if (giftAmountInput) {
        giftAmountInput.max = max.toFixed(2);
        giftAmountInput.value = state.pendingAmount.toFixed(2);
      }
      if (!state.pendingCard) {
        if (previewCardBefore) previewCardBefore.textContent = '';
        if (previewCardAfter) previewCardAfter.textContent = '';
        if (previewPayBefore) previewPayBefore.textContent = '';
        if (previewPayAfter) previewPayAfter.textContent = '';
        giftConfirmButton?.toggleAttribute('disabled', true);
        return;
      }
      const cardBefore = toAmount(state.pendingCard.balance);
      const cardAfter = toAmount(cardBefore - state.pendingAmount);
      const payBefore = toAmount(state.totals.remainingToPay);
      const payAfter = toAmount(Math.max(0, payBefore - state.pendingAmount));
      if (previewCardBefore) previewCardBefore.textContent = formatPrice(cardBefore);
      if (previewCardAfter) previewCardAfter.textContent = formatPrice(cardAfter);
      if (previewPayBefore) previewPayBefore.textContent = formatPrice(payBefore);
      if (previewPayAfter) previewPayAfter.textContent = formatPrice(payAfter);
      giftConfirmButton?.toggleAttribute('disabled', state.pendingAmount <= 0);
    };
    const resetFlowState = () => {
      state.step = 'code';
      state.pendingCard = null;
      state.pendingPassword = '';
      state.pendingAmount = 0;
      const codeInput = container.querySelector('[data-gift-code]');
      const passwordInput = container.querySelector('[data-gift-password]');
      if (codeInput) codeInput.value = '';
      if (passwordInput) passwordInput.value = '';
      setGiftFeedback('');
      syncFlow();
      syncGiftConfirmPreview();
    };
    const closeGiftFlow = () => {
      state.flowOpen = false;
      if (!flowModal) return;
      flowModal.classList.remove('is-visible');
      flowModal.setAttribute('aria-hidden', 'true');
      flowModal.hidden = true;
    };
    const openGiftFlow = () => {
      state.flowOpen = true;
      resetFlowState();
      if (!flowModal) return;
      flowModal.hidden = false;
      flowModal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        flowModal.classList.add('is-visible');
        flowModal.focus();
      });
    };
    const closeOptionModal = () => {
      if (!optionModal) return;
      optionModal.classList.remove('is-visible');
      optionModal.setAttribute('aria-hidden', 'true');
      optionModal.hidden = true;
    };
    const openOptionModal = option => {
      if (!optionModal || !option) return;
      if (optionModalTitle) optionModalTitle.textContent = option.name || 'Option';
      if (optionModalPrice) optionModalPrice.textContent = `+${formatPrice(option.price || 0)}`;
      if (optionModalDescription) {
        optionModalDescription.textContent = option.description || 'Aucune description disponible.';
      }
      const hasImage = Boolean(option.image);
      if (optionModalMedia && optionModalImage) {
        optionModalMedia.hidden = !hasImage;
        optionModalImage.src = hasImage ? option.image : '';
        optionModalImage.alt = hasImage ? option.name || 'Option' : '';
      }
      optionModal.hidden = false;
      optionModal.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        optionModal.classList.add('is-visible');
        optionModal.focus();
      });
    };

    const runValidation = async (label, fn) => {
      const startedAt = Date.now();
      setInlineLoader(container, true, label);
      try {
        return await fn();
      } finally {
        await waitMin(startedAt, VALIDATION_MIN_MS);
        if (container.isConnected) setInlineLoader(container, false, '');
      }
    };

    container.querySelectorAll('[data-open-gift-flow]').forEach(button => {
      button.addEventListener('click', openGiftFlow);
    });
    closeFlowButton?.addEventListener('click', closeGiftFlow);
    flowModal?.addEventListener('click', event => {
      if (event.target === flowModal) {
        closeGiftFlow();
      }
    });
    flowModal?.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeGiftFlow();
      }
    });
    container.querySelector('[data-option-modal-close]')?.addEventListener('click', closeOptionModal);
    optionModal?.addEventListener('click', event => {
      if (event.target === optionModal) {
        closeOptionModal();
      }
    });
    optionModal?.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeOptionModal();
      }
    });

    container.querySelector('[data-gift-code-validate]')?.addEventListener('click', async () => {
      const code = container.querySelector('[data-gift-code]')?.value || '';
      if (!normalizeCode(code)) return setGiftFeedback('Veuillez saisir un code.');
      try {
        state.pendingCard = await runValidation('Validation du code...', () => validateCode(code));
        state.step = 'password';
        syncFlow();
        showToast({ type: 'success', message: 'Code valide', durationMs: 1000 });
      } catch (error) {
        setGiftFeedback(error.message || 'Code invalide.');
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      }
    });

    container.querySelector('[data-gift-password-validate]')?.addEventListener('click', async () => {
      const password = container.querySelector('[data-gift-password]')?.value || '';
      if (!state.pendingCard) return;
      if (!String(password).trim()) return setGiftFeedback('Veuillez saisir le mot de passe.');
      try {
        const validated = await runValidation(
          'Validation du mot de passe...',
          () => validateCredentials(state.pendingCard.code, password)
        );
        state.pendingCard = validated;
        state.pendingPassword = String(password).trim();
        state.pendingAmount = maxGiftUsage(state, validated.code, validated.balance);
        state.step = 'confirm';
      container.querySelector('[data-gift-confirm-title]').textContent = `Carte trouvée (${maskCode(validated.code)}) - utiliser combien ?`;
        syncFlow();
        syncGiftConfirmPreview();
        showToast({ type: 'success', message: 'Mot de passe valide', durationMs: 1000 });
      } catch (error) {
        setGiftFeedback(error.message || 'Mot de passe invalide.');
        showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
      }
    });

    const adjustAmount = delta => {
      if (!state.pendingCard) return;
      const max = maxGiftUsage(state, state.pendingCard.code, state.pendingCard.balance);
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, state.pendingAmount + delta)));
      syncGiftConfirmPreview();
    };
    container.querySelector('[data-gift-minus]')?.addEventListener('click', () => adjustAmount(-10));
    container.querySelector('[data-gift-plus]')?.addEventListener('click', () => adjustAmount(10));
    giftAmountInput?.addEventListener('input', event => {
      const max = maxGiftUsage(state, state.pendingCard?.code, state.pendingCard?.balance);
      const raw = String(event.currentTarget.value || '').replace(',', '.');
      state.pendingAmount = toAmount(Math.min(max, Math.max(0, Number(raw || 0))));
      syncGiftConfirmPreview();
    });

    giftConfirmButton?.addEventListener('click', () => {
      if (!state.pendingCard || !state.pendingAmount) return setGiftFeedback('Montant invalide.');
      state.appliedGiftCards = state.appliedGiftCards
        .filter(entry => normalizeCode(entry.code) !== normalizeCode(state.pendingCard.code))
        .concat({
          giftCardId: state.pendingCard.id || '',
          code: normalizeCode(state.pendingCard.code),
          password: state.pendingPassword,
          amountUsed: toAmount(state.pendingAmount)
        });
      closeGiftFlow();
      resetFlowState();
      updateSummary(container, state);
      showToast({ type: 'success', message: 'Carte appliquée', durationMs: 1000 });
    });

    container.addEventListener('click', event => {
      if (!event.target.closest('[data-remove-card]')) return;
      const row = event.target.closest('[data-code]');
      const code = row?.dataset.code;
      state.appliedGiftCards = state.appliedGiftCards.filter(entry => normalizeCode(entry.code) !== normalizeCode(code));
      updateSummary(container, state);
      showToast({ type: 'info', message: 'Carte retirée', durationMs: 1000 });
    });
    container.addEventListener('click', event => {
      const viewButton = event.target.closest('[data-option-view]');
      if (!viewButton) return;
      const optionId = String(viewButton.dataset.optionId || '').trim();
      const option = findOptionById(state.allOptions, optionId);
      if (!option) return;
      openOptionModal(option);
    });

    container.addEventListener('change', event => {
      const optionCheckbox = event.target.closest('[data-option-checkbox]');
      if (!optionCheckbox) return;
      const optionId = String(optionCheckbox.dataset.optionId || '').trim();
      if (!optionId) return;
      const selectedSession = getSelectedSession(state);
      const availableOptions = getAvailableOptionsForSession(state.allOptions, selectedSession);
      const selectedOption = availableOptions.find(option => option.optionId === optionId);
      if (!selectedOption) {
        optionCheckbox.checked = false;
        return;
      }
      if (optionCheckbox.checked) {
        if (!state.selectedOptions.some(option => option.optionId === optionId)) {
          state.selectedOptions.push({
            optionId: selectedOption.optionId,
            name: selectedOption.name,
            price: selectedOption.price
          });
        }
      } else {
        state.selectedOptions = state.selectedOptions.filter(option => option.optionId !== optionId);
      }
      optionCheckbox.closest('.checkoutp-option-card')?.classList.toggle('is-selected', optionCheckbox.checked);
      playOptionToggleAnimation(container, optionId, optionCheckbox.checked);
      updateSummary(container, state);
    });

    container.querySelector('[data-cgv-info]')?.addEventListener('click', () => {
      requestVitrineNavigation('cgv', {
        source: 'checkout-cgv-info',
        skipThrottle: true
      });
    });
    container.querySelector('[data-cgv-checkbox]')?.addEventListener('change', event => {
      state.cgvAccepted = Boolean(event.currentTarget.checked);
      if (!isProceedBlockedByLegal(state)) setFeedback(container, '');
      syncProceedButton(container, state);
    });
    container.querySelector('[data-waiver-info]')?.addEventListener('click', () => {
      openConsumerWaiverInfoModal();
    });
    container.querySelector('[data-waiver-checkbox]')?.addEventListener('change', event => {
      state.waiverAccepted = Boolean(event.currentTarget.checked);
      if (!isProceedBlockedByLegal(state)) setFeedback(container, '');
      syncProceedButton(container, state);
    });
    // [data-session-select] select replaced by session calendar modal (see openSessionCalendarModal above)

    container.querySelector('[data-proceed]')?.addEventListener('click', async () => {
      if (state.alreadyPurchased) {
        setFeedback(container, `${ALREADY_PURCHASED_MESSAGE} Ouvrez Mes formations pour y acceder.`, 'error');
        showToast({ type: 'info', message: 'Deja inscrit', durationMs: 1000 });
        return;
      }
      if (state.siteBlocked) {
        setFeedback(container, SUSPENDED_PURCHASE_MESSAGE, 'error');
        return showToast({ type: 'error', message: 'Achats indisponibles', durationMs: 1000 });
      }
      if (!state.cgvAccepted) {
        flashLegalRequired(container, '[data-cgv-box]');
        return;
      }
      if (state.legalContext?.waiverRequired && !state.waiverAccepted) {
        flashLegalRequired(container, '[data-waiver-box]');
        return;
      }
      updateSummary(container, state);
      const origin = buildOrigin(itemType, itemId, state.selectedSessionId, {
        originSlug: query.originSlug || params.get('originSlug') || '',
        originType: query.originType || params.get('originType') || '',
        originId: query.originId || params.get('originId') || '',
        originSessionId: query.originSessionId || params.get('originSessionId') || ''
      });
      const waiverText =
        state.legalContext?.waiverRequired && state.waiverAccepted
          ? state.legalContext.waiverText
          : '';
      const checkoutState = buildCheckoutState(
        {
          type: itemType,
          id: itemId,
          name: state.item.name || '',
          itemSubType: state.item.type || '',
          sessionId: state.selectedSessionId,
          coverImage: state.item.coverImage || state.item.image || state.item.photos?.[0] || '',
          selectedOptions: state.selectedOptions || []
        },
        state.appliedGiftCards,
        state.totals,
        {
          acceptedCgv: state.cgvAccepted,
          waiverRequired: Boolean(state.legalContext?.waiverRequired),
          waiverAccepted: state.waiverAccepted,
          waiverText,
          dateFormation: state.legalContext?.dateFormation || null
        },
        origin
      );

      if (state.totals.remainingToPay > 0) {
        const token = createCheckoutStateToken(checkoutState);
        if (!token) return setFeedback(container, 'Impossible d’ouvrir le paiement.', 'error');
        return requestVitrineNavigation('payment', {
          source: 'checkout-payment',
          skipThrottle: true,
          query: { checkoutToken: token }
        });
      }

      const token = getOrCreateFreeCheckoutToken(state, checkoutState);
      if (!token) return setFeedback(container, 'Impossible dâ€™ouvrir le paiement.', 'error');
      return requestVitrineNavigation('payment', {
        source: 'checkout-free',
        skipThrottle: true,
        query: { checkoutToken: token, freeCheckout: '1' }
      });
    });
  } catch (error) {
    console.error('Erreur checkout', error);
    if (error.message === 'not-found') return renderStatus(container, 'Article introuvable.');
    if (error.message === 'unauth') return renderStatus(container, 'Veuillez vous connecter.');
    return renderStatus(container, 'Impossible de charger le checkout.');
  }
}
