import { mountEditorialEditorInline } from './editorialEditor.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API_ROOT = '/api/gestion/editable-content';
const TARGET_TYPE = 'page';
const TARGET_ID = 'about';
const MIN_LOADER_MS = 1000;

const VIEW_LIST = 'list';
const VIEW_EDITOR = 'editor';

const state = {
  container: null,
  zones: [],
  entries: [],
  view: VIEW_LIST,
  activeZoneKey: '',
  draftHtml: null,
  loading: true,
  loadingLabel: 'Chargement des blocs...',
  editorInstance: null
};

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function escapeHtml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getJson(response) {
  return response?.json ? response.json().catch(() => ({})) : Promise.resolve({});
}

function formatTimestamp(value) {
  if (!value) return 'Pas encore personnalisé';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toPreviewText(html = '') {
  const stripped = String(html || '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 'Aucun contenu personnalisé.';
  return stripped;
}

function buildLoaderMarkup(label = 'Chargement des blocs...') {
  return `
    <div class="gcg-inline-loader epm-loader" role="status" aria-live="polite">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${escapeHtml(label)}</p>
    </div>
  `;
}

function getEntry(zoneKey) {
  return state.entries.find(entry => entry.zoneKey === zoneKey) || null;
}

function getActiveZone() {
  if (!state.activeZoneKey) return null;
  return state.zones.find(zone => zone.key === state.activeZoneKey) || null;
}

function cleanupEditorInstance() {
  if (!state.editorInstance) return;
  try {
    state.editorInstance.close?.();
  } catch (_error) {
    // ignore cleanup errors from detached editors
  }
  state.editorInstance = null;
}

function buildZoneCard(zone) {
  const entry = getEntry(zone.key);
  const sourceHtml = entry?.contentHtml || zone.defaultContent || '';
  const previewText = toPreviewText(sourceHtml);
  const updatedLabel = formatTimestamp(entry?.updatedAt || null);
  return `
    <article class="epm-card" data-about-zone-card="${escapeHtml(zone.key)}">
      <div class="epm-card__top">
        <span class="epm-card__icon" aria-hidden="true">
          <i class="bi bi-stars"></i>
        </span>
        <div class="epm-card__headings">
          <h3>${escapeHtml(zone.label || 'Bloc éditorial')}</h3>
          <p>${escapeHtml(zone.description || 'Bloc fixe pour la page À propos.')}</p>
        </div>
      </div>
      <p class="epm-card__preview">${escapeHtml(previewText)}</p>
      <div class="epm-card__footer">
        <small>Mis à jour : ${escapeHtml(updatedLabel)}</small>
        <button type="button" class="epm-edit-button" data-about-zone-edit="${escapeHtml(zone.key)}">
          <i class="bi bi-pencil" aria-hidden="true"></i>
          <span>Modifier</span>
        </button>
      </div>
    </article>
  `;
}

function renderEmptyState(root) {
  root.innerHTML = `
    <article class="epm-empty">
      <span class="epm-empty__icon" aria-hidden="true"><i class="bi bi-file-earmark-x"></i></span>
      <h3>Aucun bloc éditorial</h3>
      <p>Cette page ne contient pas encore de section modifiable.</p>
    </article>
  `;
}

function renderCardsView(contentRoot) {
  cleanupEditorInstance();
  if (!state.zones.length) {
    renderEmptyState(contentRoot);
    return;
  }

  contentRoot.innerHTML = `
    <div class="epm-grid">
      ${state.zones.map(buildZoneCard).join('')}
    </div>
  `;

  const buttons = contentRoot.querySelectorAll('[data-about-zone-edit]');
  buttons.forEach(button => {
    const zoneKey = String(button.dataset.aboutZoneEdit || '').trim();
    if (!zoneKey) return;
    button.addEventListener('click', () => {
      state.activeZoneKey = zoneKey;
      state.draftHtml = null;
      state.view = VIEW_EDITOR;
      renderContent();
    });
  });
}

function renderEditorView(contentRoot) {
  const zone = getActiveZone();
  if (!zone) {
    state.view = VIEW_LIST;
    state.activeZoneKey = '';
    state.draftHtml = null;
    renderCardsView(contentRoot);
    return;
  }

  const entry = getEntry(zone.key);
  const initialHtml = state.draftHtml ?? entry?.contentHtml ?? zone.defaultContent ?? '';

  contentRoot.innerHTML = `
    <div class="epm-editor-view" data-about-editor-view>
      <button type="button" class="epm-back-button" data-about-editor-back>
        <i class="bi bi-arrow-left" aria-hidden="true"></i>
        <span>Retour</span>
      </button>
      <div class="epm-editor-host" data-about-editor-host></div>
    </div>
  `;

  const backButton = contentRoot.querySelector('[data-about-editor-back]');
  backButton?.addEventListener('click', () => {
    state.view = VIEW_LIST;
    state.activeZoneKey = '';
    state.draftHtml = null;
    renderContent();
  });

  cleanupEditorInstance();
  const host = contentRoot.querySelector('[data-about-editor-host]');
  state.editorInstance = mountEditorialEditorInline(host, {
    title: zone.label,
    description: zone.description || '',
    label: `Édition : ${zone.label}`,
    initialHtml,
    closeOnSave: false,
    onCancel: () => {
      state.view = VIEW_LIST;
      state.activeZoneKey = '';
      state.draftHtml = null;
      renderContent();
    },
    onSave: html => saveZoneContentFromEditor(zone, html)
  });
}

function renderContent() {
  const container = state.container;
  if (!container) return;
  const contentRoot = container.querySelector('[data-about-content]');
  if (!contentRoot) return;

  if (state.loading) {
    cleanupEditorInstance();
    contentRoot.innerHTML = buildLoaderMarkup(state.loadingLabel || 'Chargement des blocs...');
    return;
  }

  if (state.view === VIEW_EDITOR) {
    renderEditorView(contentRoot);
    return;
  }

  renderCardsView(contentRoot);
}

async function requestPageContent() {
  const params = new URLSearchParams({
    targetType: TARGET_TYPE,
    targetId: TARGET_ID
  });
  const endpoint = `${API_ROOT}?${params.toString()}`;
  const response = await fetch(endpoint, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) {
    const error = new Error(payload?.error || 'Impossible de charger les blocs éditoriaux.');
    error.status = response.status;
    error.endpoint = endpoint;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function hydrateFromApi() {
  const payload = await requestPageContent();
  state.zones = Array.isArray(payload?.zones) ? payload.zones : [];
  state.entries = Array.isArray(payload?.entries) ? payload.entries : [];
}

async function loadContent({ loaderLabel = 'Chargement des blocs...' } = {}) {
  const startedAt = Date.now();
  state.loading = true;
  state.loadingLabel = loaderLabel;
  renderContent();

  try {
    await hydrateFromApi();
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    state.loading = false;
    state.loadingLabel = 'Chargement des blocs...';
    state.view = VIEW_LIST;
    state.activeZoneKey = '';
    state.draftHtml = null;
    renderContent();
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }
    state.loading = false;
    state.loadingLabel = 'Chargement des blocs...';
    state.view = VIEW_LIST;
    state.activeZoneKey = '';
    state.draftHtml = null;
    renderContent();
    showToast({ type: 'error', message: 'Échec du chargement', durationMs: 1000 });
    logUiError('AboutGestion:Load', error, {
      status: error?.status || null,
      endpoint: error?.endpoint || `${API_ROOT}?targetType=${TARGET_TYPE}&targetId=${TARGET_ID}`,
      payload: error?.payload || null,
      message: error?.message || null
    });
  }
}

async function saveZoneContent(zone, html) {
  const endpoint = API_ROOT;
  const requestBody = {
    targetType: TARGET_TYPE,
    targetId: TARGET_ID,
    zoneKey: zone.key,
    contentHtml: html
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  const payload = await getJson(response);
  if (!response.ok) {
    const error = new Error(payload?.error || 'Impossible de sauvegarder ce bloc.');
    error.status = response.status;
    error.endpoint = endpoint;
    error.payload = payload;
    error.safePayload = {
      targetType: TARGET_TYPE,
      targetId: TARGET_ID,
      zoneKey: zone.key
    };
    throw error;
  }
}

async function saveZoneContentFromEditor(zone, html) {
  const startedAt = Date.now();
  state.draftHtml = html;
  state.loading = true;
  state.loadingLabel = 'Enregistrement des modifications...';
  renderContent();

  try {
    await saveZoneContent(zone, html);
    await hydrateFromApi();

    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }

    state.loading = false;
    state.loadingLabel = 'Chargement des blocs...';
    state.view = VIEW_LIST;
    state.activeZoneKey = '';
    state.draftHtml = null;
    renderContent();

    showToast({ type: 'success', message: 'Modifications enregistrées', durationMs: 1000 });
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }

    state.loading = false;
    state.loadingLabel = 'Chargement des blocs...';
    state.view = VIEW_EDITOR;
    state.activeZoneKey = zone.key;
    renderContent();

    showToast({ type: 'error', message: "Échec de l'enregistrement", durationMs: 1000 });
    logUiError('AboutGestion:Save', error, {
      status: error?.status || null,
      endpoint: error?.endpoint || API_ROOT,
      payload: error?.payload || null,
      message: error?.message || null,
      safePayload: error?.safePayload || {
        targetType: TARGET_TYPE,
        targetId: TARGET_ID,
        zoneKey: zone.key
      }
    });
    throw new Error("Échec de l'enregistrement");
  }
}

function renderShell(container) {
  container.innerHTML = `
    <section class="module-panel epm-module epm-module--about">
      <header class="epm-header">
        <h2>À propos</h2>
        <p>Gérez les blocs éditoriaux de la page À propos avec un rendu premium minimaliste.</p>
      </header>
      <div class="epm-content" data-about-content>
        ${buildLoaderMarkup('Chargement des blocs...')}
      </div>
    </section>
  `;
}

export async function renderModule(container) {
  if (!container) return;
  state.container = container;
  state.zones = [];
  state.entries = [];
  state.view = VIEW_LIST;
  state.activeZoneKey = '';
  state.draftHtml = null;
  state.loading = true;
  state.loadingLabel = 'Chargement des blocs...';
  cleanupEditorInstance();
  renderShell(container);
  await loadContent();
}

export default { renderModule };