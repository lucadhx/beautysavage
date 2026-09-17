import { setActionButtonState } from '../helpers/actionButtonState.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API_ROOT = '/api/gestion/social-links';
const MIN_LOADER_MS = 420;
const MODAL_CLOSE_DELAY_MS = 180;

const NETWORKS = [
  { value: 'instagram', label: 'Instagram', icon: 'bi-instagram' },
  { value: 'tiktok', label: 'TikTok', icon: 'bi-tiktok' },
  { value: 'youtube', label: 'YouTube', icon: 'bi-youtube' }
];

const NETWORK_META = new Map(NETWORKS.map(item => [item.value, item]));

const state = {
  links: [],
  loading: true
};

let rootContainer = null;

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

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
    <div class="gcg-inline-loader slm-inline-loader" role="status" aria-live="polite">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

function normalizeLink(item = {}) {
  const type = String(item?.type || '').trim().toLowerCase();
  return {
    id: String(item?.id || '').trim(),
    type,
    url: String(item?.url || '').trim(),
    isActive: Boolean(item?.isActive)
  };
}

function getNetworkMeta(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return (
    NETWORK_META.get(normalized) || {
      value: normalized,
      label: normalized || 'Reseau',
      icon: 'bi-share'
    }
  );
}

function getNetworkTypes() {
  const defaults = NETWORKS.map(item => item.value);
  const extras = state.links
    .map(link => String(link?.type || '').trim().toLowerCase())
    .filter(type => type && !defaults.includes(type));
  return [...defaults, ...extras];
}

function getLinkByType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return state.links.find(link => link.type === normalized) || null;
}

function isValidUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function renderNetworkCard(type) {
  const meta = getNetworkMeta(type);
  const link = getLinkByType(type);
  const hasUrl = Boolean(link?.url);
  const cardClass = hasUrl ? 'slm-card slm-card--added' : 'slm-card slm-card--missing';
  const statusMarkup = hasUrl
    ? `
      <p class="slm-status slm-status--added">
        <i class="bi bi-check-circle-fill" aria-hidden="true"></i>
        <span>Reseau ajoute</span>
      </p>
    `
    : `
      <p class="slm-status slm-status--missing">
        <i class="bi bi-dash-circle" aria-hidden="true"></i>
        <span>Reseau manquant</span>
      </p>
    `;

  const actionsMarkup = hasUrl
    ? `
      <div class="slm-card__actions">
        <button
          type="button"
          class="gestion-icon-button icon-only"
          data-action="open-edit-modal"
          data-network-type="${escapeHtml(type)}"
          aria-label="Modifier ${escapeHtml(meta.label)}"
        >
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="gestion-icon-button icon-only slm-delete-action"
          data-action="open-delete-modal"
          data-network-type="${escapeHtml(type)}"
          aria-label="Supprimer ${escapeHtml(meta.label)}"
        >
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>
    `
    : `
      <button
        type="button"
        class="gcg-accent-button slm-add-button"
        data-action="open-add-modal"
        data-network-type="${escapeHtml(type)}"
      >
        <i class="bi bi-plus-circle" aria-hidden="true"></i>
        <span>Ajouter le reseau</span>
      </button>
    `;

  return `
    <article class="${cardClass}">
      <div class="slm-card__logo" aria-hidden="true">
        <i class="bi ${escapeHtml(meta.icon || 'bi-share')}"></i>
      </div>
      <div class="slm-card__body">
        <h3>${escapeHtml(meta.label || 'Reseau')}</h3>
        ${statusMarkup}
        ${
          hasUrl
            ? `<p class="slm-card__url">${escapeHtml(link.url)}</p>`
            : '<p class="slm-card__url slm-card__url--placeholder">Aucun lien enregistre.</p>'
        }
      </div>
      <div class="slm-card__side">
        ${actionsMarkup}
      </div>
    </article>
  `;
}

function renderCardsArea(loaderLabel = 'Chargement des reseaux...') {
  const grid = rootContainer?.querySelector('[data-social-cards-grid]');
  if (!grid) return;
  if (state.loading) {
    grid.innerHTML = buildLoaderMarkup(loaderLabel);
    return;
  }

  const types = getNetworkTypes();
  grid.innerHTML = `
    <div class="slm-card-grid">
      ${types.map(type => renderNetworkCard(type)).join('')}
    </div>
  `;
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  window.setTimeout(() => overlay.remove(), MODAL_CLOSE_DELAY_MS);
}

function mountModal(markup) {
  document.body.querySelector('[data-social-modal-overlay]')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'gcg-modal-overlay slm-modal-overlay';
  overlay.setAttribute('data-social-modal-overlay', 'true');
  overlay.innerHTML = markup;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return overlay;
}

function bindModalClose(overlay, closeFn) {
  const onEsc = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeFn();
  };
  const onClickOutside = event => {
    if (event.target === overlay) closeFn();
  };

  window.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', onClickOutside);
  return () => {
    window.removeEventListener('keydown', onEsc);
    overlay.removeEventListener('click', onClickOutside);
  };
}

async function loadLinks({ showLoader = true, loaderLabel = 'Chargement des reseaux...' } = {}) {
  const startedAt = Date.now();
  if (showLoader) {
    state.loading = true;
    renderCardsArea(loaderLabel);
  }
  try {
    const payload = await request(API_ROOT);
    if (showLoader) {
      const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
      if (remaining > 0) await wait(remaining);
    }
    const list = Array.isArray(payload?.socialLinks) ? payload.socialLinks.map(normalizeLink) : [];
    state.links = list;
    state.loading = false;
    renderCardsArea();
  } catch (error) {
    if (showLoader) {
      const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
      if (remaining > 0) await wait(remaining);
    }
    state.links = [];
    state.loading = false;
    renderCardsArea();
    showToast({ type: 'error', message: '?chec - r?essayez', durationMs: 1000 });
    logUiError('SocialLinks:Load', error, {
      status: error?.status || null,
      endpoint: error?.endpoint || API_ROOT,
      payload: error?.payload || null
    });
  }
}

function openUpsertModal(type) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const meta = getNetworkMeta(normalizedType);
  const existing = getLinkByType(normalizedType);
  const isEditMode = Boolean(existing?.id);
  const title = `${isEditMode ? 'Modifier' : 'Ajouter'} ${meta.label || 'reseau'}`;

  const overlay = mountModal(`
    <div class="gcg-modal-panel slm-modal-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="gcg-modal-panel__header slm-modal-panel__header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="gcg-modal-close" data-action="close-modal" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <div class="gcg-modal-panel__body slm-modal-panel__body">
        <label class="slm-field">
          <span>URL</span>
          <input
            type="url"
            class="gcg-minimal-input"
            data-role="social-url-input"
            placeholder="https://..."
            value="${escapeHtml(existing?.url || '')}"
            autocomplete="off"
          >
        </label>
        <p class="slm-modal-hint" data-role="social-url-hint"></p>
        <div class="slm-preview" data-role="social-url-preview">
          <span>Apercu:</span>
          <a href="#" aria-disabled="true" tabindex="-1">${escapeHtml(existing?.url || 'https://...')}</a>
        </div>
      </div>
      <footer class="gcg-modal-panel__actions slm-modal-panel__actions">
        <button type="button" class="gcg-outline-button" data-action="close-modal">Annuler</button>
        <button type="button" class="gcg-accent-button" data-action="submit-upsert">Valider</button>
      </footer>
    </div>
  `);

  const teardown = bindModalClose(overlay, () => {
    teardown();
    closeModal(overlay);
  });

  const closeButtons = overlay.querySelectorAll('[data-action="close-modal"]');
  closeButtons.forEach(button => {
    button.addEventListener('click', () => {
      teardown();
      closeModal(overlay);
    });
  });

  const input = overlay.querySelector('[data-role="social-url-input"]');
  const hint = overlay.querySelector('[data-role="social-url-hint"]');
  const preview = overlay.querySelector('[data-role="social-url-preview"] a');
  const submitButton = overlay.querySelector('[data-action="submit-upsert"]');

  const updateValidation = () => {
    const raw = String(input?.value || '').trim();
    const valid = isValidUrl(raw);
    if (preview) {
      preview.textContent = raw || 'https://...';
      preview.href = valid ? raw : '#';
      preview.setAttribute('aria-disabled', valid ? 'false' : 'true');
      preview.tabIndex = valid ? 0 : -1;
      preview.target = valid ? '_blank' : '';
      preview.rel = valid ? 'noreferrer' : '';
    }
    if (hint) {
      hint.textContent = raw ? (valid ? '' : 'URL invalide. Utilisez http:// ou https://') : 'URL requise.';
    }
    if (submitButton) {
      submitButton.disabled = !valid;
    }
    return valid;
  };

  input?.addEventListener('input', updateValidation);
  updateValidation();

  submitButton?.addEventListener('click', async () => {
    const valid = updateValidation();
    if (!valid) return;

    const url = String(input?.value || '').trim();
    const payload = {
      type: normalizedType,
      url,
      isActive: true
    };
    const method = isEditMode ? 'PUT' : 'POST';
    const endpoint = isEditMode ? `${API_ROOT}/${encodeURIComponent(existing.id)}` : API_ROOT;

    try {
      setActionButtonState(submitButton, 'loading', { loadingLabel: 'Enregistrement...' });
      await request(
        endpoint,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        },
        { type: payload.type, url: payload.url, isActive: payload.isActive }
      );

      setActionButtonState(submitButton, 'success', { successLabel: 'R?ussi' });
      showToast({ type: 'success', message: 'Reseau enregistre', durationMs: 1000 });
      teardown();
      closeModal(overlay);
      await loadLinks({ showLoader: true, loaderLabel: 'Mise a jour des reseaux...' });
    } catch (error) {
      setActionButtonState(submitButton, 'error', { errorLabel: '\u00c9chec' });
      showToast({ type: 'error', message: '?chec - r?essayez', durationMs: 1000 });
      logUiError('SocialLinks:Upsert', error, {
        status: error?.status || null,
        endpoint: error?.endpoint || endpoint,
        payload: error?.payload || null,
        safePayload: error?.safePayload || payload
      });
    }
  });
}

function openDeleteModal(type) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const link = getLinkByType(normalizedType);
  if (!link?.id) return;
  const meta = getNetworkMeta(normalizedType);
  const title = `Supprimer le lien ${meta.label || 'reseau'} ?`;

  const overlay = mountModal(`
    <div class="gcg-modal-panel slm-modal-panel slm-modal-panel--confirm" role="dialog" aria-modal="true" aria-label="${escapeHtml(
      title
    )}">
      <header class="gcg-modal-panel__header slm-modal-panel__header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="gcg-modal-close" data-action="close-modal" aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </header>
      <div class="gcg-modal-panel__body slm-modal-panel__body">
        <p class="slm-confirm-text">Cette action supprime le lien enregistre pour ${escapeHtml(meta.label || 'ce reseau')}.</p>
      </div>
      <footer class="gcg-modal-panel__actions slm-modal-panel__actions">
        <button type="button" class="gcg-outline-button" data-action="close-modal">Annuler</button>
        <button type="button" class="gcg-accent-button slm-delete-button" data-action="confirm-delete">Supprimer</button>
      </footer>
    </div>
  `);

  const teardown = bindModalClose(overlay, () => {
    teardown();
    closeModal(overlay);
  });

  overlay.querySelectorAll('[data-action="close-modal"]').forEach(button => {
    button.addEventListener('click', () => {
      teardown();
      closeModal(overlay);
    });
  });

  const confirmButton = overlay.querySelector('[data-action="confirm-delete"]');
  confirmButton?.addEventListener('click', async () => {
    const endpoint = `${API_ROOT}/${encodeURIComponent(link.id)}`;
    try {
      setActionButtonState(confirmButton, 'loading', { loadingLabel: 'Suppression...' });
      await request(endpoint, { method: 'DELETE' }, { id: link.id, type: normalizedType });
      setActionButtonState(confirmButton, 'success', { successLabel: 'R?ussi' });
      showToast({ type: 'success', message: 'Reseau supprime', durationMs: 1000 });
      teardown();
      closeModal(overlay);
      await loadLinks({ showLoader: true, loaderLabel: 'Mise a jour des reseaux...' });
    } catch (error) {
      setActionButtonState(confirmButton, 'error', { errorLabel: '\u00c9chec' });
      showToast({ type: 'error', message: '?chec - r?essayez', durationMs: 1000 });
      logUiError('SocialLinks:Delete', error, {
        status: error?.status || null,
        endpoint: error?.endpoint || endpoint,
        payload: error?.payload || null,
        safePayload: error?.safePayload || { id: link.id, type: normalizedType }
      });
    }
  });
}

function handleRootClick(event) {
  const actionTrigger = event.target.closest('[data-action]');
  if (!actionTrigger || !rootContainer?.contains(actionTrigger)) return;
  const action = String(actionTrigger.dataset.action || '').trim();
  const networkType = String(actionTrigger.dataset.networkType || '').trim().toLowerCase();

  if (action === 'open-add-modal' || action === 'open-edit-modal') {
    openUpsertModal(networkType);
    return;
  }
  if (action === 'open-delete-modal') {
    openDeleteModal(networkType);
  }
}

function renderShell() {
  if (!rootContainer) return;
  rootContainer.innerHTML = `
    <section class="slm-module">
      <header class="slm-header">
        <h2>Reseaux sociaux</h2>
        <p>Configurez les liens Instagram, TikTok et YouTube affiches dans la vitrine.</p>
      </header>
      <div class="slm-content" data-social-cards-grid>
        ${buildLoaderMarkup('Chargement des reseaux...')}
      </div>
    </section>
  `;
}

export async function renderModule(container) {
  if (!container) return;
  rootContainer = container;
  state.links = [];
  state.loading = true;
  renderShell();
  rootContainer.removeEventListener('click', handleRootClick);
  rootContainer.addEventListener('click', handleRootClick);
  await loadLinks({ showLoader: true });
}

export default { renderModule };
