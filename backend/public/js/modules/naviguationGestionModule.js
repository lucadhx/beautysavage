
import { showToast } from '../helpers/toastService.js';
import { setActionButtonState } from '../helpers/actionButtonState.js';
import { logUiError } from '../helpers/uiLogger.js';
import { openUiConfirmModal } from './uiConfirmModal.js';

const API_ROOT = '/api/gestion/pages-gestion';
const UNCATEGORIZED_KEY = 'UNCATEGORIZED';
const CATEGORY_ORDER_SCOPE = '__CATEGORY_ORDER__';
const BOOTSTRAP_ICONS_CSS_URL =
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css';
const MAX_ICON_RESULTS = 320;
const DEBUG_RENDER = false;

const MODE_OPTIONS = {
  active: 'Active',
  indeterminate: 'D?sactivation ind?termin?e',
  nowToDate: 'Desactive maintenant a date',
  dateRange: 'Planifier une plage'
};

const ICON_FALLBACK = [
  'bi-folder',
  'bi-folder-fill',
  'bi-grid',
  'bi-grid-3x3-gap',
  'bi-collection',
  'bi-card-heading',
  'bi-layout-text-window',
  'bi-kanban',
  'bi-journal-text',
  'bi-list-task',
  'bi-window-sidebar',
  'bi-palette',
  'bi-stars',
  'bi-lightning',
  'bi-gear',
  'bi-sliders',
  'bi-archive',
  'bi-tags',
  'bi-tag',
  'bi-shop',
  'bi-shop-window',
  'bi-cart',
  'bi-bag',
  'bi-basket',
  'bi-heart',
  'bi-heart-fill',
  'bi-star',
  'bi-star-fill',
  'bi-gift',
  'bi-house',
  'bi-people',
  'bi-person-circle',
  'bi-chat-dots',
  'bi-megaphone',
  'bi-bell',
  'bi-envelope',
  'bi-calendar',
  'bi-clock',
  'bi-activity',
  'bi-clipboard-data',
  'bi-pencil',
  'bi-pencil-square',
  'bi-trash',
  'bi-check2',
  'bi-plus-circle',
  'bi-three-dots-vertical',
  'bi-chevron-down',
  'bi-chevron-up',
  'bi-arrow-left-right',
  'bi-arrows-move',
  'bi-sort-alpha-down',
  'bi-filter',
  'bi-search',
  'bi-eye',
  'bi-lock',
  'bi-shield-check',
  'bi-bug',
  'bi-cpu',
  'bi-database',
  'bi-cloud-arrow-up',
  'bi-upload',
  'bi-download',
  'bi-globe',
  'bi-link-45deg',
  'bi-code-slash',
  'bi-file-earmark',
  'bi-file-earmark-text',
  'bi-file-earmark-richtext',
  'bi-file-earmark-image',
  'bi-image',
  'bi-images',
  'bi-camera',
  'bi-play-circle',
  'bi-pause',
  'bi-music-note',
  'bi-credit-card',
  'bi-wallet2',
  'bi-graph-up',
  'bi-pie-chart',
  'bi-briefcase',
  'bi-building',
  'bi-bank',
  'bi-signpost',
  'bi-compass',
  'bi-map',
  'bi-geo-alt',
  'bi-flag',
  'bi-award',
  'bi-trophy'
];

const GESTION_ROLES = ['admin', 'dev'];
const ROLE_LABELS = {
  admin: 'Admin',
  dev: 'Dev'
};

const state = {
  loading: false,
  pages: [],
  categories: [],
  uncategorizedKey: UNCATEGORIZED_KEY,
  activeTab: 'pages',
  feedback: {
    message: '',
    status: ''
  },
  filters: {
    pagesQuery: '',
    categoriesQuery: '',
    pagesActiveOnly: false
  },
  sort: {
    pages: 'order',
    categories: 'alpha'
  },
  ui: {
    openKebabKey: null
  },
  drag: {
    categoryId: null,
    draftOrderIds: []
  },
  pageModal: {
    open: false,
    closing: false,
    mode: 'create',
    pageId: null,
    draft: {
      slug: '',
      moduleFile: '',
      order: 0,
      disabledMode: 'active',
      from: '',
      to: '',
      categories: new Set(),
      allowedRoles: new Set(GESTION_ROLES)
    }
  },
  categoryModal: {
    open: false,
    closing: false,
    mode: 'create',
    categoryId: null,
    draft: {
      name: '',
      icon: 'bi-folder',
      pageIds: new Set(),
      iconQuery: '',
      iconPickerOpen: false
    }
  },
  confirmModal: {
    open: false,
    closing: false,
    type: '',
    id: '',
    label: ''
  },
  iconLibrary: {
    loading: false,
    loaded: false,
    error: '',
    icons: []
  },
  modalAnimations: {
    durationMs: 180,
    opened: {
      page: false,
      category: false,
      confirm: false
    }
  }
};

let rootContainer = null;
let modalRoot = null;
let eventAbortController = null;

let dragSourceId = null;
let dropTargetId = null;
let dropAfter = false;
let dragListElement = null;
let dragIndicator = null;
let dragIndicatorRemovalHandler = null;
let dragIndicatorRemovalTimer = null;
let dragIndicatorNeedsReveal = false;
let dragMirror = null;
let dragMoveHandler = null;
let previousBodyTouchAction = '';
let previousHtmlTouchAction = '';
let activePointerId = null;
let pointerMoveListener = null;
let pointerUpListener = null;
let activeTouchId = null;
let touchMoveListener = null;
let touchEndListener = null;
let pendingDragCard = null;
let dragStartPoint = null;
let manualDragStarted = false;

const MANUAL_DRAG_THRESHOLD = 10;
const ACTION_TOAST_SUCCESS = 'Modifications enregistr?es';
const ACTION_TOAST_ERROR = "?chec de l'enregistrement";

function setActionLoading(button, label = 'Enregistrement...') {
  setActionButtonState(button, 'loading', { loadingLabel: label });
}

function setActionSuccess(button, label = 'Réussi') {
  setActionButtonState(button, 'success', { successLabel: label });
  showToast({ type: 'success', message: ACTION_TOAST_SUCCESS, durationMs: 1000 });
}

function setActionError(button, context, error, extra = {}) {
  setActionButtonState(button, 'error', { errorLabel: '\u00c9chec' });
  showToast({ type: 'error', message: ACTION_TOAST_ERROR, durationMs: 1000 });
  logUiError(context, error, extra);
}

function toggleBodyScroll(disable) {
  document.body.classList.toggle('no-scroll', Boolean(disable));
}

function syncBodyScroll() {
  toggleBodyScroll(
    state.pageModal.open ||
      state.pageModal.closing ||
      state.categoryModal.open ||
      state.categoryModal.closing ||
      state.confirmModal.open ||
      state.confirmModal.closing ||
      state.categoryModal.draft.iconPickerOpen
  );
}

function ensureModalRoot() {
  if (modalRoot && document.body.contains(modalRoot)) return modalRoot;
  modalRoot = document.getElementById('ui-modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'ui-modal-root';
    modalRoot.className = 'ui-modal-root';
    document.body.appendChild(modalRoot);
  }
  return modalRoot;
}

function getModalOverlay(name) {
  return modalRoot?.querySelector(`[data-modal-overlay="${name}"]`);
}

function openCenteredModal(name) {
  const overlay = getModalOverlay(name);
  if (!overlay || overlay.classList.contains('is-open') || overlay.classList.contains('is-closing')) return;
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    if (state.modalAnimations?.opened && Object.prototype.hasOwnProperty.call(state.modalAnimations.opened, name)) {
      state.modalAnimations.opened[name] = true;
    }
  });
}

function closeCenteredModal(name, onClosed) {
  const overlay = getModalOverlay(name);
  const duration = state.modalAnimations?.durationMs ?? 180;
  if (!overlay) {
    setTimeout(() => onClosed?.(), duration);
    return;
  }
  overlay.classList.add('is-closing');
  overlay.classList.remove('is-open');
  setTimeout(() => {
    overlay.classList.remove('is-closing');
    onClosed?.();
  }, duration);
}

function mountModal(name, html) {
  const root = ensureModalRoot();
  const existing = root.querySelector(`[data-modal-overlay="${name}"]`);
  if (existing) existing.remove();
  root.insertAdjacentHTML('beforeend', html);
  openCenteredModal(name);
  syncBodyScroll();
}

function unmountModal(name) {
  const existing = getModalOverlay(name);
  if (existing?.parentElement) existing.parentElement.removeChild(existing);
  syncBodyScroll();
}

function applyKebabState() {
  if (!rootContainer) return;
  const openKey = state.ui.openKebabKey;
  rootContainer.querySelectorAll('[data-kebab-key]').forEach(button => {
    const key = button.dataset.kebabKey;
    const menu = button.parentElement?.querySelector('.gestion-kebab-menu');
    const isOpen = key === openKey;
    if (menu) {
      menu.classList.toggle('is-open', isOpen);
    }
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

function refreshIconGrid() {
  if (!modalRoot) return;
  const grid = modalRoot.querySelector('[data-icon-grid]');
  if (!grid) return;
  const visibleIcons = getVisibleIcons();
  grid.innerHTML = visibleIcons.length
    ? visibleIcons
        .map(icon => {
          const selected = state.categoryModal.draft.icon === icon;
          return `
            <button
              type="button"
              class="gestion-icon-cell ${selected ? 'is-selected' : ''}"
              data-action="select-category-icon"
              data-icon="${escapeHtml(icon)}"
              title="${escapeHtml(icon)}"
              data-icon-cell
            >
              <i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i>
              <small>${escapeHtml(icon.replace('bi-', ''))}</small>
            </button>
          `;
        })
        .join('')
    : '<p class="module-placeholder">Aucun resultat.</p>';
}

function getJson(response) {
  return response?.json ? response.json() : Promise.resolve({});
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function setFeedback(message, status = '') {
  state.feedback.message = message || '';
  state.feedback.status = status || '';
}

function clearFeedback() {
  setFeedback('', '');
}
function normalizeIcon(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'bi-folder';
  const cleaned = raw.replace(/^bi\s+/, '').replace(/^bi-?/, '');
  if (!cleaned || !/^[a-z0-9-]+$/.test(cleaned)) return 'bi-folder';
  return `bi-${cleaned}`;
}

function isObjectId(value) {
  return /^[a-fA-F0-9]{24}$/.test(String(value || '').trim());
}

function normalizeGestionRoles(values = []) {
  const raw = Array.isArray(values) ? values : values ? [values] : [];
  const allowed = new Set();
  for (const value of raw) {
    const normalized = String(value || '').trim().toLowerCase();
    if (GESTION_ROLES.includes(normalized)) {
      allowed.add(normalized);
    }
  }
  if (!allowed.size) {
    GESTION_ROLES.forEach(role => allowed.add(role));
  }
  return [...allowed];
}

function normalizePage(raw = {}) {
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map(value => String(value || '').trim()).filter(isObjectId)
    : [];
  const seenCategories = new Set();
  const normalizedCategories = categories.filter(value => {
    if (seenCategories.has(value)) return false;
    seenCategories.add(value);
    return true;
  });

  const categoryOrders = Array.isArray(raw.categoryOrders)
    ? raw.categoryOrders
        .map(entry => ({
          categoryId: entry?.categoryId ? String(entry.categoryId).trim() : null,
          order: Number.isFinite(Number(entry?.order)) ? Math.max(0, Math.floor(Number(entry.order))) : 0
        }))
        .filter(entry => entry.categoryId === null || isObjectId(entry.categoryId))
    : [];

  return {
    id: String(raw.id || raw._id || '').trim(),
    slug: String(raw.slug || '').trim(),
    moduleFile: String(raw.moduleFile || '').trim(),
    type: String(raw.type || '').trim(),
    order: Number.isFinite(Number(raw.order)) ? Math.max(0, Math.floor(Number(raw.order))) : 0,
    disabled: {
      enabled: Boolean(raw?.disabled?.enabled),
      from: raw?.disabled?.from || null,
      to: raw?.disabled?.to || null
    },
    allowedRoles: normalizeGestionRoles(raw.allowedRolesGestion || raw.allowedRoles || []),
    categories: normalizedCategories,
    categoryOrders
  };
}

function normalizeCategory(raw = {}) {
  return {
    id: String(raw.id || raw._id || '').trim(),
    name: String(raw.name || '').trim(),
    icon: normalizeIcon(raw.icon),
    pageCount: Number.isFinite(Number(raw.pageCount)) ? Math.max(0, Math.floor(Number(raw.pageCount))) : 0,
    order: Number.isFinite(Number(raw.order)) ? Math.max(0, Math.floor(Number(raw.order))) : Number.MAX_SAFE_INTEGER
  };
}

function formatLocalDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const tzOffsetMs = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
}

function serializeInputDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function determineDisabledMode(disabled = {}) {
  if (!disabled.enabled) return 'active';
  const hasFrom = Boolean(disabled.from);
  const hasTo = Boolean(disabled.to);
  if (!hasFrom && !hasTo) return 'indeterminate';
  if (!hasFrom && hasTo) return 'nowToDate';
  if (hasFrom && hasTo) return 'dateRange';
  return 'indeterminate';
}

function describeDisabled(page) {
  const disabled = page?.disabled || {};
  if (!disabled.enabled) return 'Active';
  if (!disabled.from && !disabled.to) return 'Desactivee indefiniment';
  if (disabled.from && !disabled.to) {
    const fromDate = new Date(disabled.from);
    return `Desactivee depuis ${fromDate.toLocaleString()}`;
  }
  if (!disabled.from && disabled.to) {
    const until = new Date(disabled.to);
    return `Desactivee jusqu a ${until.toLocaleString()}`;
  }
  const from = new Date(disabled.from);
  const to = new Date(disabled.to);
  return `Desactivation du ${from.toLocaleString()} au ${to.toLocaleString()}`;
}

function buildDisabledPayload(draft = {}) {
  const mode = draft.disabledMode;
  const fromValue = draft.from;
  const toValue = draft.to;
  if (mode === 'active') {
    return { enabled: false, from: null, to: null };
  }
  if (mode === 'indeterminate') {
    return { enabled: true, from: null, to: null };
  }
  if (mode === 'nowToDate') {
    return {
      enabled: true,
      from: new Date().toISOString(),
      to: serializeInputDate(toValue)
    };
  }
  if (mode === 'dateRange') {
    return {
      enabled: true,
      from: serializeInputDate(fromValue),
      to: serializeInputDate(toValue)
    };
  }
  return { enabled: false, from: null, to: null };
}

function shouldShowDisabledField(mode, field) {
  if (!field) return false;
  if (mode === 'nowToDate') return field === 'to';
  if (mode === 'dateRange') return field === 'from' || field === 'to';
  return false;
}

function refreshDisabledFieldsVisibility() {
  const overlay = getModalOverlay('page');
  if (!overlay) return;
  const mode = state.pageModal.draft.disabledMode;
  overlay.querySelectorAll('[data-disabled-field]').forEach(element => {
    const field = element.dataset.disabledField;
    const visible = shouldShowDisabledField(mode, field);
    element.classList.toggle('hidden', !visible);
  });
}

function toCategoryScopeLabel(categoryId) {
  if (categoryId === state.uncategorizedKey) return 'Sans catégorie';
  const category = state.categories.find(item => item.id === categoryId);
  return category ? category.name : 'Catégorie';
}

function getCategoryScopedOrder(page, categoryId) {
  if (!page) return 0;
  if (categoryId === state.uncategorizedKey) {
    const uncategorizedEntry = page.categoryOrders.find(entry => entry.categoryId === null);
    if (uncategorizedEntry) return uncategorizedEntry.order;
    return page.order;
  }
  const scopedEntry = page.categoryOrders.find(entry => entry.categoryId === categoryId);
  if (scopedEntry) return scopedEntry.order;
  return page.order;
}

function sortPagesByCategoryScope(left, right, categoryId) {
  const leftOrder = getCategoryScopedOrder(left, categoryId);
  const rightOrder = getCategoryScopedOrder(right, categoryId);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.order !== right.order) return left.order - right.order;
  return left.slug.localeCompare(right.slug, 'fr', { sensitivity: 'base' });
}

function getPagesForCategory(categoryId) {
  const activeOnly = Boolean(state.filters.pagesActiveOnly);
  const pages = state.pages
    .filter(page => page.type === 'gestion')
    .filter(page => !(activeOnly && page?.disabled?.enabled));
  if (categoryId === state.uncategorizedKey) {
    const scoped = pages.filter(page => !page.categories.length);
    return state.sort.pages === 'alpha'
      ? scoped.sort((a, b) => a.slug.localeCompare(b.slug, 'fr', { sensitivity: 'base' }))
      : scoped.sort((a, b) => sortPagesByCategoryScope(a, b, state.uncategorizedKey));
  }
  const scoped = pages.filter(page => page.categories.includes(categoryId));
  return state.sort.pages === 'alpha'
    ? scoped.sort((a, b) => a.slug.localeCompare(b.slug, 'fr', { sensitivity: 'base' }))
    : scoped.sort((a, b) => sortPagesByCategoryScope(a, b, categoryId));
}

function getSections() {
  const categories = [...state.categories];
  if (state.sort.categories === 'alpha') {
    categories.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }
  const sections = categories.map(category => ({
    id: category.id,
    name: category.name,
    icon: category.icon,
    pages: getPagesForCategory(category.id)
  }));
  sections.push({
    id: state.uncategorizedKey,
    name: 'Sans catégorie',
    icon: 'bi-folder2-open',
    pages: getPagesForCategory(state.uncategorizedKey)
  });
  return sections;
}
function getDisplayedPagesForSection(categoryId) {
  const sectionPages = getPagesForCategory(categoryId);
  if (state.drag.categoryId !== categoryId || !state.drag.draftOrderIds.length) {
    return sectionPages;
  }
  const byId = new Map(sectionPages.map(page => [page.id, page]));
  const ordered = [];
  for (const pageId of state.drag.draftOrderIds) {
    const page = byId.get(pageId);
    if (!page) continue;
    ordered.push(page);
    byId.delete(pageId);
  }
  for (const page of byId.values()) {
    ordered.push(page);
  }
  return ordered;
}

function getPageById(pageId) {
  return state.pages.find(page => page.id === pageId) || null;
}

function getCategoryById(categoryId) {
  return state.categories.find(category => category.id === categoryId) || null;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: 'include',
    ...options
  });
  const payload = await getJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || 'Erreur API.');
  }
  return payload;
}

async function fetchPages() {
  const payload = await apiRequest('/pages');
  state.pages = Array.isArray(payload.pages) ? payload.pages.map(normalizePage) : [];
  if (payload.uncategorizedKey) {
    state.uncategorizedKey = String(payload.uncategorizedKey);
  }
}

async function fetchCategories() {
  const payload = await apiRequest('/categories');
  state.categories = Array.isArray(payload.categories) ? payload.categories.map(normalizeCategory) : [];
  if (payload.uncategorizedKey) {
    state.uncategorizedKey = String(payload.uncategorizedKey);
  }
}

async function refreshData() {
  state.loading = true;
  render();
  try {
    await Promise.all([fetchPages(), fetchCategories()]);
  } finally {
    state.loading = false;
  }
}

function closeAllMenus() {
  state.ui.openKebabKey = null;
  if (state.categoryModal.open) {
    state.categoryModal.draft.iconPickerOpen = false;
  }
  syncBodyScroll();
}

function requestClosePageModal() {
  if (!state.pageModal.open || state.pageModal.closing) return;
  state.pageModal.closing = true;
  closeCenteredModal('page', () => {
    closePageModal();
    state.pageModal.closing = false;
    syncBodyScroll();
  });
}

function resetPageModalDraft() {
  state.pageModal.draft = {
    slug: '',
    moduleFile: '',
    order: 0,
    disabledMode: 'active',
    from: '',
    to: '',
    categories: new Set(),
    allowedRoles: new Set(GESTION_ROLES)
  };
}

  function openCreatePageModal(categoryId = null) {
    resetPageModalDraft();
    const gestionPages = state.pages.filter(page => page.type === 'gestion');
    const maxOrder = gestionPages.reduce((max, page) => Math.max(max, page.order || 0), -1);
    state.pageModal.draft.order = maxOrder + 1;
  if (categoryId && categoryId !== state.uncategorizedKey) {
    state.pageModal.draft.categories.add(categoryId);
    }
    state.pageModal.open = true;
    state.pageModal.mode = 'create';
    state.pageModal.pageId = null;
    state.modalAnimations.opened.page = false;
    state.confirmModal.open = false;
    closeAllMenus();
    renderPageModalPortal();
  }

  function openEditPageModal(pageId) {
    const page = getPageById(pageId);
    if (!page) return;
  state.pageModal.open = true;
    state.pageModal.mode = 'edit';
    state.pageModal.pageId = page.id;
    state.pageModal.draft = {
      slug: page.slug || '',
      moduleFile: page.moduleFile || '',
      order: Number.isFinite(Number(page.order)) ? Number(page.order) : 0,
      disabledMode: determineDisabledMode(page.disabled),
      from: formatLocalDate(page?.disabled?.from),
      to: formatLocalDate(page?.disabled?.to),
      categories: new Set(page.categories || []),
      allowedRoles: new Set(normalizeGestionRoles(page.allowedRoles || page.allowedRolesGestion))
    };
    state.modalAnimations.opened.page = false;
    state.confirmModal.open = false;
    closeAllMenus();
    renderPageModalPortal();
  }

  function closePageModal() {
    state.pageModal.open = false;
    state.pageModal.pageId = null;
    resetPageModalDraft();
    unmountModal('page');
  }

function resetCategoryModalDraft() {
  state.categoryModal.draft = {
    name: '',
    icon: 'bi-folder',
    pageIds: new Set(),
    iconQuery: '',
    iconPickerOpen: false
  };
}

  function openCreateCategoryModal() {
    resetCategoryModalDraft();
    state.categoryModal.open = true;
    state.categoryModal.mode = 'create';
    state.categoryModal.categoryId = null;
    state.modalAnimations.opened.category = false;
    state.confirmModal.open = false;
    closeAllMenus();
    void ensureBootstrapIconsLoaded();
    renderCategoryModalPortal();
  }

function openEditCategoryModal(categoryId) {
  const category = getCategoryById(categoryId);
  if (!category) return;
  const assignedPages = state.pages
    .filter(page => page.type === 'gestion' && page.categories.includes(categoryId))
    .map(page => page.id);
  state.categoryModal.open = true;
    state.categoryModal.mode = 'edit';
    state.categoryModal.categoryId = category.id;
    state.categoryModal.draft = {
      name: category.name || '',
      icon: normalizeIcon(category.icon),
      pageIds: new Set(assignedPages),
      iconQuery: '',
      iconPickerOpen: false
    };
    state.modalAnimations.opened.category = false;
    state.confirmModal.open = false;
    closeAllMenus();
    void ensureBootstrapIconsLoaded();
    renderCategoryModalPortal();
  }

  function closeCategoryModal() {
    state.categoryModal.open = false;
    state.categoryModal.categoryId = null;
    resetCategoryModalDraft();
    unmountModal('category');
  }

function requestCloseCategoryModal() {
  if (!state.categoryModal.open || state.categoryModal.closing) return;
  state.categoryModal.closing = true;
  closeCenteredModal('category', () => {
    closeCategoryModal();
    state.categoryModal.closing = false;
    syncBodyScroll();
  });
}

  function openDeleteConfirmation(type, id, label) {
    const safeType = String(type || '').trim();
    const safeId = String(id || '').trim();
    const safeLabel = String(label || '').trim();
    if (!safeType || !safeId) return;
    const isCategory = safeType === 'delete-category';
    const title = isCategory ? 'Supprimer la catégorie ?' : 'Supprimer la page ?';
    const message = isCategory
      ? `La catégorie "${safeLabel}" sera retirée. Les pages resteront et passeront en Sans catégorie.`
      : `La page "${safeLabel}" sera supprimée définitivement.`;

    closeAllMenus();
    state.confirmModal.open = false;
    unmountModal('confirm');
    syncBodyScroll();

    void openUiConfirmModal({
      title,
      message,
      confirmLabel: 'Supprimer',
      loadingLabel: 'Suppression...',
      intent: 'danger',
      onConfirm: async () => {
        try {
          if (safeType === 'delete-page') {
            await apiRequest(`/pages/${safeId}`, { method: 'DELETE' });
            resetDragState();
            await refreshData();
            setFeedback('Page supprimée.', 'success');
            render();
            return;
          }
          if (safeType === 'delete-category') {
            await apiRequest(`/categories/${safeId}`, { method: 'DELETE' });
            resetDragState();
            await refreshData();
            setFeedback('Catégorie supprimée. Les pages restent en Sans catégorie.', 'success');
            render();
          }
        } catch (error) {
          setFeedback(error?.message || 'Suppression impossible.', 'error');
          render();
          logUiError('NavigationGestion:DeleteEntity', error, { type: safeType, id: safeId });
          throw error;
        }
      }
    });
  }

  function closeConfirmModal() {
    state.confirmModal.open = false;
    state.confirmModal.type = '';
    state.confirmModal.id = '';
    state.confirmModal.label = '';
    unmountModal('confirm');
  }

function requestCloseConfirmModal() {
  if (!state.confirmModal.open || state.confirmModal.closing) return;
  state.confirmModal.closing = true;
  closeCenteredModal('confirm', () => {
    closeConfirmModal();
    state.confirmModal.closing = false;
    syncBodyScroll();
  });
}
function resetDragState() {
  state.drag.categoryId = null;
  state.drag.draftOrderIds = [];
  cleanupDragUI();
  clearDragIndicator();
  releaseDragMirror();
  dragSourceId = null;
  dropTargetId = null;
  dropAfter = false;
  resetManualDragState();
}

function enterCategoryOrderMode(categoryId) {
  if (categoryId === CATEGORY_ORDER_SCOPE) {
    if (!state.categories.length) {
      setFeedback('Aucune catégorie à réordonner.', 'error');
      return;
    }
    state.sort.categories = 'order';
    state.drag.categoryId = CATEGORY_ORDER_SCOPE;
    state.drag.draftOrderIds = state.categories.map(category => category.id);
    closeAllMenus();
    return;
  }
  const pages = getPagesForCategory(categoryId);
  if (!pages.length) {
    setFeedback('Aucune page a reordonner dans cette section.', 'error');
    return;
  }
  state.drag.categoryId = categoryId;
  state.drag.draftOrderIds = pages.map(page => page.id);
  closeAllMenus();
}

async function saveCategoryOrder(actionButton = null) {
  if (!state.drag.categoryId || !state.drag.draftOrderIds.length) {
    return;
  }
  const categoryId = state.drag.categoryId;
  let payload = null;
  setActionLoading(actionButton, 'Enregistrement...');
  try {
    if (categoryId === CATEGORY_ORDER_SCOPE) {
      payload = { orderedCategoryIds: [...state.drag.draftOrderIds] };
      await apiRequest('/categories/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      resetDragState();
      await fetchCategories();
      setFeedback('Ordre des catégories enregistré.', 'success');
      setActionSuccess(actionButton, 'Réussi');
      return;
    }
    payload = {
      categoryId,
      orderedPageIds: [...state.drag.draftOrderIds]
    };
    await apiRequest('/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    resetDragState();
    await fetchPages();
    setFeedback(`Ordre enregistre pour ${toCategoryScopeLabel(categoryId)}.`, 'success');
    setActionSuccess(actionButton, 'Réussi');
  } catch (error) {
    setActionError(actionButton, 'NavigationGestion:SaveCategoryOrder', error, { categoryId, payload });
    throw error;
  }
}

function getVisibleIcons() {
  const query = state.categoryModal.draft.iconQuery.trim().toLowerCase();
  const source = state.iconLibrary.icons.length ? state.iconLibrary.icons : ICON_FALLBACK;
  const filtered = query ? source.filter(iconName => iconName.includes(query)) : source;
  return filtered.slice(0, MAX_ICON_RESULTS);
}

async function ensureBootstrapIconsLoaded() {
  if (state.iconLibrary.loaded || state.iconLibrary.loading) return;
  state.iconLibrary.loading = true;
  state.iconLibrary.error = '';
  render();
  try {
    const response = await fetch(BOOTSTRAP_ICONS_CSS_URL);
    if (!response.ok) {
      throw new Error("Impossible de charger la librairie d'icônes.");
    }
    const cssText = await response.text();
    const regex = /\.bi-([a-z0-9-]+)::before/g;
    const discovered = new Set();
    let match = regex.exec(cssText);
    while (match) {
      discovered.add(`bi-${match[1]}`);
      match = regex.exec(cssText);
    }
    const icons = [...discovered].sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' })
    );
    if (!icons.length) {
      throw new Error('Aucune icône détectée.');
    }
    state.iconLibrary.icons = icons;
    state.iconLibrary.loaded = true;
    state.iconLibrary.error = '';
  } catch (_error) {
    state.iconLibrary.icons = [...ICON_FALLBACK];
    state.iconLibrary.loaded = true;
    state.iconLibrary.error = 'Librairie distante indisponible: liste locale chargee.';
  } finally {
    state.iconLibrary.loading = false;
    render();
  }
}

function renderFeedback() {
  if (!state.feedback.message) {
    return '<p class="form-message gestion-pages-feedback" data-feedback></p>';
  }
  return `<p class="form-message gestion-pages-feedback" data-feedback data-status="${escapeHtml(
    state.feedback.status
  )}">${escapeHtml(state.feedback.message)}</p>`;
}

function renderTabs() {
  const pagesActive = state.activeTab === 'pages';
  const categoriesActive = state.activeTab === 'categories';
  return `
    <div class="gestion-pages-tabs" role="tablist" aria-label="Gestion des pages">
      <button
        type="button"
        role="tab"
        aria-selected="${pagesActive ? 'true' : 'false'}"
        class="gestion-tab ${pagesActive ? 'is-active' : ''}"
        data-action="switch-tab"
        data-tab="pages"
      >
        <span class="gestion-tab-label">Pages</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected="${categoriesActive ? 'true' : 'false'}"
        class="gestion-tab ${categoriesActive ? 'is-active' : ''}"
        data-action="switch-tab"
        data-tab="categories"
      >
        <span class="gestion-tab-label">Catégories</span>
      </button>
    </div>
  `;
}

function renderKebabMenu(kind, id) {
  const key = `${kind}:${id}`;
  const isOpen = state.ui.openKebabKey === key;
  const editAction = kind === 'page' ? 'open-edit-page' : 'open-edit-category';
  const deleteAction = kind === 'page' ? 'prompt-delete-page' : 'prompt-delete-category';
  return `
    <div class="gestion-kebab" data-kebab-wrapper>
      <button
        type="button"
        class="gestion-icon-button"
        aria-haspopup="menu"
        aria-expanded="${isOpen ? 'true' : 'false'}"
        data-action="toggle-kebab"
        data-kebab-key="${escapeHtml(key)}"
        title="Actions"
      >
        <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
      </button>
      <div class="gestion-kebab-menu ${isOpen ? 'is-open' : ''}" role="menu" aria-label="Actions">
        <button
          type="button"
          class="gestion-icon-action"
          role="menuitem"
          title="Modifier"
          data-action="${editAction}"
          data-id="${escapeHtml(id)}"
        >
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="gestion-icon-action danger"
          role="menuitem"
          title="Supprimer"
          data-action="${deleteAction}"
          data-id="${escapeHtml(id)}"
        >
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

function renderRoleBadges(page) {
  const roles = Array.isArray(page.allowedRoles)
    ? page.allowedRoles
    : normalizeGestionRoles(page.allowedRolesGestion);
  if (!roles.length) return '';
  return `
    <div class="gestion-role-badges" aria-label="Accès rôles">
      ${GESTION_ROLES.map(role => {
        const active = roles.includes(role);
        return `<span class="gestion-role-pill ${active ? 'is-active' : ''}">${ROLE_LABELS[role]}</span>`;
      }).join('')}
    </div>
  `;
}
function renderPageCard(page, categoryId) {
  const dragEnabled = state.drag.categoryId === categoryId;
  return `
    <article class="data-item gestion-page-card" data-page-id="${escapeHtml(page.id)}" ${
      dragEnabled ? 'draggable="true"' : ''
    }>
      <div>
        <strong>${escapeHtml(page.slug)}</strong>
        <p>Module: ${escapeHtml(page.moduleFile)} · Ordre: ${getCategoryScopedOrder(page, categoryId)}</p>
        <small>${escapeHtml(describeDisabled(page))}</small>
        ${renderRoleBadges(page)}
      </div>
      <div class="gestion-card-actions">
        ${renderKebabMenu('page', page.id)}
      </div>
    </article>
  `;
}

function renderOrderControls(sectionId) {
  const isActive = state.drag.categoryId === sectionId;
  if (isActive) {
    return `
      <div class="gestion-order-actions">
        <button type="button" class="primary-button" data-action="save-order">Valider l'ordre</button>
        <button type="button" class="secondary-button" data-action="cancel-order">Annuler</button>
      </div>
    `;
  }
  return `
    <button
      type="button"
      class="secondary-button"
      data-action="start-order"
      data-category-id="${escapeHtml(sectionId)}"
    >
      Changer l'ordre
    </button>
  `;
}

function renderPagesTab() {
    const sections = getSections();
    const orderMode = Boolean(state.drag.categoryId);

    return `
      <section class="gestion-tab-panel" data-tab-panel="pages">
        <div class="section-header gestion-pages-toolbar">
          <div>
            <h3>Pages gestion par catégorie</h3>
            <p class="muted">Chaque page peut apparaître dans plusieurs catégories.</p>
          </div>
          <div class="gestion-toolbar-actions">
            <div class="gestion-icon-actions">
              <button
                type="button"
                class="gestion-icon-button icon-only ${state.filters.pagesActiveOnly ? 'is-active' : ''}"
                data-action="toggle-pages-filter-active"
                aria-label="Filtrer les pages actives uniquement"
              >
                <i class="bi bi-filter" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="gestion-icon-button icon-only"
                data-action="toggle-pages-sort"
                aria-label="Trier les pages"
              >
                <i class="bi bi-sort-alpha-down" aria-hidden="true"></i>
              </button>
            </div>
            <button type="button" class="primary-button" data-action="open-create-page">Créer une page</button>
          </div>
        </div>
        <div class="gestion-page-sections">
          ${sections
            .map(section => {
            const pages = getDisplayedPagesForSection(section.id);
            const activeOrderClass =
              state.drag.categoryId === section.id ? 'is-active-order' : '';
            return `
              <section class="manager-section gestion-page-section ${activeOrderClass}" data-category-section="${escapeHtml(
              section.id
            )}">
                <header class="gestion-section-header">
                  <div class="gestion-section-title">
                    <span class="gestion-section-icon"><i class="bi ${escapeHtml(
                      section.icon
                    )}" aria-hidden="true"></i></span>
                    <div>
                      <h4>${escapeHtml(section.name)}</h4>
                      <small>${pages.length} page(s)</small>
                    </div>
                  </div>
                  ${renderOrderControls(section.id)}
                </header>
                <div class="data-list gestion-page-list" data-category-list="${escapeHtml(section.id)}">
                  ${
                    pages.length
                      ? pages.map(page => renderPageCard(page, section.id)).join('')
                      : '<p class="module-placeholder">Aucune page dans cette section.</p>'
                  }
                </div>
                ${
                  !orderMode
                    ? `
                      <div class="gestion-inline-actions">
                        <button type="button" class="secondary-button" data-action="open-create-page" data-category-id="${escapeHtml(
                          section.id
                        )}">
                          Ajouter une page ici
                        </button>
                      </div>
                    `
                    : ''
                }
              </section>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function renderCategoryCard(category) {
  const orderMode = state.drag.categoryId === CATEGORY_ORDER_SCOPE;
  return `
    <article class="manager-section gestion-category-card data-item" data-page-id="${escapeHtml(category.id)}" ${orderMode ? 'draggable="true"' : ''}>
      <div class="gestion-category-main">
        <span class="gestion-category-icon"><i class="bi ${escapeHtml(category.icon)}" aria-hidden="true"></i></span>
        <div>
          <strong>${escapeHtml(category.name)}</strong>
          <small>${category.pageCount} page(s) assignee(s)</small>
        </div>
      </div>
      ${
        orderMode
          ? '<div class="gestion-card-actions"><button type="button" class="gestion-icon-button icon-only" disabled aria-label="Mode ordre"><i class="bi bi-grip-vertical" aria-hidden="true"></i></button></div>'
          : `<div class="gestion-card-actions">${renderKebabMenu('category', category.id)}</div>`
      }
    </article>
  `;
}

function renderCategoriesTab() {
  const sortedCategories =
    state.sort.categories === 'alpha'
      ? [...state.categories].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
      : [...state.categories];
  const displayedCategories =
    state.drag.categoryId === CATEGORY_ORDER_SCOPE && state.drag.draftOrderIds.length
      ? state.drag.draftOrderIds
          .map(categoryId => sortedCategories.find(category => category.id === categoryId))
          .filter(Boolean)
      : sortedCategories;
  const hasCategories = sortedCategories.length > 0;
  const orderMode = state.drag.categoryId === CATEGORY_ORDER_SCOPE;
  return `
    <section class="gestion-tab-panel" data-tab-panel="categories">
      <div class="section-header gestion-pages-toolbar">
        <div>
          <h3>Catégories de pages gestion</h3>
          <p class="muted">Nom + icône Bootstrap, puis assignation multi-pages.</p>
        </div>
        <div class="gestion-toolbar-actions">
          <div class="gestion-icon-actions">
            <button
              type="button"
              class="gestion-icon-button icon-only"
              data-action="toggle-category-sort"
              aria-label="Trier les catégories"
            >
              <i class="bi bi-sort-alpha-down" aria-hidden="true"></i>
            </button>
          </div>
          ${
            orderMode
              ? `
                <div class="gestion-order-actions">
                  <button type="button" class="primary-button" data-action="save-order">Valider l'ordre</button>
                  <button type="button" class="secondary-button" data-action="cancel-order">Annuler</button>
                </div>
              `
              : `
                <button type="button" class="secondary-button" data-action="start-order" data-category-id="${CATEGORY_ORDER_SCOPE}">
                  Changer l'ordre
                </button>
              `
          }
          <button type="button" class="primary-button" data-action="open-create-category">Créer une catégorie</button>
        </div>
      </div>
      <div class="gestion-categories-list" data-category-list="${CATEGORY_ORDER_SCOPE}">
          ${
            hasCategories
              ? displayedCategories.map(renderCategoryCard).join('')
              : `
              <section class="manager-section gestion-empty-state">
                <p>Aucune catégorie pour le moment.</p>
                <button type="button" class="primary-button" data-action="open-create-category">Créer une catégorie</button>
              </section>
            `
        }
      </div>
    </section>
  `;
}

function renderPageCategorySelector() {
  if (!state.categories.length) {
    return '<p class="module-placeholder">Aucune catégorie disponible. La page restera en Sans catégorie.</p>';
  }
  const selected = state.pageModal.draft.categories;
  return `
    <div class="gestion-select-list">
      ${state.categories
        .map(category => {
          const isSelected = selected.has(category.id);
          return `
            <button
              type="button"
              class="gestion-select-row ${isSelected ? 'is-selected' : ''}"
              data-action="toggle-page-modal-category"
              data-category-id="${escapeHtml(category.id)}"
            >
              <span class="gestion-select-row-main">
                <i class="bi ${escapeHtml(category.icon)}" aria-hidden="true"></i>
                <span>${escapeHtml(category.name)}</span>
              </span>
              <i class="bi bi-check2 selection-check" aria-hidden="true"></i>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderPageRoleSelector() {
  const selected = state.pageModal.draft.allowedRoles;
  return `
    <div class="gestion-role-grid">
      ${GESTION_ROLES.map(role => {
        const isSelected = selected.has(role);
        return `
          <button
            type="button"
            class="gestion-role-chip ${isSelected ? 'is-selected' : ''}"
            data-action="toggle-page-role"
            data-role="${escapeHtml(role)}"
            aria-pressed="${isSelected ? 'true' : 'false'}"
          >
            <span class="gestion-role-label">${ROLE_LABELS[role] || role}</span>
            <i class="bi bi-check2 selection-check" aria-hidden="true"></i>
          </button>
        `;
      }).join('')}
    </div>
  `;
}
  function renderPageModal() {
    if (!state.pageModal.open) return '';
    const isEdit = state.pageModal.mode === 'edit';
    const draft = state.pageModal.draft;
    const showFrom = shouldShowDisabledField(draft.disabledMode, 'from');
    const showTo = shouldShowDisabledField(draft.disabledMode, 'to');

    const isClosing = state.pageModal.closing;
    const overlayClasses = ['modal-overlay'];
    if (isClosing) {
      overlayClasses.push('is-closing');
    } else if (state.modalAnimations.opened?.page) {
      overlayClasses.push('is-open');
    }
    return `
      <div class="${overlayClasses.join(' ')}" data-modal-overlay="page" data-action="close-page-modal-overlay">
        <div class="modal-panel gestion-manager-modal ui-modal-panel" role="dialog" aria-modal="true" aria-label="${
          isEdit ? 'Modifier une page' : 'Créer une page'
        }">
        <header class="gestion-modal-header">
          <h3>${isEdit ? 'Modifier une page gestion' : 'Créer une page gestion'}</h3>
          <button type="button" class="gestion-icon-button" data-action="close-page-modal" aria-label="Fermer">
            <i class="bi bi-x" aria-hidden="true"></i>
          </button>
        </header>
        <form data-form="page-modal" class="manager-form gestion-modal-form">
          <label>
            Slug
            <input type="text" required name="slug" data-page-modal-field="slug" value="${escapeHtml(
              draft.slug
            )}" placeholder="ex: productManager">
          </label>
          <label>
            Module JS
            <input type="text" required name="moduleFile" data-page-modal-field="moduleFile" value="${escapeHtml(
              draft.moduleFile
            )}" placeholder="ex: productManager.js">
          </label>
          <label>
            Ordre global
            <input type="number" min="0" name="order" data-page-modal-field="order" value="${escapeHtml(
              String(draft.order)
            )}">
          </label>
          <label>
            Mode désactivation
            <select name="disabledMode" data-page-modal-field="disabledMode">
              ${Object.entries(MODE_OPTIONS)
                .map(
                  ([value, label]) =>
                    `<option value="${value}" ${draft.disabledMode === value ? 'selected' : ''}>${escapeHtml(
                      label
                    )}</option>`
                )
                .join('')}
            </select>
          </label>
          <label data-disabled-field="from" class="${showFrom ? '' : 'hidden'}">
            Début
            <input type="datetime-local" name="from" data-page-modal-field="from" value="${escapeHtml(
              draft.from
            )}">
          </label>
          <label data-disabled-field="to" class="${showTo ? '' : 'hidden'}">
            Fin
            <input type="datetime-local" name="to" data-page-modal-field="to" value="${escapeHtml(
              draft.to
            )}">
          </label>
          <div class="gestion-modal-selector">
            <h4>Accès (rôles)</h4>
            <p class="muted">Admin et/ou Dev. Au moins un rôle requis.</p>
            ${renderPageRoleSelector()}
          </div>
          <div class="gestion-modal-selector">
            <h4>Catégories assignées</h4>
            ${renderPageCategorySelector()}
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-action="close-page-modal">Annuler</button>
            <button type="submit" class="primary-button">${isEdit ? 'Enregistrer' : 'Créer'}</button>
          </div>
        </form>
      </div>
      </div>
    `;
  }

  function renderPageModalPortal() {
    if (!state.pageModal.open) return;
    mountModal('page', renderPageModal());
    refreshDisabledFieldsVisibility();
  }

function renderCategoryPageSelector() {
  const pages = state.pages
    .filter(page => page.type === 'gestion')
    .sort((a, b) => a.slug.localeCompare(b.slug, 'fr', { sensitivity: 'base' }));

  if (!pages.length) {
    return '<p class="module-placeholder">Aucune page gestion disponible.</p>';
  }

  return `
    <div class="gestion-select-list gestion-select-list--scroll">
      ${pages
        .map(page => {
          const selected = state.categoryModal.draft.pageIds.has(page.id);
          return `
            <button
              type="button"
              class="gestion-select-row ${selected ? 'is-selected' : ''}"
              data-action="toggle-category-modal-page"
              data-page-id="${escapeHtml(page.id)}"
            >
              <span class="gestion-select-row-main">
                <span class="gestion-select-title">${escapeHtml(page.slug)}</span>
                <small>${escapeHtml(page.moduleFile)}</small>
              </span>
              <i class="bi bi-check2 selection-check" aria-hidden="true"></i>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderIconPickerPanel() {
  const isOpen = state.categoryModal.draft.iconPickerOpen;
  const visibleIcons = getVisibleIcons();
  const loading = state.iconLibrary.loading;
  const warning = state.iconLibrary.error;
  const sourceSize = state.iconLibrary.icons.length || ICON_FALLBACK.length;
  return `
    <div
      class="icon-picker-overlay ${isOpen ? 'is-open' : ''}"
      data-icon-picker-wrapper
      data-icon-picker-overlay
      data-action="close-icon-picker-overlay"
      aria-hidden="${isOpen ? 'false' : 'true'}"
    >
      <div
        class="icon-picker-surface"
        role="dialog"
        aria-modal="true"
        aria-label="Bibliothèque d'icônes"
        data-icon-picker-panel
      >
        <header class="icon-picker-header">
          <div class="icon-picker-header-main">
            <h4>Bibliothèque d'icônes</h4>
            <p class="muted">Choisissez une icône Bootstrap pour cette catégorie.</p>
          </div>
          <button
            type="button"
            class="gestion-icon-button icon-picker-close"
            data-action="close-icon-picker"
            aria-label="Fermer la librairie d'icônes"
          >
            <i class="bi bi-x" aria-hidden="true"></i>
          </button>
        </header>
        <div class="icon-picker-body">
          <div class="icon-picker-search-row">
            <label>
              Rechercher une icône
              <input
                type="search"
                name="iconSearch"
                data-action="icon-search"
                value="${escapeHtml(state.categoryModal.draft.iconQuery)}"
                placeholder="ex: folder, calendar, card..."
              >
            </label>
            <p class="muted icon-picker-meta">
              Bibliothèque chargée: ${sourceSize} icônes · Affichage: ${MAX_ICON_RESULTS} max.
            </p>
            ${
              warning
                ? `<p class="form-message" data-status="error">${escapeHtml(warning)}</p>`
                : ''
            }
          </div>
          ${
            loading
              ? '<p class="module-placeholder loading">Chargement des icônes...</p>'
              : `<div class="gestion-icon-grid" data-icon-grid>${
                  visibleIcons.length
                    ? visibleIcons
                        .map(icon => {
                          const selected = state.categoryModal.draft.icon === icon;
                          return `
                            <button
                              type="button"
                              class="gestion-icon-cell ${selected ? 'is-selected' : ''}"
                              data-action="select-category-icon"
                              data-icon="${escapeHtml(icon)}"
                              title="${escapeHtml(icon)}"
                              data-icon-cell
                            >
                              <i class="bi ${escapeHtml(icon)}" aria-hidden="true"></i>
                              <small>${escapeHtml(icon.replace('bi-', ''))}</small>
                            </button>
                          `;
                        })
                        .join('')
                    : '<p class="module-placeholder">Aucun resultat.</p>'
                }</div>`
          }
        </div>
      </div>
    </div>
  `;
}

  function renderCategoryModal() {
    if (!state.categoryModal.open) return '';
    const isEdit = state.categoryModal.mode === 'edit';
    const draft = state.categoryModal.draft;
    const isClosing = state.categoryModal.closing;
    const overlayClasses = ['modal-overlay'];
    if (isClosing) {
      overlayClasses.push('is-closing');
    } else if (state.modalAnimations.opened?.category) {
      overlayClasses.push('is-open');
    }
    return `
      <div class="${overlayClasses.join(' ')}" data-modal-overlay="category" data-action="close-category-modal-overlay">
        <div class="modal-panel gestion-manager-modal ui-modal-panel" role="dialog" aria-modal="true" aria-label="${
          isEdit ? 'Modifier une catégorie' : 'Créer une catégorie'
        }">
        <header class="gestion-modal-header">
          <h3>${isEdit ? 'Modifier une catégorie' : 'Créer une catégorie'}</h3>
          <button type="button" class="gestion-icon-button" data-action="close-category-modal" aria-label="Fermer">
            <i class="bi bi-x" aria-hidden="true"></i>
          </button>
        </header>
        <form data-form="category-modal" class="manager-form gestion-modal-form">
          <label>
            Nom de catégorie
            <input type="text" required maxlength="120" name="name" data-category-modal-field="name" value="${escapeHtml(
              draft.name
            )}" placeholder="ex: Organisation">
          </label>
          <div class="gestion-icon-picker">
            <div class="gestion-icon-picker-header">
              <div class="gestion-icon-preview" data-icon-preview>
                <i class="bi ${escapeHtml(draft.icon)}" aria-hidden="true"></i>
                <span data-icon-preview-label>${escapeHtml(draft.icon)}</span>
              </div>
              <button type="button" class="secondary-button" data-action="toggle-icon-picker">
                Sélectionner une icône
              </button>
            </div>
            ${renderIconPickerPanel()}
          </div>
          <div class="gestion-modal-selector">
            <h4>Pages assignées</h4>
            ${renderCategoryPageSelector()}
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-action="close-category-modal">Annuler</button>
            <button type="submit" class="primary-button">${isEdit ? 'Enregistrer' : 'Créer'}</button>
          </div>
        </form>
      </div>
      </div>
    `;
  }

  function renderCategoryModalPortal() {
    if (!state.categoryModal.open) return;
    mountModal('category', renderCategoryModal());
  }
  function renderConfirmModal() {
    if (!state.confirmModal.open) return '';
    const isCategory = state.confirmModal.type === 'delete-category';
    const title = isCategory ? 'Supprimer la catégorie ?' : 'Supprimer la page ?';
    const detail = isCategory
      ? `La catégorie "${state.confirmModal.label}" sera retirée. Les pages resteront et passeront en Sans catégorie.`
      : `La page "${state.confirmModal.label}" sera supprimée définitivement.`;

    const isClosing = state.confirmModal.closing;
    const overlayClasses = ['modal-overlay'];
    if (isClosing) {
      overlayClasses.push('is-closing');
    } else if (state.modalAnimations.opened?.confirm) {
      overlayClasses.push('is-open');
    }
    return `
      <div class="${overlayClasses.join(' ')}" data-modal-overlay="confirm" data-action="close-confirm-modal-overlay">
        <div class="modal-panel ui-modal-panel" role="dialog" aria-modal="true" aria-label="Confirmation de suppression">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(detail)}</p>
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-action="close-confirm-modal">Annuler</button>
            <button type="button" class="primary-button danger-button" data-action="confirm-delete">Supprimer</button>
        </div>
        </div>
      </div>
    `;
  }

  function renderConfirmModalPortal() {
    if (!state.confirmModal.open) return;
    mountModal('confirm', renderConfirmModal());
  }

function renderBody() {
  if (state.loading) {
    return '<p class="module-placeholder loading">Chargement des pages gestion...</p>';
  }
  return state.activeTab === 'pages' ? renderPagesTab() : renderCategoriesTab();
}

function render() {
  if (!rootContainer) return;
  teardownDragListeners();
  const dragModeClass = state.drag.categoryId ? 'order-mode' : '';
  rootContainer.innerHTML = `
    <div class="vitrine-manager gestion-pages-manager ${dragModeClass}">
      <header>
        <h2>Navigation gestion</h2>
        <p>Catégories, assignations multi-catégories, modals centrés et ordre intra-catégorie.</p>
      </header>
      ${renderFeedback()}
      ${renderTabs()}
      ${renderBody()}
    </div>
  `;
    setupDragListeners();
    applyKebabState();
    syncBodyScroll();
    if (DEBUG_RENDER && window?.location?.hostname === 'localhost') {
      console.debug('[gestion-pages] render', performance.now().toFixed(1));
    }
  }

function updatePageModalField(field, value) {
  const draft = state.pageModal.draft;
  if (!draft) return;
  if (field === 'order') {
    draft.order = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
    return;
  }
  if (field === 'disabledMode') {
    draft.disabledMode = String(value || 'active');
    return;
  }
  if (field === 'from' || field === 'to') {
    draft[field] = String(value || '');
    return;
  }
  draft[field] = String(value || '');
}

function togglePageRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!GESTION_ROLES.includes(normalized)) return;
  const roles = state.pageModal.draft?.allowedRoles;
  if (!roles) return;
  if (roles.has(normalized)) {
    roles.delete(normalized);
  } else {
    roles.add(normalized);
  }
}

function updateCategoryModalField(field, value) {
  const draft = state.categoryModal.draft;
  if (!draft) return;
  if (field === 'name') {
    draft.name = String(value || '');
    return;
  }
  if (field === 'iconQuery') {
    draft.iconQuery = String(value || '');
  }
}

async function submitPageModal(submitButton = null) {
  const pageId = state.pageModal.pageId;
  const draft = state.pageModal.draft;
  const slug = String(draft.slug || '').trim();
  const moduleFile = String(draft.moduleFile || '').trim();
  if (!slug || !moduleFile) {
    setFeedback('Slug et module JS sont obligatoires.', 'error');
    render();
    throw new Error('Slug et module JS sont obligatoires.');
  }
  const allowedRoles = draft.allowedRoles || new Set();
  if (!allowedRoles.size) {
    setFeedback('Sélectionnez au moins un rôle (admin ou dev).', 'error');
    renderPageModalPortal();
    throw new Error('Sélectionnez au moins un rôle (admin ou dev).');
  }

  const payload = {
    slug,
    moduleFile,
    type: 'gestion',
    order: Number.isFinite(Number(draft.order)) ? Number(draft.order) : 0,
    disabled: buildDisabledPayload(draft),
    categories: [...draft.categories],
    allowedRolesGestion: [...allowedRoles]
  };

  const endpoint = pageId ? `/pages/${pageId}` : '/pages';
  const method = pageId ? 'PUT' : 'POST';
  await apiRequest(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  setActionSuccess(submitButton, 'Réussi');
  await new Promise(resolve => setTimeout(resolve, 280));

  closePageModal();
  resetDragState();
  await refreshData();
  setFeedback(pageId ? 'Page mise a jour.' : 'Page creee.', 'success');
  render();
}

async function submitCategoryModal(submitButton = null) {
  const categoryId = state.categoryModal.categoryId;
  const draft = state.categoryModal.draft;
  const name = String(draft.name || '').trim();
  if (!name) {
    setFeedback('Le nom de catégorie est obligatoire.', 'error');
    render();
    throw new Error('Le nom de catégorie est obligatoire.');
  }
  const payload = {
    name,
    icon: normalizeIcon(draft.icon),
    pageIds: [...draft.pageIds]
  };
  const endpoint = categoryId ? `/categories/${categoryId}` : '/categories';
  const method = categoryId ? 'PUT' : 'POST';
  await apiRequest(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  setActionSuccess(submitButton, 'Réussi');
  await new Promise(resolve => setTimeout(resolve, 280));

  closeCategoryModal();
  resetDragState();
  await refreshData();
  setFeedback(categoryId ? 'Catégorie mise à jour.' : 'Catégorie créée.', 'success');
  render();
}

async function handleDeleteConfirmation(actionButton = null) {
  const { type, id } = state.confirmModal;
  if (!type || !id) return;
  setActionLoading(actionButton, 'Suppression...');
  try {
    if (type === 'delete-page') {
      await apiRequest(`/pages/${id}`, { method: 'DELETE' });
      closeConfirmModal();
      resetDragState();
      await refreshData();
      setFeedback('Page supprimée.', 'success');
      setActionSuccess(actionButton, 'Réussi');
      render();
      return;
    }
    if (type === 'delete-category') {
      await apiRequest(`/categories/${id}`, { method: 'DELETE' });
      closeConfirmModal();
      resetDragState();
      await refreshData();
      setFeedback('Catégorie supprimée. Les pages restent en Sans catégorie.', 'success');
      setActionSuccess(actionButton, 'Réussi');
      render();
    }
  } catch (error) {
    setActionError(actionButton, 'NavigationGestion:DeleteEntity', error, { type, id });
    throw error;
  }
}

function toggleKebabMenu(key) {
  if (!key) return;
  state.ui.openKebabKey = state.ui.openKebabKey === key ? null : key;
}
function handleClick(event) {
  const actionElement = event.target.closest('[data-action]');
  const inScope =
    actionElement &&
    (rootContainer?.contains(actionElement) || modalRoot?.contains(actionElement));
  if (!inScope) return;
  const action = actionElement.dataset.action;

  if (action === 'switch-tab') {
    const tab = actionElement.dataset.tab;
    if (tab !== 'pages' && tab !== 'categories') return;
    state.activeTab = tab;
    resetDragState();
    closeAllMenus();
    render();
    return;
  }

  if (action === 'toggle-kebab') {
    toggleKebabMenu(actionElement.dataset.kebabKey);
    applyKebabState();
    return;
  }

  if (action === 'open-create-page') {
    openCreatePageModal(actionElement.dataset.categoryId || null);
    return;
  }

  if (action === 'open-edit-page') {
    openEditPageModal(actionElement.dataset.id);
    return;
  }

  if (action === 'prompt-delete-page') {
    const page = getPageById(actionElement.dataset.id);
    if (!page) return;
    openDeleteConfirmation('delete-page', page.id, page.slug);
    return;
  }

  if (action === 'open-create-category') {
    openCreateCategoryModal();
    return;
  }

  if (action === 'open-edit-category') {
    openEditCategoryModal(actionElement.dataset.id);
    return;
  }

  if (action === 'prompt-delete-category') {
    const category = getCategoryById(actionElement.dataset.id);
    if (!category) return;
    openDeleteConfirmation('delete-category', category.id, category.name);
    return;
  }

  if (action === 'toggle-pages-sort') {
    state.sort.pages = state.sort.pages === 'alpha' ? 'order' : 'alpha';
    render();
    return;
  }

  if (action === 'toggle-page-role') {
    const role = actionElement.dataset.role;
    togglePageRole(role);
    renderPageModalPortal();
    return;
  }

  if (action === 'toggle-pages-filter-active') {
    state.filters.pagesActiveOnly = !state.filters.pagesActiveOnly;
    render();
    return;
  }

  if (action === 'toggle-category-sort') {
    state.sort.categories = state.sort.categories === 'alpha' ? 'order' : 'alpha';
    render();
    return;
  }

  if (action === 'toggle-page-modal-category') {
    const categoryId = actionElement.dataset.categoryId;
    if (!categoryId) return;
    const selected = state.pageModal.draft.categories;
    if (selected.has(categoryId)) {
      selected.delete(categoryId);
    } else {
      selected.add(categoryId);
    }
    const row = actionElement.closest('.gestion-select-row');
    if (row) {
      row.classList.toggle('is-selected', selected.has(categoryId));
    }
    return;
  }

  if (action === 'toggle-category-modal-page') {
    const pageId = actionElement.dataset.pageId;
    if (!pageId) return;
    const selected = state.categoryModal.draft.pageIds;
    if (selected.has(pageId)) {
      selected.delete(pageId);
    } else {
      selected.add(pageId);
    }
    const row = actionElement.closest('.gestion-select-row');
    if (row) {
      row.classList.toggle('is-selected', selected.has(pageId));
    }
    return;
  }

  if (action === 'toggle-icon-picker') {
    state.categoryModal.draft.iconPickerOpen = !state.categoryModal.draft.iconPickerOpen;
    const overlay = modalRoot?.querySelector('[data-icon-picker-overlay]');
    if (overlay) {
      overlay.classList.toggle('is-open', state.categoryModal.draft.iconPickerOpen);
      overlay.setAttribute('aria-hidden', state.categoryModal.draft.iconPickerOpen ? 'false' : 'true');
    }
    if (state.categoryModal.draft.iconPickerOpen) {
      void ensureBootstrapIconsLoaded().then(() => refreshIconGrid());
    }
    syncBodyScroll();
    return;
  }

  if (action === 'close-icon-picker') {
    state.categoryModal.draft.iconPickerOpen = false;
    const overlay = modalRoot?.querySelector('[data-icon-picker-overlay]');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    syncBodyScroll();
    return;
  }

  if (action === 'select-category-icon') {
    const icon = actionElement.dataset.icon;
    state.categoryModal.draft.icon = normalizeIcon(icon);
    modalRoot
      ?.querySelectorAll('[data-icon-cell]')
      .forEach(cell => cell.classList.toggle('is-selected', cell.dataset.icon === state.categoryModal.draft.icon));
    const preview = modalRoot?.querySelector('[data-icon-preview]');
    if (preview) {
      const iconEl = preview.querySelector('i');
      if (iconEl) {
        iconEl.className = `bi ${state.categoryModal.draft.icon}`;
      }
      const label = preview.querySelector('[data-icon-preview-label]');
      if (label) label.textContent = state.categoryModal.draft.icon;
    }
    return;
  }

  if (action === 'start-order') {
    const categoryId = actionElement.dataset.categoryId;
    if (!categoryId) return;
    enterCategoryOrderMode(categoryId);
    render();
    return;
  }

  if (action === 'save-order') {
    if (actionElement?.dataset.actionState === 'loading') return;
    void (async () => {
      try {
        await saveCategoryOrder(actionElement);
      } catch (error) {
        setFeedback(error.message || "Impossible d enregistrer l ordre.", 'error');
        render();
      }
    })();
    return;
  }

  if (action === 'cancel-order') {
    resetDragState();
    render();
    return;
  }

  if (action === 'close-page-modal' || action === 'close-page-modal-overlay') {
    if (action === 'close-page-modal-overlay' && event.target !== actionElement) return;
    requestClosePageModal();
    return;
  }

  if (action === 'close-category-modal' || action === 'close-category-modal-overlay') {
    if (action === 'close-category-modal-overlay' && event.target !== actionElement) return;
    requestCloseCategoryModal();
    return;
  }

  if (action === 'close-confirm-modal' || action === 'close-confirm-modal-overlay') {
    if (action === 'close-confirm-modal-overlay' && event.target !== actionElement) return;
    requestCloseConfirmModal();
    return;
  }

  if (action === 'confirm-delete') {
    if (actionElement?.dataset.actionState === 'loading') return;
    void (async () => {
      try {
        await handleDeleteConfirmation(actionElement);
      } catch (error) {
        setFeedback(error.message || 'Suppression impossible.', 'error');
        render();
      }
    })();
  }
}

function handleInput(event) {
  const inScope =
    rootContainer?.contains(event.target) || modalRoot?.contains(event.target);
  if (!inScope) return;

  const pageField = event.target.dataset.pageModalField;
    if (state.pageModal.open && pageField) {
      updatePageModalField(pageField, event.target.value);
      if (pageField === 'disabledMode') {
        refreshDisabledFieldsVisibility();
      }
      return;
    }

  const categoryField = event.target.dataset.categoryModalField;
  if (state.categoryModal.open && categoryField) {
    updateCategoryModalField(categoryField, event.target.value);
    return;
  }

    if (event.target.dataset.action === 'icon-search') {
      updateCategoryModalField('iconQuery', event.target.value);
      refreshIconGrid();
    }

  }

function handleSubmit(event) {
  const form = event.target;
  const inScope = rootContainer?.contains(form) || modalRoot?.contains(form);
  if (!inScope) return;
  const formType = form.dataset.form;
  if (!formType) return;
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.dataset.actionState === 'loading') return;

  if (formType === 'page-modal') {
    void (async () => {
      setActionButtonState(submitButton, 'loading', { loadingLabel: 'Enregistrement...' });
      try {
        await submitPageModal(submitButton);
      } catch (error) {
        setActionError(submitButton, 'NavigationGestion:SavePage', error, {
          mode: state.pageModal.mode,
          pageId: state.pageModal.pageId,
          draft: {
            slug: state.pageModal?.draft?.slug,
            moduleFile: state.pageModal?.draft?.moduleFile
          }
        });
        setFeedback(error.message || 'Erreur reseau.', 'error');
        render();
      }
    })();
    return;
  }

  if (formType === 'category-modal') {
    void (async () => {
      setActionButtonState(submitButton, 'loading', { loadingLabel: 'Enregistrement...' });
      try {
        await submitCategoryModal(submitButton);
      } catch (error) {
        setActionError(submitButton, 'NavigationGestion:SaveCategory', error, {
          mode: state.categoryModal.mode,
          categoryId: state.categoryModal.categoryId,
          draft: {
            name: state.categoryModal?.draft?.name,
            icon: state.categoryModal?.draft?.icon
          }
        });
        setFeedback(error.message || 'Erreur reseau.', 'error');
        render();
      }
    })();
  }
}

function handleDocumentClick(event) {
  if (!rootContainer) return;
  const target = event.target;
  const isInsideModule = rootContainer.contains(target) || modalRoot?.contains(target);

  let changed = false;

  if (state.ui.openKebabKey) {
    const insideKebab = target.closest('[data-kebab-wrapper]');
    if (!insideKebab) {
      state.ui.openKebabKey = null;
      changed = true;
    }
  }

  if (state.categoryModal.open && state.categoryModal.draft.iconPickerOpen) {
    const insidePicker =
      target.closest('[data-icon-picker-wrapper]') ||
      target.closest('[data-action="toggle-icon-picker"]');
    if (!insidePicker && isInsideModule) {
      state.categoryModal.draft.iconPickerOpen = false;
      changed = true;
    }
  }

  if (changed) {
    if (!state.ui.openKebabKey) applyKebabState();
    if (!state.categoryModal.draft.iconPickerOpen) {
      const overlay = modalRoot?.querySelector('[data-icon-picker-overlay]');
      if (overlay) {
        overlay.classList.remove('is-open');
        overlay.setAttribute('aria-hidden', 'true');
      }
    }
    syncBodyScroll();
  }
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Escape') return;

  if (state.confirmModal.open) {
    requestCloseConfirmModal();
    return;
  }
  if (state.pageModal.open) {
    requestClosePageModal();
    return;
  }
  if (state.categoryModal.open) {
    requestCloseCategoryModal();
    return;
  }
  if (state.categoryModal.draft.iconPickerOpen) {
    state.categoryModal.draft.iconPickerOpen = false;
    const overlay = modalRoot?.querySelector('[data-icon-picker-overlay]');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    syncBodyScroll();
    return;
  }
  if (state.ui.openKebabKey) {
    state.ui.openKebabKey = null;
    applyKebabState();
    return;
  }
  if (state.drag.categoryId) {
    resetDragState();
    render();
  }
}

function bindEvents() {
  if (!rootContainer) return;
  if (eventAbortController) {
    eventAbortController.abort();
  }
  eventAbortController = new AbortController();
  const { signal } = eventAbortController;

  rootContainer.addEventListener('click', handleClick, { signal });
  rootContainer.addEventListener('input', handleInput, { signal });
  rootContainer.addEventListener('submit', handleSubmit, { signal });
  const modalContainer = ensureModalRoot();
  modalContainer.addEventListener('click', handleClick, { signal });
  modalContainer.addEventListener('input', handleInput, { signal });
  modalContainer.addEventListener('submit', handleSubmit, { signal });
  document.addEventListener('click', handleDocumentClick, { signal });
  document.addEventListener('keydown', handleDocumentKeydown, { signal });
}
function teardownDragListeners() {
  if (!dragListElement) return;
  dragListElement.removeEventListener('dragover', handleDragOver);
  dragListElement.removeEventListener('drop', handleDrop);
  dragListElement.querySelectorAll('.data-item').forEach(card => {
    card.removeEventListener('dragstart', handleDragStart);
    card.removeEventListener('dragend', handleDragEnd);
    card.removeEventListener('pointerdown', handlePointerDown);
    card.removeEventListener('touchstart', handleTouchStart);
  });
  dragListElement = null;
}

function setupDragListeners() {
  if (!rootContainer || !state.drag.categoryId) return;
  dragListElement = rootContainer.querySelector(`[data-category-list="${state.drag.categoryId}"]`);
  if (!dragListElement) return;

  dragListElement.addEventListener('dragover', handleDragOver);
  dragListElement.addEventListener('drop', handleDrop);
  dragListElement.querySelectorAll('.data-item').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('pointerdown', handlePointerDown);
    card.addEventListener('touchstart', handleTouchStart, { passive: false });
  });
}

function ensureDragIndicator() {
  if (!dragIndicator) {
    dragIndicator = document.createElement('div');
    dragIndicator.className = 'drag-indicator';
    dragIndicator.setAttribute('aria-hidden', 'true');
    dragIndicatorNeedsReveal = true;
  }
  return dragIndicator;
}

function finalizeDragIndicatorRemoval() {
  if (!dragIndicator) return;
  if (dragIndicatorRemovalHandler) {
    dragIndicator.removeEventListener('transitionend', dragIndicatorRemovalHandler);
    dragIndicatorRemovalHandler = null;
  }
  if (dragIndicator.parentNode) {
    dragIndicator.parentNode.removeChild(dragIndicator);
  }
  dragIndicator = null;
  if (dragIndicatorRemovalTimer) {
    clearTimeout(dragIndicatorRemovalTimer);
    dragIndicatorRemovalTimer = null;
  }
}

function clearDragIndicator() {
  if (!dragIndicator) {
    dropTargetId = null;
    dropAfter = false;
    return;
  }
  dragIndicator.classList.remove('is-visible');
  if (dragIndicatorRemovalHandler) {
    dragIndicator.removeEventListener('transitionend', dragIndicatorRemovalHandler);
  }
  dragIndicatorRemovalHandler = event => {
    if (event.propertyName !== 'width') return;
    finalizeDragIndicatorRemoval();
  };
  dragIndicator.addEventListener('transitionend', dragIndicatorRemovalHandler);
  if (dragIndicatorRemovalTimer) {
    clearTimeout(dragIndicatorRemovalTimer);
  }
  dragIndicatorRemovalTimer = setTimeout(finalizeDragIndicatorRemoval, 260);
  dropTargetId = null;
  dropAfter = false;
}

function revealDragIndicator() {
  if (!dragIndicator) return;
  if (dragIndicatorNeedsReveal) {
    requestAnimationFrame(() => {
      if (!dragIndicator) return;
      dragIndicator.classList.add('is-visible');
      dragIndicatorNeedsReveal = false;
    });
  } else if (!dragIndicator.classList.contains('is-visible')) {
    dragIndicator.classList.add('is-visible');
  }
}

function findInsertionTarget(pointerY) {
  if (!dragListElement) return null;
  const cards = Array.from(dragListElement.querySelectorAll('.data-item')).filter(
    card => card.dataset.pageId !== dragSourceId
  );
  if (!cards.length) return null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (pointerY < rect.top + rect.height / 2) {
      return { card, after: false };
    }
  }
  return { card: cards[cards.length - 1], after: true };
}

function moveIndicator(target, after) {
  if (!target) return;
  const indicator = ensureDragIndicator();
  const parent = target.parentElement;
  if (!parent) return;
  if (dropTargetId === target.dataset.pageId && dropAfter === after && indicator.parentElement === parent) {
    return;
  }
  if (after) {
    parent.insertBefore(indicator, target.nextElementSibling);
  } else {
    parent.insertBefore(indicator, target);
  }
  dropTargetId = target.dataset.pageId;
  dropAfter = after;
  revealDragIndicator();
}

function updateIndicatorFromPoint(clientX, clientY) {
  if (!dragSourceId) return false;
  const element = document.elementFromPoint(clientX, clientY);
  const targetCard = element?.closest('.data-item');
  if (targetCard && targetCard.dataset.pageId !== dragSourceId) {
    const rect = targetCard.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    moveIndicator(targetCard, after);
    return true;
  }
  const fallback = findInsertionTarget(clientY);
  if (fallback) {
    moveIndicator(fallback.card, fallback.after);
    return true;
  }
  clearDragIndicator();
  return false;
}

function clearTextSelection() {
  if (window.getSelection) {
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
  }
}

function lockInteraction() {
  previousBodyTouchAction = document.body.style.touchAction || '';
  previousHtmlTouchAction = document.documentElement.style.touchAction || '';
  document.body.style.touchAction = 'none';
  document.documentElement.style.touchAction = 'none';
  clearTextSelection();
}

function unlockInteraction() {
  document.body.style.touchAction = previousBodyTouchAction;
  document.documentElement.style.touchAction = previousHtmlTouchAction;
  previousBodyTouchAction = '';
  previousHtmlTouchAction = '';
}

function updateDragMirrorPosition(clientX, clientY) {
  if (!dragMirror) return;
  const offsetX = 14;
  const offsetY = 14;
  dragMirror.style.transform = `translate(${clientX + offsetX}px, ${clientY + offsetY}px)`;
}
function releaseDragMirror() {
  if (dragMoveHandler) {
    document.removeEventListener('dragover', dragMoveHandler);
    document.removeEventListener('drag', dragMoveHandler);
    dragMoveHandler = null;
  }
  if (dragMirror && dragMirror.parentNode) {
    dragMirror.parentNode.removeChild(dragMirror);
  }
  dragMirror = null;
}

function createDragMirror(card) {
  releaseDragMirror();
  if (!card) return null;
  dragMirror = card.cloneNode(true);
  dragMirror.classList.add('drag-ghost');
  dragMirror.style.width = `${card.offsetWidth}px`;
  dragMirror.style.height = `${card.offsetHeight}px`;
  dragMirror.style.position = 'fixed';
  dragMirror.style.top = '0';
  dragMirror.style.left = '0';
  dragMirror.style.margin = '0';
  dragMirror.style.pointerEvents = 'none';
  dragMirror.style.zIndex = '9999';
  dragMirror.style.transform = 'translate(0, 0)';
  document.body.appendChild(dragMirror);
  dragMoveHandler = event => {
    if (event.clientX === 0 && event.clientY === 0) return;
    updateDragMirrorPosition(event.clientX, event.clientY);
  };
  document.addEventListener('dragover', dragMoveHandler);
  document.addEventListener('drag', dragMoveHandler);
  return dragMirror;
}

function activateDrag(card, clientX, clientY) {
  if (!card || !state.drag.categoryId) return;
  dragSourceId = card.dataset.pageId;
  card.classList.add('dragging');
  document.body.classList.add('dragging-ui');
  document.documentElement.classList.add('dragging-ui');
  lockInteraction();
  createDragMirror(card);
  updateDragMirrorPosition(clientX, clientY);
  updateIndicatorFromPoint(clientX, clientY);
}

function cleanupDragUI() {
  document.body.classList.remove('dragging-ui');
  document.documentElement.classList.remove('dragging-ui');
  unlockInteraction();
}

function handleDragStart(event) {
  if (!state.drag.categoryId) return;
  const card = event.currentTarget;
  activateDrag(card, event.clientX, event.clientY);
  event.dataTransfer?.setData('text/plain', dragSourceId);
  const blankImage = new Image();
  blankImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==';
  event.dataTransfer?.setDragImage(blankImage, 0, 0);
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  dragSourceId = null;
  clearDragIndicator();
  releaseDragMirror();
  cleanupDragUI();
}

function handleDragOver(event) {
  if (!dragSourceId) return;
  event.preventDefault();
  updateIndicatorFromPoint(event.clientX, event.clientY);
  updateDragMirrorPosition(event.clientX, event.clientY);
}

function handleDrop(event) {
  event.preventDefault();
  if (!dragSourceId) return;
  finalizeDrop();
}

function resetManualDragState() {
  pendingDragCard = null;
  dragStartPoint = null;
  manualDragStarted = false;
}

function tryStartManualDrag(clientX, clientY) {
  if (!pendingDragCard || !dragStartPoint) return false;
  const dx = clientX - dragStartPoint.x;
  const dy = clientY - dragStartPoint.y;
  if (Math.hypot(dx, dy) < MANUAL_DRAG_THRESHOLD) return false;
  manualDragStarted = true;
  clearTextSelection();
  activateDrag(pendingDragCard, clientX, clientY);
  return true;
}

function handlePointerDown(event) {
  if (event.pointerType !== 'touch') return;
  if (!state.drag.categoryId || dragSourceId || manualDragStarted) return;
  pendingDragCard = event.currentTarget;
  dragStartPoint = { x: event.clientX, y: event.clientY };
  manualDragStarted = false;
  activePointerId = event.pointerId;
  pointerMoveListener = handlePointerMove;
  pointerUpListener = handlePointerUp;
  document.addEventListener('pointermove', pointerMoveListener);
  document.addEventListener('pointerup', pointerUpListener);
  document.addEventListener('pointercancel', pointerUpListener);
}

function handlePointerMove(event) {
  if (event.pointerId !== activePointerId) return;
  if (!manualDragStarted) {
    if (!tryStartManualDrag(event.clientX, event.clientY)) return;
  }
  event.preventDefault();
  clearTextSelection();
  updateDragMirrorPosition(event.clientX, event.clientY);
  updateIndicatorFromPoint(event.clientX, event.clientY);
}

function handlePointerUp(event) {
  if (event.pointerId !== activePointerId) return;
  document.removeEventListener('pointermove', pointerMoveListener);
  document.removeEventListener('pointerup', pointerUpListener);
  document.removeEventListener('pointercancel', pointerUpListener);
  pointerMoveListener = null;
  pointerUpListener = null;
  activePointerId = null;
  if (manualDragStarted) {
    event.preventDefault();
    finalizeDrop();
    releaseDragMirror();
    dragSourceId = null;
    cleanupDragUI();
  }
  resetManualDragState();
}

function handleTouchStart(event) {
  if (!state.drag.categoryId || event.touches.length !== 1 || dragSourceId || manualDragStarted) return;
  const touch = event.changedTouches[0];
  if (!touch) return;
  pendingDragCard = event.currentTarget;
  dragStartPoint = { x: touch.clientX, y: touch.clientY };
  manualDragStarted = false;
  activeTouchId = touch.identifier;
  touchMoveListener = handleTouchMove;
  touchEndListener = handleTouchEnd;
  document.addEventListener('touchmove', touchMoveListener, { passive: false });
  document.addEventListener('touchend', touchEndListener);
  document.addEventListener('touchcancel', touchEndListener);
}

function handleTouchMove(event) {
  if (activeTouchId === null) return;
  const touch = Array.from(event.changedTouches).find(item => item.identifier === activeTouchId);
  if (!touch) return;
  if (!manualDragStarted) {
    if (!tryStartManualDrag(touch.clientX, touch.clientY)) return;
  }
  event.preventDefault();
  clearTextSelection();
  updateDragMirrorPosition(touch.clientX, touch.clientY);
  updateIndicatorFromPoint(touch.clientX, touch.clientY);
}

function handleTouchEnd(event) {
  if (activeTouchId === null) return;
  const touch = Array.from(event.changedTouches).find(item => item.identifier === activeTouchId);
  if (!touch) return;
  document.removeEventListener('touchmove', touchMoveListener);
  document.removeEventListener('touchend', touchEndListener);
  document.removeEventListener('touchcancel', touchEndListener);
  touchMoveListener = null;
  touchEndListener = null;
  activeTouchId = null;
  if (manualDragStarted) {
    event.preventDefault();
    finalizeDrop();
    releaseDragMirror();
    dragSourceId = null;
    cleanupDragUI();
  }
  resetManualDragState();
}

function reorderDraftOrder(targetId, targetAfter) {
  const sourceId = dragSourceId;
  if (!sourceId) return null;
  const orderedIds = [...state.drag.draftOrderIds];
  const fromIndex = orderedIds.findIndex(pageId => pageId === sourceId);
  if (fromIndex === -1) return null;
  const [moved] = orderedIds.splice(fromIndex, 1);
  if (!targetId) {
    orderedIds.push(moved);
    return orderedIds;
  }
  const targetIndex = orderedIds.findIndex(pageId => pageId === targetId);
  if (targetIndex === -1) {
    orderedIds.push(moved);
    return orderedIds;
  }
  const insertIndex = targetAfter ? targetIndex + 1 : targetIndex;
  orderedIds.splice(insertIndex, 0, moved);
  return orderedIds;
}

function finalizeDrop() {
  if (!dragSourceId) return false;
  const targetId = dropTargetId;
  const targetAfter = dropAfter;
  clearDragIndicator();
  const reorderedIds = reorderDraftOrder(targetId, targetAfter);
  if (!reorderedIds) return false;
  state.drag.draftOrderIds = reorderedIds;
  render();
  return true;
}

export async function renderModule(container) {
  if (!container) return;
  rootContainer = container;
  clearFeedback();
  resetDragState();
  closePageModal();
  closeCategoryModal();
  closeConfirmModal();
  bindEvents();
  try {
    await refreshData();
    render();
  } catch (error) {
    state.loading = false;
    setFeedback(error.message || 'Impossible de charger le module.', 'error');
    render();
  }
}

export default { renderModule };
