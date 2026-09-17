import { openEditorialEditor } from './editorialEditor.js';
import { openUiConfirmModal } from './uiConfirmModal.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const HOME_SETTINGS_ENDPOINT = '/api/gestion/home-settings';
const TEMP_ASSET_ENDPOINT = '/api/gestion/home-settings/temp-asset';
const SITE_IDENTITY_ENDPOINT = '/api/vitrine/site-identity';
const TEMP_ASSET_PREFIX = '/uploads/home/tmp/';
const MIN_LOADER_MS = 1000;

const state = {
  container: null,
  loading: true,
  loadingLabel: 'Chargement du module Accueil...',
  siteName: 'Beauty Savage',
  persisted: null,
  draft: null
};

function wait(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeEditorialPreviewHtml(html = '') {
  const source = String(html || '').trim();
  if (!source) return '';
  if (typeof DOMParser === 'undefined') return source;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';
    root.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(node => {
      node.remove();
    });
    root.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes || []).forEach(attribute => {
        const name = String(attribute.name || '').toLowerCase();
        const value = String(attribute.value || '');
        if (name.startsWith('on')) {
          node.removeAttribute(attribute.name);
          return;
        }
        if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
          node.removeAttribute(attribute.name);
          return;
        }
        if (name === 'style') {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return String(root.innerHTML || '').trim();
  } catch (_error) {
    return source;
  }
}

function getEditorialPreviewInnerHtml(html = '', emptyMessage = 'Aucun contenu personnalisé.') {
  const sanitizedHtml = sanitizeEditorialPreviewHtml(html);
  if (sanitizedHtml) return sanitizedHtml;
  return `<p class="homegm-preview-empty">${escapeHtml(emptyMessage)}</p>`;
}

function emptyAsset() {
  return {
    type: null,
    url: null,
    filePath: null,
    urlResolved: null,
    updatedAt: null
  };
}

function normalizeAsset(asset) {
  const next = emptyAsset();
  const type = String(asset?.type || '').trim().toLowerCase();
  if (type === 'url') {
    next.type = 'url';
    next.url = String(asset?.url || '').trim() || null;
  } else if (type === 'upload') {
    next.type = 'upload';
    next.filePath = String(asset?.filePath || '').trim() || null;
  }
  const resolved = String(asset?.urlResolved || '').trim();
  if (resolved) {
    next.urlResolved = resolved;
  } else if (next.type === 'url' && next.url) {
    next.urlResolved = next.url;
  } else if (next.type === 'upload' && next.filePath) {
    next.urlResolved = next.filePath;
  }
  next.updatedAt = asset?.updatedAt || null;
  return next;
}

function normalizeSettings(source) {
  return {
    banner: normalizeAsset(source?.banner),
    slogan: String(source?.slogan || '').trim(),
    hookEditorialHtml: String(source?.hookEditorialHtml || ''),
    about: {
      photo: normalizeAsset(source?.about?.photo),
      editorialHtml: String(source?.about?.editorialHtml || '')
    },
    updatedAt: source?.updatedAt || null
  };
}

function cloneSettings(source) {
  return normalizeSettings(JSON.parse(JSON.stringify(normalizeSettings(source))));
}

function isTempAssetPath(pathValue) {
  return String(pathValue || '').trim().startsWith(TEMP_ASSET_PREFIX);
}

function getAssetPreviewUrl(asset) {
  return String(asset?.urlResolved || asset?.url || asset?.filePath || '').trim();
}

function buildLoaderMarkup(label = 'Chargement...') {
  return `
    <div class="homegm-loader" role="status" aria-live="polite">
      <div class="homegm-loader__paws" aria-hidden="true">
        <span class="homegm-loader__paw">${PAW_ICON_SVG}</span>
        <span class="homegm-loader__paw homegm-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="homegm-loader__paw homegm-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p>${escapeHtml(label)}</p>
    </div>
  `;
}

function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : Promise.resolve({});
}

async function fetchHomeSettings() {
  const response = await fetch(HOME_SETTINGS_ENDPOINT, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) {
    const error = new Error(payload?.error || "Impossible de charger les réglages de l'accueil.");
    error.status = response.status;
    error.endpoint = HOME_SETTINGS_ENDPOINT;
    error.payload = payload;
    throw error;
  }
  return normalizeSettings(payload?.settings || {});
}

async function fetchSiteIdentity() {
  const response = await fetch(SITE_IDENTITY_ENDPOINT, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) return 'Beauty Savage';
  return String(payload?.siteName || 'Beauty Savage').trim() || 'Beauty Savage';
}

async function discardTempAsset(tempAssetId) {
  const normalized = String(tempAssetId || '').trim();
  if (!normalized || !isTempAssetPath(normalized)) return;
  try {
    await fetch(TEMP_ASSET_ENDPOINT, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempAssetId: normalized })
    });
  } catch (_error) {
    // No-op: cleanup best effort.
  }
}

async function uploadTempAsset(file, loaderTarget) {
  if (!file) {
    throw new Error('Aucun fichier sélectionné.');
  }
  if (loaderTarget) {
    loaderTarget.hidden = false;
    loaderTarget.innerHTML = buildLoaderMarkup('Upload en cours...');
  }
  try {
    const formData = new FormData();
    formData.append('asset', file);
    const response = await fetch(TEMP_ASSET_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    const payload = await getJson(response);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Impossible d'uploader l'image.");
    }
    const tempAssetId = String(payload.tempAssetId || '').trim();
    if (!tempAssetId) {
      throw new Error("Réponse d'upload invalide.");
    }
    return tempAssetId;
  } finally {
    if (loaderTarget) {
      loaderTarget.hidden = true;
      loaderTarget.innerHTML = '';
    }
  }
}

function renderShell(container) {
  container.innerHTML = `
    <section class="module-panel homegm-module">
      <header class="homegm-header">
        <h2>Accueil</h2>
        <p>Éditez la bannière, le slogan et l'accroche.</p>
      </header>
      <div class="homegm-content" data-homegm-content></div>
    </section>
  `;
}

function renderEmptyImageSlot(label, icon = 'bi bi-image') {
  return `
    <div class="homegm-image-empty">
      <i class="${escapeHtml(icon)}" aria-hidden="true"></i>
      <p>${escapeHtml(label)}</p>
    </div>
  `;
}

function renderMainView() {
  const content = state.container?.querySelector('[data-homegm-content]');
  if (!content) return;
  if (state.loading) {
    content.innerHTML = buildLoaderMarkup(state.loadingLabel || 'Chargement...');
    return;
  }

  const draft = state.draft || normalizeSettings({});
  const bannerUrl = getAssetPreviewUrl(draft.banner);
  const hookPreviewInnerHtml = getEditorialPreviewInnerHtml(
    draft.hookEditorialHtml,
    'Aucun contenu personnalisé.'
  );

  content.innerHTML = `
    <div class="homegm-grid">
      <article class="homegm-card homegm-card--banner">
        <div class="homegm-card__top">
          <span class="homegm-card__icon"><i class="bi bi-image"></i></span>
          <div>
            <h3>Bannière hero</h3>
            <p>Image de couverture principale + prévisualisation en direct.</p>
          </div>
        </div>
        <div class="homegm-banner-preview">
          <div class="homegm-banner-preview__media">
            ${
              bannerUrl
                ? `<img src="${escapeHtml(bannerUrl)}" alt="Bannière accueil" loading="lazy">`
                : renderEmptyImageSlot('Aucune bannière configurée.', 'bi bi-image-alt')
            }
          </div>
          <div class="homegm-banner-preview__overlay">
            <strong>${escapeHtml(state.siteName || 'Beauty Savage')}</strong>
            <p data-homegm-slogan-preview style="color: var(--color-sufrace)">${escapeHtml(
              draft.slogan || 'Ajoutez un slogan premium pour la home.'
            )}</p>
          </div>
        </div>
        <div class="homegm-card__footer">
          <button type="button" class="homegm-edit-link" data-homegm-action="edit-banner">
            <i class="bi bi-pencil"></i><span>${bannerUrl ? 'Changer la bannière' : 'Ajouter une bannière'}</span>
          </button>
        </div>
      </article>

      <article class="homegm-card">
        <div class="homegm-card__top">
          <span class="homegm-card__icon"><i class="bi bi-chat-square-text"></i></span>
          <div>
            <h3>Slogan</h3>
            <p>Texte affiché sur la bannière d'accueil.</p>
          </div>
        </div>
        <label class="homegm-field">
          <span>Slogan</span>
          <input
            type="text"
            class="gcg-minimal-input"
            data-homegm-slogan-input
            maxlength="180"
            value="${escapeHtml(draft.slogan || '')}"
            placeholder="Votre slogan premium"
          >
        </label>
      </article>

      <article class="homegm-card">
        <div class="homegm-card__top">
          <span class="homegm-card__icon"><i class="bi bi-stars"></i></span>
          <div>
            <h3>Accroche éditoriale</h3>
            <p>Texte premium affiché sous le bloc collections.</p>
          </div>
        </div>
        <div class="homegm-preview-text homegm-preview-rich editorial-detail">
          ${hookPreviewInnerHtml}
        </div>
        <div class="homegm-card__footer">
          <button type="button" class="homegm-edit-link" data-homegm-action="edit-hook">
            <i class="bi bi-pencil"></i><span>Modifier l'accroche</span>
          </button>
        </div>
      </article>

      <article class="homegm-card homegm-card--readonly">
        <div class="homegm-card__top">
          <span class="homegm-card__icon"><i class="bi bi-lightning-charge"></i></span>
          <div>
            <h3>Bloc Boost</h3>
            <p>Géré dans le module Boost/Formations (max 3).</p>
          </div>
        </div>
      </article>

      <article class="homegm-card homegm-card--readonly">
        <div class="homegm-card__top">
          <span class="homegm-card__icon"><i class="bi bi-grid-3x3-gap"></i></span>
          <div>
            <h3>Bloc Nos collections</h3>
            <p>Section fixe côté home. Base prête pour évolution future.</p>
          </div>
        </div>
      </article>
    </div>
    <div class="homegm-savebar">
      <button type="button" class="primary-button" data-homegm-action="save">
        Enregistrer les modifications
      </button>
    </div>
  `;
  bindMainViewActions();
}

function bindMainViewActions() {
  const content = state.container?.querySelector('[data-homegm-content]');
  if (!content) return;

  const sloganInput = content.querySelector('[data-homegm-slogan-input]');
  sloganInput?.addEventListener('input', () => {
    if (!state.draft) return;
    state.draft.slogan = String(sloganInput.value || '').trimStart();
    const preview = content.querySelector('[data-homegm-slogan-preview]');
    if (preview) {
      preview.textContent = state.draft.slogan || 'Ajoutez un slogan premium pour la home.';
    }
  });

  content.querySelector('[data-homegm-action="edit-banner"]')?.addEventListener('click', () => {
    openAssetSourceModal({
      title: 'Bannière d’accueil',
      currentAsset: state.draft?.banner,
      onApply: nextAsset => applyDraftAsset('banner', nextAsset)
    });
  });

  content.querySelector('[data-homegm-action="edit-hook"]')?.addEventListener('click', () => {
    openEditorialEditor({
      title: 'Accroche éditoriale',
      description: 'Ce contenu sera affiché sur la home vitrine.',
      label: "Édition de l'accroche",
      initialHtml: state.draft?.hookEditorialHtml || '',
      onSave: html => {
        if (!state.draft) return;
        state.draft.hookEditorialHtml = String(html || '');
        showToast({ type: 'success', message: 'Brouillon mis à jour', durationMs: 1000 });
        renderMainView();
      }
    });
  });

  content.querySelector('[data-homegm-action="save"]')?.addEventListener('click', () => {
    void saveDraft();
  });
}

async function applyDraftAsset(assetPath, nextAsset) {
  if (!state.draft) return;
  const segments = String(assetPath || '').split('.');
  if (!segments.length) return;

  let cursor = state.draft;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  const leaf = segments[segments.length - 1];
  const currentAsset = normalizeAsset(cursor[leaf]);
  const incomingAsset = normalizeAsset(nextAsset);

  const currentTempPath = isTempAssetPath(currentAsset.filePath) ? currentAsset.filePath : null;
  const incomingTempPath = isTempAssetPath(incomingAsset.filePath) ? incomingAsset.filePath : null;
  if (currentTempPath && currentTempPath !== incomingTempPath) {
    await discardTempAsset(currentTempPath);
  }

  cursor[leaf] = incomingAsset;
  renderMainView();
}

function createModalOverlay(markup) {
  const overlay = document.createElement('div');
  overlay.className = 'homegm-modal-overlay';
  overlay.setAttribute('tabindex', '-1');
  overlay.innerHTML = markup;
  document.body.appendChild(overlay);
  overlay.focus();
  return overlay;
}

function bindModalClose(overlay, closeFn) {
  const onKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFn();
    }
  };
  document.addEventListener('keydown', onKeyDown);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeFn();
    }
  });
  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}

function buildAssetSourceModalMarkup(title, currentAsset) {
  const currentPreview = getAssetPreviewUrl(currentAsset);
  return `
    <div class="homegm-modal homegm-modal--asset" role="dialog" aria-modal="true" aria-label="${escapeHtml(
      title
    )}">
      <header class="homegm-modal__header">
        <h3>${escapeHtml(title)}</h3>
        <button type="button" class="homegm-modal__close" data-modal-close aria-label="Fermer">
          <i class="bi bi-x-lg"></i>
        </button>
      </header>
      <div class="homegm-modal__body">
        <p class="muted">Choisissez une source : upload local ou URL.</p>
        <div class="homegm-source-switch" role="tablist" aria-label="Source image">
          <button type="button" class="homegm-source-switch__btn is-active" data-source-mode="upload" role="tab" aria-selected="true">Upload</button>
          <button type="button" class="homegm-source-switch__btn" data-source-mode="url" role="tab" aria-selected="false">URL</button>
        </div>
        <div class="homegm-source-panel" data-source-panel="upload">
          <button type="button" class="secondary-button" data-asset-pick-file>
            <i class="bi bi-upload"></i>
            <span>Choisir une image</span>
          </button>
          <input type="file" accept="image/png,image/jpeg,image/webp" data-asset-file-input hidden>
          <p class="muted homegm-source-hint">PNG/JPG/WEBP · 6 Mo max.</p>
        </div>
        <div class="homegm-source-panel" data-source-panel="url" hidden>
          <label class="homegm-field">
            <span>URL de l'image</span>
            <input type="url" class="gcg-minimal-input" data-asset-url-input placeholder="https://...">
          </label>
        </div>
        <div class="homegm-asset-preview" data-asset-preview>
          ${
            currentPreview
              ? `<img src="${escapeHtml(currentPreview)}" alt="Prévisualisation" loading="lazy">`
              : renderEmptyImageSlot('Aperçu indisponible')
          }
        </div>
        <div data-asset-loader hidden></div>
        <p class="form-message" data-asset-feedback></p>
      </div>
      <footer class="homegm-modal__footer">
        <button type="button" class="secondary-button" data-modal-cancel>Annuler</button>
        <button type="button" class="primary-button" data-asset-apply>Utiliser cette image</button>
      </footer>
    </div>
  `;
}

function setAssetFeedback(overlay, message = '', tone = '') {
  const target = overlay.querySelector('[data-asset-feedback]');
  if (!target) return;
  target.textContent = message;
  if (tone) {
    target.dataset.status = tone;
  } else {
    delete target.dataset.status;
  }
}

function updateSourceMode(overlay, mode) {
  const safeMode = mode === 'url' ? 'url' : 'upload';
  overlay.querySelectorAll('[data-source-mode]').forEach(button => {
    const active = button.dataset.sourceMode === safeMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  overlay.querySelectorAll('[data-source-panel]').forEach(panel => {
    panel.hidden = panel.dataset.sourcePanel !== safeMode;
  });
}

function setAssetPreview(overlay, url) {
  const target = overlay.querySelector('[data-asset-preview]');
  if (!target) return;
  if (!url) {
    target.innerHTML = renderEmptyImageSlot('Aperçu indisponible');
    return;
  }
  target.innerHTML = `<img src="${escapeHtml(url)}" alt="Prévisualisation" loading="lazy">`;
}

function openAssetSourceModal({ title, currentAsset, onApply }) {
  const normalizedCurrent = normalizeAsset(currentAsset);
  const overlay = createModalOverlay(buildAssetSourceModalMarkup(title, normalizedCurrent));
  const cleanupModalClose = bindModalClose(overlay, closeModal);
  const fileInput = overlay.querySelector('[data-asset-file-input]');
  const pickFileButton = overlay.querySelector('[data-asset-pick-file]');
  const urlInput = overlay.querySelector('[data-asset-url-input]');
  const loaderTarget = overlay.querySelector('[data-asset-loader]');

  let mode = 'upload';
  let stagedTempAsset = null;
  let stagedUrl = normalizedCurrent.type === 'url' ? normalizedCurrent.url || '' : '';
  let consumed = false;
  if (urlInput) {
    urlInput.value = stagedUrl;
  }

  function closeModal() {
    cleanupModalClose();
    overlay.remove();
    if (!consumed && stagedTempAsset) {
      void discardTempAsset(stagedTempAsset);
    }
  }

  overlay.querySelector('[data-modal-close]')?.addEventListener('click', closeModal);
  overlay.querySelector('[data-modal-cancel]')?.addEventListener('click', closeModal);

  overlay.querySelectorAll('[data-source-mode]').forEach(button => {
    button.addEventListener('click', () => {
      mode = button.dataset.sourceMode === 'url' ? 'url' : 'upload';
      updateSourceMode(overlay, mode);
      setAssetFeedback(overlay, '');
      if (mode === 'url') {
        setAssetPreview(overlay, stagedUrl);
      } else if (stagedTempAsset) {
        setAssetPreview(overlay, stagedTempAsset);
      }
    });
  });

  pickFileButton?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0] || null;
    if (!file) return;
    setAssetFeedback(overlay, '');
    try {
      const previousTemp = stagedTempAsset;
      const nextTemp = await uploadTempAsset(file, loaderTarget);
      stagedTempAsset = nextTemp;
      setAssetPreview(overlay, stagedTempAsset);
      if (previousTemp && previousTemp !== stagedTempAsset) {
        await discardTempAsset(previousTemp);
      }
      showToast({ type: 'success', message: 'Upload temporaire prêt', durationMs: 1000 });
    } catch (error) {
      setAssetFeedback(overlay, error?.message || "Échec de l'upload.", 'error');
      showToast({ type: 'error', message: "Échec de l'upload", durationMs: 1000 });
    } finally {
      fileInput.value = '';
    }
  });

  urlInput?.addEventListener('input', () => {
    stagedUrl = String(urlInput.value || '').trim();
    if (mode === 'url') {
      setAssetPreview(overlay, stagedUrl);
    }
  });

  overlay.querySelector('[data-asset-apply]')?.addEventListener('click', async () => {
    let nextAsset = emptyAsset();
    let cleanupTempAfterApply = null;
    if (mode === 'upload') {
      if (!stagedTempAsset) {
        setAssetFeedback(overlay, 'Veuillez uploader une image.', 'error');
        return;
      }
      nextAsset = {
        ...emptyAsset(),
        type: 'upload',
        filePath: stagedTempAsset,
        urlResolved: stagedTempAsset
      };
    } else {
      const value = String(stagedUrl || '').trim();
      if (!value || !/^https?:\/\//i.test(value)) {
        setAssetFeedback(overlay, 'Veuillez renseigner une URL valide (http/https).', 'error');
        return;
      }
      cleanupTempAfterApply = stagedTempAsset;
      nextAsset = {
        ...emptyAsset(),
        type: 'url',
        url: value,
        urlResolved: value
      };
    }

    const confirmed = await openUiConfirmModal({
      title: 'Confirmer le remplacement ?',
      message:
        'Cette nouvelle image remplacera le brouillon actuel. Le remplacement définitif sera effectué au clic sur “Enregistrer les modifications”.',
      confirmLabel: 'Confirmer',
      cancelLabel: 'Annuler',
      intent: 'primary'
    });
    if (!confirmed) return;

    if (cleanupTempAfterApply) {
      await discardTempAsset(cleanupTempAfterApply);
      stagedTempAsset = null;
    }
    consumed = true;
    await onApply(nextAsset);
    closeModal();
  });
}

function buildSavePayload() {
  const draft = normalizeSettings(state.draft || {});
  return {
    slogan: draft.slogan,
    hookEditorialHtml: draft.hookEditorialHtml,
    banner: {
      type: draft.banner.type,
      url: draft.banner.url,
      filePath: draft.banner.filePath
    },
    about: {
      photo: {
        type: draft.about.photo.type,
        url: draft.about.photo.url,
        filePath: draft.about.photo.filePath
      },
      editorialHtml: draft.about.editorialHtml
    }
  };
}

async function saveDraft() {
  const startedAt = Date.now();
  state.loading = true;
  state.loadingLabel = 'Enregistrement des modifications...';
  renderMainView();

  try {
    const response = await fetch(HOME_SETTINGS_ENDPOINT, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSavePayload())
    });
    const payload = await getJson(response);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.error || "Impossible d'enregistrer l'accueil.");
      error.status = response.status;
      error.endpoint = HOME_SETTINGS_ENDPOINT;
      error.payload = payload;
      throw error;
    }
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    state.persisted = normalizeSettings(payload.settings || {});
    state.draft = cloneSettings(state.persisted);
    state.loading = false;
    state.loadingLabel = 'Chargement du module Accueil...';
    renderMainView();
    showToast({ type: 'success', message: 'Modifications enregistrées', durationMs: 1000 });
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    state.loading = false;
    state.loadingLabel = 'Chargement du module Accueil...';
    renderMainView();
    showToast({ type: 'error', message: "Échec de l'enregistrement", durationMs: 1000 });
    logUiError('HomeGestion:Save', error, {
      status: error?.status || null,
      endpoint: error?.endpoint || HOME_SETTINGS_ENDPOINT,
      payload: error?.payload || null,
      safePayload: buildSavePayload()
    });
  }
}

async function loadData() {
  const startedAt = Date.now();
  state.loading = true;
  state.loadingLabel = 'Chargement du module Accueil...';
  renderMainView();
  try {
    const [settings, siteName] = await Promise.all([fetchHomeSettings(), fetchSiteIdentity()]);
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    state.persisted = settings;
    state.draft = cloneSettings(settings);
    state.siteName = siteName;
    state.loading = false;
    state.loadingLabel = 'Chargement du module Accueil...';
    renderMainView();
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    state.loading = false;
    state.loadingLabel = 'Chargement du module Accueil...';
    renderMainView();
    showToast({ type: 'error', message: 'Échec du chargement', durationMs: 1000 });
    logUiError('HomeGestion:Load', error, {
      status: error?.status || null,
      endpoint: error?.endpoint || HOME_SETTINGS_ENDPOINT,
      payload: error?.payload || null
    });
  }
}

export async function renderModule(container) {
  if (!container) return;
  state.container = container;
  state.loading = true;
  state.loadingLabel = 'Chargement du module Accueil...';
  state.siteName = 'Beauty Savage';
  state.persisted = null;
  state.draft = null;
  renderShell(container);
  renderMainView();
  await loadData();
}
