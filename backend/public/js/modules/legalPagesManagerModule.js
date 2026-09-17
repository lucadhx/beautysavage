import { mountEditorialEditorInline } from './editorialEditor.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API_ROOT = '/api/gestion/editable-content';
const TARGET_TYPE = 'legal-page';
const ZONE_KEY = 'mainText';
const MIN_LOADER_MS = 1000;

const VIEW_LIST = 'list';
const VIEW_EDITOR = 'editor';

const LEGAL_PAGE_META = [
  {
    slug: 'mentions-legales',
    title: 'Mentions légales',
    description: 'Identité de l institut, publication et cadre réglementaire.',
    iconClass: 'bi-shield-check'
  },
  {
    slug: 'politique-confidentialite',
    title: 'Politique de confidentialité',
    description: 'Gestion des données, conservation et engagements RGPD.',
    iconClass: 'bi-lock'
  },
  {
    slug: 'cgv',
    title: 'Conditions générales de vente',
    description: 'Règles de commande, paiement, délais et obligations clients.',
    iconClass: 'bi-receipt'
  }
];

const state = {
  container: null,
  entriesBySlug: {},
  view: VIEW_LIST,
  activeSlug: '',
  draftHtml: null,
  loading: true,
  loadingLabel: 'Chargement des politiques...',
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

function getEntry(slug) {
  return state.entriesBySlug[slug] || null;
}

function getActivePage() {
  if (!state.activeSlug) return null;
  return LEGAL_PAGE_META.find(page => page.slug === state.activeSlug) || null;
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

function renderEmptyState(root) {
  root.innerHTML = `
    <article class="epm-empty">
      <span class="epm-empty__icon" aria-hidden="true"><i class="bi bi-files"></i></span>
      <h3>Aucun bloc disponible</h3>
      <p>Les pages de politiques ne sont pas disponibles pour le moment.</p>
    </article>
  `;
}

function buildPageCard(page) {
  const entry = getEntry(page.slug);
  const previewText = toPreviewText(entry?.contentHtml || '');
  const updatedLabel = formatTimestamp(entry?.updatedAt || null);
  return `
    <article class="epm-card" data-legal-card="${escapeHtml(page.slug)}">
      <div class="epm-card__top">
        <span class="epm-card__icon" aria-hidden="true">
          <i class="bi ${escapeHtml(page.iconClass)}"></i>
        </span>
        <div class="epm-card__headings">
          <h3>${escapeHtml(page.title)}</h3>
          <p>${escapeHtml(page.description)}</p>
        </div>
      </div>
      <p class="epm-card__preview">${escapeHtml(previewText)}</p>
      <div class="epm-card__footer">
        <small>Mis à jour : ${escapeHtml(updatedLabel)}</small>
        <button type="button" class="epm-edit-button" data-legal-edit="${escapeHtml(page.slug)}">
          <i class="bi bi-pencil" aria-hidden="true"></i>
          <span>Modifier</span>
        </button>
      </div>
    </article>
  `;
}

function renderCardsView(contentRoot) {
  cleanupEditorInstance();
  if (!LEGAL_PAGE_META.length) {
    renderEmptyState(contentRoot);
    return;
  }

  contentRoot.innerHTML = `
    <div class="epm-grid">
      ${LEGAL_PAGE_META.map(buildPageCard).join('')}
    </div>
  `;

  const buttons = contentRoot.querySelectorAll('[data-legal-edit]');
  buttons.forEach(button => {
    const slug = String(button.dataset.legalEdit || '').trim();
    if (!slug) return;
    button.addEventListener('click', () => {
      state.activeSlug = slug;
      state.draftHtml = null;
      state.view = VIEW_EDITOR;
      renderContent();
    });
  });
}

function renderEditorView(contentRoot) {
  const page = getActivePage();
  if (!page) {
    state.view = VIEW_LIST;
    state.activeSlug = '';
    state.draftHtml = null;
    renderCardsView(contentRoot);
    return;
  }

  const entry = getEntry(page.slug);
  const initialHtml = state.draftHtml ?? entry?.contentHtml ?? '';

  contentRoot.innerHTML = `
    <div class="epm-editor-view" data-legal-editor-view>
      <button type="button" class="epm-back-button" data-legal-editor-back>
        <i class="bi bi-arrow-left" aria-hidden="true"></i>
        <span>Retour</span>
      </button>
      <div class="epm-editor-host" data-legal-editor-host></div>
    </div>
  `;

  const backButton = contentRoot.querySelector('[data-legal-editor-back]');
  backButton?.addEventListener('click', () => {
    state.view = VIEW_LIST;
    state.activeSlug = '';
    state.draftHtml = null;
    renderContent();
  });

  cleanupEditorInstance();
  const host = contentRoot.querySelector('[data-legal-editor-host]');
  state.editorInstance = mountEditorialEditorInline(host, {
    title: page.title,
    description: page.description,
    label: `Édition : ${page.title}`,
    initialHtml,
    closeOnSave: false,
    onCancel: () => {
      state.view = VIEW_LIST;
      state.activeSlug = '';
      state.draftHtml = null;
      renderContent();
    },
    onSave: html => savePageContentFromEditor(page, html)
  });
}

function renderContent() {
  const container = state.container;
  if (!container) return;
  const contentRoot = container.querySelector('[data-legal-content]');
  if (!contentRoot) return;

  if (state.loading) {
    cleanupEditorInstance();
    contentRoot.innerHTML = buildLoaderMarkup(state.loadingLabel || 'Chargement des politiques...');
    return;
  }

  if (state.view === VIEW_EDITOR) {
    renderEditorView(contentRoot);
    return;
  }

  renderCardsView(contentRoot);
}

async function requestPageEntry(slug) {
  const params = new URLSearchParams({
    targetType: TARGET_TYPE,
    targetId: slug
  });
  const endpoint = `${API_ROOT}?${params.toString()}`;
  const response = await fetch(endpoint, { credentials: 'include' });
  const payload = await getJson(response);

  if (!response.ok) {
    const error = new Error(payload?.error || 'Impossible de charger ce bloc.');
    error.status = response.status;
    error.endpoint = endpoint;
    error.payload = payload;
    throw error;
  }

  const entry = Array.isArray(payload?.entries)
    ? payload.entries.find(item => item.zoneKey === ZONE_KEY)
    : null;
  const zone = Array.isArray(payload?.zones)
    ? payload.zones.find(item => item.key === ZONE_KEY)
    : null;

  return {
    slug,
    contentHtml: entry?.contentHtml || zone?.defaultContent || '',
    updatedAt: entry?.updatedAt || null
  };
}

async function hydrateAllEntries() {
  const nextEntries = {};
  const failures = [];

  const tasks = LEGAL_PAGE_META.map(async page => {
    try {
      const entry = await requestPageEntry(page.slug);
      nextEntries[page.slug] = entry;
    } catch (error) {
      failures.push({ page, error });
      nextEntries[page.slug] = state.entriesBySlug[page.slug] || {
        slug: page.slug,
        contentHtml: '',
        updatedAt: null
      };
    }
  });

  await Promise.all(tasks);
  state.entriesBySlug = nextEntries;
  return failures;
}

async function loadContent({ loaderLabel = 'Chargement des politiques...' } = {}) {
  const startedAt = Date.now();
  state.loading = true;
  state.loadingLabel = loaderLabel;
  renderContent();

  const failures = await hydrateAllEntries();

  const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await wait(remaining);
  }

  state.loading = false;
  state.loadingLabel = 'Chargement des politiques...';
  state.view = VIEW_LIST;
  state.activeSlug = '';
  state.draftHtml = null;
  renderContent();

  if (failures.length) {
    showToast({ type: 'error', message: 'Échec du chargement', durationMs: 1000 });
    failures.forEach(({ page, error }) => {
      logUiError('LegalPolicies:Load', error, {
        pageSlug: page.slug,
        status: error?.status || null,
        endpoint: error?.endpoint || `${API_ROOT}?targetType=${TARGET_TYPE}&targetId=${page.slug}`,
        payload: error?.payload || null,
        message: error?.message || null
      });
    });
  }
}

async function savePageContent(page, html) {
  const endpoint = API_ROOT;
  const requestBody = {
    targetType: TARGET_TYPE,
    targetId: page.slug,
    zoneKey: ZONE_KEY,
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
    const error = new Error(payload?.error || 'Impossible de sauvegarder ce contenu.');
    error.status = response.status;
    error.endpoint = endpoint;
    error.payload = payload;
    error.safePayload = {
      targetType: TARGET_TYPE,
      targetId: page.slug,
      zoneKey: ZONE_KEY
    };
    throw error;
  }

  return payload;
}

async function savePageContentFromEditor(page, html) {
  const startedAt = Date.now();
  state.draftHtml = html;
  state.loading = true;
  state.loadingLabel = 'Enregistrement des modifications...';
  renderContent();

  try {
    await savePageContent(page, html);
    const refreshed = await requestPageEntry(page.slug);
    state.entriesBySlug[page.slug] = refreshed;

    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }

    state.loading = false;
    state.loadingLabel = 'Chargement des politiques...';
    state.view = VIEW_LIST;
    state.activeSlug = '';
    state.draftHtml = null;
    renderContent();

    showToast({ type: 'success', message: 'Modifications enregistrées', durationMs: 1000 });
  } catch (error) {
    const remaining = MIN_LOADER_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await wait(remaining);
    }

    state.loading = false;
    state.loadingLabel = 'Chargement des politiques...';
    state.view = VIEW_EDITOR;
    state.activeSlug = page.slug;
    renderContent();

    showToast({ type: 'error', message: "Échec de l'enregistrement", durationMs: 1000 });
    logUiError('LegalPolicies:Save', error, {
      pageSlug: page.slug,
      status: error?.status || null,
      endpoint: error?.endpoint || API_ROOT,
      payload: error?.payload || null,
      message: error?.message || null,
      safePayload: error?.safePayload || {
        targetType: TARGET_TYPE,
        targetId: page.slug,
        zoneKey: ZONE_KEY
      }
    });
    throw new Error("Échec de l'enregistrement");
  }
}

function renderShell(container) {
  container.innerHTML = `
    <section class="module-panel epm-module epm-module--policies">
      <header class="epm-header">
        <h2>Gestion des politiques</h2>
        <p>Éditez les textes juridiques via des cards premium minimalistes.</p>
      </header>
      <div class="epm-content" data-legal-content>
        ${buildLoaderMarkup('Chargement des politiques...')}
      </div>
    </section>
  `;
}

export async function renderModule(container) {
  if (!container) return;
  state.container = container;
  state.entriesBySlug = {};
  state.view = VIEW_LIST;
  state.activeSlug = '';
  state.draftHtml = null;
  state.loading = true;
  state.loadingLabel = 'Chargement des politiques...';
  cleanupEditorInstance();
  renderShell(container);
  await loadContent();
}

export default { renderModule };