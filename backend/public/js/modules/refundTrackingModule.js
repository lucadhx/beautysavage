import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { requestVitrineNavigation } from './vitrineNavigationHelper.js';

const TRACKING_ENDPOINT = '/api/refund-tracking';
const CARD_MODAL_CLOSE_DELAY_MS = 180;
const COPY_FEEDBACK_DELAY_MS = 2000;

let activeGiftCardModal = null;
const copyFeedbackTimers = new WeakMap();

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0,00 EUR';
  return amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function formatDateTimeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dateLabel = date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  const timeLabel = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${dateLabel} a ${timeLabel}`;
}

function normalizeRefundSubStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function injectStyles() {
  if (document.querySelector('[data-refund-tracking-styles]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-refund-tracking-styles', '');
  style.textContent = `
    @keyframes rt-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes rt-fade-up {
      from { opacity: 0.4; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes rt-stroke {
      to { stroke-dashoffset: 0; }
    }
    @keyframes rt-stroke-in {
      from { stroke-dashoffset: 264; }
      to { stroke-dashoffset: 0; }
    }
    @keyframes rt-shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-5px); }
      40% { transform: translateX(4px); }
      60% { transform: translateX(-3px); }
      80% { transform: translateX(2px); }
    }
    .refund-tracking {
      color-scheme: light;
      --rt-status-success: var(--color-success);
      --rt-status-failed: var(--color-danger);
      --rt-status-pending: color-mix(in oklab, var(--color-secondary) 40%, var(--color-success) 60%);
      width: 100%;
      min-height: calc(100vh - clamp(6rem, 10vw, 8rem));
      display: flex;
      justify-content: center;
      align-items: center;
      padding: clamp(1rem, 3vw, 1.8rem) clamp(0.75rem, 3vw, 1.2rem);
    }
    .refund-tracking__card {
      color: var(--color-text, #0f172a);
      width: min(600px, 100%);
      border-radius: 22px;
      border: 1px solid color-mix(in oklab, var(--color-border) 84%, transparent 16%);
      background: var(--color-surface);
      box-shadow: 0 20px 44px color-mix(in oklab, var(--color-shadow) 82%, transparent 18%);
      padding: clamp(1.1rem, 3vw, 1.7rem);
      display: flex;
      flex-direction: column;
      gap: 1.05rem;
    }
    .refund-tracking__card--loading {
      align-items: center;
      text-align: center;
      min-height: 300px;
      justify-content: center;
      gap: 0.85rem;
    }
    .refund-tracking__card--shake {
      animation: rt-shake 0.5s ease;
    }
    .refund-tracking__header {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.62rem;
    }
    .refund-tracking__status-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 116px;
      height: 116px;
    }
    .refund-tracking__status-circle {
      width: 112px;
      height: 112px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid color-mix(in oklab, currentColor 36%, var(--color-border) 64%);
      background: color-mix(in oklab, currentColor 12%, var(--color-surface) 88%);
      color: var(--color-text);
    }
    .refund-tracking__status-circle i {
      font-size: 2.35rem;
      line-height: 1;
    }
    .refund-tracking__status-circle--pending {
      color: var(--rt-status-pending);
    }
    .refund-tracking__status-circle--pending i {
      animation: rt-spin 3s linear infinite;
      transform-origin: center;
    }
    .refund-tracking__status-circle--failed {
      color: var(--rt-status-failed);
    }
    .refund-tracking__status-svg {
      width: 112px;
      height: 112px;
      display: block;
    }
    .refund-tracking__status-outline {
      fill: none;
      stroke: var(--rt-status-success);
      stroke-width: 5;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 264;
      stroke-dashoffset: 0;
      animation: rt-stroke-in 0.66s ease;
    }
    .refund-tracking__status-check {
      fill: none;
      stroke: var(--rt-status-success);
      stroke-width: 6;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 74;
      stroke-dashoffset: 0;
      animation: rt-stroke-in 0.45s 0.22s ease;
    }
    .refund-tracking__title {
      margin: 0;
      font-size: clamp(1.35rem, 3vw, 1.8rem);
      line-height: 1.15;
      font-weight: 800;
      color: var(--color-text, #0f172a);
    }
    .refund-tracking__subtitle {
      margin: 0;
      max-width: 48ch;
      color: var(--color-text, #0f172a);
      opacity: 0.84;
    }
    .refund-tracking__content {
      display: grid;
      gap: 0.82rem;
    }
    .refund-tracking__content--fade {
      opacity: 1;
      animation: rt-fade-up 0.42s ease-out;
    }
    .refund-tracking__hint {
      margin: 0;
      padding: 0.62rem 0.75rem;
      border-radius: 12px;
      font-size: 0.86rem;
      color: color-mix(in oklab, var(--color-text) 74%, transparent 26%);
      border: 1px solid color-mix(in oklab, var(--rt-status-pending) 28%, var(--color-border) 72%);
      background: color-mix(in oklab, var(--rt-status-pending) 9%, var(--color-surface) 91%);
    }
    .refund-tracking__section {
      border-radius: 16px;
      border: 1px solid var(--color-border, #e2e8f0);
      background: var(--color-surface, #ffffff);
      padding: 0.88rem 0.92rem;
      display: grid;
      gap: 0.58rem;
    }
    .refund-tracking__section-title {
      margin: 0;
      font-size: 0.86rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text, #0f172a);
      opacity: 0.6;
    }
    .refund-tracking__row {
      margin: 0;
      display: grid;
      grid-template-columns: minmax(120px, 0.95fr) minmax(0, 1.25fr);
      gap: 0.68rem;
      align-items: start;
      padding-bottom: 0.52rem;
      border-bottom: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent 30%);
    }
    .refund-tracking__row:last-child {
      padding-bottom: 0;
      border-bottom: none;
    }
    .refund-tracking__label {
      margin: 0;
      color: var(--color-text, #0f172a);
      opacity: 0.58;
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
    }
    .refund-tracking__value {
      margin: 0;
      text-align: right;
      color: var(--color-text, #0f172a);
      font-weight: 600;
      word-break: break-word;
    }
    .refund-tracking__split-row {
      margin: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 0.48rem;
      padding-bottom: 0.54rem;
      border-bottom: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent 30%);
    }
    .refund-tracking__split-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .refund-tracking__split-note {
      margin: 0;
      grid-column: 1 / -1;
      display: inline-flex;
      align-items: center;
      gap: 0.34rem;
      font-size: 0.75rem;
      color: color-mix(in oklab, var(--color-text) 52%, transparent 48%);
      line-height: 1.35;
    }
    .refund-tracking__split-note i {
      font-size: 0.82rem;
      color: color-mix(in oklab, var(--rt-status-success) 68%, var(--color-text) 32%);
    }
    .refund-tracking__split-label {
      margin: 0;
      font-weight: 600;
    }
    .refund-tracking__split-amount {
      margin: 0;
      font-weight: 700;
      color: var(--color-text);
      white-space: nowrap;
    }
    .refund-tracking__status-badge {
      margin: 0;
      padding: 0.16rem 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in oklab, var(--color-border) 78%, transparent 22%);
      background: color-mix(in oklab, var(--color-text) 8%, var(--color-surface) 92%);
      color: color-mix(in oklab, var(--color-text) 82%, transparent 18%);
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .refund-tracking__status-badge--pending {
      color: color-mix(in oklab, var(--rt-status-pending) 70%, var(--color-text) 30%);
      border-color: color-mix(in oklab, var(--rt-status-pending) 34%, var(--color-border) 66%);
      background: color-mix(in oklab, var(--rt-status-pending) 13%, var(--color-surface) 87%);
    }
    .refund-tracking__status-badge--success {
      color: color-mix(in oklab, var(--rt-status-success) 74%, var(--color-text) 26%);
      border-color: color-mix(in oklab, var(--rt-status-success) 30%, var(--color-border) 70%);
      background: color-mix(in oklab, var(--rt-status-success) 13%, var(--color-surface) 87%);
    }
    .refund-tracking__status-badge--failed {
      color: color-mix(in oklab, var(--rt-status-failed) 74%, var(--color-text) 26%);
      border-color: color-mix(in oklab, var(--rt-status-failed) 34%, var(--color-border) 66%);
      background: color-mix(in oklab, var(--rt-status-failed) 13%, var(--color-surface) 87%);
    }
    .refund-tracking__split-actions {
      margin-top: 0.4rem;
      display: flex;
      justify-content: flex-start;
    }
    .refund-tracking__view-card-button {
      display: inline-flex;
      align-items: center;
      gap: 0.42rem;
      border-radius: 999px;
      padding: 0.5rem 0.88rem;
      width: auto;
      font-size: 0.84rem;
    }
    .refund-tracking__actions {
      margin-top: 0.28rem;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.62rem;
    }
    .refund-tracking__actions .primary-button,
    .refund-tracking__actions .secondary-button {
      width: auto;
      padding: 0.66rem 1.06rem;
      font-size: 0.88rem;
    }
    .refund-tracking__loader {
      min-height: auto;
    }
    .refund-tracking__loader-title {
      margin: 0;
      font-size: 1.2rem;
    }
    .refund-tracking-gift-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 1900;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      background: color-mix(in oklab, var(--color-text) 18%, transparent 82%);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .refund-tracking-gift-modal-overlay.is-visible {
      opacity: 1;
      pointer-events: auto;
    }
    .refund-tracking-gift-modal {
      width: min(520px, 100%);
      max-height: min(88vh, 760px);
      overflow: auto;
      border-radius: 20px;
      border: 1px solid color-mix(in oklab, var(--color-border) 82%, transparent 18%);
      background: var(--color-surface);
      box-shadow: 0 24px 58px color-mix(in oklab, var(--color-text) 18%, transparent 82%);
      transform: translateY(8px) scale(0.985);
      transition: transform 0.2s ease;
      padding: 1.15rem;
    }
    .refund-tracking-gift-modal-overlay.is-visible .refund-tracking-gift-modal {
      transform: translateY(0) scale(1);
    }
    .refund-tracking-gift-modal__header {
      display: flex;
      align-items: center;
      gap: 0.62rem;
      margin-bottom: 0.94rem;
    }
    .refund-tracking-gift-modal__title-icon {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--color-primary);
      background: color-mix(in oklab, var(--color-primary) 14%, var(--color-surface) 86%);
      border: 1px solid color-mix(in oklab, var(--color-primary) 30%, var(--color-border) 70%);
    }
    .refund-tracking-gift-modal__title-icon i {
      font-size: 1rem;
      line-height: 1;
    }
    .refund-tracking-gift-modal__header h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
    }
    .refund-tracking-gift-modal__body {
      display: grid;
      gap: 0.9rem;
    }
    .refund-tracking-gift-modal__balance {
      border-radius: 14px;
      border: 1px solid color-mix(in oklab, var(--color-border) 78%, transparent 22%);
      background: var(--color-surface);
      padding: 0.8rem;
      display: grid;
      gap: 0.24rem;
    }
    .refund-tracking-gift-modal__balance-label {
      margin: 0;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: color-mix(in oklab, var(--color-text) 58%, var(--color-background) 42%);
      font-weight: 700;
    }
    .refund-tracking-gift-modal__balance-value {
      margin: 0;
      font-size: clamp(1.7rem, 4.8vw, 2.2rem);
      line-height: 1.05;
      font-weight: 800;
      color: var(--color-primary);
      word-break: break-word;
    }
    .refund-tracking-gift-modal__fields {
      display: grid;
      gap: 0.72rem;
    }
    .refund-tracking-gift-modal__field {
      display: grid;
      gap: 0.24rem;
      padding-bottom: 0.64rem;
      border-bottom: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent 30%);
    }
    .refund-tracking-gift-modal__field:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .refund-tracking-gift-modal__field-label {
      margin: 0;
      color: color-mix(in oklab, var(--color-text) 58%, var(--color-background) 42%);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 0.74rem;
      font-weight: 700;
    }
    .refund-tracking-gift-modal__field-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.52rem;
    }
    .refund-tracking-gift-modal__field-value {
      margin: 0;
      color: var(--color-text);
      font-weight: 700;
      word-break: break-word;
    }
    .refund-tracking-gift-modal__copy {
      border: 1px solid color-mix(in oklab, var(--color-border) 82%, transparent 18%);
      background: color-mix(in oklab, var(--color-surface) 95%, var(--color-background) 5%);
      color: var(--color-text);
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.18s ease, border-color 0.18s ease, color 0.18s ease;
      outline: none;
    }
    .refund-tracking-gift-modal__copy:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in oklab, var(--color-primary) 45%, var(--color-border) 55%);
      color: var(--color-primary);
    }
    .refund-tracking-gift-modal__copy:focus-visible {
      box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 26%, transparent 74%);
    }
    .refund-tracking-gift-modal__copy:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .refund-tracking-gift-modal__copy-feedback {
      margin: 0;
      color: var(--color-success);
      font-size: 0.78rem;
      font-weight: 700;
      opacity: 0;
      transform: translateY(3px);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .refund-tracking-gift-modal__copy-feedback.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
    .refund-tracking-gift-modal__footer {
      margin-top: 0.35rem;
      display: flex;
      justify-content: center;
    }
    .refund-tracking-gift-modal__close-button {
      width: auto;
      display: inline-flex;
      align-items: center;
      gap: 0.42rem;
      padding: 0.64rem 1rem;
    }
    @media (max-width: 560px) {
      .refund-tracking__card {
        border-radius: 18px;
        padding: 1rem 0.88rem;
      }
      .refund-tracking__row {
        grid-template-columns: minmax(0, 1fr);
        gap: 0.22rem;
      }
      .refund-tracking__value {
        text-align: left;
      }
      .refund-tracking__split-row {
        grid-template-columns: minmax(0, 1fr) auto;
        row-gap: 0.32rem;
      }
      .refund-tracking__status-badge {
        justify-self: start;
      }
      .refund-tracking-gift-modal {
        padding: 0.95rem;
      }
      .refund-tracking-gift-modal__field-row {
        grid-template-columns: minmax(0, 1fr);
      }
      .refund-tracking-gift-modal__copy {
        justify-self: start;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .refund-tracking__card--shake,
      .refund-tracking__status-circle--pending i {
        animation: none !important;
        transform: none !important;
      }
      .refund-tracking__content--fade {
        animation: none !important;
        transform: none !important;
        opacity: 1 !important;
      }
      .refund-tracking__status-outline,
      .refund-tracking__status-check {
        animation: none !important;
        stroke-dashoffset: 0 !important;
      }
      .refund-tracking-gift-modal-overlay,
      .refund-tracking-gift-modal,
      .refund-tracking-gift-modal__copy-feedback {
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function getRefundSubStatusLabel(status) {
  const key = normalizeRefundSubStatus(status);
  if (key === 'succeeded') return 'Valide';
  if (key === 'failed') return 'Echec';
  if (key === 'rollback_needed') return 'Action';
  if (key === 'not_applicable') return 'N/A';
  return 'En attente';
}

function getRefundSubStatusClass(status) {
  const key = normalizeRefundSubStatus(status);
  if (key === 'succeeded') return 'refund-tracking__status-badge refund-tracking__status-badge--success';
  if (key === 'failed' || key === 'rollback_needed') {
    return 'refund-tracking__status-badge refund-tracking__status-badge--failed';
  }
  if (key === 'not_applicable') return 'refund-tracking__status-badge';
  return 'refund-tracking__status-badge refund-tracking__status-badge--pending';
}

function buildStatusIcon(statusKey = 'pending') {
  if (statusKey === 'succeeded') {
    return `
      <svg viewBox="0 0 96 96" class="refund-tracking__status-svg" aria-hidden="true">
        <circle cx="48" cy="48" r="42" class="refund-tracking__status-outline"></circle>
        <path d="M28 50 L43 64 L68 35" class="refund-tracking__status-check"></path>
      </svg>
    `;
  }

  if (statusKey === 'failed') {
    return '<span class="refund-tracking__status-circle refund-tracking__status-circle--failed"><i class="bi bi-x-circle" aria-hidden="true"></i></span>';
  }

  return '<span class="refund-tracking__status-circle refund-tracking__status-circle--pending"><i class="bi bi-hourglass-split" aria-hidden="true"></i></span>';
}

function buildDataRow(label, value) {
  return `
    <p class="refund-tracking__row">
      <span class="refund-tracking__label" style="color:#0f172a;opacity:0.6">${escapeHtml(label)}</span>
      <strong class="refund-tracking__value" style="color:#0f172a">${escapeHtml(value)}</strong>
    </p>
  `;
}

function buildInfoSection(data = {}, statusKey = 'pending') {
  const isService = data?.itemType === 'service';

  const itemLabel = isService ? 'Prestation' : 'Formation';
  const dateLabel = isService ? 'Date du rendez-vous' : 'Session';

  const itemTitle = String(data?.itemTitle || data?.formationTitle || '').trim()
    || (isService ? 'Prestation' : 'Formation');
  const itemDate = String(data?.itemDate || data?.sessionDate || '').trim() || 'Non renseignee';
  const amount = formatPrice(data?.amount || 0);
  const refundedAt = formatDate(data?.refundedAt) || 'Date indisponible';

  let rows = '';
  rows += buildDataRow(itemLabel, itemTitle);
  rows += buildDataRow(dateLabel, itemDate);
  rows += buildDataRow('Montant', amount);
  if (statusKey === 'succeeded') {
    rows += buildDataRow('Rembourse le', refundedAt);
  }

  return `
    <section class="refund-tracking__section" aria-label="Informations remboursement">
      <h3 class="refund-tracking__section-title" style="color:#0f172a;opacity:0.6">Informations</h3>
      ${rows}
    </section>
  `;
}

function buildSplitRow(label, amount, status, note = '') {
  const statusLabel = getRefundSubStatusLabel(status);
  const statusClass = getRefundSubStatusClass(status);
  return `
    <p class="refund-tracking__split-row">
      <span class="refund-tracking__split-label" style="color:#0f172a">${escapeHtml(label)}</span>
      <strong class="refund-tracking__split-amount" style="color:#0f172a">${escapeHtml(formatPrice(amount))}</strong>
      <span class="${statusClass}">${escapeHtml(statusLabel)}</span>
      ${
        note
          ? `<span class="refund-tracking__split-note"><i class="bi bi-check2-circle" aria-hidden="true"></i>${escapeHtml(note)}</span>`
          : ''
      }
    </p>
  `;
}

function buildSplitSection(data = {}) {
  const stripeAmount = Number.isFinite(Number(data?.stripeRefundAmount)) ? Number(data.stripeRefundAmount) : null;
  const giftAmount = Number.isFinite(Number(data?.giftCardRefundAmount)) ? Number(data.giftCardRefundAmount) : null;
  const hasStripeRow = stripeAmount !== null && stripeAmount > 0;
  const hasGiftRow = giftAmount !== null && giftAmount > 0;
  const hasGiftCardDetails =
    normalizeRefundSubStatus(data?.giftCardRefundStatus) === 'succeeded' &&
    data?.giftCard &&
    typeof data.giftCard === 'object';
  if (!hasStripeRow && !hasGiftRow && !hasGiftCardDetails) return '';

  let rows = '';
  const stripeStatus = normalizeRefundSubStatus(data?.stripeRefundStatus);
  const stripeConfirmedAtLabel = formatDateTimeLabel(data?.stripeRefundConfirmedAt);
  const refundedAtLabel = formatDateTimeLabel(data?.refundedAt);
  let stripeNote = '';
  if (stripeStatus === 'succeeded') {
    if (stripeConfirmedAtLabel) {
      stripeNote = `Remboursement confirme par Stripe le ${stripeConfirmedAtLabel}`;
    } else if (refundedAtLabel) {
      stripeNote = `Remboursement effectue le ${refundedAtLabel}`;
    }
  }
  if (hasStripeRow) {
    rows += buildSplitRow('Remboursement bancaire', stripeAmount, data?.stripeRefundStatus, stripeNote);
  }
  if (hasGiftRow) {
    rows += buildSplitRow('Recredit carte cadeau', giftAmount, data?.giftCardRefundStatus);
  }

  return `
    <section class="refund-tracking__section refund-tracking__section--split" aria-label="Split remboursement">
      <h3 class="refund-tracking__section-title" style="color:#0f172a;opacity:0.6">Split remboursement</h3>
      ${rows}
      ${
        hasGiftCardDetails
          ? `
            <div class="refund-tracking__split-actions">
              <button type="button" class="secondary-button refund-tracking__view-card-button" data-rt-open-gift-card>
                <i class="bi bi-gift" aria-hidden="true"></i>
                <span>Voir ma carte cadeau</span>
              </button>
            </div>
          `
          : ''
      }
    </section>
  `;
}

function buildSummary(data = {}, statusKey = 'pending') {
  return `
    ${buildInfoSection(data, statusKey)}
    ${buildSplitSection(data)}
  `;
}

function goHome() {
  closeGiftCardModal();
  requestVitrineNavigation('home', { source: 'refund-tracking', skipThrottle: true });
}

function showCopyFeedback(feedbackElement) {
  if (!feedbackElement) return;
  const existingTimer = copyFeedbackTimers.get(feedbackElement);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }
  feedbackElement.classList.add('is-visible');
  const timer = window.setTimeout(() => {
    if (feedbackElement.isConnected) {
      feedbackElement.classList.remove('is-visible');
    }
    copyFeedbackTimers.delete(feedbackElement);
  }, COPY_FEEDBACK_DELAY_MS);
  copyFeedbackTimers.set(feedbackElement, timer);
}

function copyTextWithFeedback(button, rawValue, feedbackElement) {
  const value = String(rawValue || '').trim();
  if (!value || !button) return;

  const fallbackCopy = () => {
    try {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.position = 'absolute';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      return copied;
    } catch (_error) {
      return false;
    }
  };

  if (navigator?.clipboard?.writeText) {
    navigator.clipboard
      .writeText(value)
      .then(() => showCopyFeedback(feedbackElement))
      .catch(() => {
        if (fallbackCopy()) {
          showCopyFeedback(feedbackElement);
        }
      });
  } else if (fallbackCopy()) {
    showCopyFeedback(feedbackElement);
  }
}

function closeGiftCardModal() {
  if (!activeGiftCardModal) return;
  const { overlay, onEscape, onOutside } = activeGiftCardModal;
  window.removeEventListener('keydown', onEscape);
  overlay.removeEventListener('click', onOutside);
  overlay.classList.remove('is-visible');
  window.setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }, CARD_MODAL_CLOSE_DELAY_MS);
  activeGiftCardModal = null;
}

function buildCopyField(fieldKey, label, rawValue) {
  const value = String(rawValue || '').trim();
  const hasValue = Boolean(value);
  return `
    <div class="refund-tracking-gift-modal__field">
      <p class="refund-tracking-gift-modal__field-label">${escapeHtml(label)}</p>
      <div class="refund-tracking-gift-modal__field-row">
        <strong class="refund-tracking-gift-modal__field-value">${escapeHtml(hasValue ? value : 'Indisponible')}</strong>
        <button
          type="button"
          class="refund-tracking-gift-modal__copy"
          data-copy-value="${escapeHtml(value)}"
          data-copy-field="${escapeHtml(fieldKey)}"
          aria-label="Copier ${escapeHtml(label)}"
          ${hasValue ? '' : 'disabled'}
        >
          <i class="bi bi-clipboard" aria-hidden="true"></i>
        </button>
      </div>
      <p class="refund-tracking-gift-modal__copy-feedback" data-copy-feedback="${escapeHtml(fieldKey)}">Copi&eacute; !</p>
    </div>
  `;
}

function openGiftCardModal(giftCard = null) {
  if (!giftCard || typeof giftCard !== 'object') return;
  closeGiftCardModal();

  const code = String(giftCard?.code || '').trim();
  const recipientName = String(giftCard?.recipientName || '').trim();
  const expiresAt = formatShortDate(giftCard?.expiresAt) || 'Aucune';
  const balanceLabel = formatPrice(giftCard?.balance || 0);
  const beneficiaryLabel = recipientName || 'Masque';

  const overlay = document.createElement('div');
  overlay.className = 'refund-tracking-gift-modal-overlay';
  overlay.innerHTML = `
    <div class="refund-tracking-gift-modal" role="dialog" aria-modal="true" aria-labelledby="refund-tracking-gift-card-title">
      <header class="refund-tracking-gift-modal__header">
        <span class="refund-tracking-gift-modal__title-icon" aria-hidden="true"><i class="bi bi-gift"></i></span>
        <h3 id="refund-tracking-gift-card-title">Votre carte cadeau</h3>
      </header>
      <div class="refund-tracking-gift-modal__body">
        <section class="refund-tracking-gift-modal__balance">
          <p class="refund-tracking-gift-modal__balance-label">Solde disponible</p>
          <p class="refund-tracking-gift-modal__balance-value">${escapeHtml(balanceLabel)}</p>
        </section>
        <section class="refund-tracking-gift-modal__fields">
          ${buildCopyField('code', 'Code', code)}
          <div class="refund-tracking-gift-modal__field">
            <p class="refund-tracking-gift-modal__field-label">Mot de passe</p>
            <strong class="refund-tracking-gift-modal__field-value" style="font-weight:500;font-size:0.9rem;line-height:1.35;">Pour des raisons de securite, le mot de passe n'est plus affiche ici. Pour utiliser votre carte cadeau, connectez-vous a votre compte ou contactez l'institut.</strong>
          </div>
          <div class="refund-tracking-gift-modal__field">
            <p class="refund-tracking-gift-modal__field-label">Expiration</p>
            <strong class="refund-tracking-gift-modal__field-value">${escapeHtml(expiresAt)}</strong>
          </div>
          <div class="refund-tracking-gift-modal__field">
            <p class="refund-tracking-gift-modal__field-label">Beneficiaire</p>
            <strong class="refund-tracking-gift-modal__field-value">${escapeHtml(beneficiaryLabel)}</strong>
          </div>
        </section>
        <footer class="refund-tracking-gift-modal__footer">
          <button type="button" class="secondary-button refund-tracking-gift-modal__close-button" data-action="close-gift-card-modal">
            <i class="bi bi-x" aria-hidden="true"></i>
            <span>Fermer</span>
          </button>
        </footer>
      </div>
    </div>
  `;

  const onEscape = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeGiftCardModal();
  };
  const onOutside = event => {
    if (event.target === overlay) closeGiftCardModal();
  };

  overlay.querySelectorAll('[data-action="close-gift-card-modal"]').forEach(button => {
    button.addEventListener('click', closeGiftCardModal);
  });
  overlay.querySelectorAll('[data-copy-value]').forEach(button => {
    button.addEventListener('click', () => {
      const field = String(button.dataset.copyField || '').trim();
      const feedbackElement = overlay.querySelector(`[data-copy-feedback="${field}"]`);
      copyTextWithFeedback(button, String(button.dataset.copyValue || '').trim(), feedbackElement);
    });
  });
  overlay.addEventListener('click', onOutside);
  window.addEventListener('keydown', onEscape);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));

  activeGiftCardModal = { overlay, onEscape, onOutside };
}

function bindCommonActions(container, data = {}) {
  container.querySelector('[data-rt-home]')?.addEventListener('click', goHome);
  container.querySelector('[data-rt-support]')?.addEventListener('click', () => {
    window.location.href = 'mailto:support@beautysavage.fr?subject=Assistance%20remboursement';
  });
  container.querySelector('[data-rt-open-gift-card]')?.addEventListener('click', () => {
    openGiftCardModal(data?.giftCard || null);
  });
}

function renderState(container, config = {}) {
  const statusKey = String(config?.statusKey || 'pending').trim().toLowerCase();
  const title = String(config?.title || '').trim() || 'Suivi remboursement';
  const subtitle = String(config?.subtitle || '').trim() || '';
  const hint = String(config?.hint || '').trim();
  const data = config?.data && typeof config.data === 'object' ? config.data : null;
  const showSupport = Boolean(config?.showSupport);
  const showHome = config?.showHome !== false;
  const shake = Boolean(config?.shake);

  const actions = [];
  if (showSupport) {
    actions.push('<button type="button" class="primary-button" data-rt-support>Contacter le support</button>');
  }
  if (showHome) {
    actions.push('<button type="button" class="secondary-button" data-rt-home>Retour a l\'accueil</button>');
  }

  container.innerHTML = `
    <section class="refund-tracking refund-tracking--${escapeHtml(statusKey)}">
      <article class="refund-tracking__card${shake ? ' refund-tracking__card--shake' : ''}" style="background:#ffffff;color:#0f172a">
        <header class="refund-tracking__header">
          <div class="refund-tracking__status-wrap" aria-hidden="true">
            ${buildStatusIcon(statusKey)}
          </div>
          <h2 class="refund-tracking__title" style="color:#0f172a">${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="refund-tracking__subtitle" style="color:#0f172a;opacity:0.84">${escapeHtml(subtitle)}</p>` : ''}
        </header>
        <div class="refund-tracking__content refund-tracking__content--fade">
          ${hint ? `<p class="refund-tracking__hint">${escapeHtml(hint)}</p>` : ''}
          ${data ? buildSummary(data, statusKey) : ''}
          ${actions.length ? `<div class="refund-tracking__actions">${actions.join('')}</div>` : ''}
        </div>
      </article>
    </section>
  `;

  bindCommonActions(container, data || {});

  // Safety net: force visibility in case CSS animation doesn't fire on mobile
  setTimeout(() => {
    const content = container.querySelector('.refund-tracking__content--fade');
    if (content) content.style.opacity = '1';
    const outline = container.querySelector('.refund-tracking__status-outline');
    if (outline) outline.style.strokeDashoffset = '0';
    const check = container.querySelector('.refund-tracking__status-check');
    if (check) check.style.strokeDashoffset = '0';
  }, 300);
}

function renderLoading(container) {
  container.innerHTML = `
    <section class="refund-tracking refund-tracking--loading">
      <article class="refund-tracking__card refund-tracking__card--loading">
        <div class="refund-tracking__loader" aria-hidden="true">
          <div class="gcg-inline-loader">
            <div class="gcg-inline-loader__paws">
              <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
              <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
              <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
            </div>
          </div>
        </div>
        <h2 class="refund-tracking__loader-title">Chargement...</h2>
      </article>
    </section>
  `;
}

function renderNotFound(container) {
  renderState(container, {
    statusKey: 'failed',
    title: 'Lien invalide ou expire',
    subtitle: 'Ce lien de suivi est introuvable ou a expire.',
    showHome: true
  });
}

function renderPending(container, data = {}) {
  const estimatedDelay = String(data?.estimatedDelay || '').trim();
  renderState(container, {
    statusKey: 'pending',
    title: 'Remboursement en attente',
    subtitle: 'Votre demande est en cours de traitement.',
    hint: estimatedDelay,
    data,
    showHome: true
  });
}

function renderSucceeded(container, data = {}) {
  renderState(container, {
    statusKey: 'succeeded',
    title: 'Remboursement effectue',
    subtitle: 'Le remboursement a bien ete valide et envoye.',
    data,
    showHome: true
  });
}

function renderFailed(container, data = {}) {
  renderState(container, {
    statusKey: 'failed',
    title: 'Remboursement non abouti',
    subtitle: 'Le traitement a echoue. Notre support peut finaliser avec vous.',
    data,
    showSupport: true,
    showHome: true,
    shake: true
  });
}

export async function renderPage(container, context = {}) {
  if (!container) return;
  closeGiftCardModal();
  injectStyles();

  const params = new URLSearchParams(window.location.search);
  const contextQuery = context?.query || {};
  const token = String(contextQuery.token || params.get('token') || '').trim();

  if (!token) {
    renderNotFound(container);
    return;
  }

  renderLoading(container);

  try {
    const response = await fetch(`${TRACKING_ENDPOINT}/${encodeURIComponent(token)}`, {
      credentials: 'include'
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok) {
      renderNotFound(container);
      return;
    }

    const data = payload?.refund || payload || {};
    const status = String(data?.status || '').trim();

    if (status === 'succeeded') {
      renderSucceeded(container, data);
    } else if (status === 'failed' || status === 'canceled') {
      renderFailed(container, data);
    } else {
      renderPending(container, data);
    }
  } catch (error) {
    console.error('[RefundTrackingModule] Erreur chargement suivi', error);
    renderNotFound(container);
  }
}
