import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { openConsumerWaiverInfoModal } from '../helpers/consumerWaiverModal.js';
import { RETRACTATION_DAYS } from '../constants/consumerWaiver.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';
import { openUiConfirmModal } from './uiConfirmModal.js';

const API_BASE = '/api/client/formations';
const AVAILABLE_SESSIONS_ENDPOINT = formationId => `/api/vitrine/formations/${formationId}/sessions`;
const CHANGE_SESSION_ENDPOINT = formationId => `/api/client/formations/${formationId}/change-session`;
const CANCEL_FORMATION_ENDPOINT = formationId => `/api/client/formations/${formationId}/cancel`;
const AUTH_ME_ENDPOINT = '/auth/me';
const DISTANCIEL_PROGRESS_KEY_PREFIX = 'beautysavage_progress';
const DISTANCIEL_TAB_ICONS = ['bi-journal-richtext', 'bi-play-circle', 'bi-collection-play', 'bi-file-earmark-text'];
const DISTANCIEL_CONTENT_TAB_DESCRIPTION = 'description';
const DISTANCIEL_CONTENT_TAB_VIDEOS = 'videos';
const DISTANCIEL_CONTENT_TAB_FILES = 'files';
const CANCELLATION_CONFIRM_KEYWORD = 'annulation';

let currentUserIdPromise = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(value) {
  if (!value) return 'Heure inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Heure inconnue';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return `${formatDate(date)} a ${formatTime(date)}`;
}

function getRemainingTimeParts(targetDate, now = new Date()) {
  const target = targetDate instanceof Date ? targetDate : new Date(targetDate || '');
  if (Number.isNaN(target.getTime())) {
    return { valid: false, totalMs: 0, days: 0, hours: 0, minutes: 0 };
  }
  const deltaMs = target.getTime() - now.getTime();
  if (deltaMs <= 0) {
    return { valid: true, totalMs: 0, days: 0, hours: 0, minutes: 0 };
  }
  const totalMinutes = Math.floor(deltaMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  const minutes = Math.max(0, totalMinutes - days * 24 * 60 - hours * 60);
  return { valid: true, totalMs: deltaMs, days, hours, minutes };
}

function formatRemainingCountdown(parts) {
  if (!parts?.valid) return 'Session introuvable';
  if ((parts?.totalMs || 0) <= 0) return 'La session a déjà commencé.';
  return `${parts.days} jours ${parts.hours} heures ${parts.minutes} minutes`;
}

function buildSessionScheduleList(schedule = []) {
  if (!Array.isArray(schedule) || !schedule.length) {
    return '<p class="muted">Horaires non définis.</p>';
  }
  return schedule
    .map(
      entry => `<p class="muted">Jour ${entry.dayIndex} : ${escapeHtml(entry.startTime)} - ${escapeHtml(
        entry.endTime
      )}</p>`
    )
    .join('');
}

function renderStatus(container, message) {
  if (!container) return;
  container.innerHTML = `
    <div class="status-banner status-empty">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

async function fetchJson(path) {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = payload?.error || 'Erreur réseau';
    throw new Error(error);
  }
  return response.json();
}

function buildPurchaseQuery(purchase) {
  const purchaseId = String(purchase?.id || '').trim();
  if (!purchaseId) return '';
  return `?purchaseId=${encodeURIComponent(purchaseId)}`;
}

async function loadModules(formationId) {
  const payload = await fetchJson(`${API_BASE}/${formationId}/modules`);
  return Array.isArray(payload.modules) ? payload.modules : [];
}

async function loadSession(formationId, purchase = null) {
  const payload = await fetchJson(`${API_BASE}/${formationId}/session${buildPurchaseQuery(purchase)}`);
  return {
    session: payload.session || null,
    refundEligibility: payload.refundEligibility || null
  };
}

async function loadParticipants(formationId, purchase = null) {
  const payload = await fetchJson(`${API_BASE}/${formationId}/participants${buildPurchaseQuery(purchase)}`);
  return Array.isArray(payload.participants) ? payload.participants : [];
}

async function loadAvailableSessions(formationId) {
  try {
    const response = await fetch(AVAILABLE_SESSIONS_ENDPOINT(formationId));
    if (!response.ok) {
      return [];
    }
    const payload = await response.json().catch(() => ({}));
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  } catch (error) {
    console.error('Erreur chargement sessions disponibles', error);
    return [];
  }
}

function formatSessionDuration(session) {
  return session.durationLabel || `${session.durationDays || 1} jour${session.durationDays > 1 ? 's' : ''}`;
}

function isSessionAvailable(session) {
  const remaining = Number.isFinite(Number(session.placesRemaining))
    ? Number(session.placesRemaining)
    : Math.max(0, Number(session.maxClients || 0) - Number(session.reservedCount || 0));
  if (typeof session.isAvailable === 'boolean') {
    return session.isAvailable && remaining > 0;
  }
  return remaining > 0;
}

function renderHeader(container, formation, onBack) {
  if (!container) return;
  const cover = String(formation?.coverImage || '').trim();
  const typeLabel = getFormationTypeLabel(formation?.type);
  container.innerHTML = `
    <header class="myf-detail-header">
      ${
        onBack
          ? `
            <button class="myf-back-link" type="button" data-formation-detail-back>
              <i class="bi bi-arrow-left" aria-hidden="true"></i>
              Retour aux formations
            </button>
          `
          : ''
      }
      <div class="myf-detail-hero">
        <div class="myf-detail-hero__cover">
          ${
            cover
              ? `<img src="${escapeHtml(cover)}" alt="Couverture ${escapeHtml(formation.name || 'formation')}" loading="lazy">`
              : '<span class="myf-detail-hero__cover-fallback"><i class="bi bi-image" aria-hidden="true"></i></span>'
          }
        </div>
        <div class="myf-detail-hero__content">
          <span class="myf-detail-hero__type">${escapeHtml(typeLabel)}</span>
          <h2>${escapeHtml(formation.name || 'Formation')}</h2>
          <p class="muted">${escapeHtml(formation.previewDescription || formation.description || 'Details disponibles apres achat.')}</p>
        </div>
      </div>
    </header>
    <div data-formation-detail-body></div>
  `;
  if (onBack) {
    const backButton = container.querySelector('[data-formation-detail-back]');
    backButton?.addEventListener('click', event => {
      event.preventDefault();
      onBack();
    });
  }
}

function sortModulesByOrder(modules = []) {
  return [...modules].sort((left, right) => {
    const leftOrder = Number.isFinite(Number(left?.order)) ? Number(left.order) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(Number(right?.order)) ? Number(right.order) : Number.MAX_SAFE_INTEGER;
    if (leftOrder != rightOrder) return leftOrder - rightOrder;
    return String(left?.title || '').localeCompare(String(right?.title || ''), 'fr', { sensitivity: 'base' });
  });
}

async function loadCurrentUserId() {
  if (!currentUserIdPromise) {
    currentUserIdPromise = fetch(AUTH_ME_ENDPOINT, { credentials: 'include' })
      .then(response => (response.ok ? response.json().catch(() => ({})) : {}))
      .then(payload => {
        const userId = String(payload?.user?.id || payload?.id || '').trim();
        return userId || 'anonymous';
      })
      .catch(() => 'anonymous');
  }
  return currentUserIdPromise;
}

function buildProgressStorageKey(userId, formationId) {
  return `${DISTANCIEL_PROGRESS_KEY_PREFIX}_${userId}_${formationId}`;
}

function readStoredProgress(storageKey) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { completedModuleIds: new Set(), activeModuleId: '' };
  }
  if (!storageKey) return { completedModuleIds: new Set(), activeModuleId: '' };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { completedModuleIds: new Set(), activeModuleId: '' };
    const parsed = JSON.parse(raw);
    const completedModuleIds = new Set(
      Array.isArray(parsed?.completedModuleIds)
        ? parsed.completedModuleIds.map(entry => String(entry || '').trim()).filter(Boolean)
        : []
    );
    const activeModuleId = String(parsed?.activeModuleId || '').trim();
    return { completedModuleIds, activeModuleId };
  } catch (error) {
    console.debug('[MyFormationDetail] local progress read failed', error);
    return { completedModuleIds: new Set(), activeModuleId: '' };
  }
}

function persistProgress(storageKey, completedModuleIds, activeModuleId) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (!storageKey) return;
  const payload = {
    completedModuleIds: Array.from(completedModuleIds || []),
    activeModuleId: String(activeModuleId || ''),
    updatedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch (error) {
    console.debug('[MyFormationDetail] local progress persist failed', error);
  }
}

function resolveEmbeddableVideoUrl(rawValue) {
  const source = String(rawValue || '').trim();
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname.includes('youtube.com')) {
      const videoId = url.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
      }
      return url.href;
    }
    if (hostname === 'youtu.be') {
      const shortId = url.pathname.split('/').filter(Boolean)[0];
      if (shortId) {
        return `https://www.youtube.com/embed/${encodeURIComponent(shortId)}`;
      }
    }
    if (hostname.includes('vimeo.com') && !hostname.includes('player.vimeo.com')) {
      const vimeoId = url.pathname.split('/').filter(Boolean)[0];
      if (vimeoId && /^\d+$/.test(vimeoId)) {
        return `https://player.vimeo.com/video/${vimeoId}`;
      }
    }
    return url.href;
  } catch (error) {
    return null;
  }
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${Math.round(size)} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function getNormalizedModuleVideos(module = {}) {
  const items = Array.isArray(module.videoItems)
    ? module.videoItems
    : Array.isArray(module.videos)
      ? module.videos.map(url => ({ url }))
      : [];
  return [...items]
    .map((entry, index) => {
      const url = String(entry?.url || entry?.embedUrl || '').trim();
      if (!url) return null;
      const embedUrl = resolveEmbeddableVideoUrl(url);
      if (!embedUrl) return null;
      return {
        id: String(entry?.id || `${index + 1}-${url}`),
        title: String(entry?.title || '').trim() || `Video ${index + 1}`,
        embedUrl,
        description: String(entry?.previewDescription || entry?.description || '').trim(),
        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index + 1
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);
}

function getNormalizedModuleFiles(module = {}) {
  const items = Array.isArray(module.files) ? module.files : [];
  return [...items]
    .map((entry, index) => {
      const url = String(entry?.url || '').trim();
      if (!url) return null;
      return {
        id: String(entry?.fileId || entry?.id || `${index + 1}-${url}`),
        title: String(entry?.title || '').trim() || String(entry?.name || '').trim() || `Fichier ${index + 1}`,
        name: String(entry?.name || '').trim() || `fichier-${index + 1}`,
        url,
        size: formatFileSize(entry?.size),
        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index + 1
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);
}

function resolveInitialActiveModuleIndex(modules, completedModuleIds, activeModuleId) {
  if (!Array.isArray(modules) || !modules.length) return 0;
  if (activeModuleId) {
    const activeIndex = modules.findIndex(entry => String(entry.id || '') === activeModuleId);
    if (activeIndex >= 0) return activeIndex;
  }
  const firstIncompleteIndex = modules.findIndex(entry => !completedModuleIds.has(String(entry.id || '')));
  if (firstIncompleteIndex >= 0) return firstIncompleteIndex;
  return modules.length - 1;
}

function buildDistancielTabsHtml(modules = []) {
  return modules
    .map((module, index) => {
      const shortTitle = String(module?.title || `Module ${index + 1}`).trim();
      const iconClass = DISTANCIEL_TAB_ICONS[index % DISTANCIEL_TAB_ICONS.length];
      return `
        <button
          type="button"
          class="myf-module-tab"
          role="tab"
          tabindex="-1"
          data-myf-module-tab
          data-module-index="${index}"
          title="${escapeHtml(shortTitle)}"
        >
          <span class="myf-module-tab__icon">
            <i class="bi ${iconClass}" aria-hidden="true"></i>
            <i class="bi bi-check2 myf-module-tab__done" aria-hidden="true"></i>
          </span>
          <span class="myf-module-tab__label">${escapeHtml(shortTitle)}</span>
        </button>
      `;
    })
    .join('');
}

function renderDistancielWorkspace(container, formation, modules, purchase) {
  const hasReview = Boolean(purchase?.hasReview);
  container.innerHTML = `
    <div class="module-panel myf-distanciel-workspace" data-myf-distanciel-workspace>
      <header class="myf-distanciel-header">
        <div>
          <h3>Parcours distanciel</h3>
          <p class="muted">${escapeHtml(formation.name || 'Formation')}</p>
        </div>
        <p class="myf-distanciel-progress-meta muted" data-myf-progress-meta></p>
      </header>
      <div class="myf-module-tabs-nav" data-myf-module-tabs-nav>
        <div class="myf-module-tabs-shell" data-myf-module-tabs-shell>
          <div class="myf-module-tabs-track" role="tablist" aria-label="Modules de formation" data-myf-module-tabs-track>
            ${buildDistancielTabsHtml(modules)}
            <span class="myf-module-tabs-arrow" data-myf-module-tabs-arrow aria-hidden="true"></span>
          </div>
        </div>
      </div>
      <section class="manager-section myf-module-content-panel" data-myf-module-content></section>
      <button
        type="button"
        class="myf-review-fab"
        data-myf-open-review-modal
        ${hasReview ? 'disabled aria-disabled="true"' : ''}
      >
        ${hasReview ? 'Avis déjà envoyé' : 'Noter la formation'}
      </button>
      <div class="myf-review-modal-overlay" data-myf-review-modal hidden>
        <div class="myf-review-modal" role="dialog" aria-modal="true" aria-label="Noter la formation">
          <header class="myf-review-modal__header">
            <h4>Laisser un avis</h4>
            <button type="button" class="myf-review-modal__close" data-myf-close-review-modal aria-label="Fermer">
              <i class="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          </header>
          ${
            hasReview
              ? '<p class="muted">Vous avez déjà laissé un avis pour cette formation. Merci.</p>'
              : `
                <form data-myf-review-form>
                  <label>
                    Note
                    <select name="rating" required>
                      <option value="">Sélectionnez une note</option>
                      <option value="5">5 - Excellent</option>
                      <option value="4">4 - Très bien</option>
                      <option value="3">3 - Correct</option>
                      <option value="2">2 - Insatisfaisant</option>
                      <option value="1">1 - Décevant</option>
                    </select>
                  </label>
                  <label>
                    Commentaire
                    <textarea name="comment" rows="3" placeholder="Votre retour (facultatif)"></textarea>
                  </label>
                  <div class="form-actions">
                    <button class="primary-button" type="submit" data-myf-review-submit>Envoyer mon avis</button>
                  </div>
                  <p class="form-message" data-myf-review-feedback></p>
                </form>
              `
          }
        </div>
      </div>
    </div>
  `;
}

function getFormationTypeLabel(type = '') {
  return String(type || '').trim().toLowerCase() === 'presentiel' ? 'Présentielle' : 'Distancielle';
}

function computePresentielSessionEndDateTime(session) {
  if (!session?.startDate) return null;
  const startDate = new Date(session.startDate);
  if (Number.isNaN(startDate.getTime())) return null;
  const durationDays = Math.max(1, Math.floor(Number(session.durationDays) || 1));
  const schedule = Array.isArray(session.schedule) ? session.schedule : [];
  const byDay = new Map();
  schedule.forEach(entry => {
    const dayIndex = Number(entry?.dayIndex);
    if (!Number.isFinite(dayIndex)) return;
    const endTime = String(entry?.endTime || '').trim();
    if (!endTime) return;
    const existing = byDay.get(dayIndex);
    if (!existing || endTime > existing) {
      byDay.set(dayIndex, endTime);
    }
  });
  const lastScheduledDay = byDay.size ? Math.max(...byDay.keys()) : durationDays;
  const effectiveLastDay = Math.max(1, Math.min(durationDays, lastScheduledDay || durationDays));
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + effectiveLastDay - 1);
  const endTime = byDay.get(effectiveLastDay) || '23:59';
  const [hours, minutes] = String(endTime)
    .split(':')
    .map(value => Number(value));
  endDate.setHours(Number.isFinite(hours) ? hours : 23, Number.isFinite(minutes) ? minutes : 59, 0, 0);
  return endDate;
}

function positionDistancielTabArrow(workspace) {
  const arrow = workspace?.querySelector('[data-myf-module-tabs-arrow]');
  const activeTab = workspace?.querySelector('[data-myf-module-tab].is-active');
  if (!arrow || !activeTab) return;
  const left = Math.max(0, activeTab.offsetLeft + activeTab.offsetWidth / 2 - 8);
  const nextTransform = `translateX(${left}px)`;
  if (arrow.style.transform !== nextTransform) {
    arrow.style.transform = nextTransform;
  }
}

function formatSessionDateRange(session) {
  if (!session?.startDate) return 'Date non définie';
  const startDate = new Date(session.startDate);
  if (Number.isNaN(startDate.getTime())) return 'Date non définie';
  const durationDays = Math.max(1, Math.floor(Number(session.durationDays) || 1));
  if (durationDays <= 1) {
    return `${formatDate(startDate)} (${session.durationLabel || '1 jour'})`;
  }
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays - 1);
  return `${formatDate(startDate)} -> ${formatDate(endDate)} (${session.durationLabel || `${durationDays} jours`})`;
}

function buildSessionScheduleRows(schedule = []) {
  if (!Array.isArray(schedule) || !schedule.length) {
    return '<p class="muted">Horaires non definis.</p>';
  }
  return `
    <ul class="myf-presentiel-session-schedule-list">
      ${schedule
        .map(entry => {
          const dayLabel = Number.isFinite(Number(entry?.dayIndex)) ? `Jour ${Number(entry.dayIndex)}` : 'Jour';
          const startTime = String(entry?.startTime || '').trim() || '--:--';
          const endTime = String(entry?.endTime || '').trim() || '--:--';
          return `
            <li>
              <span>${escapeHtml(dayLabel)}</span>
              <strong>${escapeHtml(startTime)} - ${escapeHtml(endTime)}</strong>
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}

function buildPresentielSessionReservedBlock(formation, session) {
  if (!session) {
    return `
      <article class="myf-presentiel-session-card myf-presentiel-session-card--empty">
        <header class="myf-presentiel-session-card__header">
          <h3>
            <i class="bi bi-calendar-check" aria-hidden="true"></i>
            Session reservee
          </h3>
        </header>
        <p class="muted">Session non definie, contactez l'institut.</p>
      </article>
    `;
  }
  const formalities = String(formation?.formalities || '').trim();
  return `
    <article class="myf-presentiel-session-card">
      <header class="myf-presentiel-session-card__header">
        <h3>
          <i class="bi bi-calendar-check" aria-hidden="true"></i>
          Session reservee
        </h3>
      </header>
      <div class="myf-presentiel-session-grid">
        <section class="myf-presentiel-session-block">
          <p class="myf-presentiel-session-block__title">
            <i class="bi bi-calendar3" aria-hidden="true"></i>
            Dates
          </p>
          <p>${escapeHtml(formatSessionDateRange(session))}</p>
        </section>
        <section class="myf-presentiel-session-block">
          <p class="myf-presentiel-session-block__title">
            <i class="bi bi-clock-history" aria-hidden="true"></i>
            Horaires
          </p>
          ${buildSessionScheduleRows(session.schedule)}
        </section>
        ${
          formalities
            ? `
              <section class="myf-presentiel-session-block">
                <p class="myf-presentiel-session-block__title">
                  <i class="bi bi-info-circle" aria-hidden="true"></i>
                  Formalites
                </p>
                <p>${escapeHtml(formalities).replace(/\n/g, '<br>')}</p>
              </section>
            `
            : ''
        }
      </div>
    </article>
  `;
}

function normalizeRefundDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(0, Math.floor(parsed));
}

function getPresentielRefundDeadline(sessionStartAt, refundDays = 7) {
  const target = new Date(sessionStartAt || '');
  if (Number.isNaN(target.getTime())) return null;
  return new Date(target.getTime() - normalizeRefundDays(refundDays) * 24 * 60 * 60 * 1000);
}

function buildRefundableExplanation(refundDays) {
  return `Remboursable jusqu a ${normalizeRefundDays(refundDays)} jours avant la session ou dans les ${RETRACTATION_DAYS} jours suivant votre achat (sans renonciation).`;
}

function buildNonRefundableExplanation(refundEligibility, refundDays) {
  const reason = String(refundEligibility?.reason || 'none').trim();
  if (reason === 'none' && refundEligibility?.waiverSigned && Number(refundEligibility?.daysSincePurchase) < RETRACTATION_DAYS) {
    return 'Non remboursable: votre renonciation signee annule le droit legal de retractation.';
  }
  if (reason === 'none' && Number(refundEligibility?.daysSincePurchase) >= RETRACTATION_DAYS) {
    return `Non remboursable: le delai legal de retractation de ${RETRACTATION_DAYS} jours est depasse.`;
  }
  return `Non remboursable: la session est dans ${normalizeRefundDays(refundDays)} jours ou moins.`;
}

function isPresentielRefundEligible(refundEligibility) {
  return Boolean(refundEligibility?.eligibleRefund);
}

function buildPresentielCancellationCountdownMarkup(
  { sessionStartAt, refundDays, refundEligibility = null } = {},
  now = new Date()
) {
  const sessionStart = new Date(sessionStartAt || '');
  if (Number.isNaN(sessionStart.getTime())) {
    return '<p class="myf-cancel-card__timers-empty">Session introuvable.</p>';
  }

  const normalizedRefundDays = normalizeRefundDays(refundDays);
  const refundDeadline = getPresentielRefundDeadline(sessionStart, normalizedRefundDays);
  const refundCountdown = getRemainingTimeParts(refundDeadline, now);
  const cancellationCountdown = getRemainingTimeParts(sessionStart, now);

  const refundOpen = (refundCountdown?.totalMs || 0) > 0;
  const cancellationOpen = (cancellationCountdown?.totalMs || 0) > 0;
  const refundable = isPresentielRefundEligible(refundEligibility);

  const refundLabel = refundOpen ? `Encore ${formatRemainingCountdown(refundCountdown)}` : 'Delai depasse';
  const cancellationLabel = cancellationOpen
    ? `Encore ${formatRemainingCountdown(cancellationCountdown)}`
    : 'La session a deja commence';
  const explanation = refundable
    ? buildRefundableExplanation(normalizedRefundDays)
    : buildNonRefundableExplanation(refundEligibility, normalizedRefundDays);

  return `
    <div class="myf-cancel-card__timers">
      <article class="myf-cancel-card__timer myf-cancel-card__timer--refund${refundOpen ? '' : ' is-expired'}">
        <p class="myf-cancel-card__timer-title">
          <i class="bi bi-cash-coin" aria-hidden="true"></i>
          Annulation + remboursement
        </p>
        <p class="myf-cancel-card__timer-value">${escapeHtml(refundLabel)}</p>
        <p class="myf-cancel-card__timer-meta">${escapeHtml(`Jusqu'au ${formatDateTime(refundDeadline)}`)}</p>
      </article>
      <article class="myf-cancel-card__timer myf-cancel-card__timer--cancel${cancellationOpen ? '' : ' is-expired'}">
        <p class="myf-cancel-card__timer-title">
          <i class="bi bi-calendar2-check" aria-hidden="true"></i>
          Annulation simple
        </p>
        <p class="myf-cancel-card__timer-value">${escapeHtml(cancellationLabel)}</p>
        <p class="myf-cancel-card__timer-meta">${escapeHtml(`Jusqu'au ${formatDateTime(sessionStart)}`)}</p>
      </article>
    </div>
    <p class="muted">${escapeHtml(explanation)}</p>
  `;
}

function buildPresentielCancellationBlock(session, purchase, formation, refundEligibility = null) {
  const sessionStart = session?.startDate ? new Date(session.startDate) : null;
  const sessionValid = sessionStart && !Number.isNaN(sessionStart.getTime());
  const alreadyCanceled = String(purchase?.participationStatus || '').trim().toLowerCase() === 'canceled';
  const refundDays = normalizeRefundDays(formation?.refundDays);
  const countdownMarkup = buildPresentielCancellationCountdownMarkup({
    sessionStartAt: sessionValid ? sessionStart : null,
    refundDays,
    refundEligibility
  });
  const buttonLabel = alreadyCanceled ? 'Formation annulee' : 'Annuler ma formation';
  const buttonIcon = alreadyCanceled ? 'bi-check-circle' : 'bi-x-octagon';

  return `
    <section class="myf-cancel-card">
      <header class="myf-cancel-card__header">
        <h3><i class="bi bi-calendar-x" aria-hidden="true"></i>Annulation</h3>
      </header>
      <button
        type="button"
        class="danger-button myf-cancel-card__button"
        data-action="cancel-formation"
        ${alreadyCanceled ? 'disabled aria-disabled="true"' : ''}
      >
        <i class="bi ${buttonIcon}" aria-hidden="true"></i>
        <span class="myf-cancel-card__button-label">${buttonLabel}</span>
      </button>
      <div class="myf-cancel-card__hint" data-cancel-countdown>${countdownMarkup}</div>
      <button type="button" class="myf-cancel-card__info" data-action="open-cancel-info">
        <i class="bi bi-info-circle"></i>
        Plus d informations
      </button>
      ${alreadyCanceled ? '<span class="myf-cancel-card__badge">Annule</span>' : ''}
    </section>
  `;
}
function buildCancelModalLoader(label = 'Traitement...') {
  return `
    <div class="myf-cancel-loader" role="status" aria-live="polite" aria-busy="true">
      <span class="myf-cancel-loader__paw">${PAW_ICON_SVG}</span>
      <span class="myf-cancel-loader__paw myf-cancel-loader__paw--delay">${PAW_ICON_SVG}</span>
      <span class="myf-cancel-loader__paw myf-cancel-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      <p>${escapeHtml(label)}</p>
    </div>
  `;
}

function openCancellationTypingModal({ eligibleRefund = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'myf-review-modal-overlay';
    overlay.innerHTML = `
      <div class="myf-review-modal myf-cancel-modal" role="dialog" aria-modal="true" aria-label="Confirmation annulation">
        <header class="myf-review-modal__header">
          <h4>Validation finale</h4>
          <button type="button" class="myf-review-modal__close" data-close-cancel-modal aria-label="Fermer">
            <i class="bi bi-x-lg"></i>
          </button>
        </header>
        <p class="muted">
          ${
            eligibleRefund
              ? 'Cette annulation est éligible au remboursement.'
              : "Cette annulation n'est pas éligible au remboursement."
          }
        </p>
        <p class="muted">Tapez <strong>${escapeHtml(CANCELLATION_CONFIRM_KEYWORD)}</strong> pour confirmer.</p>
        <label class="myf-cancel-modal__field">
          Confirmation
          <input type="text" class="gcg-minimal-input" data-cancel-keyword-input autocomplete="off">
        </label>
        <div class="form-actions">
          <button type="button" class="secondary-button" data-close-cancel-modal>Annuler</button>
          <button type="button" class="danger-button" data-submit-cancel disabled>Valider l annulation</button>
        </div>
        <div data-cancel-loader-slot hidden></div>
      </div>
    `;

    const close = value => {
      overlay.classList.remove('is-visible');
      window.setTimeout(() => {
        overlay.remove();
        resolve(Boolean(value));
      }, 180);
    };

    const input = overlay.querySelector('[data-cancel-keyword-input]');
    const submitButton = overlay.querySelector('[data-submit-cancel]');
    const loaderSlot = overlay.querySelector('[data-cancel-loader-slot]');
    const closeButtons = overlay.querySelectorAll('[data-close-cancel-modal]');

    const refresh = () => {
      const matches = String(input?.value || '').trim().toLowerCase() === CANCELLATION_CONFIRM_KEYWORD;
      if (submitButton) {
        submitButton.disabled = !matches;
      }
    };

    input?.addEventListener('input', refresh);
    closeButtons.forEach(button => {
      button.addEventListener('click', () => close(false));
    });
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close(false);
    });

    submitButton?.addEventListener('click', () => {
      closeButtons.forEach(button => {
        button.disabled = true;
      });
      if (input) input.disabled = true;
      if (submitButton) submitButton.disabled = true;
      if (loaderSlot) {
        loaderSlot.hidden = false;
        loaderSlot.innerHTML = buildCancelModalLoader('Validation en cours...');
      }
      close(true);
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      input?.focus();
      refresh();
    });
  });
}

function renderPresentielCancellationResult(container, refundEligibility, formation, onBack) {
  if (!container) return;
  const eligibleRefund = isPresentielRefundEligible(refundEligibility);
  const refundDays = normalizeRefundDays(formation?.refundDays);
  const message = eligibleRefund
    ? 'Une demande de remboursement a ete envoyee. Vous recevrez une confirmation apres traitement.'
    : buildNonRefundableExplanation(refundEligibility, refundDays);
  container.innerHTML = `
    <section class="myf-cancel-success myf-cancel-success--enter">
      <span class="myf-cancel-success__icon" aria-hidden="true">
        <i class="bi ${eligibleRefund ? 'bi-check-circle' : 'bi-info-circle'}"></i>
      </span>
      <h3>Votre annulation a ete prise en compte.</h3>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary-button" data-action="back-to-my-formations">
        Retour a mes formations
      </button>
    </section>
  `;
  const backButton = container.querySelector('[data-action="back-to-my-formations"]');
  backButton?.addEventListener('click', () => {
    if (typeof onBack === 'function') {
      onBack();
    }
  });
}
function changeSessionCard(session) {
  if (!session) return '';
  const dateLabel = formatSessionDateRange(session);
  return `
    <article class="myf-presentiel-change-card">
      <div>
        <p class="myf-presentiel-change-card__date">
          <i class="bi bi-calendar-event" aria-hidden="true"></i>
          ${escapeHtml(dateLabel)}
        </p>
        <div class="myf-presentiel-change-card__schedule">${buildSessionScheduleRows(session.schedule)}</div>
      </div>
      <button type="button" class="secondary-button" data-change-session-button data-session-id="${escapeHtml(session.id)}">
        Choisir
      </button>
    </article>
  `;
}

function renderSessionInfo(
  container,
  formation,
  session,
  participants = [],
  purchase = null,
  refundEligibility = null
) {
  if (!container) return;
  const otherParticipants = Array.isArray(participants) ? participants : [];
  container.innerHTML = `
    ${buildPresentielSessionReservedBlock(formation, session)}
    ${buildPresentielCancellationBlock(session, purchase, formation, refundEligibility)}
    <section class="module-section myf-presentiel-participants">
      <header>
        <h3>Participants</h3>
      </header>
      ${
        otherParticipants.length
          ? `
            <ul class="myf-presentiel-participants-list">
              ${otherParticipants
                .map(
                  participant => `
                    <li>
                      <i class="bi bi-person" aria-hidden="true"></i>
                      <span>${escapeHtml(participant?.label || 'Participant')}</span>
                    </li>
                  `
                )
                .join('')}
            </ul>
          `
          : '<p class="muted">Aucun autre participant pour le moment.</p>'
      }
    </section>
  `;
}

function updateDistancielTabsOverflowState(workspace) {
  const shell = workspace?.querySelector('[data-myf-module-tabs-shell]');
  const leftButton = workspace?.querySelector('[data-myf-module-tabs-scroll="left"]');
  const rightButton = workspace?.querySelector('[data-myf-module-tabs-scroll="right"]');
  if (!shell || !leftButton || !rightButton) return;
  const maxScrollLeft = Math.max(0, shell.scrollWidth - shell.clientWidth);
  const hasOverflow = maxScrollLeft > 8;
  if (!hasOverflow) {
    leftButton.hidden = true;
    rightButton.hidden = true;
    return;
  }
  leftButton.hidden = false;
  rightButton.hidden = false;
  const atStart = shell.scrollLeft <= 4;
  const atEnd = shell.scrollLeft >= maxScrollLeft - 4;
  leftButton.disabled = atStart;
  rightButton.disabled = atEnd;
}

function scrollDistancielTabs(workspace, direction = 1) {
  const shell = workspace?.querySelector('[data-myf-module-tabs-shell]');
  if (!shell) return;
  shell.scrollBy({
    left: Math.max(120, Math.round(shell.clientWidth * 0.68)) * direction,
    behavior: 'smooth'
  });
}

function ensureActiveModuleTabVisible(workspace) {
  const shell = workspace?.querySelector('[data-myf-module-tabs-shell]');
  const activeTab = workspace?.querySelector('[data-myf-module-tab].is-active');
  if (!shell || !activeTab) return;
  const left = activeTab.offsetLeft;
  const right = left + activeTab.offsetWidth;
  const visibleLeft = shell.scrollLeft;
  const visibleRight = visibleLeft + shell.clientWidth;
  if (left < visibleLeft) {
    shell.scrollTo({ left: Math.max(0, left - 24), behavior: 'auto' });
    return;
  }
  if (right > visibleRight) {
    shell.scrollTo({ left: Math.max(0, right - shell.clientWidth + 24), behavior: 'auto' });
  }
}

function renderDistancielTabs(workspace, state) {
  if (!workspace || !state?.modules?.length) return;
  const progressMeta = workspace.querySelector('[data-myf-progress-meta]');
  if (progressMeta) {
    progressMeta.textContent = `${state.completedModuleIds.size}/${state.modules.length} modules termines`;
  }
  const tabButtons = workspace.querySelectorAll('[data-myf-module-tab]');
  tabButtons.forEach((tabButton, index) => {
    const module = state.modules[index];
    const moduleId = String(module?.id || '');
    const isActive = index === state.activeModuleIndex;
    const isDone = state.completedModuleIds.has(moduleId);
    tabButton.classList.toggle('is-active', isActive);
    tabButton.classList.toggle('is-done', isDone);
    tabButton.classList.toggle('is-future', !isDone && !isActive);
    tabButton.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tabButton.setAttribute('aria-current', isActive ? 'step' : 'false');
    tabButton.tabIndex = isActive ? 0 : -1;
  });
  positionDistancielTabArrow(workspace);
  ensureActiveModuleTabVisible(workspace);
  updateDistancielTabsOverflowState(workspace);
}

function buildVideoCarouselHtml(videos) {
  if (!videos.length) {
    return '<p class="module-placeholder">Aucune video disponible pour ce module.</p>';
  }
  return `
    <div class="myf-video-carousel" data-myf-video-carousel>
      <button
        type="button"
        class="myf-video-carousel__nav"
        data-myf-video-nav="prev"
        aria-label="Video precedente"
      >
        <i class="bi bi-chevron-left" aria-hidden="true"></i>
      </button>
      <div class="myf-video-carousel__viewport" data-myf-video-viewport>
        <div class="myf-video-carousel__track" data-myf-video-track>
          ${videos
            .map(
              video => `
                <article class="myf-module-video-card myf-video-slide">
                  <header class="myf-module-video-card__header">
                    <i class="bi bi-camera-video-fill" aria-hidden="true"></i>
                    <strong>${escapeHtml(video.title)}</strong>
                  </header>
                  <div class="module-video">
                    <iframe
                      src="${escapeHtml(video.embedUrl)}"
                      title="${escapeHtml(video.title)}"
                      loading="lazy"
                      allowfullscreen
                    ></iframe>
                  </div>
                  ${video.description ? `<p class="muted">${escapeHtml(video.description)}</p>` : ''}
                </article>
              `
            )
            .join('')}
        </div>
      </div>
      <button
        type="button"
        class="myf-video-carousel__nav"
        data-myf-video-nav="next"
        aria-label="Video suivante"
      >
        <i class="bi bi-chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  `;
}

function updateVideoCarouselButtons(workspace) {
  const viewport = workspace?.querySelector('[data-myf-video-viewport]');
  const prevButton = workspace?.querySelector('[data-myf-video-nav="prev"]');
  const nextButton = workspace?.querySelector('[data-myf-video-nav="next"]');
  if (!viewport || !prevButton || !nextButton) return;
  const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  if (maxScrollLeft <= 6) {
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }
  prevButton.disabled = viewport.scrollLeft <= 4;
  nextButton.disabled = viewport.scrollLeft >= maxScrollLeft - 4;
}

function buildFileCardsHtml(files) {
  if (!files.length) {
    return '<p class="module-placeholder">Aucun fichier annexe disponible.</p>';
  }
  return `
    <ul class="myf-module-files-list">
      ${files
        .map(
          file => `
            <li class="myf-module-file-item">
              <div class="myf-module-file-item__main">
                <i class="bi bi-file-earmark-text myf-module-file-item__icon" aria-hidden="true"></i>
                <div class="myf-module-file-item__meta">
                  <span>${escapeHtml(file.title)}</span>
                  ${file.size ? `<small>${escapeHtml(file.size)}</small>` : ''}
                </div>
              </div>
              <a
                href="${escapeHtml(file.url)}"
                target="_blank"
                rel="noreferrer noopener"
                class="myf-module-file-item__download"
                aria-label="Telecharger ${escapeHtml(file.title)}"
              >
                <i class="bi bi-download" aria-hidden="true"></i>
              </a>
            </li>
          `
        )
        .join('')}
    </ul>
  `;
}

function resolveAvailableContentTabs(hasVideos, hasFiles) {
  const tabs = [DISTANCIEL_CONTENT_TAB_DESCRIPTION];
  if (hasVideos) tabs.push(DISTANCIEL_CONTENT_TAB_VIDEOS);
  if (hasFiles) tabs.push(DISTANCIEL_CONTENT_TAB_FILES);
  return tabs;
}

function getContentTabLabel(tabName) {
  if (tabName === DISTANCIEL_CONTENT_TAB_VIDEOS) return 'Videos';
  if (tabName === DISTANCIEL_CONTENT_TAB_FILES) return 'Fichiers';
  return 'Descriptif';
}

function renderDistancielModuleContent(workspace, state, onBack) {
  const content = workspace?.querySelector('[data-myf-module-content]');
  if (!content || !state?.modules?.length) return;
  const module = state.modules[state.activeModuleIndex];
  if (!module) return;
  const moduleId = String(module.id || '');
  const videos = getNormalizedModuleVideos(module);
  const files = getNormalizedModuleFiles(module);
  const hasVideos = videos.length > 0;
  const hasFiles = files.length > 0;
  const availableTabs = resolveAvailableContentTabs(hasVideos, hasFiles);
  if (!availableTabs.includes(state.activeContentTab)) {
    state.activeContentTab = DISTANCIEL_CONTENT_TAB_DESCRIPTION;
  }
  const moduleDescription = String(module.previewDescription || module.description || module.legacyDescription || '').trim();
  const descriptionHtml = moduleDescription ? escapeHtml(moduleDescription).replace(/\n/g, '<br>') : '';
  const isLastModule = state.activeModuleIndex >= state.modules.length - 1;
  const isFormationCompleted = state.completedModuleIds.size >= state.modules.length;
  const nextButtonLabel = isLastModule ? "J'ai terminé cette formation" : "J'ai terminé ce module, suivant";
  let activePanelHtml = `
    <section class="module-section myf-module-section myf-module-section--description">
      <h5>Description</h5>
      ${
        descriptionHtml
          ? `<p class="muted">${descriptionHtml}</p>`
          : '<p class="module-placeholder">Aucun descriptif disponible pour ce module.</p>'
      }
    </section>
  `;
  if (state.activeContentTab === DISTANCIEL_CONTENT_TAB_VIDEOS && hasVideos) {
    activePanelHtml = `
      <section class="module-section myf-module-section myf-module-section--videos">
        <h5>Videos</h5>
        ${buildVideoCarouselHtml(videos)}
      </section>
    `;
  }
  if (state.activeContentTab === DISTANCIEL_CONTENT_TAB_FILES && hasFiles) {
    activePanelHtml = `
      <section class="module-section myf-module-section myf-module-section--files">
        <h5>Fichiers</h5>
        ${buildFileCardsHtml(files)}
      </section>
    `;
  }
  const completionCard =
    isFormationCompleted && isLastModule
      ? `
        <article class="myf-module-finished-state">
          <i class="bi bi-check2-circle" aria-hidden="true"></i>
          <div>
            <strong>Formation termin?e</strong>
            <p class="muted">Bravo, vous avez complete l'ensemble des modules.</p>
          </div>
          ${
            onBack
              ? '<button type="button" class="secondary-button" data-myf-back-to-formations>Revenir à mes formations</button>'
              : ''
          }
        </article>
      `
      : '';
  content.innerHTML = `
    <article class="myf-module-article" data-active-module-id="${escapeHtml(moduleId)}">
      <header class="myf-module-article__header">
        <p class="muted">Module ${state.activeModuleIndex + 1}/${state.modules.length}</p>
        <h4>${escapeHtml(module.title || `Module ${state.activeModuleIndex + 1}`)}</h4>
      </header>
      <nav class="myf-module-content-tabs" role="tablist" aria-label="Contenu du module">
        ${availableTabs
          .map(tabName => {
            const isActive = tabName === state.activeContentTab;
            return `
              <button
                type="button"
                class="myf-module-content-tab ${isActive ? 'is-active' : ''}"
                data-myf-content-tab="${tabName}"
                role="tab"
                aria-selected="${isActive ? 'true' : 'false'}"
              >
                ${getContentTabLabel(tabName)}
              </button>
            `;
          })
          .join('')}
      </nav>
      <div class="myf-module-content-active-panel" data-myf-active-content-panel>
        ${activePanelHtml}
      </div>
      <div class="myf-module-actions">
        <button type="button" class="primary-button" data-myf-complete-next>${nextButtonLabel}</button>
      </div>
      ${completionCard}
    </article>
  `;
  const videoViewport = workspace.querySelector('[data-myf-video-viewport]');
  if (videoViewport && videoViewport.dataset.boundScroll !== 'true') {
    videoViewport.dataset.boundScroll = 'true';
    videoViewport.addEventListener(
      'scroll',
      () => {
        updateVideoCarouselButtons(workspace);
      },
      { passive: true }
    );
  }
  updateVideoCarouselButtons(workspace);
}

function updateDistancielState(workspace, state, onBack) {
  renderDistancielTabs(workspace, state);
  renderDistancielModuleContent(workspace, state, onBack);
  const activeModule = state.modules[state.activeModuleIndex];
  persistProgress(state.storageKey, state.completedModuleIds, activeModule?.id || '');
}

function attachDistancielWorkspaceEvents(workspace, state, onBack) {
  if (!workspace || workspace.dataset.eventsBound === 'true') return;
  workspace.dataset.eventsBound = 'true';
  const reviewModal = workspace.querySelector('[data-myf-review-modal]');
  const closeReviewModal = () => {
    if (!reviewModal) return;
    reviewModal.setAttribute('hidden', '');
    reviewModal.classList.remove('is-visible');
  };
  const openReviewModal = () => {
    if (!reviewModal) return;
    reviewModal.removeAttribute('hidden');
    requestAnimationFrame(() => {
      reviewModal.classList.add('is-visible');
    });
    const firstField = reviewModal.querySelector('[name="rating"]');
    firstField?.focus();
  };

  workspace.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-myf-module-tab]');
    if (tabButton) {
      const nextIndex = Number(tabButton.dataset.moduleIndex);
      if (Number.isFinite(nextIndex) && nextIndex >= 0 && nextIndex < state.modules.length) {
        state.activeModuleIndex = nextIndex;
        state.activeContentTab = DISTANCIEL_CONTENT_TAB_DESCRIPTION;
        updateDistancielState(workspace, state, onBack);
      }
      return;
    }

    const tabsScrollButton = event.target.closest('[data-myf-module-tabs-scroll]');
    if (tabsScrollButton) {
      const direction = tabsScrollButton.dataset.myfModuleTabsScroll === 'left' ? -1 : 1;
      scrollDistancielTabs(workspace, direction);
      return;
    }

    const contentTabButton = event.target.closest('[data-myf-content-tab]');
    if (contentTabButton) {
      const nextTab = String(contentTabButton.dataset.myfContentTab || '').trim();
      if (nextTab && nextTab !== state.activeContentTab) {
        state.activeContentTab = nextTab;
        updateDistancielState(workspace, state, onBack);
      }
      return;
    }

    const videoNavButton = event.target.closest('[data-myf-video-nav]');
    if (videoNavButton) {
      const viewport = workspace.querySelector('[data-myf-video-viewport]');
      if (viewport) {
        const direction = videoNavButton.dataset.myfVideoNav === 'prev' ? -1 : 1;
        viewport.scrollBy({
          left: Math.max(220, Math.round(viewport.clientWidth * 0.88)) * direction,
          behavior: 'smooth'
        });
      }
      return;
    }

    const completeButton = event.target.closest('[data-myf-complete-next]');
    if (completeButton) {
      const activeModule = state.modules[state.activeModuleIndex];
      if (!activeModule) return;
      state.completedModuleIds.add(String(activeModule.id || ''));
      if (state.activeModuleIndex < state.modules.length - 1) {
        state.activeModuleIndex += 1;
        state.activeContentTab = DISTANCIEL_CONTENT_TAB_DESCRIPTION;
      }
      updateDistancielState(workspace, state, onBack);
      return;
    }

    if (event.target.closest('[data-myf-open-review-modal]')) {
      if (!state.reviewAllowed) return;
      openReviewModal();
      return;
    }

    if (event.target.closest('[data-myf-close-review-modal]')) {
      closeReviewModal();
      return;
    }

    if (reviewModal && event.target === reviewModal) {
      closeReviewModal();
      return;
    }

    const backButton = event.target.closest('[data-myf-back-to-formations]');
    if (backButton && typeof onBack === 'function') {
      onBack();
    }
  });

  workspace.addEventListener('keydown', event => {
    const activeTab = event.target.closest('[data-myf-module-tab]');
    if (!activeTab) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const nextIndex =
      event.key === 'ArrowRight'
        ? Math.min(state.activeModuleIndex + 1, state.modules.length - 1)
        : Math.max(state.activeModuleIndex - 1, 0);
    if (nextIndex !== state.activeModuleIndex) {
      state.activeModuleIndex = nextIndex;
      state.activeContentTab = DISTANCIEL_CONTENT_TAB_DESCRIPTION;
      updateDistancielState(workspace, state, onBack);
      const targetTab = workspace.querySelector(`[data-myf-module-tab][data-module-index="${nextIndex}"]`);
      targetTab?.focus();
    }
  });

  workspace.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!reviewModal || reviewModal.hasAttribute('hidden')) return;
    event.preventDefault();
    closeReviewModal();
  });

  workspace.addEventListener('submit', async event => {
    const form = event.target.closest('[data-myf-review-form]');
    if (!form || !state.reviewAllowed) return;
    event.preventDefault();
    const ratingField = form.querySelector('[name="rating"]');
    const commentField = form.querySelector('[name="comment"]');
    const feedback = form.querySelector('[data-myf-review-feedback]');
    const submitButton = form.querySelector('[data-myf-review-submit]');
    const setFeedback = message => {
      if (!feedback) return;
      feedback.textContent = message || '';
    };
    const rating = Number(ratingField?.value || 0);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      setFeedback('Sélectionnez une note entre 1 et 5.');
      return;
    }
    if (submitButton) submitButton.disabled = true;
    setFeedback('');
    try {
      const response = await fetch(`/api/client/formations/${state.formationId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rating,
          comment: String(commentField?.value || '').trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Impossible d'envoyer votre avis.");
      }
      state.reviewAllowed = false;
      showToast({ type: 'success', message: 'Modifications enregistrées', durationMs: 1000 });
      closeReviewModal();
      const reviewFab = workspace.querySelector('[data-myf-open-review-modal]');
      if (reviewFab) {
        reviewFab.textContent = 'Avis déjà envoyé';
        reviewFab.disabled = true;
        reviewFab.setAttribute('aria-disabled', 'true');
      }
    } catch (error) {
      setFeedback(error.message || "Impossible d'envoyer votre avis.");
      showToast({ type: 'error', message: "Échec de l'enregistrement", durationMs: 1000 });
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  const tabsTrack = workspace.querySelector('[data-myf-module-tabs-track]');
  const tabsShell = workspace.querySelector('[data-myf-module-tabs-shell]');
  tabsShell?.addEventListener('scroll', () => {
    updateDistancielTabsOverflowState(workspace);
  }, { passive: true });
  if (tabsTrack && window.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      positionDistancielTabArrow(workspace);
      updateDistancielTabsOverflowState(workspace);
      updateVideoCarouselButtons(workspace);
    });
    observer.observe(tabsTrack);
    if (tabsShell) {
      observer.observe(tabsShell);
    }
  }
  updateDistancielTabsOverflowState(workspace);
  updateVideoCarouselButtons(workspace);
}

async function renderDistanciel(container, formation, onBack, purchase) {
  const modules = sortModulesByOrder(await loadModules(formation.id));
  if (!modules.length) {
    renderStatus(container, "Aucun module n'a encore ete publie pour cette formation.");
    return;
  }

  const userId = await loadCurrentUserId();
  const storageKey = buildProgressStorageKey(userId, formation.id);
  const storedProgress = readStoredProgress(storageKey);
  const validModuleIds = new Set(modules.map(module => String(module.id || '')));
  const completedModuleIds = new Set(
    Array.from(storedProgress.completedModuleIds).filter(moduleId => validModuleIds.has(moduleId))
  );
  const activeModuleIndex = resolveInitialActiveModuleIndex(modules, completedModuleIds, storedProgress.activeModuleId);
  const state = {
    modules,
    activeModuleIndex,
    completedModuleIds,
    storageKey,
    activeContentTab: DISTANCIEL_CONTENT_TAB_DESCRIPTION,
    formationId: String(formation.id || ''),
    reviewAllowed: !Boolean(purchase?.hasReview)
  };

  renderDistancielWorkspace(container, formation, modules, purchase);
  const workspace = container.querySelector('[data-myf-distanciel-workspace]');
  if (!workspace) {
    renderStatus(container, "Impossible d'afficher les modules distanciels.");
    return;
  }

  updateDistancielState(workspace, state, onBack);
  attachDistancielWorkspaceEvents(workspace, state, onBack);
}

function clearPresentielCountdownTimer(container) {
  if (!container) return;
  if (container.__myfCancelCountdownTimer) {
    window.clearInterval(container.__myfCancelCountdownTimer);
    container.__myfCancelCountdownTimer = null;
  }
}

async function renderPresentiel(container, formation, purchase, onBack) {
  clearPresentielCountdownTimer(container);
  const [sessionResult, participants] = await Promise.all([
    loadSession(formation.id, purchase),
    loadParticipants(formation.id, purchase)
  ]);
  const session = sessionResult?.session || null;
  let refundEligibility = sessionResult?.refundEligibility || null;
  renderSessionInfo(container, formation, session, participants, purchase, refundEligibility);

  const cancelHint = container.querySelector('[data-cancel-countdown]');
  const cancelButton = container.querySelector('[data-action="cancel-formation"]');
  const cancelCard = container.querySelector('.myf-cancel-card');
  const infoButton = container.querySelector('[data-action="open-cancel-info"]');
  const sessionStart = session?.startDate ? new Date(session.startDate) : null;
  const hasValidSessionStart = sessionStart && !Number.isNaN(sessionStart.getTime());

  const updateCancelHint = () => {
    if (!cancelHint) return;
    cancelHint.innerHTML = buildPresentielCancellationCountdownMarkup({
      sessionStartAt: hasValidSessionStart ? sessionStart : null,
      refundDays: formation?.refundDays,
      refundEligibility
    });
  };

  updateCancelHint();
  if (hasValidSessionStart) {
    container.__myfCancelCountdownTimer = window.setInterval(() => {
      if (!document.body.contains(container)) {
        clearPresentielCountdownTimer(container);
        return;
      }
      updateCancelHint();
    }, 60000);
  }

  infoButton?.addEventListener('click', () => {
    const buildSubtitle = () =>
      hasValidSessionStart
        ? `Votre session commence actuellement dans ${formatRemainingCountdown(
            getRemainingTimeParts(sessionStart)
          )}.`
        : 'Session introuvable.';
    openConsumerWaiverInfoModal({
      subtitle: buildSubtitle(),
      getSubtitle: buildSubtitle,
      liveSubtitleIntervalMs: 60000
    });
  });

  cancelButton?.addEventListener('click', async () => {
    if (!session?.id || !hasValidSessionStart) {
      showToast({ type: 'error', message: 'Session introuvable', durationMs: 1000 });
      logUiError('MyFormationDetail:CancelMissingSession', new Error('Session introuvable'), {
        formationId: formation?.id || null,
        session: session || null
      });
      return;
    }
    if (String(purchase?.participationStatus || '').trim().toLowerCase() === 'canceled') {
      return;
    }
    const eligibleRefund = isPresentielRefundEligible(refundEligibility);
    const confirmedStep1 = await openUiConfirmModal({
      title: 'Confirmer l annulation',
      confirmLabel: 'Continuer',
      cancelLabel: 'Annuler',
      intent: 'danger',
      allowHtml: true,
      message: `
        <p>Éligible au remboursement: <strong>${eligibleRefund ? 'OUI' : 'NON'}</strong></p>
        <p>Souhaitez-vous vraiment poursuivre l'annulation ?</p>
      `
    });
    if (!confirmedStep1) return;

    const confirmedStep2 = await openCancellationTypingModal({ eligibleRefund });
    if (!confirmedStep2) return;

    const startedAt = Date.now();
    const labelNode = cancelButton.querySelector('.myf-cancel-card__button-label');
    const originalLabel = labelNode ? labelNode.textContent : cancelButton.textContent;
    cancelCard?.classList.add('is-processing');
    cancelButton.disabled = true;
    if (labelNode) {
      labelNode.textContent = 'Annulation...';
    } else {
      cancelButton.textContent = 'Annulation...';
    }
    if (cancelHint) {
      cancelHint.innerHTML = buildCancelModalLoader('Validation de l annulation...');
    }
    try {
      const response = await fetch(CANCEL_FORMATION_ENDPOINT(formation.id), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseId: purchase?.id || '',
          saleId: purchase?.saleId || '',
          sessionId: session.id
        })
      });
      const payload = await response.json().catch(() => ({}));
      const remaining = 1000 - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
      if (!response.ok) {
        throw new Error(payload?.error || "Impossible d'annuler la formation.");
      }
      refundEligibility = payload?.refundEligibility || {
        eligibleRefund: Boolean(payload?.eligibleRefund),
        reason: payload?.eligibleRefund ? 'institut' : 'none',
        refundDays: normalizeRefundDays(formation?.refundDays),
        waiverSigned: false,
        daysBeforeSession: null,
        daysSincePurchase: null
      };
      const isEligible = isPresentielRefundEligible(refundEligibility);
      purchase.participationStatus = 'canceled';
      purchase.cancellationEligibleRefund = isEligible;
      showToast({ type: 'success', message: 'Annulation enregistree', durationMs: 1000 });
      clearPresentielCountdownTimer(container);
      renderPresentielCancellationResult(container, refundEligibility, formation, onBack);
    } catch (error) {
      const remaining = 1000 - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
      showToast({ type: 'error', message: error?.message || 'Annulation impossible', durationMs: 1000 });
      if (cancelHint) {
        updateCancelHint();
      }
      cancelCard?.classList.remove('is-processing');
      cancelButton.disabled = false;
      if (labelNode) {
        labelNode.textContent = originalLabel;
      } else {
        cancelButton.textContent = originalLabel;
      }
    }
  });

  const isCanceledPurchase =
    String(purchase?.participationStatus || '').trim().toLowerCase() === 'canceled';

  if (session && !isCanceledPurchase) {
    const changeSection = document.createElement('div');
    changeSection.className = 'module-section';
    changeSection.innerHTML = `
      <header>
        <h3>Changer de date (test)</h3>
        <p class="muted">Fonctionnalite temporaire pour les tests.</p>
      </header>
      <div data-change-session-list class="data-list"></div>
      <p class="form-message" data-change-feedback></p>
    `;
    container.appendChild(changeSection);

    const listContainer = changeSection.querySelector('[data-change-session-list]');
    const feedbackTarget = changeSection.querySelector('[data-change-feedback]');
    const sessions = await loadAvailableSessions(formation.id);
    const alternatives = sessions.filter(
      candidate =>
        candidate.id !== session?.id &&
        isSessionAvailable(candidate) &&
        Number(
          candidate.placesRemaining ??
            Math.max(0, Number(candidate.maxClients || 0) - Number(candidate.reservedCount || 0))
        ) >= 0
    );

    listContainer.innerHTML = alternatives.length
      ? alternatives.map(changeSessionCard).join('')
      : '<p class="module-placeholder">Aucune autre session disponible pour le moment.</p>';

    const setFeedback = message => {
      if (!feedbackTarget) return;
      feedbackTarget.textContent = message || '';
    };

    listContainer.addEventListener('click', async event => {
      const button = event.target.closest('[data-change-session-button]');
      if (!button) return;
      const targetId = button.dataset.sessionId;
      if (!targetId || targetId === session.id) return;
      const targetSession =
        alternatives.find(entry => entry.id === targetId) || sessions.find(entry => entry.id === targetId);
      if (!targetSession) return;
      const confirmLabel = `Changer la session vers ${formatDate(targetSession.startDate)} (${formatSessionDuration(
        targetSession
      )}) ?`;
      if (!window.confirm(confirmLabel)) return;
      button.disabled = true;
      setFeedback('');
      try {
        const response = await fetch(CHANGE_SESSION_ENDPOINT(formation.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            purchaseId: purchase?.id || '',
            newSessionId: targetId
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || 'Impossible de changer la session.');
        }
        await renderPresentiel(container, formation, purchase, onBack);
      } catch (error) {
        setFeedback(error.message || 'Erreur lors du changement de session.');
      } finally {
        if (document.contains(button)) {
          button.disabled = false;
        }
      }
    });
  }

  renderPresentielReviewFab(container, formation, purchase, session);
}

function renderPresentielReviewFab(container, formation, purchase, session) {
  if (!container || !formation || !purchase) return;
  if (String(purchase.participationStatus || '').trim().toLowerCase() === 'canceled') return;
  const endDateTime = computePresentielSessionEndDateTime(session);
  const now = new Date();
  const hasReview = Boolean(purchase?.hasReview);
  const canReview = Boolean(endDateTime && now >= endDateTime && !hasReview);

  let buttonLabel = 'Noter la formation';
  if (hasReview) {
    buttonLabel = 'Avis déjà envoyé';
  } else if (!session || !endDateTime || now < endDateTime) {
    buttonLabel = 'Notez la formation une fois termin?e';
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'myf-presentiel-review-root';
  wrapper.innerHTML = `
    <button
      type="button"
      class="myf-review-fab"
      data-myf-open-review-modal
      ${canReview ? '' : 'disabled aria-disabled="true"'}
    >
      ${escapeHtml(buttonLabel)}
    </button>
    <div class="myf-review-modal-overlay" data-myf-review-modal hidden>
      <div class="myf-review-modal" role="dialog" aria-modal="true" aria-label="Noter la formation">
        <header class="myf-review-modal__header">
          <h4>Laisser un avis</h4>
          <button type="button" class="myf-review-modal__close" data-myf-close-review-modal aria-label="Fermer">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </header>
        <form data-myf-review-form>
          <label>
            Note
            <select name="rating" required>
              <option value="">Sélectionnez une note</option>
              <option value="5">5 - Excellent</option>
              <option value="4">4 - Très bien</option>
              <option value="3">3 - Correct</option>
              <option value="2">2 - Insatisfaisant</option>
              <option value="1">1 - Décevant</option>
            </select>
          </label>
          <label>
            Commentaire
            <textarea name="comment" rows="3" placeholder="Votre retour (facultatif)"></textarea>
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit" data-myf-review-submit>Envoyer mon avis</button>
          </div>
          <p class="form-message" data-myf-review-feedback></p>
        </form>
      </div>
    </div>
  `;
  container.appendChild(wrapper);

  const reviewButton = wrapper.querySelector('[data-myf-open-review-modal]');
  const reviewModal = wrapper.querySelector('[data-myf-review-modal]');
  const closeButton = wrapper.querySelector('[data-myf-close-review-modal]');
  const form = wrapper.querySelector('[data-myf-review-form]');
  const feedback = wrapper.querySelector('[data-myf-review-feedback]');
  const submitButton = wrapper.querySelector('[data-myf-review-submit]');

  const closeModal = () => {
    if (!reviewModal) return;
    reviewModal.classList.remove('is-visible');
    reviewModal.setAttribute('hidden', '');
  };

  const openModal = () => {
    if (!reviewModal || !canReview) return;
    reviewModal.removeAttribute('hidden');
    requestAnimationFrame(() => {
      reviewModal.classList.add('is-visible');
    });
    const firstField = reviewModal.querySelector('[name="rating"]');
    firstField?.focus();
  };

  reviewButton?.addEventListener('click', openModal);
  closeButton?.addEventListener('click', closeModal);
  reviewModal?.addEventListener('click', event => {
    if (event.target === reviewModal) {
      closeModal();
    }
  });
  reviewModal?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  });

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!canReview) return;
    const ratingField = form.querySelector('[name="rating"]');
    const commentField = form.querySelector('[name="comment"]');
    const rating = Number(ratingField?.value || 0);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      if (feedback) feedback.textContent = 'Sélectionnez une note entre 1 et 5.';
      return;
    }
    if (feedback) feedback.textContent = '';
    if (submitButton) submitButton.disabled = true;
    try {
      const response = await fetch(`/api/client/formations/${formation.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rating,
          comment: String(commentField?.value || '').trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Impossible d'envoyer votre avis.");
      }
      purchase.hasReview = true;
      showToast({ type: 'success', message: 'Modifications enregistrées', durationMs: 1000 });
      reviewButton.textContent = 'Avis déjà envoyé';
      reviewButton.disabled = true;
      reviewButton.setAttribute('aria-disabled', 'true');
      closeModal();
    } catch (error) {
      if (feedback) feedback.textContent = error.message || "Impossible d'envoyer votre avis.";
      showToast({ type: 'error', message: "Échec de l'enregistrement", durationMs: 1000 });
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

export async function renderPage(container, data = {}) {
  if (!container) return;
  const formation = data.formation || {};
  const purchase = data.purchase || null;
  const onBack = typeof data.onBack === 'function' ? data.onBack : null;
  container.innerHTML = `
    <article class="formations-page">
      <div class="module-panel" style="padding: 0" data-formation-detail-root>
        <div data-formation-detail-inner></div>
      </div>
    </article>
  `;
  const panel = container.querySelector('[data-formation-detail-inner]');
  renderHeader(panel, formation, onBack);
  const body = panel.querySelector('[data-formation-detail-body]');
  try {
    if (formation.type === 'distanciel') {
      await renderDistanciel(body, formation, onBack, purchase);
    } else if (formation.type === 'presentiel') {
      await renderPresentiel(body, formation, purchase, onBack);
    } else {
      renderStatus(body, 'Type de formation inconnu.');
    }
  } catch (error) {
    console.error('Erreur détail formation', error);
    renderStatus(body, error.message || 'Impossible de charger le détail.');
  }
}

