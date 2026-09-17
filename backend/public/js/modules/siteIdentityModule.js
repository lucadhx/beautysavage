import { setActionButtonState } from '../helpers/actionButtonState.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { updateSiteFavicon } from '../helpers/siteFavicon.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API_ROOT = '/api/gestion/site-identity';
const TEMP_LOGO_API = `${API_ROOT}/temp-logo`;
const DEFAULT_SITE_NAME = 'Beauty Savage';
const MAX_LOGO_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

const state = {
  identity: null,
  draft: {
    siteName: DEFAULT_SITE_NAME
  },
  pendingLogo: null,
  modal: {
    open: false,
    busy: false,
    candidate: null,
    closeTimer: null
  },
  loaderCount: 0,
  escapeHandler: null
};

function isDevRuntime() {
  if (typeof window === 'undefined') return false;
  return DEV_HOSTNAMES.has(String(window.location?.hostname || '').toLowerCase());
}

function debugInfo(...args) {
  if (!isDevRuntime()) return;
  console.log('[SiteIdentity]', ...args);
}

function debugError(context, error, extra = null) {
  if (!isDevRuntime()) return;
  logUiError(`SiteIdentity:${context}`, error, extra);
}

function getJson(response) {
  return response?.json ? response.json() : Promise.resolve({});
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSiteInitials(siteName) {
  const cleaned = String(siteName || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim();
  if (!cleaned) return 'BS';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return 'BS';
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words
    .slice(0, 3)
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase();
}

function normalizeIdentity(payload = {}) {
  const source = payload?.identity || {};
  const siteName = String(source.siteName || '').trim() || DEFAULT_SITE_NAME;
  const logoType =
    source.logoType === 'upload' || source.logoType === 'url'
      ? source.logoType
      : null;
  const logoUrlResolved = String(source.logoUrlResolved || '').trim();
  const logoUrl = String(source.logoUrl || '').trim();
  return {
    siteName,
    logoType,
    logoUrlResolved: logoUrlResolved || '',
    logoUrl: logoType === 'url' ? logoUrl : '',
    updatedAt: source.updatedAt || null
  };
}

function applyIdentity(identity) {
  state.identity = identity;
  updateSiteFavicon(identity?.logoUrlResolved);
  state.draft.siteName = identity?.siteName || DEFAULT_SITE_NAME;
  state.pendingLogo = null;
  state.modal.candidate = null;
}

function resolveDisplayedLogoUrl() {
  return String(
    state.pendingLogo?.tempLogoUrl ||
      state.identity?.logoUrlResolved ||
      ''
  ).trim();
}

function setModuleLoader(container, loading, message = '') {
  const loader = container.querySelector('[data-site-identity-loader]');
  const label = loader?.querySelector('[data-site-identity-loader-label]');
  if (!loader || !label) return;
  label.textContent = String(message || 'Chargement...');
  loader.hidden = !loading;
}

function startLoader(container, message) {
  state.loaderCount += 1;
  setModuleLoader(container, true, message);
}

function stopLoader(container) {
  state.loaderCount = Math.max(0, state.loaderCount - 1);
  if (!state.loaderCount) {
    setModuleLoader(container, false);
  }
}

async function runWithLoader(container, message, task) {
  startLoader(container, message);
  try {
    return await task();
  } finally {
    stopLoader(container);
  }
}

async function fetchIdentity() {
  const response = await fetch(API_ROOT, {
    credentials: 'include'
  });
  const payload = await getJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Impossible de charger l’identité du site.");
  }
  return normalizeIdentity(payload);
}

async function uploadTempLogo(file) {
  const formData = new FormData();
  formData.append('logo', file);
  const response = await fetch(TEMP_LOGO_API, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  const payload = await getJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || "Impossible d'uploader le logo temporaire.");
  }
  const tempLogoId = String(payload?.tempLogoId || '').trim();
  const tempLogoUrl = String(payload?.tempLogoUrl || '').trim();
  if (!tempLogoId || !tempLogoUrl) {
    throw new Error('Réponse temporaire invalide.');
  }
  return {
    tempLogoId,
    tempLogoUrl,
    fileName: String(file?.name || '').trim() || 'logo'
  };
}

async function discardTempLogo(tempLogoId) {
  if (!tempLogoId) return;
  const response = await fetch(TEMP_LOGO_API, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempLogoId })
  });
  const payload = await getJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || 'Impossible de supprimer le logo temporaire.');
  }
}

function renderMainPreview(container) {
  const image = container.querySelector('[data-site-logo-image]');
  const fallback = container.querySelector('[data-site-logo-fallback]');
  const fallbackInitials = container.querySelector('[data-site-logo-fallback-initials]');
  const pending = container.querySelector('[data-site-logo-pending]');
  const summary = container.querySelector('[data-site-logo-summary]');
  const logoUrl = resolveDisplayedLogoUrl();
  const siteName = String(state.draft.siteName || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME;

  if (image) {
    if (logoUrl) {
      image.src = logoUrl;
      image.hidden = false;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
    }
    image.alt = `Logo de ${siteName}`;
  }

  if (fallbackInitials) {
    fallbackInitials.textContent = getSiteInitials(siteName);
  }
  if (fallback) {
    fallback.hidden = Boolean(logoUrl);
  }

  if (pending) {
    pending.hidden = !state.pendingLogo;
  }
  if (summary) {
    if (state.pendingLogo) {
      summary.textContent = `Nouveau logo prêt (${state.pendingLogo.fileName}).`;
    } else if (state.identity?.logoUrlResolved) {
      summary.textContent = 'Logo actuel en production.';
    } else {
      summary.textContent = 'Aucun logo configuré.';
    }
  }
}

function updateNameInput(container) {
  const input = container.querySelector('[data-site-name-input]');
  if (!input) return;
  const normalized = String(state.draft.siteName || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME;
  if (input.value !== normalized) {
    input.value = normalized;
  }
}

function renderModal(container) {
  const overlay = container.querySelector('[data-logo-confirm-modal]');
  if (!overlay) return;
  const image = overlay.querySelector('[data-logo-confirm-image]');
  const fileLabel = overlay.querySelector('[data-logo-confirm-file]');
  const noButton = overlay.querySelector('[data-action="confirm-logo-no"]');
  const yesButton = overlay.querySelector('[data-action="confirm-logo-yes"]');
  const candidate = state.modal.candidate;
  const logoUrl = String(candidate?.tempLogoUrl || '').trim();

  if (image) {
    if (logoUrl) {
      image.src = logoUrl;
      image.hidden = false;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
    }
  }
  if (fileLabel) {
    fileLabel.textContent = candidate?.fileName
      ? `Nouveau fichier: ${candidate.fileName}`
      : 'Nouveau fichier sélectionné';
  }
  if (noButton) noButton.disabled = state.modal.busy;
  if (yesButton) yesButton.disabled = state.modal.busy;

  if (state.modal.open) {
    overlay.hidden = false;
    if (state.modal.closeTimer) {
      clearTimeout(state.modal.closeTimer);
      state.modal.closeTimer = null;
    }
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
    });
    return;
  }

  overlay.classList.remove('is-open');
  state.modal.closeTimer = setTimeout(() => {
    if (state.modal.open) return;
    overlay.hidden = true;
  }, 180);
}

function refreshView(container) {
  updateNameInput(container);
  renderMainPreview(container);
  renderModal(container);
}

function openConfirmModal(container) {
  state.modal.open = true;
  refreshView(container);
}

function closeConfirmModal(container) {
  state.modal.open = false;
  state.modal.busy = false;
  refreshView(container);
}

async function cleanupTransientTempLogos() {
  const tempIds = [];
  if (state.pendingLogo?.tempLogoId) tempIds.push(state.pendingLogo.tempLogoId);
  if (state.modal.candidate?.tempLogoId) tempIds.push(state.modal.candidate.tempLogoId);
  const unique = [...new Set(tempIds.filter(Boolean))];
  if (!unique.length) return;
  await Promise.all(
    unique.map(async tempLogoId => {
      try {
        await discardTempLogo(tempLogoId);
      } catch (error) {
        debugError('CleanupTempLogo', error, { tempLogoId });
      }
    })
  );
}

function resetState() {
  state.identity = null;
  state.draft.siteName = DEFAULT_SITE_NAME;
  state.pendingLogo = null;
  state.modal.open = false;
  state.modal.busy = false;
  state.modal.candidate = null;
  state.loaderCount = 0;
  if (state.modal.closeTimer) {
    clearTimeout(state.modal.closeTimer);
    state.modal.closeTimer = null;
  }
}

async function handleFileSelection(container, file) {
  const fileInput = container.querySelector('[data-logo-file-input]');
  if (fileInput) {
    fileInput.value = '';
  }
  if (!file) return;
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    showToast({ type: 'error', message: 'Format invalide (png, jpg, jpeg, webp).', durationMs: 1000 });
    return;
  }
  if (file.size > MAX_LOGO_SIZE) {
    showToast({ type: 'error', message: 'Fichier trop lourd (max 2 Mo).', durationMs: 1000 });
    return;
  }

  try {
    if (state.modal.candidate?.tempLogoId) {
      await discardTempLogo(state.modal.candidate.tempLogoId);
      state.modal.candidate = null;
    }
    const candidate = await runWithLoader(container, 'Upload du logo temporaire...', () =>
      uploadTempLogo(file)
    );
    state.modal.candidate = candidate;
    openConfirmModal(container);
    debugInfo('Logo temporaire upload', candidate.tempLogoId);
  } catch (error) {
    showToast({ type: 'error', message: 'Échec de la préparation du logo.', durationMs: 1000 });
    debugError('UploadTempLogo', error, { fileName: file?.name || null });
  }
}

async function handleConfirmNo(container) {
  const candidate = state.modal.candidate;
  if (!candidate?.tempLogoId || state.modal.busy) {
    closeConfirmModal(container);
    state.modal.candidate = null;
    return;
  }
  state.modal.busy = true;
  refreshView(container);
  try {
    await runWithLoader(container, 'Suppression du logo temporaire...', () =>
      discardTempLogo(candidate.tempLogoId)
    );
    state.modal.candidate = null;
    closeConfirmModal(container);
    showToast({ type: 'info', message: 'Changement annulé.', durationMs: 1000 });
    debugInfo('Logo temporaire supprime', candidate.tempLogoId);
  } catch (error) {
    state.modal.busy = false;
    refreshView(container);
    showToast({ type: 'error', message: "Impossible d'annuler ce logo.", durationMs: 1000 });
    debugError('DiscardTempLogo', error, { tempLogoId: candidate.tempLogoId });
  }
}

async function handleConfirmYes(container) {
  const candidate = state.modal.candidate;
  if (!candidate?.tempLogoId || state.modal.busy) return;
  state.modal.busy = true;
  refreshView(container);
  await stageLogo(container, candidate);
}

async function stageLogo(container, candidate) {
  const previousPending = state.pendingLogo?.tempLogoId || null;
  state.pendingLogo = candidate;
  state.modal.candidate = null;
  closeConfirmModal(container);
  refreshView(container);
  showToast({ type: 'success', message: 'Nouveau logo en attente.', durationMs: 1000 });
  debugInfo('Logo stage', candidate.tempLogoId);

  if (previousPending && previousPending !== candidate.tempLogoId) {
    try {
      await runWithLoader(container, 'Nettoyage ancien logo temporaire...', () =>
        discardTempLogo(previousPending)
      );
    } catch (error) {
      debugError('CleanupPreviousPending', error, { tempLogoId: previousPending });
    }
  }
}

function buildSavePayload(siteName) {
  const payload = {
    siteName
  };

  if (state.pendingLogo?.tempLogoId) {
    payload.logoType = 'upload';
    payload.pendingLogo = {
      tempLogoId: state.pendingLogo.tempLogoId
    };
    return payload;
  }

  if (state.identity?.logoType === 'url') {
    payload.logoType = 'url';
    payload.logoUrl = state.identity.logoUrl;
    return payload;
  }

  if (state.identity?.logoType === 'upload') {
    payload.logoType = 'upload';
    return payload;
  }

  payload.logoType = null;
  return payload;
}

async function saveIdentity(container) {
  const saveButton = container.querySelector('[data-action="save-identity"]');
  const input = container.querySelector('[data-site-name-input]');
  const siteName = String(input?.value || '').trim();
  if (!siteName) {
    showToast({ type: 'error', message: 'Le nom du site est requis.', durationMs: 1000 });
    return;
  }

  state.draft.siteName = siteName;
  const payload = buildSavePayload(siteName);

  setActionButtonState(saveButton, 'loading', { loadingLabel: 'Enregistrement...' });
  try {
    await runWithLoader(container, 'Enregistrement des modifications...', async () => {
      const response = await fetch(API_ROOT, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await getJson(response);
      if (!response.ok) {
        throw new Error(body?.error || "Impossible d’enregistrer l’identité.");
      }
      const refreshed = await fetchIdentity();
      applyIdentity(refreshed);
    });

    refreshView(container);
    showToast({ type: 'success', message: 'Modifications enregistrées', durationMs: 1000 });
    setActionButtonState(saveButton, 'success', { successLabel: 'Enregistré' });
    debugInfo('Identité enregistrée', payload);
  } catch (error) {
    showToast({ type: 'error', message: "Échec de l’enregistrement", durationMs: 1000 });
    setActionButtonState(saveButton, 'error', { errorLabel: '\u00c9chec' });
    debugError('SaveIdentity', error, payload);
  }
}

function bindEvents(container) {
  const form = container.querySelector('[data-site-identity-form]');
  const nameInput = container.querySelector('[data-site-name-input]');
  const fileInput = container.querySelector('[data-logo-file-input]');
  const changeLogoButton = container.querySelector('[data-action="change-logo"]');
  const overlay = container.querySelector('[data-logo-confirm-modal]');
  const confirmNoButton = container.querySelector('[data-action="confirm-logo-no"]');
  const confirmYesButton = container.querySelector('[data-action="confirm-logo-yes"]');

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    await saveIdentity(container);
  });

  nameInput?.addEventListener('input', event => {
    state.draft.siteName = String(event.target?.value || '').trim();
    renderMainPreview(container);
  });

  changeLogoButton?.addEventListener('click', () => {
    openFilePicker(container);
  });

  fileInput?.addEventListener('change', async event => {
    const selectedFile = event.target?.files?.[0];
    await handleFileSelection(container, selectedFile);
  });

  confirmNoButton?.addEventListener('click', async () => {
    await handleConfirmNo(container);
  });

  confirmYesButton?.addEventListener('click', async () => {
    await handleConfirmYes(container);
  });

  overlay?.addEventListener('click', async event => {
    if (event.target !== overlay) return;
    await handleConfirmNo(container);
  });
}

function openFilePicker(container) {
  const picker = container.querySelector('[data-logo-file-input]');
  picker?.click();
}

function buildLoaderMarkup(message = 'Chargement...') {
  return `
    <div class="site-identity-inline-loader" role="status" aria-live="polite" aria-busy="true">
      <div class="site-identity-inline-loader__paws" aria-hidden="true">
        <span class="site-identity-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="site-identity-inline-loader__paw site-identity-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="site-identity-inline-loader__paw site-identity-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="site-identity-inline-loader__label" data-site-identity-loader-label>${escapeHtml(message)}</p>
    </div>
  `;
}

function buildMarkup() {
  return `
    <article class="site-identity-premium" data-site-identity-root>
      <header class="site-identity-premium__header">
        <h2>Identité du site</h2>
        <p>Définissez le nom et le logo utilisés par la vitrine.</p>
      </header>

      <div data-site-identity-loader hidden>
        ${buildLoaderMarkup('Chargement de l’identité...')}
      </div>

      <form class="site-identity-premium__form" data-site-identity-form>
        <section class="site-identity-panel">
          <div class="site-identity-panel__title">
            <h3>Nom du site</h3>
            <p>Renseignez le nom de votre institut.</p>
          </div>
          <label class="site-identity-field">
            <span>Nom</span>
            <input
              class="site-identity-minimal-input"
              type="text"
              name="siteName"
              data-site-name-input
              placeholder="Beauty Savage"
              maxlength="120"
              required
            >
          </label>
        </section>

        <section class="site-identity-panel">
          <div class="site-identity-panel__title">
            <h3>Logo du site</h3>
            <p>Uploadez le logo de votre institut.</p>
          </div>

          <div class="site-identity-logo-preview" data-site-logo-preview>
            <img data-site-logo-image hidden alt="Logo du site">
            <div class="site-identity-logo-fallback" data-site-logo-fallback>
              <span class="site-identity-logo-fallback__icon"><i class="bi bi-image" aria-hidden="true"></i></span>
              <span class="site-identity-logo-fallback__initials" data-site-logo-fallback-initials>BS</span>
              <p>Aucun logo configuré pour le moment.</p>
            </div>
          </div>
          <p class="site-identity-logo-summary" data-site-logo-summary></p>
          <p class="site-identity-pending-label" data-site-logo-pending hidden>
            Nouveau logo en attente d’enregistrement
          </p>

          <input
            type="file"
            data-logo-file-input
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            hidden
          >

          <div class="site-identity-panel__actions">
            <button type="button" class="site-identity-change-button" data-action="change-logo">
              <i class="bi bi-upload" aria-hidden="true"></i>
              <span>Changer le logo</span>
            </button>
          </div>
        </section>

        <div class="site-identity-savebar">
          <button type="submit" class="site-identity-save-button" data-action="save-identity">
            Enregistrer les modifications
          </button>
        </div>
      </form>

      <div class="site-identity-confirm-overlay" data-logo-confirm-modal hidden>
        <div class="site-identity-confirm-panel" role="dialog" aria-modal="true">
          <header class="site-identity-confirm-panel__header">
            <h3>Remplacer le logo ?</h3>
            <p>Êtes-vous sûr de vouloir remplacer l’ancien logo par celui-ci ?</p>
          </header>
          <div class="site-identity-confirm-preview">
            <img data-logo-confirm-image hidden alt="Nouveau logo">
          </div>
          <p class="site-identity-confirm-file" data-logo-confirm-file>Nouveau fichier sélectionné</p>
          <div class="site-identity-confirm-actions">
            <button type="button" class="site-identity-confirm-no" data-action="confirm-logo-no">Non</button>
            <button type="button" class="site-identity-confirm-yes" data-action="confirm-logo-yes">Oui</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

export async function renderModule(container) {
  if (!container) return;

  await cleanupTransientTempLogos();
  resetState();

  container.innerHTML = buildMarkup();
  bindEvents(container);

  if (state.escapeHandler) {
    window.removeEventListener('keydown', state.escapeHandler);
  }
  state.escapeHandler = async event => {
    if (event.key !== 'Escape' || !state.modal.open) return;
    event.preventDefault();
    await handleConfirmNo(container);
  };
  window.addEventListener('keydown', state.escapeHandler);

  try {
    await runWithLoader(container, 'Chargement de l’identité...', async () => {
      const identity = await fetchIdentity();
      applyIdentity(identity);
    });
    refreshView(container);
  } catch (error) {
    applyIdentity({
      siteName: DEFAULT_SITE_NAME,
      logoType: null,
      logoUrlResolved: '',
      logoUrl: '',
      updatedAt: null
    });
    refreshView(container);
    showToast({ type: 'error', message: "Impossible de charger l’identité", durationMs: 1000 });
    debugError('FetchIdentity', error);
  }
}

export default { renderModule };
