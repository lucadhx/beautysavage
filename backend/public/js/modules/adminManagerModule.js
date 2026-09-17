import { setActionButtonState } from '../helpers/actionButtonState.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { openUiConfirmModal } from './uiConfirmModal.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const ADMIN_API_ROOT = '/api/gestion/admins';
const USERS_API_ROOT = '/api/gestion/users';
const MODAL_CLOSE_DELAY_MS = 180;
const MIN_LOADER_MS = 350;

const state = {
  admins: [],
  view: 'list',
  selectedAdminId: null,
  openKebabId: null,
  loading: false
};

let rootContainer = null;
let eventAbortController = null;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : Promise.resolve({});
}

function formatDate(value) {
  if (!value) return 'Date inconnue';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString();
}

function toSafeAdminPayload(admin = {}) {
  return {
    id: String(admin.id || ''),
    email: String(admin.email || '').trim().toLowerCase(),
    createdAt: admin.createdAt || null,
    isActive: Boolean(admin.isActive),
    mustChangePassword: Boolean(admin.mustChangePassword)
  };
}

function sortAdmins(admins = []) {
  return [...admins].sort((a, b) => {
    if (Boolean(a.isActive) !== Boolean(b.isActive)) {
      return a.isActive ? -1 : 1;
    }
    const aDate = new Date(a.createdAt || 0).getTime();
    const bDate = new Date(b.createdAt || 0).getTime();
    return bDate - aDate;
  });
}

function buildRequestError(message, extra = {}) {
  const error = new Error(message || 'Requete impossible.');
  error.status = extra.status || null;
  error.endpoint = extra.endpoint || null;
  error.payload = extra.payload || null;
  error.safePayload = extra.safePayload || null;
  return error;
}

async function request(endpoint, options = {}, safePayload = null) {
  const response = await fetch(endpoint, {
    credentials: 'include',
    ...options
  });
  const payload = await getJson(response);
  if (!response.ok || payload?.ok === false) {
    throw buildRequestError(payload?.error || payload?.message || 'Requete impossible.', {
      status: response.status,
      endpoint,
      payload,
      safePayload
    });
  }
  return payload || {};
}

function buildLoaderMarkup(label = 'Chargement...') {
  return `
    <div class="gcg-inline-loader adm-inline-loader" role="status" aria-live="polite">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

function getContentNode() {
  return rootContainer?.querySelector('[data-admin-content]') || null;
}

function getCreateButton() {
  return rootContainer?.querySelector('[data-action="open-create-modal"]') || null;
}

function getAdminById(adminId) {
  return state.admins.find(admin => String(admin.id) === String(adminId)) || null;
}

function setCreateButtonLoading(loading) {
  const button = getCreateButton();
  if (!button) return;
  if (loading) {
    setActionButtonState(button, 'loading', { loadingLabel: 'Chargement...' });
    return;
  }
  setActionButtonState(button, 'idle');
  button.disabled = false;
}

function renderEmptyState() {
  return `
    <div class="gcg-empty-state adm-empty-state">
      <i class="bi bi-person-x" aria-hidden="true"></i>
      <p>Aucun admin enregistre.</p>
    </div>
  `;
}

function renderListCard(admin) {
  const isActive = Boolean(admin.isActive);
  const isOpen = String(state.openKebabId || '') === String(admin.id || '');
  return `
    <article class="adm-card" data-admin-id="${escapeHtml(admin.id)}">
      <span class="adm-card__icon" aria-hidden="true"><i class="bi bi-person-circle"></i></span>
      <div class="adm-card__body">
        <div class="adm-card__topline">
          <strong class="adm-card__email">${escapeHtml(admin.email || 'Email inconnu')}</strong>
          <span class="adm-status-badge ${isActive ? 'adm-status-badge--active' : 'adm-status-badge--inactive'}">
            ${isActive ? 'Actif' : 'Desactive'}
          </span>
        </div>
        <p>Nom / Prenom: <strong>Non renseigne</strong></p>
        <p>Cree le: <strong>${escapeHtml(formatDate(admin.createdAt))}</strong></p>
      </div>
      <div class="adm-card__actions">
        <div class="gestion-kebab" data-kebab-wrapper>
          <button
            type="button"
            class="gestion-icon-button adm-kebab-button"
            data-action="toggle-kebab"
            data-admin-id="${escapeHtml(admin.id)}"
            data-kebab-key="${escapeHtml(admin.id)}"
            aria-haspopup="menu"
            aria-expanded="${isOpen ? 'true' : 'false'}"
            aria-label="Actions admin"
          >
            <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
          </button>
          <div class="gestion-kebab-menu adm-kebab-menu ${isOpen ? 'is-open' : ''}" role="menu" aria-label="Actions admin">
            <button type="button" class="gestion-icon-action" data-action="view-admin" data-admin-id="${escapeHtml(
              admin.id
            )}" title="Voir" aria-label="Voir">
              <i class="bi bi-eye" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="gestion-icon-action"
              data-action="confirm-toggle-admin"
              data-admin-id="${escapeHtml(admin.id)}"
              title="${isActive ? 'Desactiver' : 'Reactiver'}"
              aria-label="${isActive ? 'Desactiver' : 'Reactiver'}"
            >
              <i class="bi ${isActive ? 'bi-slash-circle' : 'bi-arrow-clockwise'}" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="gestion-icon-action danger"
              data-action="confirm-delete-admin"
              data-admin-id="${escapeHtml(admin.id)}"
              title="Supprimer"
              aria-label="Supprimer"
            >
              <i class="bi bi-trash" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderAdminListView() {
  const admins = sortAdmins(state.admins);
  if (!admins.length) return renderEmptyState();
  return `
    <section class="adm-list-view" data-admin-list-view>
      <div class="adm-card-grid">
        ${admins.map(renderListCard).join('')}
      </div>
    </section>
  `;
}

function renderDetailView(admin) {
  if (!admin) {
    return `
      <section class="adm-detail-view">
        <button type="button" class="adm-back-button" data-action="back-to-admin-list">
          <i class="bi bi-arrow-left" aria-hidden="true"></i>
          <span>Retour aux admins</span>
        </button>
        ${renderEmptyState()}
      </section>
    `;
  }
  const isActive = Boolean(admin.isActive);
  return `
    <section class="adm-detail-view" data-admin-detail-view>
      <button type="button" class="adm-back-button" data-action="back-to-admin-list">
        <i class="bi bi-arrow-left" aria-hidden="true"></i>
        <span>Retour aux admins</span>
      </button>

      <article class="adm-detail-card">
        <header class="adm-detail-card__header">
          <span class="adm-detail-card__icon" aria-hidden="true"><i class="bi bi-person-circle"></i></span>
          <div class="adm-detail-card__identity">
            <h3>${escapeHtml(admin.email || 'Admin')}</h3>
            <span class="adm-status-badge ${isActive ? 'adm-status-badge--active' : 'adm-status-badge--inactive'}">
              ${isActive ? 'Actif' : 'Desactive'}
            </span>
          </div>
        </header>

        <div class="adm-detail-card__meta">
          <p><span>Email</span><strong>${escapeHtml(admin.email || 'Non renseigne')}</strong></p>
          <p><span>Nom / Prenom</span><strong>Non renseigne</strong></p>
          <p><span>Date creation</span><strong>${escapeHtml(formatDate(admin.createdAt))}</strong></p>
          <p><span>Mot de passe a changer</span><strong>${admin.mustChangePassword ? 'Oui' : 'Non'}</strong></p>
        </div>

        <div class="adm-detail-card__actions">
          <button
            type="button"
            class="gcg-outline-button"
            data-action="confirm-toggle-admin"
            data-admin-id="${escapeHtml(admin.id)}"
          >
            <i class="bi ${isActive ? 'bi-slash-circle' : 'bi-arrow-clockwise'}" aria-hidden="true"></i>
            <span>${isActive ? 'Desactiver' : 'Reactiver'}</span>
          </button>
          <button
            type="button"
            class="gcg-accent-button adm-delete-button"
            data-action="confirm-delete-admin"
            data-admin-id="${escapeHtml(admin.id)}"
          >
            <i class="bi bi-trash" aria-hidden="true"></i>
            <span>Supprimer</span>
          </button>
        </div>
      </article>
    </section>
  `;
}

function renderContent() {
  const content = getContentNode();
  if (!content) return;
  if (state.view === 'detail') {
    content.innerHTML = renderDetailView(getAdminById(state.selectedAdminId));
    return;
  }
  content.innerHTML = renderAdminListView();
}

function renderLoadError(message = '?chec de chargement.') {
  const content = getContentNode();
  if (!content) return;
  content.innerHTML = `<p class="gcg-error">${escapeHtml(message)}</p>`;
}

async function fetchAdmins(label = 'Chargement des admins...') {
  const content = getContentNode();
  if (!content) return;
  const start = Date.now();
  state.loading = true;
  setCreateButtonLoading(true);
  state.openKebabId = null;
  content.innerHTML = buildLoaderMarkup(label);
  try {
    const payload = await request(ADMIN_API_ROOT);
    const waitMs = MIN_LOADER_MS - (Date.now() - start);
    if (waitMs > 0) await wait(waitMs);
    state.admins = Array.isArray(payload.admins) ? payload.admins.map(toSafeAdminPayload) : [];
    if (state.view === 'detail' && !getAdminById(state.selectedAdminId)) {
      state.view = 'list';
      state.selectedAdminId = null;
    }
    renderContent();
  } catch (error) {
    const waitMs = MIN_LOADER_MS - (Date.now() - start);
    if (waitMs > 0) await wait(waitMs);
    state.admins = [];
    state.view = 'list';
    state.selectedAdminId = null;
    renderLoadError(error.message || 'Impossible de charger les admins.');
    showToast({ type: 'error', message: '?chec chargement admins', durationMs: 1000 });
    logUiError('AdminManager:LoadAdmins', error, {
      status: error?.status || null,
      endpoint: error?.endpoint || ADMIN_API_ROOT,
      payload: error?.payload || null
    });
  } finally {
    state.loading = false;
    setCreateButtonLoading(false);
  }
}

function mountModal(markup) {
  document.body.querySelector('[data-admin-modal-overlay]')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'gcg-modal-overlay adm-modal-overlay';
  overlay.setAttribute('data-admin-modal-overlay', 'true');
  overlay.innerHTML = markup;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return overlay;
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  setTimeout(() => {
    overlay.remove();
  }, MODAL_CLOSE_DELAY_MS);
}

function bindModalClose(overlay, closeFn) {
  const onEsc = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeFn();
  };
  const onOutside = event => {
    if (event.target === overlay) closeFn();
  };
  window.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', onOutside);
  return () => {
    window.removeEventListener('keydown', onEsc);
    overlay.removeEventListener('click', onOutside);
  };
}

function setModalError(overlay, message = '') {
  const node = overlay.querySelector('[data-admin-modal-error]');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function setModalLoader(overlay, visible, label = 'Traitement...') {
  const host = overlay.querySelector('[data-admin-modal-loader]');
  if (!host) return;
  host.hidden = !visible;
  host.innerHTML = visible ? buildLoaderMarkup(label) : '';
}

function closeOpenKebab() {
  if (!state.openKebabId) return;
  state.openKebabId = null;
  if (state.view === 'list') renderContent();
}

function openConfirmModal({
  title,
  message,
  confirmLabel,
  confirmLoadingLabel,
  confirmSuccessLabel,
  confirmErrorLabel,
  danger = false,
  onConfirm,
  successToast,
  errorToast,
  logContext,
  safePayload = null
}) {
  const overlay = mountModal(`
    <div class="gcg-modal-panel adm-modal-panel adm-modal-panel--confirm" role="dialog" aria-modal="true" aria-label="${escapeHtml(
      title
    )}">
      <header class="gcg-modal-panel__header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="gcg-modal-close" data-action="close-modal" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <div class="gcg-modal-panel__body">
        <p class="adm-confirm-message">${escapeHtml(message)}</p>
        <p class="adm-modal-error" data-admin-modal-error hidden></p>
        <div data-admin-modal-loader hidden></div>
      </div>
      <div class="gcg-modal-panel__actions">
        <button type="button" class="gcg-outline-button" data-action="cancel-modal">Annuler</button>
        <button type="button" class="${danger ? 'gcg-accent-button adm-delete-button' : 'gcg-accent-button'}" data-action="confirm-modal">
          ${escapeHtml(confirmLabel)}
        </button>
      </div>
    </div>
  `);

  const close = () => {
    cleanup();
    closeModal(overlay);
  };
  const cleanup = bindModalClose(overlay, close);

  overlay.querySelector('[data-action="close-modal"]')?.addEventListener('click', close);
  overlay.querySelector('[data-action="cancel-modal"]')?.addEventListener('click', close);
  overlay.querySelector('[data-action="confirm-modal"]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setModalError(overlay, '');
    setModalLoader(overlay, true, confirmLoadingLabel || 'Traitement...');
    setActionButtonState(button, 'loading', { loadingLabel: confirmLoadingLabel || 'Traitement...' });
    try {
      await onConfirm();
      setActionButtonState(button, 'success', { successLabel: confirmSuccessLabel || 'R?ussi' });
      showToast({
        type: 'success',
        message: successToast || 'Modification enregistr?e',
        durationMs: 1000
      });
      close();
    } catch (error) {
      setActionButtonState(button, 'error', { errorLabel: confirmErrorLabel || '\u00c9chec' });
      setModalLoader(overlay, false);
      setModalError(overlay, error?.message || 'Action impossible.');
      showToast({
        type: 'error',
        message: errorToast || '?chec action admin',
        durationMs: 1000
      });
      logUiError(logContext || 'AdminManager:ConfirmAction', error, {
        status: error?.status || null,
        endpoint: error?.endpoint || null,
        payload: error?.payload || null,
        safePayload
      });
    }
  });
}

function openCreateModal() {
  const overlay = mountModal(`
    <div class="gcg-modal-panel adm-modal-panel" role="dialog" aria-modal="true" aria-label="Créer un admin">
      <header class="gcg-modal-panel__header">
        <h3>Créer un admin</h3>
        <button type="button" class="gcg-modal-close" data-action="close-modal" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <form class="gcg-modal-panel__body adm-modal-form" data-admin-create-form>
        <label class="adm-modal-field">
          <span>Email</span>
          <input class="gcg-minimal-input adm-modal-input" name="email" type="email" placeholder="admin@domaine.fr" autocomplete="off" required>
        </label>
        <label class="adm-modal-field">
          <span>Mot de passe</span>
          <input class="gcg-minimal-input adm-modal-input" name="password" type="password" minlength="8" required>
        </label>
        <p class="adm-modal-error" data-admin-modal-error hidden></p>
        <div data-admin-modal-loader hidden></div>
      </form>
      <div class="gcg-modal-panel__actions">
        <button type="button" class="gcg-outline-button" data-action="cancel-modal">Annuler</button>
        <button type="button" class="gcg-accent-button" data-action="confirm-create-admin">Cr?er</button>
      </div>
    </div>
  `);

  const close = () => {
    cleanup();
    closeModal(overlay);
  };
  const cleanup = bindModalClose(overlay, close);

  overlay.querySelector('[data-action="close-modal"]')?.addEventListener('click', close);
  overlay.querySelector('[data-action="cancel-modal"]')?.addEventListener('click', close);
  overlay.querySelector('[data-action="confirm-create-admin"]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const email = String(overlay.querySelector('[name="email"]')?.value || '').trim().toLowerCase();
    const password = String(overlay.querySelector('[name="password"]')?.value || '');
    if (!email || !password) {
      setModalError(overlay, 'Email et mot de passe requis.');
      return;
    }
    setModalError(overlay, '');
    setModalLoader(overlay, true, 'Creation admin...');
    setActionButtonState(button, 'loading', { loadingLabel: 'Creation...' });
    const safePayload = { email, passwordLength: password.length };
    try {
      await request(
        ADMIN_API_ROOT,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        },
        safePayload
      );
      setActionButtonState(button, 'success', { successLabel: 'Cree' });
      showToast({ type: 'success', message: 'Admin cree', durationMs: 1000 });
      close();
      await fetchAdmins('Actualisation des admins...');
    } catch (error) {
      setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
      setModalLoader(overlay, false);
      setModalError(overlay, error?.message || 'Cr?ation impossible.');
      showToast({ type: 'error', message: '?chec cr?ation admin', durationMs: 1000 });
      logUiError('AdminManager:CreateAdmin', error, {
        status: error?.status || null,
        endpoint: error?.endpoint || ADMIN_API_ROOT,
        payload: error?.payload || null,
        safePayload
      });
    }
  });
}

async function toggleAdminStatus(adminId) {
  await request(`${ADMIN_API_ROOT}/${encodeURIComponent(adminId)}/toggle`, { method: 'PUT' });
  await fetchAdmins('Mise ? jour des admins...');
}

async function deleteAdmin(adminId) {
  const deleteEndpoint = `${ADMIN_API_ROOT}/${encodeURIComponent(adminId)}`;
  try {
    await request(deleteEndpoint, { method: 'DELETE' });
    await fetchAdmins('Mise ? jour des admins...');
    return;
  } catch (error) {
    const status = Number(error?.status || 0);
    const fallbackAllowed = status === 404 || status === 405 || status === 501;
    if (!fallbackAllowed) throw error;
  }

  const fallbackPayload = { role: 'client', active: false };
  await request(
    `${USERS_API_ROOT}/${encodeURIComponent(adminId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fallbackPayload)
    },
    fallbackPayload
  );
  await fetchAdmins('Mise ? jour des admins...');
}

function confirmToggleStatus(adminId) {
  const admin = getAdminById(adminId);
  if (!admin) return;
  const isActive = Boolean(admin.isActive);
  void openUiConfirmModal({
    title: isActive ? 'D?sactiver cet admin ?' : 'R?activer cet admin ?',
    message: isActive
      ? '?tes-vous s?r de vouloir d?sactiver cet admin ? Il ne pourra plus se connecter.'
      : '?tes-vous s?r de vouloir r?activer cet admin ? Il pourra de nouveau se connecter.',
    confirmLabel: 'Confirmer',
    loadingLabel: isActive ? 'D?sactivation...' : 'R?activation...',
    intent: isActive ? 'danger' : 'primary',
    onConfirm: async () => {
      try {
        await toggleAdminStatus(adminId);
        showToast({
          type: 'success',
          message: isActive ? 'Admin d?sactiv?' : 'Admin r?activ?',
          durationMs: 1000
        });
      } catch (error) {
        showToast({
          type: 'error',
          message: isActive ? '?chec d?sactivation admin' : '?chec r?activation admin',
          durationMs: 1000
        });
        logUiError(isActive ? 'AdminManager:Deactivate' : 'AdminManager:Reactivate', error, {
          status: error?.status || null,
          endpoint: error?.endpoint || null,
          payload: error?.payload || null,
          safePayload: { adminId }
        });
        throw error;
      }
    }
  });
}

function confirmDelete(adminId) {
  void openUiConfirmModal({
    title: 'Supprimer cet admin ?',
    message: 'Suppression definitive. Cette action est irreversible.',
    confirmLabel: 'Supprimer',
    loadingLabel: 'Suppression...',
    intent: 'danger',
    onConfirm: async () => {
      try {
        await deleteAdmin(adminId);
        showToast({ type: 'success', message: 'Admin supprime', durationMs: 1000 });
      } catch (error) {
        showToast({ type: 'error', message: '?chec suppression admin', durationMs: 1000 });
        logUiError('AdminManager:Delete', error, {
          status: error?.status || null,
          endpoint: error?.endpoint || null,
          payload: error?.payload || null,
          safePayload: { adminId }
        });
        throw error;
      }
    }
  });
}

async function openAdminDetail(adminId) {
  state.selectedAdminId = adminId;
  state.view = 'detail';
  state.openKebabId = null;
  await fetchAdmins('Chargement de la fiche admin...');
}

function handleModuleClick(event) {
  if (!rootContainer || !rootContainer.isConnected) return;
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode || !rootContainer.contains(actionNode)) return;
  const action = actionNode.dataset.action;
  const adminId = actionNode.dataset.adminId;

  if (action === 'open-create-modal') {
    openCreateModal();
    return;
  }

  if (action === 'toggle-kebab') {
    event.stopPropagation();
    state.openKebabId = state.openKebabId === adminId ? null : adminId;
    renderContent();
    return;
  }

  if (action === 'view-admin') {
    void openAdminDetail(adminId);
    return;
  }

  if (action === 'back-to-admin-list') {
    state.view = 'list';
    state.selectedAdminId = null;
    state.openKebabId = null;
    renderContent();
    return;
  }

  if (action === 'confirm-toggle-admin') {
    closeOpenKebab();
    confirmToggleStatus(adminId);
    return;
  }

  if (action === 'confirm-delete-admin') {
    closeOpenKebab();
    confirmDelete(adminId);
  }
}

function handleDocumentClick(event) {
  if (!rootContainer || !rootContainer.isConnected || !state.openKebabId) return;
  const insideKebab = event.target.closest('[data-kebab-wrapper]');
  if (insideKebab && rootContainer.contains(insideKebab)) return;
  closeOpenKebab();
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Escape') return;
  if (state.openKebabId) {
    closeOpenKebab();
  }
}

function bindEvents() {
  if (!rootContainer) return;
  if (eventAbortController) {
    eventAbortController.abort();
  }
  eventAbortController = new AbortController();
  const { signal } = eventAbortController;

  rootContainer.addEventListener('click', handleModuleClick, { signal });
  document.addEventListener('click', handleDocumentClick, { signal });
  document.addEventListener('keydown', handleDocumentKeydown, { signal });
}

function buildMarkup() {
  return `
    <section class="adm-module" data-admin-module>
      <header class="adm-header">
        <div>
          <h2>Gestion des admins</h2>
          <p>Administrez les comptes admin depuis la console developpeur.</p>
        </div>
        <button type="button" class="adm-create-button" data-action="open-create-modal">
          <i class="bi bi-person-plus" aria-hidden="true"></i>
          <span>Créer un admin</span>
        </button>
      </header>
      <section class="adm-content" data-admin-content></section>
    </section>
  `;
}

export async function renderModule(container) {
  if (!container) return;
  rootContainer = container;
  state.admins = [];
  state.view = 'list';
  state.selectedAdminId = null;
  state.openKebabId = null;
  state.loading = false;

  container.innerHTML = buildMarkup();
  bindEvents();
  await fetchAdmins('Chargement des admins...');
}

