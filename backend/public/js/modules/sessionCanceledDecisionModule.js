import { showToast } from '../helpers/toastService.js';
import { openConsumerWaiverInfoModal } from '../helpers/consumerWaiverModal.js';
import {
  buildSessionSummaryLine,
  buildSessionTimeRangeLabel,
  isSessionSelectable
} from '../helpers/sessionCardsRenderer.js';
import { createBookingCalendar } from './bookingCalendarComponent.js';
import {
  RETRACTATION_DAYS,
  PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT,
  PRESENTIEL_WAIVER_WITHIN_7_TEXT,
  isWaiverRequired
} from '../constants/consumerWaiver.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { openUiConfirmModal } from './uiConfirmModal.js';

// Module-level calendar instance tracker (one at a time — formation or service)
let _calendarInstance = null;

function destroyCalendar() {
  _calendarInstance?.destroy();
  _calendarInstance = null;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getQueryParam(data = {}, key = '') {
  const fromData = String(data?.query?.[key] || '').trim();
  if (fromData) return fromData;
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return String(params.get(key) || '').trim();
}

function formatDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Date indisponible';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function computeRequiredWaiverText(sessionStartAt, legal = {}) {
  const startDate = new Date(sessionStartAt || '');
  if (Number.isNaN(startDate.getTime())) return '';
  const now = Date.now();
  const deltaDays = (startDate.getTime() - now) / (24 * 60 * 60 * 1000);
  const refundDaysRaw = Number(legal?.refundDays);
  const refundDays = Number.isFinite(refundDaysRaw) ? Math.max(0, refundDaysRaw) : 7;
  const between7And14Text =
    String(legal?.presentielWaiverBetween7And14 || PRESENTIEL_WAIVER_BETWEEN_7_AND_14_TEXT).trim();
  const within7Text =
    String(legal?.presentielWaiverWithin7 || PRESENTIEL_WAIVER_WITHIN_7_TEXT).trim();
  if (!isWaiverRequired({ daysBeforeFormation: deltaDays, refundDays })) return '';
  if (deltaDays < RETRACTATION_DAYS) return between7And14Text;
  return within7Text;
}

async function withMinDelay(task, minMs = 1000) {
  const startedAt = Date.now();
  const result = await task();
  const remaining = Math.max(0, minMs - (Date.now() - startedAt));
  if (remaining) {
    await new Promise(resolve => setTimeout(resolve, remaining));
  }
  return result;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || 'Erreur réseau');
    error.status = response.status;
    error.code = payload?.code || null;
    throw error;
  }
  return payload;
}

function buildLoader(message = 'Chargement...') {
  return `
    <div class="scd-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="scd-loader__paws" aria-hidden="true">
        <span>${PAW_ICON_SVG}</span>
        <span>${PAW_ICON_SVG}</span>
        <span>${PAW_ICON_SVG}</span>
      </div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function buildButtonPaws() {
  return `
    <span class="scd-button-loader" aria-hidden="true">
      <span>${PAW_ICON_SVG}</span>
      <span>${PAW_ICON_SVG}</span>
      <span>${PAW_ICON_SVG}</span>
    </span>
  `;
}

function openKeywordModal() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'scd-modal-overlay';
    overlay.innerHTML = `
      <div class="scd-modal" role="dialog" aria-modal="true" aria-label="Confirmer">
        <header>
          <h4>Confirmer l'annulation</h4>
          <button type="button" data-action="close" aria-label="Fermer">&times;</button>
        </header>
        <p>Tapez <strong>annulation</strong> pour valider votre choix.</p>
        <input type="text" data-keyword-input class="scd-input" placeholder="annulation" />
        <div class="scd-modal__actions">
          <button type="button" class="secondary-button" data-action="cancel">Annuler</button>
          <button type="button" class="danger-button" data-action="confirm" disabled>Valider</button>
        </div>
      </div>
    `;
    const close = value => {
      overlay.remove();
      resolve(value);
    };
    const input = overlay.querySelector('[data-keyword-input]');
    const confirmButton = overlay.querySelector('[data-action="confirm"]');
    const refreshState = () => {
      const valid = String(input?.value || '').trim().toLowerCase() === 'annulation';
      if (confirmButton) confirmButton.disabled = !valid;
    };
    overlay.addEventListener('click', event => {
      if (
        event.target === overlay ||
        event.target.closest('[data-action="close"]') ||
        event.target.closest('[data-action="cancel"]')
      ) {
        close(false);
      }
      if (event.target.closest('[data-action="confirm"]')) {
        close(true);
      }
    });
    input?.addEventListener('input', refreshState);
    document.body.appendChild(overlay);
    window.requestAnimationFrame(() => {
      input?.focus();
      refreshState();
    });
  });
}

function buildWaiverCheckboxMarkup({
  text = '',
  checked = false,
  disabled = false
} = {}) {
  return `
    <div class="checkout-waiver-box checkout-waiver-box--inline">
      <label class="checkout-waiver-box__label">
        <input
          class="checkout-waiver-box__checkbox-input"
          type="checkbox"
          data-accept-waiver
          ${checked ? 'checked' : ''}
          ${disabled ? 'disabled' : ''}
        >
        <span class="checkout-waiver-box__checkbox-mark" aria-hidden="true">
          <i class="bi bi-check2"></i>
        </span>
        <span>${escapeHtml(text)}</span>
      </label>
      <button type="button" class="checkout-waiver-box__info" data-action="open-waiver-info" ${disabled ? 'disabled' : ''}>
        plus d'informations <i class="bi bi-link-45deg" aria-hidden="true"></i>
      </button>
    </div>
  `;
}

function buildRescheduleModalStep1Markup(payload, state) {
  const availableSessions = Array.isArray(payload?.availableSessions) ? payload.availableSessions : [];
  const selectedSession = availableSessions.find(item => item.id === state.selectedSessionId) || null;
  const hasSelectable = availableSessions.some(session => isSessionSelectable(session));
  const canProceed = selectedSession && isSessionSelectable(selectedSession);

  return `
    <header class="scd-reschedule-modal__header">
      <h3>Choisir une nouvelle date</h3>
      <button type="button" class="scd-reschedule-modal__close" data-action="close-reschedule" aria-label="Fermer">&times;</button>
    </header>
    <div class="scd-reschedule-modal__body">
      <div class="scd-calendar-mount" data-scd-calendar-mount></div>
    </div>
    <footer class="scd-reschedule-modal__footer">
      <button
        type="button"
        class="primary-button scd-submit-button"
        data-action="next-step"
        ${canProceed ? '' : 'disabled'}
      >
        Suite <i class="bi bi-arrow-right" aria-hidden="true"></i>
      </button>
      ${!hasSelectable ? '<p class="muted scd-helper">Aucune session disponible. Vous pouvez demander un remboursement.</p>' : ''}
      ${hasSelectable && !canProceed ? '<p class="muted scd-helper">Sélectionnez une session disponible pour continuer.</p>' : ''}
    </footer>
  `;
}

function buildRescheduleModalStep2Markup(payload, state) {
  const availableSessions = Array.isArray(payload?.availableSessions) ? payload.availableSessions : [];
  const selectedSession = availableSessions.find(item => item.id === state.selectedSessionId) || null;
  const requiredWaiverText = state.requiredWaiverText || '';
  const busyAction = String(state.loadingAction || '').trim();
  const isBusy = Boolean(busyAction);
  const canSubmit = selectedSession && (!requiredWaiverText || state.acceptedWaiver) && !isBusy;
  const submitContent = busyAction === 'reschedule'
    ? `${buildButtonPaws()}<span>Validation...</span>`
    : '<span>Confirmer le report</span>';

  return `
    <header class="scd-reschedule-modal__header">
      <h3>Confirmer le report</h3>
      <button type="button" class="scd-reschedule-modal__close" data-action="close-reschedule" aria-label="Fermer">&times;</button>
    </header>
    <div class="scd-reschedule-modal__body">
      <div class="scd-recap">
        <p class="scd-recap__name">${escapeHtml(payload?.formation?.name || 'Formation')}</p>
        <p class="scd-recap__date">
          Nouvelle date : ${escapeHtml(buildSessionSummaryLine(selectedSession || {}))} · ${escapeHtml(buildSessionTimeRangeLabel(selectedSession || {}))}
        </p>
      </div>
      ${requiredWaiverText ? `
        <div class="scd-waiver-box">
          ${buildWaiverCheckboxMarkup({ text: requiredWaiverText, checked: state.acceptedWaiver, disabled: isBusy })}
        </div>
      ` : ''}
    </div>
    <footer class="scd-reschedule-modal__footer">
      <button type="button" class="secondary-button" data-action="prev-step" ${isBusy ? 'disabled' : ''}>
        <i class="bi bi-arrow-left" aria-hidden="true"></i> Modifier
      </button>
      <button
        type="button"
        class="primary-button scd-submit-button"
        data-action="submit-reschedule"
        ${canSubmit ? '' : 'disabled'}
        ${busyAction === 'reschedule' ? 'aria-busy="true"' : ''}
      >
        ${submitContent}
      </button>
    </footer>
  `;
}

function buildRescheduleModalMarkup(payload, state) {
  const step = state.rescheduleStep || 1;
  const inner = step === 2
    ? buildRescheduleModalStep2Markup(payload, state)
    : buildRescheduleModalStep1Markup(payload, state);

  return `
    <div class="scd-reschedule-overlay" data-reschedule-overlay>
      <article class="scd-reschedule-modal${state.modalAnimated ? '' : ' scd-reveal'}" role="dialog" aria-modal="true" aria-label="Choisir une nouvelle session">
        ${inner}
      </article>
    </div>
  `;
}

function bindRescheduleModalEvents(container, handlers = {}) {
  const overlay = container.querySelector('[data-reschedule-overlay]');
  if (!overlay || overlay.dataset.bound === 'true') return;
  overlay.dataset.bound = 'true';
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      handlers.onCloseReschedule?.();
      return;
    }
    if (event.target.closest('[data-action="close-reschedule"]')) {
      handlers.onCloseReschedule?.();
      return;
    }
    if (event.target.closest('[data-action="open-waiver-info"]')) {
      handlers.onOpenWaiverInfo?.();
      return;
    }
    if (event.target.closest('[data-action="next-step"]')) {
      handlers.onNextStep?.();
      return;
    }
    if (event.target.closest('[data-action="prev-step"]')) {
      handlers.onPrevStep?.();
      return;
    }
    if (event.target.closest('[data-action="submit-reschedule"]')) {
      handlers.onSubmitReschedule?.();
      return;
    }
  });
  overlay.addEventListener('change', event => {
    if (event.target.matches('[data-accept-waiver]')) {
      handlers.onToggleWaiver?.(Boolean(event.target.checked));
    }
  });
}

function syncRescheduleModal(container, payload, state, handlers = {}) {
  const current = container.querySelector('[data-reschedule-overlay]');
  if (!state.showReschedule) {
    // Destroy calendar before removing modal
    destroyCalendar();
    current?.remove();
    return;
  }
  const step = state.rescheduleStep || 1;
  const markup = buildRescheduleModalMarkup(payload, state);
  if (current) {
    // Destroy old calendar before re-rendering
    destroyCalendar();
    current.outerHTML = markup;
  } else {
    container.insertAdjacentHTML('beforeend', markup);
    state.modalAnimated = true;
  }
  bindRescheduleModalEvents(container, handlers);

  // Mount formation calendar in the mount point (only on step 1)
  if (step === 1) {
    const mountEl = container.querySelector('[data-scd-calendar-mount]');
    if (mountEl) {
      const availableSessions = Array.isArray(payload?.availableSessions) ? payload.availableSessions : [];
      _calendarInstance = createBookingCalendar({
        mode: 'formation',
        sessions: availableSessions,
        onSessionSelected: session => {
          handlers.onSelectSession?.(session.id);
        }
      });
      _calendarInstance.mount(mountEl);
    }
  }
}

function renderDecisionView(container, payload, state, handlers = {}) {
  const formation = payload?.formation || {};
  const flow = payload?.flow || {};
  const canceledSession = payload?.canceledSession || {};
  const updatedSession = payload?.updatedSession || {};
  const flowType = String(flow?.flowType || 'session_cancelled').trim();
  const busyAction = String(state.loadingAction || '').trim();
  const isBusy = Boolean(busyAction);
  const autoRefundDays = Number(flow.autoRefundDays) || 7;

  let cardTitle = 'Votre session a été annulée';
  let subtitleParts = [escapeHtml(formation?.name || 'Formation')];
  if (canceledSession?.startDate) {
    const d = new Date(canceledSession.startDate);
    if (!Number.isNaN(d.getTime())) {
      subtitleParts.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }));
      subtitleParts.push(d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    }
  }
  let deadlineText = flow.tokenExpiresAt ? `Décision avant le ${escapeHtml(formatDateTime(flow.tokenExpiresAt))}` : '';

  const actions = [];

  if (flowType === 'formation_deleted') {
    cardTitle = 'Votre formation a été supprimée';
    subtitleParts = [escapeHtml(formation?.name || 'Formation')];
    if (flow.tokenExpiresAt) {
      deadlineText = `Décision avant le ${escapeHtml(formatDateTime(flow.tokenExpiresAt))}`;
    }
    actions.push(`
      <button type="button" class="primary-button" data-action="choose-gift-card" ${isBusy ? 'disabled' : ''}>
        <i class="bi bi-gift" aria-hidden="true"></i>
        ${busyAction === 'gift-card' ? `${buildButtonPaws()}<span>Création...</span>` : '<span>Recevoir une carte cadeau</span>'}
      </button>
    `);
  }

  if (flowType === 'session_updated') {
    cardTitle = 'Votre session a été modifiée';
    const newDate = updatedSession?.startDate ? new Date(updatedSession.startDate) : null;
    subtitleParts = [escapeHtml(formation?.name || 'Formation')];
    if (newDate && !Number.isNaN(newDate.getTime())) {
      subtitleParts.push(newDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }));
      subtitleParts.push(newDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    }
    actions.push(`
      <button type="button" class="primary-button" data-action="choose-confirm" ${isBusy ? 'disabled' : ''}>
        <i class="bi bi-calendar-check" aria-hidden="true"></i>
        ${busyAction === 'confirm' ? `${buildButtonPaws()}<span>Validation...</span>` : '<span>Confirmer ma présence</span>'}
      </button>
    `);
  }

  if (flowType !== 'formation_deleted') {
    actions.push(`
      <button type="button" class="primary-button" data-action="open-reschedule" ${isBusy ? 'disabled' : ''}>
        <i class="bi bi-calendar-plus" aria-hidden="true"></i>
        ${busyAction === 'open-reschedule' ? `${buildButtonPaws()}<span>Ouverture...</span>` : '<span>Décaler ma session</span>'}
      </button>
    `);
  }

  actions.push(`
    <button type="button" class="danger-button" data-action="choose-refund" ${isBusy ? 'disabled' : ''}>
      <i class="bi bi-cash" aria-hidden="true"></i>
      ${busyAction === 'refund' ? `${buildButtonPaws()}<span>Validation...</span>` : '<span>Demander un remboursement</span>'}
    </button>
  `);

  container.innerHTML = `
    <section class="scd-shell">
      <article class="scd-card scd-reveal">
        <h2 class="scd-card__title">${escapeHtml(cardTitle)}</h2>
        <p class="scd-card__subtitle">${subtitleParts.join(' · ')}</p>
        ${deadlineText ? `<p class="scd-card__deadline"><i class="bi bi-clock" aria-hidden="true"></i> ${deadlineText}</p>` : ''}

        <hr class="scd-card__divider">

        <p class="scd-card__question">Que souhaitez-vous faire ?</p>

        <div class="scd-actions">
          ${actions.join('')}
        </div>

        <p class="scd-auto-refund-note">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          Sans réponse, remboursement automatique dans ${autoRefundDays} jours.
        </p>
      </article>
    </section>
  `;

  container.querySelector('[data-action="choose-refund"]')?.addEventListener('click', handlers.onRefund);
  container.querySelector('[data-action="open-reschedule"]')?.addEventListener('click', handlers.onOpenReschedule);
  container.querySelector('[data-action="choose-confirm"]')?.addEventListener('click', handlers.onConfirm);
  container.querySelector('[data-action="choose-gift-card"]')?.addEventListener('click', handlers.onGiftCard);
  syncRescheduleModal(container, payload, state, handlers);
}

function renderFinalState(container, title, description) {
  container.innerHTML = `
    <section class="scd-shell">
      <article class="scd-card scd-card--success">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </article>
    </section>
  `;
}

// ─── Service booking decision ─────────────────────────────────────────────

function formatDate(value) {
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(value) {
  const d = new Date(value || '');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}


function buildServiceRescheduleModalMarkup(serviceState) {
  const { selectedSlotStart, selectedSlotEnd, loadingAction } = serviceState;
  const isBusy = Boolean(loadingAction);
  const hasSlot = Boolean(selectedSlotStart && selectedSlotEnd);
  const canConfirm = hasSlot && !isBusy;

  const pad2 = n => String(n).padStart(2, '0');
  const fmtTime = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  return `
    <div class="scd-reschedule-overlay" data-reschedule-overlay>
      <article class="scd-reschedule-modal scd-reveal" role="dialog" aria-modal="true" aria-label="Choisir un nouveau créneau">
        <header class="scd-reschedule-modal__header">
          <h3>Choisir un nouveau créneau</h3>
          <button type="button" class="scd-reschedule-modal__close" data-action="close-service-reschedule" aria-label="Fermer">&times;</button>
        </header>
        <div class="scd-reschedule-modal__body">
          <!-- Service calendar component mount point -->
          <div class="scd-calendar-mount" data-scd-calendar-mount></div>
          ${hasSlot ? `
            <div class="scd-selection-summary is-visible">
              <p class="scd-selection-summary__label">Créneau sélectionné</p>
              <strong>${escapeHtml(new Date(selectedSlotStart).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</strong>
              <span>${escapeHtml(fmtTime(selectedSlotStart))} → ${escapeHtml(fmtTime(selectedSlotEnd))}</span>
            </div>
          ` : ''}
        </div>
        <footer class="scd-reschedule-modal__footer">
          <button
            type="button"
            class="primary-button scd-submit-button"
            data-action="submit-service-reschedule"
            ${canConfirm ? '' : 'disabled'}
            ${isBusy && loadingAction === 'service-reschedule' ? 'aria-busy="true"' : ''}
          >
            ${isBusy && loadingAction === 'service-reschedule'
              ? `${buildButtonPaws()}<span>Validation...</span>`
              : '<span>Confirmer ce créneau</span>'}
          </button>
          ${!canConfirm && !isBusy ? '<p class="muted scd-helper">Sélectionnez un créneau pour continuer.</p>' : ''}
        </footer>
      </article>
    </div>
  `;
}

function renderServiceDecisionView(container, payload, state, serviceState, handlers) {
  const flow = payload?.flow || {};
  const snap = payload?.serviceSnapshot || {};
  const bk = payload?.bookingSnapshot || {};
  const siteName = escapeHtml(payload?.siteName || 'Beauty Savage');
  const serviceName = escapeHtml(snap.name || 'Prestation');
  const serviceAvailable = Boolean(payload?.serviceAvailable);
  const busyAction = String(state.loadingAction || '').trim();
  const isBusy = Boolean(busyAction);
  const autoRefundDays = Number(flow.autoRefundDays) || 7;

  const bkStartAt = bk.startAt ? new Date(bk.startAt) : null;
  const bookingDateLabel = bkStartAt ? formatDate(bkStartAt) : '';
  const bookingTimeLabel = bkStartAt ? formatTime(bkStartAt) : '';

  const refundContent = busyAction === 'refund'
    ? `${buildButtonPaws()}<span>Validation...</span>`
    : '<span>Demander un remboursement</span>';
  const rescheduleContent = busyAction === 'open-service-reschedule'
    ? `${buildButtonPaws()}<span>Ouverture...</span>`
    : '<span>Choisir un nouveau créneau</span>';

  const subtitleParts = [serviceName];
  if (bookingDateLabel) subtitleParts.push(escapeHtml(bookingDateLabel));
  if (bookingTimeLabel) subtitleParts.push(escapeHtml(bookingTimeLabel));
  const deadlineText = flow.tokenExpiresAt ? `Décision avant le ${escapeHtml(formatDateTime(flow.tokenExpiresAt))}` : '';

  container.innerHTML = `
    <section class="scd-shell">
      <article class="scd-card scd-reveal">
        <h2 class="scd-card__title">Votre réservation a été annulée</h2>
        <p class="scd-card__subtitle">${subtitleParts.join(' · ')}</p>
        ${deadlineText ? `<p class="scd-card__deadline"><i class="bi bi-clock" aria-hidden="true"></i> ${deadlineText}</p>` : ''}

        <hr class="scd-card__divider">

        <p class="scd-card__question">Que souhaitez-vous faire ?</p>

        <div class="scd-actions">
          <button
            type="button"
            class="primary-button"
            data-action="open-service-reschedule"
            ${!serviceAvailable || isBusy ? 'disabled' : ''}
          >
            <i class="bi bi-calendar-plus" aria-hidden="true"></i>
            ${busyAction === 'open-service-reschedule'
              ? `${buildButtonPaws()}<span>Ouverture...</span>`
              : `<span>${serviceAvailable ? 'Choisir un nouveau créneau' : 'Prestation indisponible'}</span>`}
          </button>

          <button
            type="button"
            class="danger-button"
            data-action="choose-refund"
            ${isBusy ? 'disabled' : ''}
          >
            <i class="bi bi-cash" aria-hidden="true"></i>
            ${busyAction === 'refund'
              ? `${buildButtonPaws()}<span>Validation...</span>`
              : `<span>Demander un remboursement${Number(payload?.refundAmount) > 0 ? ` (${String(Number(payload.refundAmount).toFixed(2)).replace('.', ',')} €)` : ''}</span>`}
          </button>
        </div>

        <p class="scd-auto-refund-note">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          Sans réponse, remboursement automatique dans ${autoRefundDays} jours.
        </p>
      </article>
    </section>
  `;

  container.querySelector('[data-action="choose-refund"]')?.addEventListener('click', handlers.onRefund);
  container.querySelector('[data-action="open-service-reschedule"]')?.addEventListener('click', handlers.onOpenServiceReschedule);

  // Mount reschedule modal if open
  if (serviceState.showReschedule) {
    const markup = buildServiceRescheduleModalMarkup(serviceState);
    container.insertAdjacentHTML('beforeend', markup);
    bindServiceRescheduleModalEvents(container, serviceState, handlers);
  }
}

function bindServiceRescheduleModalEvents(container, serviceState, handlers) {
  const overlay = container.querySelector('[data-reschedule-overlay]');
  if (!overlay || overlay.dataset.bound === 'true') return;
  overlay.dataset.bound = 'true';

  overlay.addEventListener('click', event => {
    if (event.target === overlay) { handlers.onCloseServiceReschedule?.(); return; }
    if (event.target.closest('[data-action="close-service-reschedule"]')) { handlers.onCloseServiceReschedule?.(); return; }
    if (event.target.closest('[data-action="submit-service-reschedule"]')) { handlers.onSubmitServiceReschedule?.(); return; }
  });

  // Mount the service booking calendar into the mount point
  const mountEl = overlay.querySelector('[data-scd-calendar-mount]');
  if (mountEl && handlers._serviceId) {
    destroyCalendar();
    _calendarInstance = createBookingCalendar({
      mode: 'service',
      serviceId: handlers._serviceId,
      onSlotSelected: slot => {
        serviceState.selectedSlotStart = slot.start;
        serviceState.selectedSlotEnd = slot.end;
        serviceState.selectedSlotPractitionerId = slot.practitionerId || '';
        serviceState.selectedSlotKey = `${slot.start}|${slot.end}|${slot.practitionerId || ''}`;
        // Re-render the modal to show the selection summary and enable submit
        handlers._rerenderServiceModal?.();
      }
    });
    _calendarInstance.mount(mountEl);
  }
}

export async function renderPage(container, data = {}) {
  if (!container) return;
  container.classList.add('scd-page');
  const flowId = getQueryParam(data, 'flowId');
  const token = getQueryParam(data, 'token');

  if (!flowId || !token) {
    container.innerHTML = `
      <section class="scd-shell">
        <article class="scd-card">
          <h2>Lien invalide</h2>
          <p>Le lien de decision est incomplet.</p>
        </article>
      </section>
    `;
    return;
  }

  const state = {
    flowPayload: null,
    showReschedule: false,
    showSessionSelector: false,
    selectedSessionId: '',
    requiredWaiverText: '',
    acceptedWaiver: false,
    loadingAction: '',
    modalAnimated: false,
    rescheduleStep: 1
  };

  // ── Service booking state ──────────────────────────���───────────────────
  const serviceState = {
    showReschedule: false,
    selectedSlotKey: '',
    selectedSlotStart: '',
    selectedSlotEnd: '',
    selectedSlotPractitionerId: ''
  };

  const loadFlow = async () => {
    container.innerHTML = buildLoader('Chargement de votre decision...');
    const payload = await fetchJson(
      `/api/client/session-cancel-flows/${encodeURIComponent(flowId)}?token=${encodeURIComponent(token)}`
    );
    state.flowPayload = payload;
    const selected = (payload?.availableSessions || []).find(item => item.id === state.selectedSessionId);
    if (!selected || !isSessionSelectable(selected)) {
      state.selectedSessionId = '';
      state.requiredWaiverText = '';
      state.acceptedWaiver = false;
    }
    state.showSessionSelector = false;
    state.modalAnimated = false;
    state.loadingAction = '';
    state.rescheduleStep = 1;
    renderDecision();
  };

  const renderDecision = () => {
    const payload = state.flowPayload || {};
    const flowType = String(payload?.flow?.flowType || 'session_cancelled').trim();
    const isServiceFlow = flowType === 'service_booking_cancelled';
    const serviceId = payload?.service?.id || payload?.serviceSnapshot?.serviceId || null;

    const handlers = {
      onRefund: async () => {
        if (state.loadingAction) return;
        const step1 = await openUiConfirmModal({
          title: 'Confirmer le remboursement',
          message: 'Vous allez demander un remboursement. Voulez-vous continuer ?',
          confirmLabel: 'Continuer',
          cancelLabel: 'Annuler',
          intent: 'danger'
        });
        if (!step1) return;

        const confirmed = await openKeywordModal();
        if (!confirmed) return;

        try {
          state.loadingAction = 'refund';
          renderDecision();
          await withMinDelay(
            () =>
              fetchJson(
                `/api/client/session-cancel-flows/${encodeURIComponent(flowId)}/refund`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    token,
                    confirmationKeyword: 'annulation'
                  })
                }
              ),
            1000
          );
          showToast({ type: 'success', message: 'Decision enregistree', durationMs: 1000 });
          renderFinalState(
            container,
            'Votre remboursement a ete demande',
            flowType === 'formation_deleted'
              ? 'Le remboursement de la formation supprimée a été enregistré.'
              : 'Une demande de remboursement a été envoyée. Vous recevrez un email de suivi.'
          );
        } catch (error) {
          state.loadingAction = '';
          showToast({ type: 'error', message: error.message || 'Action impossible', durationMs: 1000 });
          await loadFlow();
        }
      },
      onConfirm: async () => {
        if (state.loadingAction) return;
        const confirmed = await openUiConfirmModal({
          title: 'Confirmer votre présence',
          message: 'Vous allez conserver la session modifiée. Voulez-vous continuer ?',
          confirmLabel: 'Confirmer',
          cancelLabel: 'Annuler',
          intent: 'primary'
        });
        if (!confirmed) return;
        try {
          state.loadingAction = 'confirm';
          renderDecision();
          await withMinDelay(
            () =>
              fetchJson(
                `/api/client/session-cancel-flows/${encodeURIComponent(flowId)}/confirm`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token })
                }
              ),
            1000
          );
          showToast({ type: 'success', message: 'Session confirmee', durationMs: 1000 });
          renderFinalState(
            container,
            'Votre présence est confirmée',
            'La session modifiée est maintenant validée. Vous recevrez un email récapitulatif.'
          );
        } catch (error) {
          state.loadingAction = '';
          showToast({ type: 'error', message: error.message || 'Action impossible', durationMs: 1000 });
          await loadFlow();
        }
      },
      onGiftCard: async () => {
        if (state.loadingAction) return;
        const confirmed = await openUiConfirmModal({
          title: 'Recevoir une carte cadeau',
          message: 'Une carte cadeau sera créée au montant que vous avez payé. Voulez-vous continuer ?',
          confirmLabel: 'Creer la carte',
          cancelLabel: 'Annuler',
          intent: 'primary'
        });
        if (!confirmed) return;
        try {
          state.loadingAction = 'gift-card';
          renderDecision();
          await withMinDelay(
            () =>
              fetchJson(
                `/api/client/session-cancel-flows/${encodeURIComponent(flowId)}/gift-card`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token })
                }
              ),
            1000
          );
          showToast({ type: 'success', message: 'Carte cadeau créée', durationMs: 1000 });
          renderFinalState(
            container,
            'Votre carte cadeau est prete',
            'Un email contenant le code, le mot de passe et le solde vient de vous être envoyé.'
          );
        } catch (error) {
          state.loadingAction = '';
          showToast({ type: 'error', message: error.message || 'Action impossible', durationMs: 1000 });
          await loadFlow();
        }
      },
      onOpenReschedule: () => {
        if (state.loadingAction) return;
        state.showReschedule = true;
        state.showSessionSelector = false;
        state.modalAnimated = false;
        state.rescheduleStep = 1;
        renderDecision();
      },
      onCloseReschedule: () => {
        if (state.loadingAction) return;
        state.showReschedule = false;
        state.showSessionSelector = false;
        state.modalAnimated = false;
        state.rescheduleStep = 1;
        syncRescheduleModal(container, payload, state, handlers);
      },
      onOpenSessionSelector: () => {
        if (state.loadingAction) return;
        state.showSessionSelector = true;
        syncRescheduleModal(container, payload, state, handlers);
      },
      onCloseSessionSelector: () => {
        if (state.loadingAction) return;
        state.showSessionSelector = false;
        syncRescheduleModal(container, payload, state, handlers);
      },
      onSelectSession: sessionId => {
        if (state.loadingAction) return;
        state.selectedSessionId = String(sessionId || '').trim();
        const selected = (state.flowPayload?.availableSessions || []).find(
          item => item.id === state.selectedSessionId
        );
        if (!selected || !isSessionSelectable(selected)) {
          state.selectedSessionId = '';
          state.requiredWaiverText = '';
          state.acceptedWaiver = false;
          state.showSessionSelector = false;
          syncRescheduleModal(container, payload, state, handlers);
          return;
        }
        // Session selected — requiredWaiverText computed on next step
        state.showSessionSelector = false;
        // Only update the footer button state (step 1 — no full re-render needed)
        syncRescheduleModal(container, payload, state, handlers);
      },
      onNextStep: () => {
        if (state.loadingAction) return;
        const availableSessions = Array.isArray(payload?.availableSessions) ? payload.availableSessions : [];
        const selected = availableSessions.find(item => item.id === state.selectedSessionId);
        if (!selected || !isSessionSelectable(selected)) return;
        // Compute waiver text at step 2
        state.requiredWaiverText = computeRequiredWaiverText(selected.startDate, payload?.legal);
        state.acceptedWaiver = false;
        state.rescheduleStep = 2;
        syncRescheduleModal(container, payload, state, handlers);
      },
      onPrevStep: () => {
        if (state.loadingAction) return;
        state.rescheduleStep = 1;
        state.requiredWaiverText = '';
        state.acceptedWaiver = false;
        syncRescheduleModal(container, payload, state, handlers);
      },
      onToggleWaiver: checked => {
        if (state.loadingAction) return;
        state.acceptedWaiver = Boolean(checked);
        syncRescheduleModal(container, payload, state, handlers);
      },
      onOpenWaiverInfo: () => {
        const selected = (state.flowPayload?.availableSessions || []).find(
          item => item.id === state.selectedSessionId
        );
        const subtitle = selected?.startDate
          ? `Votre session commence le ${formatDateTime(selected.startDate)}.`
          : '';
        openConsumerWaiverInfoModal({ subtitle });
      },
      // ── Service booking handlers ──────────────────────────────────────
      // _serviceId and _rerenderServiceModal are passed to bindServiceRescheduleModalEvents
      _serviceId: serviceId,
      _rerenderServiceModal: () => {
        // Update selection summary and footer button without destroying the mounted calendar
        const existingOverlay = container.querySelector('[data-reschedule-overlay]');
        if (!existingOverlay) return;

        const pad2l = n => String(n).padStart(2, '0');
        const fmtTime = iso => {
          const d = new Date(iso);
          return Number.isNaN(d.getTime()) ? '' : `${pad2l(d.getHours())}:${pad2l(d.getMinutes())}`;
        };

        const hasSlot = Boolean(serviceState.selectedSlotStart && serviceState.selectedSlotEnd);
        const canConfirm = hasSlot && !serviceState.loadingAction;

        // Update or insert selection summary
        let summaryEl = existingOverlay.querySelector('.scd-selection-summary');
        if (hasSlot) {
          const summaryHtml = `
            <div class="scd-selection-summary is-visible">
              <p class="scd-selection-summary__label">Créneau sélectionné</p>
              <strong>${escapeHtml(new Date(serviceState.selectedSlotStart).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</strong>
              <span>${escapeHtml(fmtTime(serviceState.selectedSlotStart))} → ${escapeHtml(fmtTime(serviceState.selectedSlotEnd))}</span>
            </div>
          `;
          if (summaryEl) {
            summaryEl.outerHTML = summaryHtml;
          } else {
            // Insert before footer
            const footer = existingOverlay.querySelector('.scd-reschedule-modal__footer');
            const body = existingOverlay.querySelector('.scd-reschedule-modal__body');
            if (body) body.insertAdjacentHTML('beforeend', summaryHtml);
          }
        }

        // Update submit button state
        const submitBtn = existingOverlay.querySelector('[data-action="submit-service-reschedule"]');
        if (submitBtn) {
          submitBtn.disabled = !canConfirm;
        }

        // Remove helper text if slot selected
        if (hasSlot) {
          existingOverlay.querySelector('.scd-helper')?.remove();
        }
      },
      onOpenServiceReschedule: () => {
        if (state.loadingAction) return;
        serviceState.showReschedule = true;
        serviceState.selectedSlotKey = '';
        serviceState.selectedSlotStart = '';
        serviceState.selectedSlotEnd = '';
        serviceState.selectedSlotPractitionerId = '';
        renderDecision();
      },
      onCloseServiceReschedule: () => {
        if (state.loadingAction) return;
        serviceState.showReschedule = false;
        destroyCalendar();
        renderDecision();
      },
      onSubmitServiceReschedule: async () => {
        if (state.loadingAction) return;
        if (!serviceState.selectedSlotStart || !serviceState.selectedSlotEnd) return;
        try {
          state.loadingAction = 'service-reschedule';
          renderDecision();
          await withMinDelay(
            () => fetchJson(
              `/api/client/session-cancel-flows/${encodeURIComponent(flowId)}/service-reschedule`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  token,
                  chosenSlotStart: serviceState.selectedSlotStart,
                  chosenSlotEnd: serviceState.selectedSlotEnd,
                  practitionerId: serviceState.selectedSlotPractitionerId || null,
                  acceptedCgv: true
                })
              }
            ),
            1000
          );
          showToast({ type: 'success', message: 'Nouveau créneau confirmé', durationMs: 1000 });
          renderFinalState(
            container,
            'Votre nouveau créneau est confirmé',
            'Vous allez recevoir un email de confirmation avec les détails de votre réservation.'
          );
        } catch (error) {
          state.loadingAction = '';
          if (error?.code === 'SLOT_UNAVAILABLE' || error?.message === 'SLOT_UNAVAILABLE') {
            showToast({ type: 'error', message: 'Ce créneau n\'est plus disponible. Veuillez choisir une autre date.', durationMs: 4000 });
            serviceState.rescheduleStep = 1;
            serviceState.selectedSlotKey = '';
            serviceState.selectedSlotStart = '';
            serviceState.selectedSlotEnd = '';
            serviceState.selectedSlotPractitionerId = '';
            renderDecision();
          } else {
            showToast({ type: 'error', message: error.message || 'Action impossible', durationMs: 1000 });
            await loadFlow();
          }
        }
      },
      onSubmitReschedule: async () => {
        if (state.loadingAction) return;
        if (!state.selectedSessionId) return;
        if (state.requiredWaiverText && !state.acceptedWaiver) return;
        try {
          state.loadingAction = 'reschedule';
          renderDecision();
          await withMinDelay(
            () =>
              fetchJson(
                `/api/client/session-cancel-flows/${encodeURIComponent(flowId)}/reschedule`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    token,
                    chosenSessionId: state.selectedSessionId,
                    acceptedCgv: true,
                    renonciation_text: state.requiredWaiverText || ''
                  })
                }
              ),
            1000
          );
          showToast({ type: 'success', message: 'Nouvelle session confirmee', durationMs: 1000 });
          renderFinalState(
            container,
            'Votre nouvelle session est confirmee',
            'Vous allez recevoir un email de confirmation avec les détails.'
          );
        } catch (error) {
          state.loadingAction = '';
          showToast({ type: 'error', message: error.message || 'Action impossible', durationMs: 1000 });
          await loadFlow();
        }
      }
    };

    if (isServiceFlow) {
      renderServiceDecisionView(container, payload, state, serviceState, handlers);
    } else {
      renderDecisionView(container, payload, state, handlers);
    }

    // Filet de sécurité mobile — force la visibilité si l'animation CSS est bloquée
    setTimeout(() => {
      container.querySelectorAll('.scd-reveal').forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      });
      container.querySelectorAll('.scd-card').forEach(card => {
        card.style.backgroundColor = '#ffffff';
        card.style.color = '#0f172a';
      });
    }, 300);
  };

  try {
    await loadFlow();
  } catch (error) {
    container.innerHTML = `
      <section class="scd-shell">
        <article class="scd-card">
          <h2>Lien indisponible</h2>
          <p>${escapeHtml(error.message || 'Impossible de charger cette page.')}</p>
        </article>
      </section>
    `;
  }
}

