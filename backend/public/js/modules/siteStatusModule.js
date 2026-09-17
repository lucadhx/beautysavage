import { setActionButtonState } from '../helpers/actionButtonState.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API_ROOT = '/api/gestion/site-status';
const MODAL_CLOSE_DELAY_MS = 180;
const MAINTENANCE_CUSTOM_ETA_KEY = 'custom';

const ETA_PRESETS = [
  { key: '30m', label: '30 minutes', value: '30 minutes' },
  { key: '1h', label: '1 heure', value: '1 heure' },
  { key: '2h', label: '2 heures', value: '2 heures' },
  { key: '4h', label: '4 heures', value: '4 heures' },
  { key: MAINTENANCE_CUSTOM_ETA_KEY, label: "Jusqu'a une heure", value: MAINTENANCE_CUSTOM_ETA_KEY }
];

const state = {
  siteStatus: null,
  history: [],
  loaderCount: 0,
  modal: {
    type: null,
    open: false,
    closeTimer: null,
    maintenanceConfirming: false,
    maintenanceDraft: {
      reason: '',
      etaPreset: '30m',
      etaTime: '',
      etaValue: ''
    }
  },
  boundKeyHandler: null
};

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeStatus(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === 'suspended') return 'suspended';
  if (candidate === 'maintenance') return 'maintenance';
  return 'active';
}

function statusLabel(status) {
  if (status === 'suspended') return 'SUSPENDU';
  if (status === 'maintenance') return 'MAINTENANCE';
  return 'ACTIF';
}

function formatDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString();
}

function getActorLabel(actor) {
  if (!actor) return 'Inconnu';
  const name = String(actor?.name || '').trim();
  const email = String(actor?.email || '').trim();
  if (name && email) return `${name} (${email})`;
  return name || email || 'Inconnu';
}

function getPresetByKey(key) {
  return ETA_PRESETS.find(entry => entry.key === key) || ETA_PRESETS[0];
}

function formatCustomEta(timeValue) {
  const match = String(timeValue || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return '';
  const hours = match[1];
  const minutes = match[2];
  if (minutes === '00') {
    return `Jusqu'a ${hours}h`;
  }
  return `Jusqu'a ${hours}h${minutes}`;
}

function resolveEtaValue(draft = state.modal.maintenanceDraft) {
  const preset = getPresetByKey(draft?.etaPreset);
  if (preset.key !== MAINTENANCE_CUSTOM_ETA_KEY) {
    return String(preset.value || '').trim();
  }
  return formatCustomEta(draft?.etaTime);
}

async function parseJson(response) {
  return response?.json ? response.json().catch(() => ({})) : {};
}

async function request(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: 'include',
    ...options
  });
  const payload = await parseJson(response);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || payload?.message || 'Requete impossible.');
  }
  return payload;
}

function setLoader(container, active, label = '') {
  const host = container.querySelector('[data-site-status-loader]');
  const labelNode = host?.querySelector('[data-site-status-loader-label]');
  if (!host || !labelNode) return;
  labelNode.textContent = label || 'Chargement...';
  host.hidden = !active;
}

function startLoader(container, label) {
  state.loaderCount += 1;
  setLoader(container, true, label);
}

function stopLoader(container) {
  state.loaderCount = Math.max(0, state.loaderCount - 1);
  if (!state.loaderCount) {
    setLoader(container, false);
  }
}

async function runWithLoader(container, label, task) {
  startLoader(container, label);
  try {
    return await task();
  } finally {
    stopLoader(container);
  }
}

function buildActionButtons(status) {
  if (status === 'maintenance') {
    return `
      <button type="button" class="site-status-action-button site-status-action-button--accent" data-site-status-action="maintenance-end">
        <i class="bi bi-check2-circle" aria-hidden="true"></i>
        <span>Terminer la maintenance</span>
      </button>
    `;
  }
  if (status === 'suspended') {
    return `
      <button type="button" class="site-status-action-button site-status-action-button--accent" data-site-status-action="reactivate">
        <i class="bi bi-play-circle" aria-hidden="true"></i>
        <span>Reactiver le site</span>
      </button>
      <button type="button" class="site-status-action-button site-status-action-button--ghost" data-site-status-action="maintenance-start">
        <i class="bi bi-tools" aria-hidden="true"></i>
        <span>Passer en maintenance</span>
      </button>
    `;
  }
  return `
    <button type="button" class="site-status-action-button site-status-action-button--danger" data-site-status-action="suspend">
      <i class="bi bi-pause-circle" aria-hidden="true"></i>
      <span>Suspendre le site</span>
    </button>
    <button type="button" class="site-status-action-button site-status-action-button--accent" data-site-status-action="maintenance-start">
      <i class="bi bi-tools" aria-hidden="true"></i>
      <span>Lancer une maintenance</span>
    </button>
  `;
}

function renderStatusCard(container) {
  const root = container.querySelector('[data-site-status-current]');
  if (!root) return;
  const status = normalizeStatus(state.siteStatus?.status);
  const reason = String(state.siteStatus?.reason || '').trim();
  const eta = String(state.siteStatus?.eta || '').trim();
  const actor = getActorLabel(state.siteStatus?.updatedBy);
  const startedAt = state.siteStatus?.maintenanceStartedAt
    ? formatDate(state.siteStatus?.maintenanceStartedAt)
    : '';

  root.innerHTML = `
    <div class="site-status-current__line">
      <span class="site-status-badge site-status-badge--${status}">
        ${statusLabel(status)}
      </span>
    </div>
    <p>Derniere mise a jour: <strong>${escapeHtml(formatDate(state.siteStatus?.updatedAt))}</strong></p>
    <p>Par: <strong>${escapeHtml(actor)}</strong></p>
    ${
      reason
        ? `<p>Motif: <strong>${escapeHtml(reason)}</strong></p>`
        : '<p>Motif: <strong>Aucun</strong></p>'
    }
    ${
      status === 'maintenance' && eta
        ? `<p>Durée estimée: <strong>${escapeHtml(eta)}</strong></p>`
        : ''
    }
    ${
      status === 'maintenance' && startedAt
        ? `<p>Début maintenance: <strong>${escapeHtml(startedAt)}</strong></p>`
        : ''
    }
    <div class="site-status-module__actions">
      ${buildActionButtons(status)}
    </div>
  `;
}

function renderHistory(container) {
  const list = container.querySelector('[data-site-status-history]');
  if (!list) return;
  if (!Array.isArray(state.history) || !state.history.length) {
    list.innerHTML = '<p class="module-placeholder">Aucun changement pour le moment.</p>';
    return;
  }
  list.innerHTML = state.history
    .map(entry => {
      const status = normalizeStatus(entry?.status);
      const reason = String(entry?.reason || '').trim();
      const eta = String(entry?.eta || '').trim();
      const startedAt = entry?.startedAt ? formatDate(entry?.startedAt) : '';
      const endedAt = entry?.endedAt ? formatDate(entry?.endedAt) : '';
      return `
        <article class="site-status-history-item">
          <div class="site-status-history-item__top">
            <span class="site-status-badge site-status-badge--${status}">
              ${statusLabel(status)}
            </span>
            <span>${escapeHtml(formatDate(entry?.date))}</span>
          </div>
          <p>Par: <strong>${escapeHtml(getActorLabel(entry?.byUser))}</strong></p>
          ${
            reason
              ? `<p>Motif: <strong>${escapeHtml(reason)}</strong></p>`
              : '<p>Motif: <strong>Aucun</strong></p>'
          }
          ${eta ? `<p>Durée estimée: <strong>${escapeHtml(eta)}</strong></p>` : ''}
          ${startedAt ? `<p>Début: <strong>${escapeHtml(startedAt)}</strong></p>` : ''}
          ${endedAt ? `<p>Fin: <strong>${escapeHtml(endedAt)}</strong></p>` : ''}
        </article>
      `;
    })
    .join('');
}

function closeModal(container) {
  state.modal.open = false;
  state.modal.maintenanceConfirming = false;
  const overlay = container.querySelector('[data-site-status-modal]');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  if (state.modal.closeTimer) {
    clearTimeout(state.modal.closeTimer);
    state.modal.closeTimer = null;
  }
  state.modal.closeTimer = setTimeout(() => {
    if (state.modal.open) return;
    overlay.hidden = true;
  }, MODAL_CLOSE_DELAY_MS);
}

function resetMaintenanceDraft() {
  state.modal.maintenanceDraft = {
    reason: '',
    etaPreset: '30m',
    etaTime: '',
    etaValue: ''
  };
}

function openModal(container, type) {
  state.modal.type = type;
  state.modal.open = true;
  state.modal.maintenanceConfirming = false;
  if (type === 'maintenance-start') {
    resetMaintenanceDraft();
  }
  renderModal(container);
}

function renderMaintenanceEtaPicker() {
  const draft = state.modal.maintenanceDraft;
  const preset = getPresetByKey(draft?.etaPreset);
  return `
    <div class="site-status-eta-picker">
      <p>Durée estimée</p>
      <div class="site-status-eta-picker__options">
        ${ETA_PRESETS.map(entry => `
          <button
            type="button"
            class="site-status-eta-picker__option ${
              preset.key === entry.key ? 'is-active' : ''
            }"
            data-eta-preset="${escapeHtml(entry.key)}"
          >
            ${escapeHtml(entry.label)}
          </button>
        `).join('')}
      </div>
      <div class="site-status-eta-picker__custom ${preset.key === MAINTENANCE_CUSTOM_ETA_KEY ? 'is-visible' : ''}">
        <label class="site-status-modal-field">
          <span>Heure cible</span>
          <input
            type="time"
            data-eta-time
            class="site-status-minimal-input"
            value="${escapeHtml(draft?.etaTime || '')}"
          />
        </label>
      </div>
    </div>
  `;
}

function renderModal(container) {
  const overlay = container.querySelector('[data-site-status-modal]');
  const body = overlay?.querySelector('[data-site-status-modal-body]');
  if (!overlay || !body) return;

  if (!state.modal.open || !state.modal.type) {
    closeModal(container);
    return;
  }

  if (state.modal.type === 'suspend') {
    body.innerHTML = `
      <h3>Suspendre le site</h3>
      <p>Le motif est obligatoire. Les achats seront bloqués tant que le site reste suspendu.</p>
      <label class="site-status-modal-field">
        <span>Motif</span>
        <textarea data-site-status-reason rows="4" placeholder="Expliquez la raison de la suspension"></textarea>
      </label>
      <div class="site-status-modal-actions">
        <button type="button" class="site-status-outline-button" data-action="cancel-modal">Annuler</button>
        <button type="button" class="site-status-accent-button" data-action="confirm-suspend">Confirmer suspension</button>
      </div>
    `;
  } else if (state.modal.type === 'reactivate') {
    body.innerHTML = `
      <h3>Réactiver le site</h3>
      <p>Les achats redeviendront disponibles immédiatement après confirmation.</p>
      <div class="site-status-modal-actions">
        <button type="button" class="site-status-outline-button" data-action="cancel-modal">Annuler</button>
        <button type="button" class="site-status-accent-button" data-action="confirm-reactivate">Confirmer réactivation</button>
      </div>
    `;
  } else if (state.modal.type === 'maintenance-end') {
    body.innerHTML = `
      <h3>Terminer la maintenance</h3>
      <p>Êtes-vous sûr de terminer la maintenance et de remettre le site actif ?</p>
      <div class="site-status-modal-actions">
        <button type="button" class="site-status-outline-button" data-action="cancel-modal">Annuler</button>
        <button type="button" class="site-status-accent-button" data-action="confirm-maintenance-end">Confirmer</button>
      </div>
    `;
  } else if (state.modal.type === 'maintenance-start') {
    const draft = state.modal.maintenanceDraft;
    if (!state.modal.maintenanceConfirming) {
      body.innerHTML = `
        <h3>Lancer la maintenance</h3>
        <p>Renseignez le motif et la durée estimée avant confirmation.</p>
        <label class="site-status-modal-field">
          <span>Motif (obligatoire)</span>
          <textarea data-maintenance-reason rows="4" placeholder="Ex: Mise à jour serveur critique">${escapeHtml(draft.reason)}</textarea>
        </label>
        ${renderMaintenanceEtaPicker()}
        <div class="site-status-modal-actions">
          <button type="button" class="site-status-outline-button" data-action="cancel-modal">Annuler</button>
          <button type="button" class="site-status-accent-button" data-action="continue-maintenance-start">Continuer</button>
        </div>
      `;
    } else {
      body.innerHTML = `
        <h3>Confirmation maintenance</h3>
        <p>Êtes-vous sûr de lancer la maintenance ?</p>
        <div class="site-status-confirm-summary">
          <p><strong>Motif:</strong> ${escapeHtml(draft.reason)}</p>
          <p><strong>Durée estimée:</strong> ${escapeHtml(draft.etaValue)}</p>
        </div>
        <div class="site-status-modal-actions">
          <button type="button" class="site-status-outline-button" data-action="back-maintenance-start">Retour</button>
          <button type="button" class="site-status-accent-button" data-action="confirm-maintenance-start">Confirmer maintenance</button>
        </div>
      `;
    }
  }

  overlay.hidden = false;
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
  });
}

function refreshView(container) {
  renderStatusCard(container);
  renderHistory(container);
  renderModal(container);
}

async function loadState(container) {
  await runWithLoader(container, 'Chargement du statut du site...', async () => {
    const [statusPayload, historyPayload] = await Promise.all([
      request('/'),
      request('/history')
    ]);
    state.siteStatus = statusPayload.siteStatus || { status: 'active' };
    state.history = Array.isArray(historyPayload.history) ? historyPayload.history : [];
  });
  refreshView(container);
}

async function submitSuspend(container, reason, button) {
  setActionButtonState(button, 'loading', { loadingLabel: 'Suspension...' });
  try {
    await runWithLoader(container, 'Suspension du site...', () =>
      request('/suspend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
    );
    closeModal(container);
    setActionButtonState(button, 'success', { successLabel: 'Suspendu' });
    showToast({ type: 'success', message: 'Site suspendu', durationMs: 1000 });
    await loadState(container);
  } catch (error) {
    setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logUiError('SiteStatus:Suspend', error, { reason });
  }
}

async function submitReactivate(container, button) {
  setActionButtonState(button, 'loading', { loadingLabel: 'Réactivation...' });
  try {
    await runWithLoader(container, 'Réactivation du site...', () =>
      request('/reactivate', { method: 'POST' })
    );
    closeModal(container);
    setActionButtonState(button, 'success', { successLabel: 'Actif' });
    showToast({ type: 'success', message: 'Site réactivé', durationMs: 1000 });
    await loadState(container);
  } catch (error) {
    setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logUiError('SiteStatus:Reactivate', error);
  }
}

async function submitMaintenanceStart(container, reason, eta, button) {
  setActionButtonState(button, 'loading', { loadingLabel: 'Maintenance...' });
  try {
    await runWithLoader(container, 'Activation maintenance...', () =>
      request('/maintenance/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, eta })
      })
    );
    closeModal(container);
    setActionButtonState(button, 'success', { successLabel: 'Maintenance active' });
    showToast({ type: 'success', message: 'Maintenance activée', durationMs: 1000 });
    await loadState(container);
  } catch (error) {
    setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logUiError('SiteStatus:MaintenanceStart', error, { reason, eta });
  }
}

async function submitMaintenanceEnd(container, button) {
  setActionButtonState(button, 'loading', { loadingLabel: 'Fin maintenance...' });
  try {
    await runWithLoader(container, 'Désactivation maintenance...', () =>
      request('/maintenance/end', { method: 'POST' })
    );
    closeModal(container);
    setActionButtonState(button, 'success', { successLabel: 'Terminee' });
    showToast({ type: 'success', message: 'Maintenance terminée', durationMs: 1000 });
    await loadState(container);
  } catch (error) {
    setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logUiError('SiteStatus:MaintenanceEnd', error);
  }
}

function validateMaintenanceDraft() {
  const reason = String(state.modal.maintenanceDraft.reason || '').trim();
  if (!reason) {
    showToast({ type: 'error', message: 'Motif requis', durationMs: 1000 });
    return null;
  }
  const etaValue = resolveEtaValue(state.modal.maintenanceDraft);
  if (!etaValue) {
    showToast({ type: 'error', message: 'Durée estimée requise', durationMs: 1000 });
    return null;
  }
  return { reason, eta: etaValue };
}

function bindEvents(container) {
  const overlay = container.querySelector('[data-site-status-modal]');

  overlay?.addEventListener('click', event => {
    if (event.target === overlay) {
      closeModal(container);
    }
  });

  container.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-site-status-action]');
    if (actionButton) {
      const type = actionButton.dataset.siteStatusAction;
      if (type === 'suspend') {
        openModal(container, 'suspend');
      } else if (type === 'reactivate') {
        openModal(container, 'reactivate');
      } else if (type === 'maintenance-start') {
        openModal(container, 'maintenance-start');
      } else if (type === 'maintenance-end') {
        openModal(container, 'maintenance-end');
      }
      return;
    }

    const etaOption = event.target.closest('[data-eta-preset]');
    if (etaOption) {
      state.modal.maintenanceDraft.etaPreset = String(etaOption.dataset.etaPreset || '30m');
      if (state.modal.maintenanceDraft.etaPreset !== MAINTENANCE_CUSTOM_ETA_KEY) {
        state.modal.maintenanceDraft.etaTime = '';
      }
      renderModal(container);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'cancel-modal') {
      closeModal(container);
      return;
    }

    if (action === 'confirm-suspend') {
      const reason = String(
        container.querySelector('[data-site-status-reason]')?.value || ''
      ).trim();
      if (!reason) {
        showToast({ type: 'error', message: 'Motif requis', durationMs: 1000 });
        return;
      }
      submitSuspend(container, reason, event.target.closest('button'));
      return;
    }

    if (action === 'confirm-reactivate') {
      submitReactivate(container, event.target.closest('button'));
      return;
    }

    if (action === 'confirm-maintenance-end') {
      submitMaintenanceEnd(container, event.target.closest('button'));
      return;
    }

    if (action === 'continue-maintenance-start') {
      const reason = String(
        container.querySelector('[data-maintenance-reason]')?.value || ''
      ).trim();
      state.modal.maintenanceDraft.reason = reason;
      state.modal.maintenanceDraft.etaTime = String(
        container.querySelector('[data-eta-time]')?.value || ''
      ).trim();

      const validated = validateMaintenanceDraft();
      if (!validated) return;
      state.modal.maintenanceDraft.etaValue = validated.eta;
      state.modal.maintenanceConfirming = true;
      renderModal(container);
      return;
    }

    if (action === 'back-maintenance-start') {
      state.modal.maintenanceConfirming = false;
      renderModal(container);
      return;
    }

    if (action === 'confirm-maintenance-start') {
      const validated = validateMaintenanceDraft();
      if (!validated) return;
      submitMaintenanceStart(
        container,
        validated.reason,
        validated.eta,
        event.target.closest('button')
      );
    }
  });

  container.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-maintenance-reason]')) {
      state.modal.maintenanceDraft.reason = String(target.value || '').trim();
    }
    if (target.matches('[data-eta-time]')) {
      state.modal.maintenanceDraft.etaTime = String(target.value || '').trim();
    }
  });

  if (state.boundKeyHandler) {
    window.removeEventListener('keydown', state.boundKeyHandler);
  }
  state.boundKeyHandler = event => {
    if (event.key !== 'Escape' || !state.modal.open) return;
    closeModal(container);
  };
  window.addEventListener('keydown', state.boundKeyHandler);
}

function buildMarkup() {
  return `
    <section class="site-status-module">
      <header class="site-status-module__header">
        <div>
          <h2>Statut du site</h2>
          <p>Controle global des etats ACTIF, SUSPENDU et MAINTENANCE avec historique complet.</p>
        </div>
      </header>

      <div data-site-status-loader hidden>
        <div class="site-status-inline-loader" role="status" aria-live="polite">
          <div class="site-status-inline-loader__paws" aria-hidden="true">
            <span class="site-status-inline-loader__paw">${PAW_ICON_SVG}</span>
            <span class="site-status-inline-loader__paw site-status-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
            <span class="site-status-inline-loader__paw site-status-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
          </div>
          <p data-site-status-loader-label>Chargement...</p>
        </div>
      </div>

      <section class="site-status-current" data-site-status-current></section>

      <section class="site-status-history">
        <h3>Historique</h3>
        <div class="site-status-history__list" data-site-status-history></div>
      </section>

      <div class="site-status-modal-overlay" data-site-status-modal hidden>
        <div class="site-status-modal-panel" role="dialog" aria-modal="true">
          <div class="site-status-modal-panel__content" data-site-status-modal-body></div>
        </div>
      </div>
    </section>
  `;
}

export async function renderModule(container) {
  if (!container) return;
  state.modal.open = false;
  state.modal.type = null;
  state.modal.maintenanceConfirming = false;
  state.loaderCount = 0;
  resetMaintenanceDraft();
  container.innerHTML = buildMarkup();
  bindEvents(container);
  try {
    await loadState(container);
  } catch (error) {
    showToast({ type: 'error', message: '\u00c9chec', durationMs: 1000 });
    logUiError('SiteStatus:Load', error);
  }
}

export default { renderModule };
