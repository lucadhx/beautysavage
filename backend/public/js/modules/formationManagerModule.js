import { openEditorialEditor } from './editorialEditor.js';
import { fetchEditableContent, saveEditableContent } from './editableContentClient.js';
import { confirmAction } from './confirmActionModal.js';
import { showToast } from '../helpers/toastService.js';
import { setActionButtonState } from '../helpers/actionButtonState.js';
import { logUiError } from '../helpers/uiLogger.js';
import { buildGestionLineGraph } from '../helpers/graphStylePreset.js';

const API_ROOT = '/api/gestion/formations';
const MODULES_ROOT = '/api/gestion';
const COVER_UPLOAD_ENDPOINT = `${API_ROOT}/upload-cover`;
const COVER_UPLOAD_MAX_SIZE = 5 * 1024 * 1024;
const COVER_PREVIEW_EMPTY_STATE = `
  <div class="gmf-cover-empty">
    <i class="bi bi-card-image" aria-hidden="true"></i>
    <p>Vous n'avez pas encore de couverture.</p>
    <button type="button" class="gmf-compact-action" data-action="trigger-cover-upload">Uploader une image</button>
  </div>
`;

const TYPE_OPTIONS = [
  { value: 'presentiel', label: 'Pr?sentiel' },
  { value: 'distanciel', label: 'Distanciel' }
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'published', label: 'Publié' },
  { value: 'disabled', label: 'Désactivé' }
];

const BOOST_ENDPOINT = '/api/gestion/boosts';
const PROMOTIONS_ENDPOINT = '/api/gestion/promotions';
const BOOST_LIMIT = 3;
const BOOST_CAROUSEL_MIN_ITEMS = 1;
const MODULES_ORDER_ENDPOINT = formationId => `${MODULES_ROOT}/formations/${formationId}/modules/order`;

const SESSIONS_ENDPOINT = formationId => `${MODULES_ROOT}/formations/${formationId}/sessions`;
const CANCELED_SESSIONS_ENDPOINT = formationId => `${MODULES_ROOT}/formations/${formationId}/canceled-sessions`;
const DELETED_HISTORY_ENDPOINT = `${API_ROOT}/deleted-history`;
const SALES_ENDPOINT = '/api/gestion/sales';
const FORMATION_REVIEWS_ENDPOINT = formationId => `${API_ROOT}/${formationId}/reviews`;
const DASHBOARD_PERIODS = ['day', 'month', 'year'];
const DASHBOARD_TAB_SALES = 'sales';
const DASHBOARD_TAB_REVIEWS = 'reviews';
const DASHBOARD_TAB_VALUES = new Set([DASHBOARD_TAB_SALES, DASHBOARD_TAB_REVIEWS]);
const WEEKDAY_LABELS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
const MONTH_LABELS = [
  'Janvier',
  'Fevrier',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Aout',
  'Septembre',
  'Octobre',
  'Novembre',
  'Decembre'
];
const calendarToday = new Date();
const SESSION_TIME_STEP_MINUTES = 30;
const SESSION_TIME_START_MINUTES = 7 * 60;
const SESSION_TIME_END_MINUTES = 22 * 60;
const SESSION_MOVE_RESUME_DELAY_MS = 600;
const SESSION_MOVE_SUGGESTION_MIN_MS = 900;
const SESSION_MOVE_SUGGESTION_MAX_MS = 1400;
const SESSION_TIME_OPTIONS = Array.from(
  { length: Math.floor((SESSION_TIME_END_MINUTES - SESSION_TIME_START_MINUTES) / SESSION_TIME_STEP_MINUTES) + 1 },
  (_unused, index) => {
    const total = SESSION_TIME_START_MINUTES + index * SESSION_TIME_STEP_MINUTES;
    const hours = String(Math.floor(total / 60)).padStart(2, '0');
    const minutes = String(total % 60).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
);
const SESSIONS_CONFLICTS_ENDPOINT = '/api/gestion/sessions/conflicts';
const SESSIONS_CONFLICTS_REPORT_ENDPOINT = '/api/gestion/sessions/conflicts-report';

const state = {
  formations: [],
  view: 'list',
  dashboardTab: DASHBOARD_TAB_SALES,
  dashboardPeriod: 'month',
  dashboardPeriodPickerOpen: false,
  dashboardReferenceDate: new Date(),
  dashboardSales: [],
  dashboardSalesLoaded: false,
  dashboardSalesLoading: false,
  dashboardSalesError: '',
  dashboardSalesRequestInFlight: null,
  dashboardReviewsByFormation: {},
  dashboardSaleDetailId: null,
  editorTab: 'info',
  activeFormationId: null,
  editingId: null,
  activePromotion: null,
  dismissedPromotionFormationId: null,
  boostActive: false,
  boostOrder: null,
  boostedItems: [],
  boostsLoading: false,
  boostsRequestInFlight: null,
  boostCarouselIndex: 0,
  boostReplaceSelection: null,
  boostTouchStartX: null,
  formationOptions: [],
  optionsLoading: false,
  optionKebabId: null,
  distancielFormations: [],
  modules: [],
  selectedFormationId: null,
  moduleEditingId: null,
  moduleView: 'modulesList',
  moduleEditorTab: 'info',
  moduleDraft: {
    title: '',
    descriptionEditorial: '',
    videos: [],
    files: []
  },
  modulePendingUploadFiles: [],
  moduleVideoInfoOpen: false,
  moduleVideoInfoAnchorEl: null,
  moduleVideoKebabId: null,
  moduleVideoOrderMode: false,
  moduleVideoDraftOrderIds: [],
  moduleVideoView: 'list',
  moduleVideoEditingId: null,
  moduleVideoEditorDraft: {
    id: null,
    title: '',
    url: '',
    descriptionEditorial: ''
  },
  moduleFileKebabId: null,
  moduleFileOrderMode: false,
  moduleFileDraftOrderIds: [],
  moduleOrderMode: false,
  moduleDraftOrderIds: [],
  moduleKebabId: null,
  presentielFormations: [],
  selectedPresentielId: null,
  sessions: [],
  canceledSessions: [],
  sessionListFilter: 'mine',
  currentUserId: null,
  planningTab: 'calendar',
  planningSessionView: 'list',
  planningEditingSessionId: null,
  planningSessionKebabId: null,
  sessionDurationDays: 1,
  sessionCalendar: {
    month: calendarToday.getMonth(),
    year: calendarToday.getFullYear()
  },
  sessionSelectedDates: [],
  sessionModal: {
    open: false,
    dateKey: null,
    sessionId: null
  },
  sessionMove: {
    month: calendarToday.getMonth(),
    year: calendarToday.getFullYear(),
    previewStartKey: '',
    touchPreviewStartKey: '',
    suggestionKeys: [],
    suggestionTimerId: null,
    resumeTimerId: null,
    pendingStartKey: '',
    currentSessionId: null
  },
  sessionMoveConfirm: {
    open: false,
    inFlight: false
  },
  sessionExternalFormationsId: null,
  sessionExternalSessions: [],
  sessionExternalRequestInFlight: null,
  sessionTimePicker: {
    open: false,
    context: '',
    dayIndex: null,
    target: '',
    key: ''
  },
  sessionConflictModal: {
    open: false,
    message: ''
  },
  sessionConflictsByDate: {},
  sessionConflictsLoadingDates: new Set(),
  catalogTab: 'main',
  deletedHistory: [],
  deletedHistoryLoading: false,
  deletedHistoryLoaded: false,
  deletedHistoryError: '',
  deletedHistoryRequestInFlight: null,
  deletedHistoryClientsModal: {
    open: false,
    historyId: null
  },
  pendingTypeChange: null,
  openKebabId: null,
  typeWarningReason: '',
  formationMetaKebab: null,
  statusPickerOpen: false,
  fileRenameModal: {
    open: false,
    fileId: null
  },
  trailerModalOpen: false,
  whatsappModalOpen: false
};

const VIEW_LIST = 'list';
const VIEW_EDIT = 'edit';
const VIEW_DASHBOARD = 'dashboard';
const VIEW_VALUES = new Set([VIEW_LIST, VIEW_EDIT, VIEW_DASHBOARD]);
const CATALOG_TAB_MAIN = 'main';
const CATALOG_TAB_HISTORY = 'history';
const CATALOG_TAB_VALUES = new Set([CATALOG_TAB_MAIN, CATALOG_TAB_HISTORY]);
const EDITOR_TAB_INFO = 'info';
const EDITOR_TAB_PROMOTION = 'promotion';
const EDITOR_TAB_BOOST = 'boost';
const EDITOR_TAB_MODULES = 'modules';
const EDITOR_TAB_PLANNING = 'planning';
const EDITOR_TAB_OPTIONS = 'options';
const PLANNING_TAB_CALENDAR = 'calendar';
const PLANNING_TAB_SESSIONS = 'sessions';
const PLANNING_TAB_CANCELED = 'canceled';
const PLANNING_TAB_VALUES = new Set([PLANNING_TAB_CALENDAR, PLANNING_TAB_SESSIONS, PLANNING_TAB_CANCELED]);
const EDITOR_TAB_VALUES = new Set([
  EDITOR_TAB_INFO,
  EDITOR_TAB_PROMOTION,
  EDITOR_TAB_BOOST,
  EDITOR_TAB_MODULES,
  EDITOR_TAB_PLANNING,
  EDITOR_TAB_OPTIONS
]);
const PANEL_DISPLAY_CLASSES = ['hidden', 'flex', 'block', 'grid', 'inline-flex'];
const FM_DEV_LOGS = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const FM_TRACE_SESSION_MOVE = false;
let fmRenderCount = 0;
let moduleKebabOutsideListenerAttached = false;
let moduleKebabEscapeListenerAttached = false;
let editorTabResizeListenerAttached = false;
let moduleVideoInfoViewportListenersAttached = false;
let sessionTimePickerOutsideListenerAttached = false;
let planningSessionKebabOutsideListenerAttached = false;
let sessionMoveDebugListenersAttached = false;
let dashboardPeriodPickerOutsideListenerAttached = false;

let moduleDragSourceId = null;
let moduleDropTargetId = null;
let moduleDropAfter = false;
let moduleDragListElement = null;
let moduleDragIndicator = null;
let moduleDragIndicatorRemovalHandler = null;
let moduleDragIndicatorRemovalTimer = null;
let moduleDragIndicatorNeedsReveal = false;
let moduleDragMirror = null;
let moduleDragMoveHandler = null;
let modulePreviousBodyTouchAction = '';
let modulePreviousHtmlTouchAction = '';
let modulePendingDragCard = null;
let moduleActivePointerId = null;
let modulePointerMoveListener = null;
let modulePointerUpListener = null;
let moduleActiveTouchId = null;
let moduleTouchMoveListener = null;
let moduleTouchEndListener = null;
let moduleDragStartPoint = null;
let moduleManualDragStarted = false;
const MODULE_MANUAL_DRAG_THRESHOLD = 8;

const TYPE_LABELS = {
  distanciel: 'Distanciel',
  presentiel: 'Présentiel'
};
const MODULE_PANEL_LIST = 'modulesList';
const MODULE_PANEL_EDITOR = 'moduleEditor';
const MODULE_EDITOR_TAB_INFO = 'info';
const MODULE_EDITOR_TAB_VIDEOS = 'videos';
const MODULE_EDITOR_TAB_FILES = 'files';
const MODULE_EDITOR_TAB_VALUES = new Set([
  MODULE_EDITOR_TAB_INFO,
  MODULE_EDITOR_TAB_VIDEOS,
  MODULE_EDITOR_TAB_FILES
]);
const MODULE_VIDEO_URL_PATTERN = /^(https?:\/\/|<iframe[\s\S]*src=|\/\/)([\s\S]+)/i;
const MODULE_VIDEO_VIEW_LIST = 'list';
const MODULE_VIDEO_VIEW_EDITOR = 'editor';

function getRoot(container) {
  if (container instanceof Element) {
    if (container.matches('[data-module-root]')) return container;
    const nearestRoot = container.closest('[data-module-root]');
    if (nearestRoot) return nearestRoot;
  }
  return document.querySelector('[data-module-root]');
}

function logDev(...args) {
  if (!FM_DEV_LOGS) return;
  console.debug(...args);
}

function describeEventTarget(target) {
  if (!target || !(target instanceof Element)) return 'unknown';
  const tag = String(target.tagName || '').toLowerCase();
  const className = String(target.className || '').trim().replace(/\s+/g, '.');
  const dateKey = String(target.getAttribute('data-date-key') || '').trim();
  return `${tag}${className ? `.${className}` : ''}${dateKey ? ` [data-date-key=${dateKey}]` : ''}`;
}

function traceSessionMove(step, payload = {}) {
  if (!FM_TRACE_SESSION_MOVE) return;
  console.warn(`[FM_TRACE][SessionMove] ${step}`, payload);
}

function ensureSessionMoveDebugListeners() {
  if (sessionMoveDebugListenersAttached || !FM_TRACE_SESSION_MOVE) return;
  document.addEventListener(
    'click',
    event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const inMoveScope = target.closest('[data-session-move-calendar], [data-session-move-day], [data-session-move-confirm-modal]');
      if (!inMoveScope) return;
      traceSessionMove('document capture click', {
        target: describeEventTarget(target),
        inMoveScope: inMoveScope.getAttribute('data-session-move-day') !== null
          ? 'day'
          : inMoveScope.getAttribute('data-session-move-confirm-modal') !== null
            ? 'confirm'
            : 'calendar'
      });
    },
    true
  );
  sessionMoveDebugListenersAttached = true;
}

function setElementVisibility(element, visible, displayClass = 'flex') {
  if (!element) return;
  element.classList.remove(...PANEL_DISPLAY_CLASSES);
  if (visible) {
    element.removeAttribute('hidden');
    element.classList.add(displayClass);
    element.style.display = displayClass === 'block' ? 'block' : 'flex';
    return;
  }
  element.setAttribute('hidden', '');
  element.classList.add('hidden');
  element.style.display = 'none';
}

function debugPanelStates(container, reason = '') {
  if (!FM_DEV_LOGS) return;
  const root = getRoot(container);
  if (!root) return;
  const snapshot = {};
  [VIEW_LIST, VIEW_DASHBOARD, VIEW_EDIT].forEach(name => {
    const panel = root.querySelector(`[data-panel="${name}"]`);
    if (!panel) {
      snapshot[name] = { missing: true };
      return;
    }
    const style = window.getComputedStyle(panel);
    snapshot[name] = {
      hiddenAttr: panel.hasAttribute('hidden'),
      display: style.display,
      visibility: style.visibility,
      inlineDisplay: panel.style.display || '',
      className: panel.className,
      hasHiddenClass: panel.classList.contains('hidden'),
      hasFlexClass: panel.classList.contains('flex'),
      hasBlockClass: panel.classList.contains('block')
    };
  });
  logDev('[FM] panel states', reason, snapshot);
}

function normalizeView(viewName, currentType = getCurrentFormType()) {
  void currentType;
  return VIEW_VALUES.has(viewName) ? viewName : VIEW_LIST;
}

function setView(viewName, container) {
  const root = getRoot(container);
  if (!root) return;
  const nextView = normalizeView(viewName);
  state.view = nextView;
  root.querySelectorAll('[data-panel]').forEach(panel => {
    const shouldShow = panel.dataset.panel === nextView;
    const displayClass = panel.dataset.panelDisplay || 'flex';
    setElementVisibility(panel, shouldShow, displayClass);
  });
  setElementVisibility(root.querySelector('[data-list-header]'), nextView === VIEW_LIST, 'flex');
  debugPanelStates(root, `setView:${nextView}`);
}

function syncViewVisibility(container) {
  setView(state.view, container);
}

function normalizeCatalogTab(tabName) {
  return CATALOG_TAB_VALUES.has(tabName) ? tabName : CATALOG_TAB_MAIN;
}

function setCatalogTab(tabName, container, { forceHistoryReload = false } = {}) {
  const root = getRoot(container);
  if (!root) return;
  const nextTab = normalizeCatalogTab(tabName);
  state.catalogTab = nextTab;
  root.querySelectorAll('[data-catalog-panel]').forEach(panel => {
    const shouldShow = panel.dataset.catalogPanel === nextTab;
    const displayClass = panel.dataset.panelDisplay || 'block';
    setElementVisibility(panel, shouldShow, displayClass);
  });
  root.querySelectorAll('[data-catalog-tab]').forEach(button => {
    const isActive = button.dataset.tab === nextTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (nextTab === CATALOG_TAB_HISTORY) {
    renderDeletedHistory(root);
    void fetchDeletedFormationHistory(root, { force: forceHistoryReload });
    return;
  }
  syncViewVisibility(root);
}

function openEditView({ reset = false } = {}) {
  const root = getRoot();
  setView(VIEW_EDIT, root);
  if (reset) {
    resetForm();
    resetModuleForm();
    resetSessionForm();
    state.activeFormationId = null;
    state.editorTab = EDITOR_TAB_INFO;
  }
  syncTypeManagedSections(root);
  setEditorTab(state.editorTab, root);
  const firstInput = document.querySelector('[data-formation-form] input[name="name"]');
  firstInput?.focus();
}

function backToListView() {
  const root = getRoot();
  resetModuleDragState();
  teardownModuleDragListeners();
  clearModuleDragIndicator();
  releaseModuleDragMirror();
  closeAllModuleKebabs(root);
  closeAllModuleEditorKebabs(root);
  resetModuleForm();
  setModuleView(MODULE_PANEL_LIST, root);
  setView(VIEW_LIST, root);
  closeFormationMetaKebab();
  closeStatusPicker(root?.querySelector('[data-formation-form]'));
  closeTrailerModal();
  closeWhatsappModal();
  closeFileRenameModal();
  closeFormationPromotionModal(root);
  closeFormationBoostModal(root);
  closeSessionTimePicker();
  closeSessionConflictModal();
  resetSessionMoveState();
  state.editorTab = EDITOR_TAB_INFO;
  state.dismissedPromotionFormationId = null;
  state.planningTab = PLANNING_TAB_CALENDAR;
  state.planningSessionView = 'list';
  state.planningEditingSessionId = null;
  state.planningSessionKebabId = null;
  closePlanningSessionKebabs(root);
  state.activeFormationId = null;
  state.editingId = null;
  state.dashboardSaleDetailId = null;
  state.dashboardTab = DASHBOARD_TAB_SALES;
  state.dashboardPeriod = 'month';
  state.dashboardPeriodPickerOpen = false;
  state.dashboardReferenceDate = new Date();
  state.sessionModal.open = false;
  state.sessionModal.dateKey = null;
  state.sessionModal.sessionId = null;
  state.sessionExternalFormationsId = null;
  state.sessionExternalSessions = [];
  state.sessionExternalRequestInFlight = null;
  closeDeletedHistoryClientsModal(root, { immediate: true });
  closeModalOverlay(root?.querySelector('[data-type-warning-modal]'), { immediate: true });
  closeModalOverlay(root?.querySelector('[data-session-create-modal]'), { immediate: true });
  closeModalOverlay(root?.querySelector('[data-session-detail-modal]'), { immediate: true });
  closeModalOverlay(root?.querySelector('[data-session-conflict-modal]'), { immediate: true });
}

function attachViewSwitchEvents(container) {
  const root = getRoot(container);
  root
    ?.querySelectorAll('[data-action="open-create"]')
    .forEach(button =>
      button.addEventListener('click', () => {
        setCatalogTab(CATALOG_TAB_MAIN, root);
        openEditView({ reset: true });
      })
    );
  root
    ?.querySelectorAll('[data-action="back-to-list"]')
    .forEach(button =>
      button.addEventListener('click', () => {
        setCatalogTab(CATALOG_TAB_MAIN, root);
        backToListView();
      })
    );
}

function getEditorTypeTab(currentType = getCurrentFormType()) {
  return currentType === 'presentiel' ? EDITOR_TAB_PLANNING : EDITOR_TAB_MODULES;
}

function syncEditorCreationNotice(container) {
  const root = getRoot(container);
  if (!root) return;
  const notice = root.querySelector('[data-editor-create-notice]');
  const message = root.querySelector('[data-editor-create-notice-message]');
  if (!notice || !message) return;
  const isCreationMode = !state.editingId;
  const currentType = getCurrentFormType();
  const typeFeatureLabel = currentType === 'presentiel' ? 'le planning' : 'les modules';
  message.textContent = `Vous pourrez gerer ${typeFeatureLabel}, les promotions et le boost une fois la formation sauvegardée avec les informations générales remplies.`;
  notice.hidden = !isCreationMode;
}

function normalizeEditorTab(tabName, container) {
  const root = getRoot(container);
  const requested = EDITOR_TAB_VALUES.has(tabName) ? tabName : EDITOR_TAB_INFO;
  const currentType = getCurrentFormType();
  const hasFormationId = Boolean(state.editingId);
  if (requested !== EDITOR_TAB_INFO && !hasFormationId) {
    return EDITOR_TAB_INFO;
  }
  if (requested === EDITOR_TAB_MODULES && currentType !== 'distanciel') {
    return EDITOR_TAB_INFO;
  }
  if (requested === EDITOR_TAB_PLANNING && currentType !== 'presentiel') {
    return EDITOR_TAB_INFO;
  }
  if (!root?.querySelector(`[data-editor-panel="${requested}"]`)) {
    return EDITOR_TAB_INFO;
  }
  return requested;
}

const TAB_SCROLL_EPSILON = 2;

function updateTabsScrollToggle(nav, track) {
  if (!nav || !track) return;
  const toggle = nav.querySelector('[data-tabs-scroll-toggle]');
  if (!toggle) return;
  const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
  if (maxScrollLeft <= TAB_SCROLL_EPSILON) {
    toggle.hidden = true;
    toggle.dataset.direction = 'right';
    toggle.textContent = '›';
    return;
  }
  const atEnd = track.scrollLeft >= maxScrollLeft - TAB_SCROLL_EPSILON;
  const direction = atEnd ? 'left' : 'right';
  toggle.hidden = false;
  toggle.dataset.direction = direction;
  toggle.textContent = direction === 'right' ? '›' : '‹';
  toggle.setAttribute(
    'aria-label',
    direction === 'right' ? 'Afficher les onglets à droite' : 'Revenir aux onglets de gauche'
  );
}

function attachTabsScrollToggle(nav, track, onAfterScroll) {
  if (!nav || !track) return;
  const toggle = nav.querySelector('[data-tabs-scroll-toggle]');
  if (!toggle) return;
  if (toggle.dataset.bound !== 'true') {
    toggle.dataset.bound = 'true';
    toggle.addEventListener('click', () => {
      const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
      if (maxScrollLeft <= TAB_SCROLL_EPSILON) return;
      const direction = toggle.dataset.direction === 'left' ? 'left' : 'right';
      const targetLeft = direction === 'left' ? 0 : maxScrollLeft;
      track.scrollTo({ left: targetLeft, behavior: 'smooth' });
      window.setTimeout(() => {
        if (typeof onAfterScroll === 'function') {
          onAfterScroll();
        } else {
          updateTabsScrollToggle(nav, track);
        }
      }, 220);
    });
  }
  updateTabsScrollToggle(nav, track);
}

function updateEditorTabArrow(container) {
  const root = getRoot(container);
  if (!root) return;
  const tabsNav = root.querySelector('[data-editor-tabs]');
  const arrow = root.querySelector('[data-editor-tab-arrow]');
  const track = root.querySelector('[data-editor-tabs-track]');
  if (!track) return;
  updateTabsScrollToggle(tabsNav, track);
  const activeButton = track?.querySelector('[data-editor-tab].is-active:not([hidden])');
  if (!arrow || !track || !activeButton) {
    return;
  }
  const arrowHalfWidth = 8;
  const nextX =
    track.offsetLeft +
    activeButton.offsetLeft -
    track.scrollLeft +
    activeButton.offsetWidth / 2 -
    arrowHalfWidth;
  arrow.style.transform = `translateX(${Math.max(0, Math.round(nextX))}px)`;
}

function ensureEditorTabResizeListener() {
  if (editorTabResizeListenerAttached) return;
  window.addEventListener('resize', () => {
    updateEditorTabArrow();
    updatePlanningTabArrow();
    updateDashboardTabArrow();
  });
  editorTabResizeListenerAttached = true;
}

function setEditorTab(tabName, container) {
  const root = getRoot(container);
  if (!root) return;
  const nextTab = normalizeEditorTab(tabName, root);
  state.editorTab = nextTab;
  root.querySelectorAll('[data-editor-panel]').forEach(panel => {
    const shouldShow = panel.dataset.editorPanel === nextTab;
    const displayClass = panel.dataset.panelDisplay || 'block';
    setElementVisibility(panel, shouldShow, displayClass);
  });
  root.querySelectorAll('[data-editor-tab]').forEach(button => {
    const isActive = button.dataset.editorTab === nextTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  requestAnimationFrame(() => updateEditorTabArrow(root));
  if (nextTab === EDITOR_TAB_PROMOTION && state.editingId) {
    void loadFormationPromotionState(state.editingId, root);
  }
  if (nextTab === EDITOR_TAB_BOOST) {
    syncCurrentFormationBoostState(root, { silent: true });
    void loadBoosts(root);
  }
  if (nextTab === EDITOR_TAB_MODULES && state.editingId) {
    state.selectedFormationId = state.editingId;
    state.moduleView = MODULE_PANEL_LIST;
    state.moduleOrderMode = false;
    setModuleView(MODULE_PANEL_LIST, root);
    renderModuleFormationOptions();
    renderModuleList();
    void fetchModulesForSelectedFormation(state.selectedFormationId);
  }
  if (nextTab === EDITOR_TAB_PLANNING && state.editingId) {
    state.selectedPresentielId = state.editingId;
    state.planningSessionView = 'list';
    state.planningEditingSessionId = null;
    renderSessionList();
    renderSessionCalendar();
    setPlanningSessionView('list');
    setPlanningTab(state.planningTab || PLANNING_TAB_CALENDAR, root);
    void fetchSessionsForSelectedPresentiel(state.selectedPresentielId);
  }
  if (nextTab === EDITOR_TAB_OPTIONS && state.editingId) {
    void loadFormationOptions(state.editingId, root);
  }
}

function syncEditorTabs(container) {
  const root = getRoot(container);
  if (!root) return;
  const currentType = getCurrentFormType();
  const hasFormationId = Boolean(state.editingId);
  root.querySelectorAll('[data-editor-tab]').forEach(button => {
    const tabName = button.dataset.editorTab;
    const requiresId = button.hasAttribute('data-requires-id');
    let hidden = false;
    if (requiresId && !hasFormationId) {
      hidden = true;
    }
    if (tabName === EDITOR_TAB_MODULES) {
      hidden = hidden || currentType !== 'distanciel';
    }
    if (tabName === EDITOR_TAB_PLANNING) {
      hidden = hidden || currentType !== 'presentiel';
    }
    if (tabName === EDITOR_TAB_OPTIONS) {
      hidden = hidden || currentType !== 'presentiel';
    }
    button.hidden = hidden;
    const disabled = false;
    button.disabled = disabled;
    button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    button.removeAttribute('title');
  });
  if (
    state.editorTab === EDITOR_TAB_MODULES &&
    currentType !== 'distanciel'
  ) {
    state.editorTab = EDITOR_TAB_INFO;
  }
  if (
    state.editorTab === EDITOR_TAB_PLANNING &&
    currentType !== 'presentiel'
  ) {
    state.editorTab = EDITOR_TAB_INFO;
  }
  if (
    state.editorTab === EDITOR_TAB_OPTIONS &&
    currentType !== 'presentiel'
  ) {
    state.editorTab = EDITOR_TAB_INFO;
  }
  if (!hasFormationId && state.editorTab !== EDITOR_TAB_INFO) {
    state.editorTab = EDITOR_TAB_INFO;
  }
  syncEditorCreationNotice(root);
  setEditorTab(state.editorTab, root);
}

function handleEditorTabClick(event) {
  const button = event.target.closest('[data-editor-tab]');
  if (!button) return;
  event.preventDefault();
  if (button.disabled || button.hidden) {
    const feedback = document.querySelector('[data-formation-form-message]');
    showFeedback(feedback, "Enregistrez d'abord la formation.", 'info');
    return;
  }
  setEditorTab(button.dataset.editorTab, button.closest('[data-module-root]'));
}

function attachEditorTabEvents(container) {
  const root = getRoot(container);
  if (!root) return;
  const track = root.querySelector('[data-editor-tabs-track]');
  track?.addEventListener('click', handleEditorTabClick);
  track?.addEventListener('scroll', () => updateEditorTabArrow(root), { passive: true });
  attachTabsScrollToggle(root.querySelector('[data-editor-tabs]'), track, () => updateEditorTabArrow(root));
  ensureEditorTabResizeListener();
}

function getPlanningTabsRoot(container) {
  const root = getRoot(container);
  return root?.querySelector('[data-planning-tabs-root]') || null;
}

function normalizePlanningTab(tabName) {
  return PLANNING_TAB_VALUES.has(tabName) ? tabName : PLANNING_TAB_CALENDAR;
}

function updatePlanningTabArrow(container) {
  const root = getRoot(container);
  if (!root) return;
  const tabsRoot = getPlanningTabsRoot(root);
  const tabsNav = tabsRoot?.querySelector('[data-planning-tabs]');
  const track = tabsRoot?.querySelector('[data-planning-tabs-track]');
  const arrow = tabsRoot?.querySelector('[data-planning-tab-arrow]');
  if (!track) return;
  updateTabsScrollToggle(tabsNav, track);
  const activeButton = track?.querySelector('[data-planning-tab].is-active:not([hidden])');
  if (!track || !arrow || !activeButton) return;
  const arrowHalfWidth = 8;
  const nextX =
    track.offsetLeft +
    activeButton.offsetLeft -
    track.scrollLeft +
    activeButton.offsetWidth / 2 -
    arrowHalfWidth;
  arrow.style.transform = `translateX(${Math.max(0, Math.round(nextX))}px)`;
}

function setPlanningTab(tabName, container) {
  const root = getRoot(container);
  if (!root) return;
  const nextTab = normalizePlanningTab(tabName);
  state.planningTab = nextTab;
  root.querySelectorAll('[data-planning-panel]').forEach(panel => {
    const shouldShow = panel.dataset.planningPanel === nextTab;
    const displayClass = panel.dataset.panelDisplay || 'block';
    setElementVisibility(panel, shouldShow, displayClass);
  });
  root.querySelectorAll('[data-planning-tab]').forEach(button => {
    const isActive = button.dataset.planningTab === nextTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (nextTab === PLANNING_TAB_SESSIONS) {
    if (state.planningSessionView === 'detail') {
      renderPlanningSessionDetail();
    } else {
      renderSessionList();
    }
  } else if (nextTab === PLANNING_TAB_CANCELED) {
    renderCanceledSessionList();
  } else {
    state.planningSessionKebabId = null;
    closePlanningSessionKebabs(root);
  }
  requestAnimationFrame(() => updatePlanningTabArrow(root));
}

function setPlanningSessionView(viewName, options = {}) {
  const root = getRoot();
  if (!root) return;
  closeSessionTimePicker();
  const nextView = viewName === 'detail' ? 'detail' : 'list';
  state.planningSessionView = nextView;
  if (nextView === 'detail') {
    state.planningEditingSessionId = options.sessionId || state.planningEditingSessionId;
  }
  if (nextView === 'list') {
    state.planningEditingSessionId = null;
    state.planningSessionKebabId = null;
  }
  const listPanel = root.querySelector('[data-planning-sessions-list]');
  const detailPanel = root.querySelector('[data-planning-sessions-detail]');
  setElementVisibility(listPanel, nextView === 'list', listPanel?.dataset.panelDisplay || 'block');
  setElementVisibility(detailPanel, nextView === 'detail', detailPanel?.dataset.panelDisplay || 'block');
  if (nextView === 'detail') {
    renderPlanningSessionDetail();
    return;
  }
  closePlanningSessionKebabs(root);
  renderSessionList();
}

function attachPlanningTabEvents(container) {
  const root = getRoot(container);
  if (!root) return;
  const track = root.querySelector('[data-planning-tabs-track]');
  track?.addEventListener('click', event => {
    const button = event.target.closest('[data-planning-tab]');
    if (!button) return;
    event.preventDefault();
    setPlanningTab(button.dataset.planningTab, root);
  });
  track?.addEventListener('scroll', () => updatePlanningTabArrow(root), { passive: true });
  attachTabsScrollToggle(root.querySelector('[data-planning-tabs]'), track, () => updatePlanningTabArrow(root));
}

function updateSecondaryActionsState(container) {
  const root = getRoot(container);
  if (!root) return;
  const needsIdButtons = root.querySelectorAll('[data-requires-id]');
  const disabled = !state.editingId;
  needsIdButtons.forEach(button => {
    button.disabled = disabled;
    button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (disabled) {
      button.title = 'Sauvegardez d abord la formation pour activer cette action.';
    } else {
      button.removeAttribute('title');
    }
  });
  const editorialButton = root.querySelector('[data-action="open-editorial"]');
  if (editorialButton) {
    editorialButton.disabled = disabled;
    editorialButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (disabled) {
      editorialButton.title = "Sauvegardez d'abord la formation pour modifier la description.";
    } else {
      editorialButton.removeAttribute('title');
    }
  }
  syncEditorTabs(root);
}

function syncTypeManagedSections(container) {
  const root = getRoot(container);
  if (!root) return;
  const currentType = getCurrentFormType();
  if (currentType === 'distanciel') {
    if (state.editingId) {
      state.selectedFormationId = state.editingId;
      renderModuleFormationOptions();
      renderModuleList();
    } else {
      state.selectedFormationId = null;
      state.modules = [];
      renderModuleFormationOptions();
      renderModuleList();
    }
  }
  if (currentType === 'presentiel') {
    if (state.editingId) {
      state.selectedPresentielId = state.editingId;
      const durationInput = document.querySelector('[data-formation-form] [name="durationDays"]');
      const parsedDuration = Number(durationInput?.value);
      if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
        state.sessionDurationDays = Math.max(1, Math.floor(parsedDuration));
      }
      renderSessionFormationOptions();
      renderSessionList();
      renderSessionCalendar();
    } else {
      state.selectedPresentielId = null;
      state.sessions = [];
      renderSessionFormationOptions();
      renderSessionList();
      renderSessionCalendar();
    }
  }
  updateTypeToggleUI(root.querySelector('[data-formation-form]'));
  syncEditorTabs(root);
  updateSecondaryActionsState(root);
  setView(state.view, root);
}

const MODULES_FOR_FORMATION_ENDPOINT = formationId => `${MODULES_ROOT}/formations/${formationId}/modules`;
const MODULE_ENDPOINT = moduleId => `${MODULES_ROOT}/modules/${moduleId}`;
const MODULE_FILE_ENDPOINT = (moduleId, fileId) => `${MODULE_ENDPOINT(moduleId)}/files/${fileId}`;
const SESSION_ITEM_ENDPOINT = (formationId, sessionId) =>
  `${MODULES_ROOT}/formations/${formationId}/sessions/${sessionId}`;
const MODAL_VISIBLE_CLASS = 'module-modal-overlay--visible';
const MODAL_TRANSITION_MS = 180;

function openModalOverlay(overlay) {
  if (!overlay) return;
  const hideTimerId = Number(overlay.dataset.hideTimerId || 0);
  if (hideTimerId) {
    window.clearTimeout(hideTimerId);
    overlay.removeAttribute('data-hide-timer-id');
  }
  overlay.removeAttribute('hidden');
  requestAnimationFrame(() => {
    overlay.classList.add(MODAL_VISIBLE_CLASS);
  });
  overlay.focus();
}

function closeModalOverlay(overlay, { immediate = false } = {}) {
  if (!overlay) return;
  const hide = () => {
    overlay.setAttribute('hidden', '');
    overlay.removeAttribute('data-hide-timer-id');
  };
  const hideTimerId = Number(overlay.dataset.hideTimerId || 0);
  if (hideTimerId) {
    window.clearTimeout(hideTimerId);
    overlay.removeAttribute('data-hide-timer-id');
  }
  overlay.classList.remove(MODAL_VISIBLE_CLASS);
  if (immediate) {
    hide();
    return;
  }
  const timerId = window.setTimeout(() => {
    if (!overlay.classList.contains(MODAL_VISIBLE_CLASS)) {
      hide();
    }
  }, MODAL_TRANSITION_MS);
  overlay.dataset.hideTimerId = String(timerId);
}

function getJson(response) {
  return response.json ? response.json() : Promise.resolve({});
}

function showFeedback(target, message, status = '') {
  if (!target) return;
  target.textContent = message || '';
  if (status) {
    target.dataset.status = status;
  } else {
    target.removeAttribute('data-status');
  }
}

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

function getCoverPreviewElement() {
  return document.querySelector('[data-cover-preview]');
}

function getFormationForm() {
  return document.querySelector('[data-formation-form]');
}

function getFormationFieldValue(name) {
  const form = getFormationForm();
  return String(form?.querySelector(`[name="${name}"]`)?.value || '').trim();
}

function setFormationFieldValue(name, value) {
  const form = getFormationForm();
  const field = form?.querySelector(`[name="${name}"]`);
  if (!field) return;
  field.value = value == null ? '' : String(value);
}

function updatePresentielOnlyFieldsVisibility(form = getFormationForm()) {
  const currentType = String(form?.querySelector('[name="type"]')?.value || 'distanciel');
  const show = currentType === 'presentiel';
  form?.querySelectorAll('[data-presentiel-only]').forEach(block => {
    block.hidden = !show;
  });
}

function getFormationStatusField() {
  return getFormationForm()?.querySelector('[name="status"]') || null;
}

function renderStatusPicker(form = getFormationForm()) {
  const status = getFormationStatusField()?.value || 'draft';
  const option = STATUS_OPTIONS.find(entry => entry.value === status) || STATUS_OPTIONS[0];
  const trigger = form?.querySelector('[data-status-picker-trigger]');
  const label = form?.querySelector('[data-status-picker-label]');
  if (label) {
    label.textContent = option?.label || 'Brouillon';
  }
  if (trigger) {
    trigger.dataset.value = option?.value || 'draft';
  }
  form?.querySelectorAll('[data-status-option]').forEach(button => {
    const isActive = button.dataset.value === (option?.value || 'draft');
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function openStatusPicker(form = getFormationForm()) {
  state.statusPickerOpen = true;
  form?.querySelector('[data-status-picker-trigger]')?.setAttribute('aria-expanded', 'true');
  form?.querySelector('[data-status-picker-menu]')?.removeAttribute('hidden');
  renderStatusPicker(form);
}

function closeStatusPicker(form = getFormationForm()) {
  state.statusPickerOpen = false;
  form?.querySelector('[data-status-picker-trigger]')?.setAttribute('aria-expanded', 'false');
  form?.querySelector('[data-status-picker-menu]')?.setAttribute('hidden', '');
}

function getTrailerMeta() {
  const url = getFormationFieldValue('trailerVideoUrl');
  const title = getFormationFieldValue('trailerVideoTitle') || 'Bande annonce';
  return { title, url };
}

function getWhatsappMeta() {
  const url = getFormationFieldValue('whatsappGroupUrl');
  const title = getFormationFieldValue('whatsappGroupTitle') || 'Groupe WhatsApp';
  return { title, url };
}

function setCoverPreview(url) {
  const preview = getCoverPreviewElement();
  if (!preview) return;
  if (!url) {
    preview.innerHTML = COVER_PREVIEW_EMPTY_STATE;
    return;
  }
  preview.innerHTML = `
    <div class="gmf-cover-filled">
      <img src="${escapeHtml(url)}" alt="Couverture de la formation" loading="lazy">
      <button type="button" class="gmf-compact-action" data-action="trigger-cover-upload">Modifier l image</button>
    </div>
  `;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTypeField() {
  return document.querySelector('[data-formation-form] [name="type"]');
}

function getCurrentFormType() {
  return getTypeField()?.value || 'distanciel';
}

function getEditingFormation() {
  if (!state.editingId) return null;
  return state.formations.find(entry => entry.id === state.editingId) || null;
}

function normalizeEntityId(value) {
  return String(value || '').trim();
}

function getFormationSoldCount(formation) {
  const soldCount = Number(formation?.soldCount);
  if (Number.isFinite(soldCount)) {
    return Math.max(0, Math.floor(soldCount));
  }
  const purchasers = Number(formation?.purchasedUsersCount);
  if (Number.isFinite(purchasers)) {
    return Math.max(0, Math.floor(purchasers));
  }
  return 0;
}

function isTypeLockedForFormation(formation) {
  return getFormationSoldCount(formation) > 0;
}

function renderTypeLockMessage(form, formation) {
  const target = form?.querySelector('[data-type-lock-message]');
  if (!target) return;
  const locked = isTypeLockedForFormation(formation);
  if (!locked) {
    target.hidden = true;
    target.textContent = '';
    return;
  }
  target.hidden = false;
  target.textContent =
    'Type verrouillé : cette formation a déjà été achetée. Créez une nouvelle formation pour proposer une autre version.';
}

function updateTypeToggleUI(form) {
  const scope = form || document.querySelector('[data-formation-form]');
  const activeValue = scope?.querySelector('[name="type"]')?.value || 'distanciel';
  const buttons = scope?.querySelectorAll('[data-type-option]');
  buttons?.forEach(button => {
    const isActive = button.dataset.typeOption === activeValue;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  const label = scope?.querySelector('[data-type-label]');
  if (label) {
    label.textContent = TYPE_LABELS[activeValue] || activeValue;
  }
  const locked = isTypeLockedForFormation(getEditingFormation());
  buttons?.forEach(button => {
    button.disabled = locked;
    button.setAttribute('aria-disabled', locked ? 'true' : 'false');
  });
  renderTypeLockMessage(scope, getEditingFormation());
  updatePresentielOnlyFieldsVisibility(scope);
}

async function applyStatusChange(nextStatus, { confirmChange = true } = {}) {
  const option = STATUS_OPTIONS.find(entry => entry.value === nextStatus);
  if (!option) return;
  const field = getFormationStatusField();
  if (!field) return;
  const currentStatus = field.value || 'draft';
  if (currentStatus === nextStatus) {
    closeStatusPicker();
    return;
  }
  if (confirmChange) {
    const confirmed = await confirmAction({
      title: 'Confirmer le changement de statut ?',
      message: `Le statut passera sur "${option.label}".`,
      confirmLabel: 'Confirmer'
    });
    if (!confirmed) {
      closeStatusPicker();
      return;
    }
  }
  field.value = nextStatus;
  renderStatusPicker();
  closeStatusPicker();
}

function hasDistancielDataToLose() {
  return (
    Boolean(state.editingId) &&
    state.selectedFormationId === state.editingId &&
    Array.isArray(state.modules) &&
    state.modules.length > 0
  );
}

function hasPresentielDataToLose() {
  return (
    Boolean(state.editingId) &&
    state.selectedPresentielId === state.editingId &&
    Array.isArray(state.sessions) &&
    state.sessions.length > 0
  );
}

function requiresTypeWarning(currentType, nextType) {
  if (currentType === nextType) return false;
  if (currentType === 'distanciel' && nextType === 'presentiel') {
    return hasDistancielDataToLose();
  }
  if (currentType === 'presentiel' && nextType === 'distanciel') {
    return hasPresentielDataToLose();
  }
  return false;
}

function clearTypeSpecificData(previousType) {
  if (previousType === 'distanciel') {
    if (state.selectedFormationId === state.editingId) {
      state.selectedFormationId = null;
    }
    state.modules = [];
    resetModuleDragState();
    teardownModuleDragListeners();
    clearModuleDragIndicator();
    releaseModuleDragMirror();
    closeAllModuleKebabs();
    setModuleView(MODULE_PANEL_LIST);
    renderModuleList();
  }
  if (previousType === 'presentiel') {
    if (state.selectedPresentielId === state.editingId) {
      state.selectedPresentielId = null;
    }
    state.sessions = [];
    state.sessionSelectedDates = [];
    renderSessionList();
    renderSessionCalendar();
    closeSessionDetailModal();
  }
}

function applyTypeChange(nextType, { resetLinkedData = false, previousType } = {}) {
  const form = document.querySelector('[data-formation-form]');
  const typeField = form?.querySelector('[name="type"]');
  if (typeField) {
    typeField.value = nextType;
  }
  if (resetLinkedData) {
    clearTypeSpecificData(previousType || getCurrentFormType());
  }
  updateTypeToggleUI(form);
  syncTypeManagedSections(form?.closest('[data-module-root]'));
}

function openTypeWarningModal(nextType, currentType) {
  const overlay = document.querySelector('[data-type-warning-modal]');
  if (!overlay) {
    applyTypeChange(nextType, { previousType: currentType, resetLinkedData: true });
    return;
  }
  state.pendingTypeChange = { nextType, currentType };
  const text = overlay.querySelector('[data-type-warning-text]');
  if (text) {
    const losing = currentType === 'distanciel' ? 'distancielle' : 'presentielle';
    text.textContent = `Attention : si vous changez le type, les donnees actuelles de votre formation ${losing} seront perdues.`;
  }
  openModalOverlay(overlay);
}

function closeTypeWarningModal() {
  const overlay = document.querySelector('[data-type-warning-modal]');
  if (!overlay) return;
  closeModalOverlay(overlay);
  state.pendingTypeChange = null;
}

function confirmTypeWarningChange() {
  const nextType = state.pendingTypeChange?.nextType;
  const previousType = state.pendingTypeChange?.currentType || getCurrentFormType();
  closeTypeWarningModal();
  if (!nextType) return;
  applyTypeChange(nextType, { resetLinkedData: true, previousType });
}

function handleTypeToggleClick(event) {
  const button = event.target.closest('[data-type-option]');
  if (!button) return;
  event.preventDefault();
  const nextType = button.dataset.typeOption;
  const currentType = getCurrentFormType();
  const editingFormation = getEditingFormation();
  if (isTypeLockedForFormation(editingFormation)) {
    renderTypeLockMessage(document.querySelector('[data-formation-form]'), editingFormation);
    return;
  }
  if (!nextType || nextType === currentType) {
    return;
  }
  if (requiresTypeWarning(currentType, nextType)) {
    openTypeWarningModal(nextType, currentType);
    return;
  }
  applyTypeChange(nextType, { previousType: currentType, resetLinkedData: false });
}

function attachTypeToggleEvents(container) {
  const root = getRoot(container);
  const toggle = root?.querySelector('[data-type-toggle]');
  toggle?.addEventListener('click', handleTypeToggleClick);
  const warning = root?.querySelector('[data-type-warning-modal]');
  warning?.addEventListener('click', event => {
    if (event.target === warning) {
      closeTypeWarningModal();
    }
  });
  warning?.querySelector('[data-action=\"cancel-type-warning\"]')?.addEventListener('click', event => {
    event.preventDefault();
    closeTypeWarningModal();
  });
  warning?.querySelector('[data-action=\"confirm-type-warning\"]')?.addEventListener('click', event => {
    event.preventDefault();
    confirmTypeWarningChange();
  });
}


function showCoverUploadFeedback(message, status = '') {
  const target = document.querySelector('[data-cover-upload-message]');
  if (!target) return;
  target.textContent = message || '';
  if (status) {
    target.dataset.status = status;
  } else {
    target.removeAttribute('data-status');
  }
}

async function uploadCoverImage(file) {
  const formData = new FormData();
  formData.append('coverImage', file);
  const response = await fetch(COVER_UPLOAD_ENDPOINT, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
  const payload = await getJson(response);
  if (!response.ok) {
    const error = payload?.error || 'Impossible de charger la couverture.';
    throw new Error(error);
  }
  if (!payload?.coverImage) {
    throw new Error('R?ponse invalide du serveur.');
  }
  return payload.coverImage;
}

function attachCoverUploader(container) {
  const form = container.querySelector('[data-formation-form]');
  const fileInput = form?.querySelector('[name="coverImageFile"]');
  const coverField = form?.querySelector('[name="coverImage"]');
  if (!fileInput) return;
  if (fileInput.dataset.bound === 'true') return;
  fileInput.dataset.bound = 'true';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      showCoverUploadFeedback('');
      return;
    }
    if (file.size > COVER_UPLOAD_MAX_SIZE) {
      showCoverUploadFeedback('Fichier trop volumineux (max 5 Mo).', 'error');
      fileInput.value = '';
      return;
    }
    showCoverUploadFeedback('Upload en cours...', 'loading');
    try {
      const coverUrl = await uploadCoverImage(file);
      if (coverField) {
        coverField.value = coverUrl;
      }
      setCoverPreview(coverUrl);
      showCoverUploadFeedback('Couverture enregistr?e.', 'success');
      showToast({ type: 'success', message: ACTION_TOAST_SUCCESS, durationMs: 1000 });
    } catch (error) {
      logUiError('FormationManager:UploadCover', error, {
        fileName: file?.name || '',
        fileSize: file?.size || 0
      });
      showToast({ type: 'error', message: ACTION_TOAST_ERROR, durationMs: 1000 });
      showCoverUploadFeedback(error.message || "Erreur lors de l'upload.", 'error');
    } finally {
      fileInput.value = '';
    }
  });
}

function closeFormationMetaKebab() {
  state.formationMetaKebab = null;
  const root = getRoot();
  root?.querySelectorAll('[data-formation-meta-menu]').forEach(menu => {
    menu.classList.remove('is-open');
    menu.setAttribute('hidden', '');
  });
}

function toggleFormationMetaKebab(kind) {
  const root = getRoot();
  if (!root || !kind) return;
  const menu = root.querySelector(`[data-formation-meta-menu="${kind}"]`);
  if (!menu) return;
  const willOpen = state.formationMetaKebab !== kind;
  closeFormationMetaKebab();
  if (!willOpen) return;
  menu.removeAttribute('hidden');
  requestAnimationFrame(() => menu.classList.add('is-open'));
  state.formationMetaKebab = kind;
}

function renderTrailerBlock() {
  const container = document.querySelector('[data-trailer-content]');
  if (!container) return;
  const trailer = getTrailerMeta();
  if (!trailer.url) {
    container.innerHTML = `
      <div class="gmf-meta-empty">
        <i class="bi bi-camera-video"></i>
        <p>Vous n’avez actuellement aucune bande-annonce pour cette formation.</p>
        <button type="button" class="gmf-compact-action" data-action="open-trailer-modal-create">Ajouter une bande-annonce</button>
      </div>
    `;
    return;
  }
  const menuOpen = state.formationMetaKebab === 'trailer';
  container.innerHTML = `
    <article class="gmf-meta-card">
      <div class="gmf-meta-card__main">
        <i class="bi bi-camera-video"></i>
        <div class="gmf-meta-card__text">
          <p class="gmf-meta-card__title">${escapeHtml(trailer.title || 'Bande-annonce')}</p>
          <p class="gmf-meta-card__subline">${escapeHtml(trailer.url)}</p>
        </div>
      </div>
      <div class="formation-card__actions">
        <button type="button" class="kebab-button" data-action="toggle-formation-meta-kebab" data-kind="trailer" aria-label="Actions bande-annonce">
          <span aria-hidden="true">⋮</span>
        </button>
        <div class="formation-card__menu ${menuOpen ? 'is-open' : ''}" data-formation-meta-menu="trailer" ${menuOpen ? '' : 'hidden'}>
          <button type="button" data-action="open-trailer-modal-edit" aria-label="Modifier"><i class="bi bi-pencil"></i></button>
          <button type="button" data-action="delete-trailer-meta" aria-label="Supprimer"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </article>
  `;
}

function renderWhatsappBlock() {
  const container = document.querySelector('[data-whatsapp-content]');
  if (!container) return;
  const whatsapp = getWhatsappMeta();
  if (!whatsapp.url) {
    container.innerHTML = `
      <div class="gmf-meta-empty">
        <i class="bi bi-whatsapp"></i>
        <p>Vous n’avez actuellement aucun groupe WhatsApp pour cette formation.</p>
        <button type="button" class="gmf-compact-action" data-action="open-whatsapp-modal-create">Ajouter un groupe</button>
      </div>
    `;
    return;
  }
  const menuOpen = state.formationMetaKebab === 'whatsapp';
  container.innerHTML = `
    <article class="gmf-meta-card gmf-meta-card--whatsapp">
      <div class="gmf-meta-card__main">
        <i class="bi bi-whatsapp"></i>
        <div class="gmf-meta-card__text">
          <p class="gmf-meta-card__title">${escapeHtml(whatsapp.title || 'Groupe WhatsApp')}</p>
          <p class="gmf-meta-card__subline">${escapeHtml(whatsapp.url)}</p>
        </div>
      </div>
      <div class="formation-card__actions">
        <button type="button" class="kebab-button" data-action="toggle-formation-meta-kebab" data-kind="whatsapp" aria-label="Actions groupe WhatsApp">
          <span aria-hidden="true">⋮</span>
        </button>
        <div class="formation-card__menu ${menuOpen ? 'is-open' : ''}" data-formation-meta-menu="whatsapp" ${menuOpen ? '' : 'hidden'}>
          <button type="button" data-action="open-whatsapp-modal-edit" aria-label="Modifier"><i class="bi bi-pencil"></i></button>
          <button type="button" data-action="delete-whatsapp-meta" aria-label="Supprimer"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </article>
  `;
}

function renderFormationInfoWidgets() {
  const form = getFormationForm();
  setCoverPreview(getFormationFieldValue('coverImage'));
  renderTrailerBlock();
  renderWhatsappBlock();
  updatePresentielOnlyFieldsVisibility(form);
  renderStatusPicker(form);
}

function getTrailerModalOverlay() {
  return document.querySelector('[data-trailer-modal]');
}

function getWhatsappModalOverlay() {
  return document.querySelector('[data-whatsapp-modal]');
}

function openTrailerModal(mode = 'create') {
  const overlay = getTrailerModalOverlay();
  if (!overlay) return;
  const titleInput = overlay.querySelector('[name="trailerModalTitle"]');
  const urlInput = overlay.querySelector('[name="trailerModalUrl"]');
  const heading = overlay.querySelector('[data-trailer-modal-heading]');
  const trailer = getTrailerMeta();
  const isEdit = mode === 'edit' && Boolean(trailer.url);
  if (titleInput) titleInput.value = isEdit ? trailer.title : '';
  if (urlInput) urlInput.value = isEdit ? trailer.url : '';
  if (heading) heading.textContent = isEdit ? 'Modifier la bande-annonce' : 'Ajouter une bande-annonce';
  state.trailerModalOpen = true;
  openModalOverlay(overlay);
  requestAnimationFrame(() => titleInput?.focus());
}

function closeTrailerModal() {
  state.trailerModalOpen = false;
  closeModalOverlay(getTrailerModalOverlay());
}

function openWhatsappModal(mode = 'create') {
  const overlay = getWhatsappModalOverlay();
  if (!overlay) return;
  const titleInput = overlay.querySelector('[name="whatsappModalTitle"]');
  const urlInput = overlay.querySelector('[name="whatsappModalUrl"]');
  const heading = overlay.querySelector('[data-whatsapp-modal-heading]');
  const whatsapp = getWhatsappMeta();
  const isEdit = mode === 'edit' && Boolean(whatsapp.url);
  if (titleInput) titleInput.value = isEdit ? whatsapp.title : '';
  if (urlInput) urlInput.value = isEdit ? whatsapp.url : '';
  if (heading) heading.textContent = isEdit ? 'Modifier le groupe WhatsApp' : 'Ajouter un groupe WhatsApp';
  state.whatsappModalOpen = true;
  openModalOverlay(overlay);
  requestAnimationFrame(() => titleInput?.focus());
}

function closeWhatsappModal() {
  state.whatsappModalOpen = false;
  closeModalOverlay(getWhatsappModalOverlay());
}

function saveTrailerModal() {
  const overlay = getTrailerModalOverlay();
  const title = String(overlay?.querySelector('[name="trailerModalTitle"]')?.value || '').trim();
  const url = String(overlay?.querySelector('[name="trailerModalUrl"]')?.value || '').trim();
  if (!url) {
    showFeedback(document.querySelector('[data-formation-form-message]'), 'URL de bande-annonce requise.', 'error');
    return;
  }
  setFormationFieldValue('trailerVideoTitle', title || 'Bande-annonce');
  setFormationFieldValue('trailerVideoUrl', url);
  closeTrailerModal();
  closeFormationMetaKebab();
  renderTrailerBlock();
}

function saveWhatsappModal() {
  const overlay = getWhatsappModalOverlay();
  const title = String(overlay?.querySelector('[name="whatsappModalTitle"]')?.value || '').trim();
  const url = String(overlay?.querySelector('[name="whatsappModalUrl"]')?.value || '').trim();
  if (!url) {
    showFeedback(document.querySelector('[data-formation-form-message]'), 'Lien WhatsApp requis.', 'error');
    return;
  }
  setFormationFieldValue('whatsappGroupTitle', title || 'Groupe WhatsApp');
  setFormationFieldValue('whatsappGroupUrl', url);
  closeWhatsappModal();
  closeFormationMetaKebab();
  renderWhatsappBlock();
}

async function deleteTrailerMeta() {
  const confirmed = await confirmAction({
    title: 'Supprimer la bande-annonce ?',
    message: 'Cette bande-annonce ne sera plus affichée avant achat.',
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!confirmed) return;
  setFormationFieldValue('trailerVideoTitle', '');
  setFormationFieldValue('trailerVideoUrl', '');
  closeFormationMetaKebab();
  renderTrailerBlock();
}

async function deleteWhatsappMeta() {
  const confirmed = await confirmAction({
    title: 'Supprimer le groupe WhatsApp ?',
    message: 'Le lien de groupe sera retire de la formation.',
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!confirmed) return;
  setFormationFieldValue('whatsappGroupTitle', '');
  setFormationFieldValue('whatsappGroupUrl', '');
  closeFormationMetaKebab();
  renderWhatsappBlock();
}

function formatStatus(status) {
  const entry = STATUS_OPTIONS.find(option => option.value === status);
  return entry ? entry.label : status || 'Inconnu';
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'Prix indisponible';
  }
  return `${number.toFixed(2)} EUR`;
}

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculatePromotionPreview(basePrice, discountType, discountValue) {
  const normalizedBase = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0;
  const normalizedDiscount = Number.isFinite(Number(discountValue)) ? Number(discountValue) : 0;
  let finalPrice = normalizedBase;
  if (
    normalizedDiscount > 0 &&
    (discountType === 'fixed' || discountType === 'percentage')
  ) {
    if (discountType === 'percentage') {
      finalPrice = normalizedBase - (normalizedBase * normalizedDiscount) / 100;
    } else {
      finalPrice = normalizedBase - normalizedDiscount;
    }
  }
  finalPrice = Math.max(0, roundToCents(finalPrice));
  return {
    basePrice: roundToCents(normalizedBase),
    finalPrice
  };
}

function parsePromotionDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizePromotionEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    id: entry.id || entry._id || null,
    discountType: entry.discountType === 'fixed' ? 'fixed' : 'percentage',
    discountValue: Number.isFinite(Number(entry.discountValue)) ? Number(entry.discountValue) : 0,
    startAt: entry.startAt || null,
    endAt: entry.endAt || null,
    enabled: entry.enabled !== false
  };
}

function isPromotionActiveNow(entry, now = new Date()) {
  if (!entry || entry.enabled === false) return false;
  const startAt = parsePromotionDate(entry.startAt);
  const endAt = parsePromotionDate(entry.endAt);
  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
}

function getActivePromotion(entity, now = new Date()) {
  const backendActive = normalizePromotionEntry(entity?.activePromotion || null);
  if (backendActive) {
    return backendActive;
  }
  const list = Array.isArray(entity?.promotions)
    ? entity.promotions.map(normalizePromotionEntry).filter(Boolean)
    : [];
  if (!list.length) return null;
  const activeEntries = list.filter(entry => isPromotionActiveNow(entry, now));
  if (!activeEntries.length) return null;
  activeEntries.sort((a, b) => {
    const aStart = parsePromotionDate(a.startAt)?.getTime() || 0;
    const bStart = parsePromotionDate(b.startAt)?.getTime() || 0;
    return bStart - aStart;
  });
  return activeEntries[0] || null;
}

function formatPromotionLabel(promotion) {
  if (!promotion) return '';
  const valueLabel =
    promotion.discountType === 'percentage'
      ? `${promotion.discountValue}%`
      : formatPrice(promotion.discountValue);
  const start = promotion.startAt ? new Date(promotion.startAt).toLocaleString() : null;
  const end = promotion.endAt ? new Date(promotion.endAt).toLocaleString() : null;
  if (start && end) {
    return `${valueLabel} du ${start} au ${end}`;
  }
  if (end) {
    return `${valueLabel} jusqu'au ${end}`;
  }
  if (start) {
    return `${valueLabel} à partir du ${start}`;
  }
  return `${valueLabel} (promotion en cours)`;
}

function formatPromotionBadgeLabel(promotion) {
  if (!promotion) return '';
  return promotion.discountType === 'percentage'
    ? `-${Number(promotion.discountValue || 0)}%`
    : `-${formatPrice(promotion.discountValue || 0)}`;
}

function formatPromotionDetailTypeLabel(promotion) {
  if (!promotion) return '';
  return promotion.discountType === 'percentage'
    ? `${Number(promotion.discountValue || 0)}%`
    : `${formatPrice(promotion.discountValue || 0)}`;
}

function renderFormationPromotionStatus(container, promotion) {
  if (!container) return;
  const target = container.querySelector('[data-formation-promotion-status]');
  if (!target) return;
  if (!promotion) {
    target.textContent = 'Aucune promotion active.';
    target.removeAttribute('data-status');
    return;
  }
  target.textContent = formatPromotionLabel(promotion);
  target.dataset.status = 'success';
}

function renderFormationPromotionCurrent(container, promotion = state.activePromotion) {
  if (!container) return;
  const target = container.querySelector('[data-formation-promotion-current]');
  if (!target) return;
  const basePriceInput = container.querySelector('[data-formation-form] [name="price"]');
  const basePrice = Number(basePriceInput?.value);
  const normalizedBasePrice = Number.isFinite(basePrice) ? basePrice : 0;
  if (!promotion) {
    target.innerHTML = `
      <article class="gmf-promotion-card gmf-promotion-card--empty">
        <div class="gmf-promotion-empty-state">
          <i class="bi bi-percent" aria-hidden="true"></i>
          <p>Aucune promotion active pour cette formation.</p>
          <button type="button" class="primary-button" data-action="open-formation-promotion-modal">
            Appliquer une promotion
          </button>
        </div>
      </article>
    `;
    return;
  }
  const preview = calculatePromotionPreview(
    normalizedBasePrice,
    promotion.discountType,
    promotion.discountValue
  );
  target.innerHTML = `
    <article class="gmf-promotion-card">
      <header class="gmf-promotion-card__header">
        <div>
          <p class="gmf-promotion-card__title">Promotion actuelle</p>
          <p class="gmf-promotion-card__period muted">${escapeHtml(formatPromotionLabel(promotion))}</p>
        </div>
        <span class="gmf-promotion-badge">${escapeHtml(formatPromotionBadgeLabel(promotion))}</span>
      </header>
      <div class="gmf-promotion-price">
        <p class="muted">Prix original : <s>${formatPrice(preview.basePrice)}</s></p>
        <p class="gmf-promotion-price__final">${formatPrice(preview.finalPrice)}</p>
      </div>
      <p class="muted">Type : ${promotion.discountType === 'percentage' ? 'Pourcentage' : 'Montant fixe'} · Valeur : ${escapeHtml(
    formatPromotionDetailTypeLabel(promotion)
  )}</p>
      <div class="form-actions">
        <button type="button" class="secondary-button" data-action="open-formation-promotion-modal">
          Modifier la promotion
        </button>
        <button type="button" class="danger-button" data-action="stop-formation-promotion"><i class="bi bi-stop-fill"></i> 
          Stopper la promotion
        </button>
      </div>
    </article>
  `;
}

function updateFormationPromotionPricePreview(container) {
  if (!container) return;
  const basePreview = container.querySelector('[data-formation-promotion-preview-base]');
  const finalPreview = container.querySelector('[data-formation-promotion-preview-final]');
  const form = container.querySelector('[data-formation-form]');
  const promotionForm = container.querySelector('[data-formation-promotion-form]');
  const modalBase = container.querySelector('[data-formation-promotion-modal-preview-base]');
  const modalFinal = container.querySelector('[data-formation-promotion-modal-preview-final]');
  if (!promotionForm) {
    renderFormationPromotionCurrent(container, state.activePromotion);
    return;
  }
  const baseValue = form?.querySelector('[name="price"]')?.value;
  const discountType = promotionForm?.querySelector('[name="discountType"]')?.value;
  const discountValue = promotionForm?.querySelector('[name="discountValue"]')?.value;
  const preview = calculatePromotionPreview(baseValue, discountType, discountValue);
  if (basePreview) {
    basePreview.innerHTML = `Prix actuel : <s>${formatPrice(preview.basePrice)}</s>`;
  }
  if (finalPreview) {
    finalPreview.textContent = `Prix après réduction : ${formatPrice(preview.finalPrice)}`;
  }
  if (modalBase) {
    modalBase.innerHTML = `Prix actuel : <s>${formatPrice(preview.basePrice)}</s>`;
  }
  if (modalFinal) {
    modalFinal.textContent = `Prix après réduction : ${formatPrice(preview.finalPrice)}`;
  }
  renderFormationPromotionCurrent(container, state.activePromotion);
}

function normalizeBoostItem(item) {
  const normalizedId = normalizeEntityId(item?.id || item?._id);
  const normalizedType = String(item?.type || '').trim().toLowerCase();
  if (!normalizedId || !normalizedType) {
    return null;
  }
  return {
    ...item,
    id: normalizedId,
    type: normalizedType,
    name: String(item?.name || '').trim(),
    coverImage: String(item?.coverImage || '').trim(),
    boostOrder: Number.isFinite(Number(item?.boostOrder)) ? Number(item.boostOrder) : null
  };
}

function getSortedBoostedItems(items = state.boostedItems) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeBoostItem)
    .filter(Boolean);
  normalized.sort((a, b) => {
    const orderA = Number.isFinite(Number(a.boostOrder)) ? Number(a.boostOrder) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(Number(b.boostOrder)) ? Number(b.boostOrder) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
  });
  return normalized;
}

function getCurrentFormationBoostEntry() {
  const currentFormationId = normalizeEntityId(state.editingId);
  if (!currentFormationId) return null;
  return (
    state.boostedItems.find(
      item =>
        item.type === 'formation' &&
        normalizeEntityId(item.id) === currentFormationId
    ) || null
  );
}

function syncCurrentFormationBoostState(container, { silent = false } = {}) {
  const root = getRoot(container);
  const currentFormationId = normalizeEntityId(state.editingId);
  const boostedFormationIds = state.boostedItems
    .filter(item => item.type === 'formation')
    .map(item => normalizeEntityId(item.id));
  const currentBoostEntry = getCurrentFormationBoostEntry();
  state.boostActive = Boolean(currentBoostEntry && currentFormationId);
  state.boostOrder = Number.isFinite(Number(currentBoostEntry?.boostOrder))
    ? Number(currentBoostEntry.boostOrder)
    : null;
  if (FM_DEV_LOGS && !silent) {
    console.debug('[FM][Boost] sync current formation', {
      currentFormationId,
      boostedFormationIds,
      boostActive: state.boostActive,
      boostOrder: state.boostOrder
    });
  }
  renderFormationBoostStatus(root, state.boostActive, state.boostOrder);
  updateFormationBoostButton(root, state.boostActive);
}

function getBoostCarouselItems() {
  const formations = state.boostedItems.filter(item => item.type === 'formation');
  return formations.slice(0, BOOST_LIMIT);
}

function renderFormationBoostStatus(container, isBoosted, order) {
  if (!container) return;
  const target = container.querySelector('[data-formation-boost-status]');
  const badge = container.querySelector('[data-formation-boost-badge]');
  if (badge) {
    badge.textContent = isBoosted ? 'BOOSTEE' : 'NON BOOSTEE';
    badge.dataset.active = isBoosted ? 'true' : 'false';
  }
  if (!target) return;
  if (!isBoosted) {
    target.textContent = 'Cette formation n est pas boostee. Vous pouvez la mettre en avant dans le top boost.';
    target.removeAttribute('data-status');
    return;
  }
  const orderLabel = Number.isFinite(Number(order)) ? Number(order) : 'N/A';
  target.textContent = `Cette formation est actuellement boostee (ordre ${orderLabel}).`;
  target.dataset.status = 'success';
}

function updateFormationBoostButton(container, isBoosted) {
  if (!container) return;
  const button = container.querySelector('[data-action="toggle-formation-boost"]');
  if (!button) return;
  button.classList.toggle('danger-button', isBoosted);
  button.classList.toggle('gmf-boost-stop-button', isBoosted);
  button.classList.toggle('gmf-compact-action', !isBoosted);
  button.innerHTML = isBoosted
    ? '<i class="bi bi-stop-circle"></i> Stopper le boost'
    : '<i class="bi bi-lightning-charge"></i> Booster la formation';
}

function shiftBoostCarousel(direction = 1, container) {
  const items = getBoostCarouselItems();
  if (!items.length) {
    state.boostCarouselIndex = 0;
    return;
  }
  const maxIndex = Math.max(0, items.length - BOOST_CAROUSEL_MIN_ITEMS);
  const next = Math.min(maxIndex, Math.max(0, state.boostCarouselIndex + Number(direction || 0)));
  state.boostCarouselIndex = next;
  renderBoostedList(container);
}

function renderBoostedList(container) {
  if (!container) return;
  const list = container.querySelector('[data-formation-boosted-list]');
  const counter = container.querySelector('[data-formation-boost-count]');
  if (counter) {
    counter.textContent = `Slots boost occupes : ${state.boostedItems.length}/${BOOST_LIMIT}`;
  }
  if (!list) return;
  if (state.boostsLoading) {
    list.innerHTML = '<p class="module-placeholder">Chargement des boosts...</p>';
    return;
  }
  const carouselItems = getBoostCarouselItems();
  if (!carouselItems.length) {
    state.boostCarouselIndex = 0;
    list.innerHTML = `
      <article class="gmf-boost-empty-state">
        <i class="bi bi-stars"></i>
        <p>Aucune formation boostee pour le moment.</p>
      </article>
    `;
    return;
  }
  const maxIndex = Math.max(0, carouselItems.length - BOOST_CAROUSEL_MIN_ITEMS);
  if (state.boostCarouselIndex > maxIndex) {
    state.boostCarouselIndex = maxIndex;
  }
  const offset = state.boostCarouselIndex * 100;
  list.innerHTML = `
    <div class="gmf-boost-carousel" data-formation-boost-carousel>
      <button
        type="button"
        class="gmf-boost-carousel__nav gmf-boost-carousel__nav--prev"
        data-action="boost-carousel-prev"
        aria-label="Formation boostee precedente"
        ${state.boostCarouselIndex <= 0 ? 'disabled' : ''}
      >
        <i class="bi bi-chevron-left"></i>
      </button>
      <div class="gmf-boost-carousel__viewport">
        <div class="gmf-boost-carousel__track" style="transform: translateX(-${offset}%);">
          ${carouselItems
            .map(item => {
              const coverMarkup = item.coverImage
                ? `<img src="${escapeHtml(item.coverImage)}" alt="${escapeHtml(item.name || 'Formation boostee')}">`
                : '<div class="gmf-boost-card__cover-empty"><i class="bi bi-card-image"></i></div>';
              return `
                <article class="gmf-boost-card">
                  <div class="gmf-boost-card__cover">${coverMarkup}</div>
                  <div class="gmf-boost-card__body">
                    <p class="gmf-boost-card__name">${escapeHtml(item.name || 'Sans titre')}</p>
                    <p class="muted">Ordre ${Number.isFinite(Number(item.boostOrder)) ? Number(item.boostOrder) : 'N/A'}</p>
                  </div>
                </article>
              `;
            })
            .join('')}
        </div>
      </div>
      <button
        type="button"
        class="gmf-boost-carousel__nav gmf-boost-carousel__nav--next"
        data-action="boost-carousel-next"
        aria-label="Formation boostee suivante"
        ${state.boostCarouselIndex >= maxIndex ? 'disabled' : ''}
      >
        <i class="bi bi-chevron-right"></i>
      </button>
    </div>
    <div class="gmf-boost-carousel__dots">
      ${carouselItems
        .map((item, index) => `
          <button
            type="button"
            class="gmf-boost-carousel__dot ${index === state.boostCarouselIndex ? 'is-active' : ''}"
            data-action="boost-carousel-goto"
            data-boost-index="${index}"
            aria-label="Aller au boost ${index + 1}: ${escapeHtml(item.name || 'Formation')}"
          ></button>
        `)
        .join('')}
    </div>
  `;
}

function getBoostReplacementCandidates() {
  const currentFormationId = normalizeEntityId(state.editingId);
  return state.boostedItems.filter(item => {
    if (item.type !== 'formation') return true;
    return normalizeEntityId(item.id) !== currentFormationId;
  });
}

function renderBoostModalList(container) {
  if (!container) return;
  const list = container.querySelector('[data-formation-boost-modal-list]');
  const confirmButton = container.querySelector('[data-action="confirm-replace-formation-boost"]');
  if (!list) return;
  if (state.boostsLoading) {
    list.innerHTML = '<p class="module-placeholder">Chargement des boosts...</p>';
    if (confirmButton) confirmButton.disabled = true;
    return;
  }
  const candidates = getBoostReplacementCandidates();
  if (!candidates.length) {
    list.innerHTML = '<p class="module-placeholder">Aucun boost a remplacer.</p>';
    if (confirmButton) confirmButton.disabled = true;
    return;
  }
  if (!state.boostReplaceSelection) {
    const first = candidates[0];
    state.boostReplaceSelection = {
      id: normalizeEntityId(first.id),
      type: String(first.type || '').trim().toLowerCase()
    };
  }
  list.innerHTML = candidates
    .map(item => {
      const selected =
        state.boostReplaceSelection &&
        normalizeEntityId(state.boostReplaceSelection.id) === normalizeEntityId(item.id) &&
        String(state.boostReplaceSelection.type || '').trim().toLowerCase() === String(item.type || '').trim().toLowerCase();
      const coverMarkup = item.coverImage
        ? `<img src="${escapeHtml(item.coverImage)}" alt="${escapeHtml(item.name || 'Element booste')}">`
        : '<div class="gmf-boost-replace-item__cover-empty"><i class="bi bi-card-image"></i></div>';
      return `
        <button
          type="button"
          class="gmf-boost-replace-item ${selected ? 'is-selected' : ''}"
          data-action="select-boost-replace-candidate"
          data-boost-id="${escapeHtml(item.id)}"
          data-boost-type="${escapeHtml(item.type)}"
        >
          <span class="gmf-boost-replace-item__cover">${coverMarkup}</span>
          <span class="gmf-boost-replace-item__meta">
            <strong>${escapeHtml(item.name || 'Sans titre')}</strong>
            <span class="muted">${item.type === 'formation' ? 'Formation' : 'Produit'} · ordre ${
              Number.isFinite(Number(item.boostOrder)) ? Number(item.boostOrder) : 'N/A'
            }</span>
          </span>
          <i class="bi ${selected ? 'bi-check-circle-fill' : 'bi-circle'}" aria-hidden="true"></i>
        </button>
      `;
    })
    .join('');
  if (confirmButton) {
    confirmButton.disabled = !state.boostReplaceSelection?.id;
  }
}

function setBoostsLoading(container, isLoading) {
  const root = getRoot(container);
  state.boostsLoading = Boolean(isLoading);
  if (!root) return;
  const feedback = root.querySelector('[data-formation-boost-message]');
  if (state.boostsLoading) {
    showFeedback(feedback, 'Chargement des boosts...', 'loading');
  } else if (feedback?.dataset.status === 'loading') {
    showFeedback(feedback, '', '');
  }
}

function isDevHost() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

async function loadBoosts(container, { force = false } = {}) {
  const root = getRoot(container);
  if (!root) return [];
  if (state.boostsRequestInFlight && !force) {
    return state.boostsRequestInFlight;
  }
  const request = (async () => {
    setBoostsLoading(root, true);
    renderBoostedList(root);
    renderBoostModalList(root);
    try {
      const response = await fetch(BOOST_ENDPOINT, { credentials: 'include' });
      const payload = await getJson(response);
      if (!response.ok) {
        throw new Error(payload?.error || 'Impossible de charger les boosts.');
      }
      state.boostedItems = getSortedBoostedItems(Array.isArray(payload.boosts) ? payload.boosts : []);
      syncCurrentFormationBoostState(root);
      if (FM_DEV_LOGS) {
        const currentFormationId = normalizeEntityId(state.editingId);
        const boostedIds = state.boostedItems
          .filter(item => item.type === 'formation')
          .map(item => normalizeEntityId(item.id));
        console.debug('[FM][Boost] list loaded', { currentFormationId, boostedIds });
      }
    } catch (error) {
      state.boostedItems = [];
      syncCurrentFormationBoostState(root, { silent: true });
      if (isDevHost()) {
        console.warn('Chargement boosts indisponible', error);
      }
    } finally {
      setBoostsLoading(root, false);
      renderBoostedList(root);
      renderBoostModalList(root);
      state.boostsRequestInFlight = null;
    }
    return state.boostedItems;
  })();
  state.boostsRequestInFlight = request;
  return request;
}

async function updateBoostedStateAndList(container) {
  await loadBoosts(container, { force: true });
}

function openFormationBoostModal(container) {
  if (!container) return;
  const overlay = container.querySelector('[data-formation-boost-modal]');
  if (!overlay) return;
  const feedback = container.querySelector('[data-formation-boost-modal-message]');
  if (feedback) {
    showFeedback(feedback, '', '');
  }
  state.boostReplaceSelection = null;
  renderBoostModalList(container);
  openModalOverlay(overlay);
}

function closeFormationBoostModal(container) {
  if (!container) return;
  const overlay = container.querySelector('[data-formation-boost-modal]');
  if (!overlay) return;
  closeModalOverlay(overlay);
  const feedback = container.querySelector('[data-formation-boost-modal-message]');
  if (feedback) {
    showFeedback(feedback, '', '');
  }
  state.boostReplaceSelection = null;
}

async function callBoostEndpoint(payload) {
  const response = await fetch(BOOST_ENDPOINT, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await getJson(response);
  if (!response.ok) {
    throw new Error(data?.error || 'Impossible de mettre à jour le boost.');
  }
  return data?.entity || null;
}

function applyBoostResult(entity, container) {
  const root = container || getRoot();
  state.boostActive = Boolean(entity?.isBoosted);
  state.boostOrder = Number.isFinite(Number(entity?.boostOrder)) ? Number(entity.boostOrder) : null;
  renderFormationBoostStatus(root, state.boostActive, state.boostOrder);
  updateFormationBoostButton(root, state.boostActive);
}

function resetFormationBoostControls(container) {
  const root = container || getRoot();
  state.boostedItems = [];
  state.boostCarouselIndex = 0;
  state.boostReplaceSelection = null;
  applyBoostResult({ isBoosted: false, boostOrder: null }, root);
  renderBoostedList(root);
  renderBoostModalList(root);
  const message = root?.querySelector('[data-formation-boost-message]');
  showFeedback(message, '', '');
}

async function enableCurrentFormation(
  container,
  successMessage = 'Formation boostee.',
  triggerButton = null,
  context = 'FormationManager:BoostEnable'
) {
  const feedback = container?.querySelector('[data-formation-boost-message]');
  if (!state.editingId) {
    showFeedback(feedback, 'Sélectionnez une formation pour gérer le boost.', 'error');
    return;
  }
  setActionLoading(triggerButton, 'Enregistrement...');
  try {
    const entity = await callBoostEndpoint({
      targetType: 'formation',
      targetId: state.editingId,
      isBoosted: true
    });
    applyBoostResult(entity, container);
    showFeedback(feedback, successMessage, 'success');
    await updateBoostedStateAndList(container);
    await fetchFormations();
    const selected = state.formations.find(item => item.id === state.editingId);
    if (selected) {
      populateForm(selected);
    }
    setActionSuccess(triggerButton, 'R?ussi');
  } catch (error) {
    setActionError(triggerButton, context, error, {
      editingId: state.editingId,
      boostActive: state.boostActive
    });
    showFeedback(feedback, error.message || 'Erreur réseau.', 'error');
  }
}

async function disableCurrentFormation(container, triggerButton = null) {
  const feedback = container?.querySelector('[data-formation-boost-message]');
  if (!state.editingId) {
    showFeedback(feedback, 'Sélectionnez une formation pour gérer le boost.', 'error');
    return;
  }
  setActionLoading(triggerButton, 'Enregistrement...');
  try {
    const entity = await callBoostEndpoint({
      targetType: 'formation',
      targetId: state.editingId,
      isBoosted: false
    });
    applyBoostResult(entity, container);
    showFeedback(feedback, 'Boost retiré pour cette formation.', 'success');
    await updateBoostedStateAndList(container);
    await fetchFormations();
    const selected = state.formations.find(item => item.id === state.editingId);
    if (selected) {
      populateForm(selected);
    }
    setActionSuccess(triggerButton, 'R?ussi');
  } catch (error) {
    setActionError(triggerButton, 'FormationManager:BoostDisable', error, {
      editingId: state.editingId,
      boostActive: state.boostActive
    });
    showFeedback(feedback, error.message || 'Erreur réseau.', 'error');
  }
}

async function replaceBoostWithCurrent(container, boostId, boostType, confirmButton = null) {
  const normalizedBoostId = normalizeEntityId(boostId);
  const normalizedBoostType = String(boostType || '').trim().toLowerCase();
  if (!normalizedBoostId || !normalizedBoostType) return;
  const feedback = container?.querySelector('[data-formation-boost-message]');
  const modalConfirmButton = container?.querySelector('[data-action="confirm-replace-formation-boost"]');
  const modalCloseButton = container?.querySelector('[data-action="close-formation-boost-modal"]');
  if (!state.editingId) {
    showFeedback(feedback, 'Sélectionnez une formation pour remplacer un boost.', 'error');
    return;
  }
  try {
    setActionLoading(confirmButton, 'Remplacement...');
    if (modalConfirmButton) modalConfirmButton.disabled = true;
    if (modalCloseButton) modalCloseButton.disabled = true;
    await callBoostEndpoint({
      targetType: normalizedBoostType,
      targetId: normalizedBoostId,
      isBoosted: false
    });
    const entity = await callBoostEndpoint({
      targetType: 'formation',
      targetId: state.editingId,
      isBoosted: true
    });
    applyBoostResult(entity, container);
    showFeedback(feedback, 'Boost remplacé.', 'success');
    await updateBoostedStateAndList(container);
    closeFormationBoostModal(container);
    await fetchFormations();
    const selected = state.formations.find(item => item.id === state.editingId);
    if (selected) {
      populateForm(selected);
    }
    setActionSuccess(confirmButton, 'R?ussi');
  } catch (error) {
    setActionError(confirmButton, 'FormationManager:BoostReplace', error, {
      editingId: state.editingId,
      replacedBoostId: normalizedBoostId,
      replacedBoostType: normalizedBoostType
    });
    showFeedback(feedback, error.message || 'Erreur réseau.', 'error');
  } finally {
    if (modalConfirmButton) modalConfirmButton.disabled = false;
    if (modalCloseButton) modalCloseButton.disabled = false;
  }
}

async function handleFormationBoostToggle(event) {
  event.preventDefault();
  const actionButton = event.target.closest('[data-action="toggle-formation-boost"]');
  const container = event.currentTarget.closest('[data-module-root]');
  const feedback = container?.querySelector('[data-formation-boost-message]');
  if (!state.editingId) {
    showFeedback(feedback, 'Sélectionnez une formation pour gérer le boost.', 'error');
    setActionError(actionButton, 'FormationManager:BoostToggle', new Error('Formation manquante'), {
      editingId: state.editingId
    });
    return;
  }
  await loadBoosts(container, { force: true });
  syncCurrentFormationBoostState(container);
  if (state.boostActive) {
    const confirmed = await confirmAction({
      title: 'Stopper le boost ?',
      message: 'Cette formation ne sera plus mise en avant dans les boosts.',
      confirmLabel: 'Stopper le boost',
      danger: true
    });
    if (!confirmed) {
      return;
    }
    await disableCurrentFormation(container, actionButton);
    return;
  }
  if (state.boostedItems.length >= BOOST_LIMIT) {
    showFeedback(feedback, '3 boosts actifs détectés. Choisissez un élément à remplacer.', 'info');
    openFormationBoostModal(container);
    return;
  }
  await enableCurrentFormation(container, 'Formation boostee.', actionButton, 'FormationManager:BoostEnable');
}

function attachFormationBoostModalEvents(container) {
  if (!container) return;
  const overlay = container.querySelector('[data-formation-boost-modal]');
  const confirmButton = overlay?.querySelector('[data-action="confirm-replace-formation-boost"]');
  const modalFeedback = overlay?.querySelector('[data-formation-boost-modal-message]');
  overlay?.addEventListener('click', event => {
    if (event.target === overlay) {
      closeFormationBoostModal(container);
    }
  });
  overlay?.querySelectorAll('[data-action="close-formation-boost-modal"]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      closeFormationBoostModal(container);
    });
  });
  const list = container.querySelector('[data-formation-boost-modal-list]');
  list?.addEventListener('click', event => {
    const action = event.target.closest('[data-action="select-boost-replace-candidate"]');
    if (!action) return;
    event.preventDefault();
    state.boostReplaceSelection = {
      id: normalizeEntityId(action.dataset.boostId),
      type: String(action.dataset.boostType || '').trim().toLowerCase()
    };
    renderBoostModalList(container);
  });
  confirmButton?.addEventListener('click', async event => {
    event.preventDefault();
    const confirmActionButton = event.target.closest('[data-action="confirm-replace-formation-boost"]');
    if (!state.boostReplaceSelection?.id || !state.boostReplaceSelection?.type) {
      showFeedback(modalFeedback, 'Sélectionnez une formation à remplacer.', 'error');
      setActionError(
        confirmActionButton,
        'FormationManager:BoostReplace',
        new Error('Selection de remplacement manquante.'),
        { selection: state.boostReplaceSelection }
      );
      return;
    }
    showFeedback(modalFeedback, '', '');
    await replaceBoostWithCurrent(
      container,
      state.boostReplaceSelection.id,
      state.boostReplaceSelection.type,
      confirmActionButton
    );
  });
}

function attachFormationBoostEvents(container) {
  if (!container) return;
  const button = container.querySelector('[data-action="toggle-formation-boost"]');
  button?.addEventListener('click', handleFormationBoostToggle);
  const boostPanel = container.querySelector('[data-editor-panel="boost"]');
  boostPanel?.addEventListener('click', event => {
    const prevButton = event.target.closest('[data-action="boost-carousel-prev"]');
    if (prevButton) {
      event.preventDefault();
      shiftBoostCarousel(-1, container);
      return;
    }
    const nextButton = event.target.closest('[data-action="boost-carousel-next"]');
    if (nextButton) {
      event.preventDefault();
      shiftBoostCarousel(1, container);
      return;
    }
    const dotButton = event.target.closest('[data-action="boost-carousel-goto"]');
    if (!dotButton) return;
    event.preventDefault();
    const nextIndex = Number(dotButton.dataset.boostIndex);
    if (!Number.isFinite(nextIndex)) return;
    state.boostCarouselIndex = Math.max(0, Math.floor(nextIndex));
    renderBoostedList(container);
  });
  boostPanel?.addEventListener('touchstart', event => {
    const track = event.target.closest('[data-formation-boost-carousel]');
    if (!track) return;
    state.boostTouchStartX = Number(event.changedTouches?.[0]?.clientX || 0);
  }, { passive: true });
  boostPanel?.addEventListener('touchend', event => {
    const track = event.target.closest('[data-formation-boost-carousel]');
    if (!track) return;
    const startX = Number(state.boostTouchStartX || 0);
    const endX = Number(event.changedTouches?.[0]?.clientX || 0);
    const delta = endX - startX;
    state.boostTouchStartX = null;
    if (Math.abs(delta) < 36) return;
    shiftBoostCarousel(delta < 0 ? 1 : -1, container);
  }, { passive: true });
  attachFormationBoostModalEvents(container);
}

function openFormationPromotionModal(container) {
  if (!container) return;
  const overlay = container.querySelector('[data-formation-promotion-modal]');
  if (!overlay) return;
  hydrateFormationPromotionForm(container, state.activePromotion);
  openModalOverlay(overlay);
}

function closeFormationPromotionModal(container) {
  if (!container) return;
  const overlay = container.querySelector('[data-formation-promotion-modal]');
  if (!overlay) return;
  closeModalOverlay(overlay);
}

function attachFormationPromotionModalEvents(container) {
  if (!container) return;
  if (container.dataset.boundPromotionModalEvents === 'true') return;
  container.dataset.boundPromotionModalEvents = 'true';
  const overlay = container.querySelector('[data-formation-promotion-modal]');
  const closeButton = overlay?.querySelector('[data-action="close-formation-promotion-modal"]');
  container.addEventListener('click', event => {
    const openButton = event.target.closest('[data-action="open-formation-promotion-modal"]');
    if (openButton) {
      event.preventDefault();
      openFormationPromotionModal(container);
    }
  });
  closeButton?.addEventListener('click', () => closeFormationPromotionModal(container));
  overlay?.addEventListener('click', event => {
    if (event.target === overlay) {
      closeFormationPromotionModal(container);
    }
  });
  overlay?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFormationPromotionModal(container);
    }
  });
}

function parseLocalDatetime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function formatDatetimeLocalValue(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function hydrateFormationPromotionForm(container, promotion = state.activePromotion) {
  const form = container?.querySelector('[data-formation-promotion-form]');
  if (!form) return;
  form.reset();
  if (promotion) {
    const discountType = promotion.discountType === 'fixed' ? 'fixed' : 'percentage';
    const discountValue = Number.isFinite(Number(promotion.discountValue))
      ? Number(promotion.discountValue)
      : '';
    form.querySelector('[name="discountType"]').value = discountType;
    form.querySelector('[name="discountValue"]').value = discountValue;
    const now = Date.now();
    const startAt = promotion.startAt ? new Date(promotion.startAt) : null;
    const endAt = promotion.endAt ? new Date(promotion.endAt) : null;
    let mode = 'immediate';
    if (startAt && !Number.isNaN(startAt.getTime()) && startAt.getTime() > now) {
      mode = 'scheduled';
    } else if (endAt && !Number.isNaN(endAt.getTime())) {
      mode = 'limited';
    }
    const modeInput = form.querySelector(`[name="promotionMode"][value="${mode}"]`);
    if (modeInput) {
      modeInput.checked = true;
    }
    form.querySelector('[name="startAt"]').value = formatDatetimeLocalValue(promotion.startAt);
    form.querySelector('[name="endAt"]').value = formatDatetimeLocalValue(promotion.endAt);
  }
  updateFormationPromotionMode(
    container,
    form.querySelector('[name="promotionMode"]:checked')?.value || 'immediate'
  );
  updateFormationPromotionPricePreview(container);
}

function updateFormationPromotionMode(container, mode) {
  if (!container) return;
  const fields = container.querySelectorAll('[data-formation-promotion-field]');
  fields.forEach(field => {
    const modes = String(field.dataset.formationPromotionField || '')
      .split(' ')
      .map(entry => entry.trim())
      .filter(Boolean);
    const shouldShow = modes.length === 0 || modes.includes(mode);
    field.style.display = shouldShow ? '' : 'none';
  });
}

async function loadFormationPromotionState(formationId, container) {
  const root = getRoot(container);
  if (!formationId || !root) {
    state.activePromotion = null;
    renderFormationPromotionStatus(root, null);
    updateFormationPromotionPricePreview(root);
    return null;
  }
  try {
    const params = new URLSearchParams({
      targetType: 'formation',
      targetId: String(formationId)
    });
    const response = await fetch(`${PROMOTIONS_ENDPOINT}?${params.toString()}`, {
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de charger les promotions.');
    }
    const active = getActivePromotion(payload);
    const dismissedForCurrent = state.dismissedPromotionFormationId === String(formationId);
    state.activePromotion = dismissedForCurrent ? null : active;
    renderFormationPromotionStatus(root, state.activePromotion);
    updateFormationPromotionPricePreview(root);
    logDev('[FM] promo raw', formationId, payload?.activePromotion, payload?.promotions);
    return active;
  } catch (error) {
    state.activePromotion = null;
    renderFormationPromotionStatus(root, null);
    updateFormationPromotionPricePreview(root);
    logDev('[FM] promo load error', { formationId, message: error?.message || error });
    return null;
  }
}

function resetFormationPromotionForm(container) {
  if (!container) return;
  const form = container.querySelector('[data-formation-promotion-form]');
  const feedback = container.querySelector('[data-formation-promotion-message]');
  if (!form) return;
  form.reset();
  updateFormationPromotionMode(
    container,
    form.querySelector('[name="promotionMode"]:checked')?.value || 'immediate'
  );
  showFeedback(feedback, '', '');
  state.dismissedPromotionFormationId = null;
  state.activePromotion = null;
  renderFormationPromotionStatus(container, null);
  updateFormationPromotionPricePreview(container);
}

async function handleFormationPromotionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form?.querySelector('button[type="submit"]');
  if (submitButton?.dataset.actionState === 'loading') return;
  const container = form.closest('[data-module-root]');
  const feedback = container?.querySelector('[data-formation-promotion-message]');
  if (!state.editingId) {
    setActionError(submitButton, 'FormationManager:ApplyPromotion', new Error('Formation manquante'), {
      editingId: state.editingId
    });
    showFeedback(feedback, 'Sélectionnez une formation pour planifier une promotion.', 'error');
    return;
  }
  const discountType = form.querySelector('[name="discountType"]')?.value;
  const discountValue = Number(form.querySelector('[name="discountValue"]')?.value);
  if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
    setActionError(submitButton, 'FormationManager:ApplyPromotion', new Error('Valeur de promotion invalide.'));
    showFeedback(feedback, 'Valeur de promotion invalide.', 'error');
    return;
  }
  if (discountType === 'percentage' && discountValue > 100) {
    setActionError(submitButton, 'FormationManager:ApplyPromotion', new Error('Pourcentage invalide.'), {
      discountValue
    });
    showFeedback(feedback, 'Le pourcentage doit être entre 0 et 100.', 'error');
    return;
  }
  const mode = form.querySelector('[name="promotionMode"]:checked')?.value || 'immediate';
  let startAt = null;
  let endAt = null;
  if (mode === 'limited') {
    endAt = parseLocalDatetime(form.querySelector('[name="endAt"]')?.value);
    if (!endAt) {
      setActionError(submitButton, 'FormationManager:ApplyPromotion', new Error('Date de fin requise.'));
      showFeedback(feedback, 'Date de fin requise.', 'error');
      return;
    }
    startAt = new Date().toISOString();
  } else if (mode === 'scheduled') {
    startAt = parseLocalDatetime(form.querySelector('[name="startAt"]')?.value);
    if (!startAt) {
      setActionError(submitButton, 'FormationManager:ApplyPromotion', new Error('Date de début requise.'));
      showFeedback(feedback, 'Date de début requise.', 'error');
      return;
    }
    endAt = parseLocalDatetime(form.querySelector('[name="endAt"]')?.value);
    if (endAt && endAt <= startAt) {
      setActionError(submitButton, 'FormationManager:ApplyPromotion', new Error('Plage de dates invalide.'), {
        startAt,
        endAt
      });
      showFeedback(feedback, 'La fin doit suivre le début.', 'error');
      return;
    }
  } else {
    startAt = new Date().toISOString();
  }
  const payload = {
    targetType: 'formation',
    targetId: state.editingId,
    discountType,
    discountValue,
    startAt
  };
  if (endAt) {
    payload.endAt = endAt;
  }
  setActionLoading(submitButton, 'Enregistrement...');
  try {
    const response = await fetch(PROMOTIONS_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await getJson(response);
    if (!response.ok) {
      setActionError(
        submitButton,
        'FormationManager:ApplyPromotion',
        new Error(data?.error || 'Impossible de sauvegarder la promotion.'),
        { status: response.status, payload, responseBody: data }
      );
      showFeedback(feedback, data?.error || 'Impossible de sauvegarder la promotion.', 'error');
      return;
    }
    setActionSuccess(submitButton, 'R?ussi');
    showFeedback(feedback, 'Promotion planifiee.', 'success');
    state.dismissedPromotionFormationId = null;
    state.activePromotion = getActivePromotion({ promotions: data?.promotion ? [data.promotion] : [] });
    renderFormationPromotionStatus(container, state.activePromotion);
    updateFormationPromotionPricePreview(container);
    await loadFormationPromotionState(state.editingId, container);
    await fetchFormations(); // to refresh list and preserve state
    const selected = state.formations.find(item => item.id === state.editingId);
    if (selected) {
      populateForm(selected);
    }
    closeFormationPromotionModal(container);
  } catch (error) {
    setActionError(submitButton, 'FormationManager:ApplyPromotion', error, { payload });
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

async function handleStopFormationPromotion(event) {
  const button = event.target.closest('[data-action="stop-formation-promotion"]');
  if (!button) return;
  event.preventDefault();
  const container = button.closest('[data-module-root]');
  if (!container) return;
  const feedback = container.querySelector('[data-formation-promotion-message]');
  if (!state.editingId || !state.activePromotion) {
    setActionError(button, 'FormationManager:StopPromotion', new Error('Aucune promotion active.'));
    showFeedback(feedback, 'Aucune promotion active a stopper.', 'info');
    return;
  }
  const confirmed = await confirmAction({
    title: 'Stopper la promotion ?',
    message: 'La promotion active ne sera plus affichee dans cette session.',
    confirmLabel: 'Stopper',
    danger: true
  });
  if (!confirmed) return;
  setActionLoading(button, 'Enregistrement...');
  state.dismissedPromotionFormationId = String(state.editingId);
  state.activePromotion = null;
  renderFormationPromotionStatus(container, null);
  renderFormationPromotionCurrent(container, null);
  showFeedback(feedback, 'Promotion stoppee.', 'success');
  setActionSuccess(button, 'R?ussi');
}

function attachFormationPromotionFormEvents(container) {
  if (!container) return;
  const form = container.querySelector('[data-formation-promotion-form]');
  if (form) {
    const modeInputs = form.querySelectorAll('[name="promotionMode"]');
    modeInputs.forEach(input => {
      input.addEventListener('change', () => updateFormationPromotionMode(container, input.value));
    });
    const previewInputs = [
      form.querySelector('[name="discountType"]'),
      form.querySelector('[name="discountValue"]')
    ];
    previewInputs.forEach(input => {
      input?.addEventListener('input', () => updateFormationPromotionPricePreview(container));
    });
    form.addEventListener('submit', handleFormationPromotionSubmit);
    updateFormationPromotionMode(container, form.querySelector('[name="promotionMode"]:checked')?.value || 'immediate');
    updateFormationPromotionPricePreview(container);
  } else {
    renderFormationPromotionCurrent(container, state.activePromotion);
  }
  container.addEventListener('click', event => {
    if (event.target.closest('[data-action="stop-formation-promotion"]')) {
      void handleStopFormationPromotion(event);
    }
  });
  attachFormationPromotionModalEvents(container);
}
function closeAllKebabMenus(container) {
  const scope = getRoot(container) || document;
  scope.querySelectorAll('[data-kebab-menu]').forEach(menu => {
    const hideTimerId = Number(menu.dataset.hideTimerId || 0);
    if (hideTimerId) {
      window.clearTimeout(hideTimerId);
      menu.removeAttribute('data-hide-timer-id');
    }
    if (menu.hidden && !menu.classList.contains('is-open')) {
      return;
    }
    menu.classList.remove('is-open');
    const timerId = window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) {
        menu.hidden = true;
      }
    }, 150);
    menu.dataset.hideTimerId = String(timerId);
  });
  state.openKebabId = null;
}

function toggleKebabMenu(id, container) {
  const scope = getRoot(container) || document;
  if (!id) return;
  const menu = scope.querySelector(`[data-kebab-menu][data-id=\"${id}\"]`);
  if (!menu) return;
  const isOpen = !menu.hidden;
  closeAllKebabMenus(container);
  if (!isOpen) {
    const hideTimerId = Number(menu.dataset.hideTimerId || 0);
    if (hideTimerId) {
      window.clearTimeout(hideTimerId);
      menu.removeAttribute('data-hide-timer-id');
    }
    menu.hidden = false;
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
    });
    state.openKebabId = id;
  }
}

function formatDateTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString();
}

function formatHistoryClientIdentity(client = {}, index = 0) {
  const firstName = String(client?.firstName || '').trim();
  const lastName = String(client?.lastName || '').trim();
  const email = String(client?.email || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) return fullName;
  if (email) return email;
  return `Client #${index + 1}`;
}

function formatDeletedByLabel(entry = {}) {
  const firstName = String(entry?.deletedBy?.firstName || '').trim();
  const lastName = String(entry?.deletedBy?.lastName || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) return fullName;
  const email = String(entry?.deletedBy?.email || '').trim();
  if (email) return email;
  return 'Administrateur';
}

function getDeletedHistoryEntry(historyId) {
  const normalized = normalizeEntityId(historyId);
  if (!normalized) return null;
  return state.deletedHistory.find(entry => normalizeEntityId(entry?.id) === normalized) || null;
}

function renderDeletedHistory(container) {
  const root = getRoot(container);
  const historyRoot = root?.querySelector('[data-formation-deleted-history]');
  if (!historyRoot) return;
  if (state.deletedHistoryLoading) {
    historyRoot.innerHTML = '<p class="module-placeholder">Chargement de l historique...</p>';
    return;
  }
  if (state.deletedHistoryError) {
    historyRoot.innerHTML = `<p class="form-message" data-status="error">${escapeHtml(state.deletedHistoryError)}</p>`;
    return;
  }
  if (!state.deletedHistory.length) {
    historyRoot.innerHTML = `
      <article class="gmf-history-empty">
        <i class="bi bi-clock-history" aria-hidden="true"></i>
        <p>Aucune formation supprim?e pour le moment.</p>
      </article>
    `;
    return;
  }
  historyRoot.innerHTML = state.deletedHistory
    .map(entry => {
      const title = escapeHtml(entry?.formationTitle || 'Formation supprim?e');
      const formationId = escapeHtml(entry?.formationId || '');
      const deletedBy = escapeHtml(formatDeletedByLabel(entry));
      const deletedAt = escapeHtml(formatDateTimeLabel(entry?.deletedAt));
      const clientsCount = Number.isFinite(Number(entry?.clientsCount))
        ? Math.max(0, Math.floor(Number(entry.clientsCount)))
        : Array.isArray(entry?.clients)
          ? entry.clients.length
          : 0;
      const clientsLabel = `${clientsCount} client${clientsCount > 1 ? 's' : ''}`;
      return `
        <article class="gmf-history-card" data-history-card-id="${escapeHtml(entry?.id || '')}">
          <div class="gmf-history-card__head">
            <div>
              <p class="gmf-kicker">Formation supprim?e</p>
              <h4>${title}</h4>
            </div>
            <span class="gmf-history-card__count">${escapeHtml(clientsLabel)}</span>
          </div>
          <div class="gmf-history-card__meta">
            <p><i class="bi bi-upc-scan"></i> ID: ${formationId || '-'}</p>
            <p><i class="bi bi-person-check"></i> Supprimee par: ${deletedBy}</p>
            <p><i class="bi bi-calendar-event"></i> Le: ${deletedAt}</p>
          </div>
          <div class="gmf-history-card__actions">
            <button
              type="button"
              class="secondary-button"
              data-action="show-deleted-formation-clients"
              data-history-id="${escapeHtml(entry?.id || '')}"
            >
              Afficher les clients
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

async function fetchDeletedFormationHistory(container, { force = false } = {}) {
  if (state.deletedHistoryRequestInFlight && !force) {
    return state.deletedHistoryRequestInFlight;
  }
  if (state.deletedHistoryLoaded && !force) {
    renderDeletedHistory(container);
    return state.deletedHistory;
  }
  state.deletedHistoryLoading = true;
  state.deletedHistoryError = '';
  renderDeletedHistory(container);
  const request = (async () => {
    const response = await fetch(DELETED_HISTORY_ENDPOINT, {
      method: 'GET',
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de charger l historique des suppressions.');
    }
    state.deletedHistory = Array.isArray(payload?.history) ? payload.history : [];
    state.deletedHistoryLoaded = true;
    state.deletedHistoryError = '';
    return state.deletedHistory;
  })();
  state.deletedHistoryRequestInFlight = request;
  try {
    return await request;
  } catch (error) {
    state.deletedHistoryError = error?.message || 'Impossible de charger l historique des suppressions.';
    logUiError('FormationManager:LoadDeletedHistory', error, {});
    return [];
  } finally {
    state.deletedHistoryLoading = false;
    state.deletedHistoryRequestInFlight = null;
    renderDeletedHistory(container);
  }
}

function renderDeletedHistoryClients(entry, container) {
  const root = getRoot(container);
  const body = root?.querySelector('[data-deleted-history-clients-body]');
  const title = root?.querySelector('[data-deleted-history-clients-title]');
  if (!body || !title) return;
  const formationTitle = String(entry?.formationTitle || 'Formation supprim?e').trim();
  const clients = Array.isArray(entry?.clients) ? entry.clients : [];
  title.textContent = `${formationTitle} - ${clients.length} client${clients.length > 1 ? 's' : ''}`;
  if (!clients.length) {
    body.innerHTML = '<p class="module-placeholder">Aucun client enregistre pour cette suppression.</p>';
    return;
  }
  body.innerHTML = `
    <div class="gmf-history-clients-list">
      ${clients
        .map((client, index) => {
          const identity = escapeHtml(formatHistoryClientIdentity(client, index));
          const email = escapeHtml(String(client?.email || '').trim() || '-');
          const paid = escapeHtml(formatPrice(client?.totalPaid || 0));
          const lastDate = escapeHtml(formatDateTimeLabel(client?.lastSubscribedAt || client?.subscribedAt));
          return `
            <article class="gmf-history-client-card">
              <h5>${identity}</h5>
              <p><i class="bi bi-envelope"></i> ${email}</p>
              <p><i class="bi bi-credit-card-2-front"></i> Total paye: ${paid}</p>
              <p><i class="bi bi-calendar-check"></i> Derniere souscription: ${lastDate}</p>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function closeDeletedHistoryClientsModal(container, { immediate = false } = {}) {
  const root = getRoot(container);
  const overlay = root?.querySelector('[data-deleted-history-clients-modal]');
  if (!overlay) return;
  closeModalOverlay(overlay, { immediate });
  state.deletedHistoryClientsModal.open = false;
  state.deletedHistoryClientsModal.historyId = null;
}

function openDeletedHistoryClientsModal(historyId, container) {
  const root = getRoot(container);
  const entry = getDeletedHistoryEntry(historyId);
  if (!entry || !root) return;
  renderDeletedHistoryClients(entry, root);
  const overlay = root.querySelector('[data-deleted-history-clients-modal]');
  if (!overlay) return;
  state.deletedHistoryClientsModal.open = true;
  state.deletedHistoryClientsModal.historyId = normalizeEntityId(historyId);
  openModalOverlay(overlay);
}

function attachCatalogTabEvents(container) {
  const root = getRoot(container);
  if (!root || root.dataset.catalogEventsBound === 'true') return;
  root.dataset.catalogEventsBound = 'true';
  root.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-action="set-catalog-tab"]');
    if (tabButton) {
      event.preventDefault();
      setCatalogTab(tabButton.dataset.tab, root);
      return;
    }
    const reloadButton = event.target.closest('[data-action="reload-deleted-history"]');
    if (reloadButton) {
      event.preventDefault();
      void fetchDeletedFormationHistory(root, { force: true });
      return;
    }
    const showClientsButton = event.target.closest('[data-action="show-deleted-formation-clients"]');
    if (showClientsButton) {
      event.preventDefault();
      openDeletedHistoryClientsModal(showClientsButton.dataset.historyId, root);
      return;
    }
    const closeClientsButton = event.target.closest('[data-action="close-deleted-history-clients-modal"]');
    if (closeClientsButton) {
      event.preventDefault();
      closeDeletedHistoryClientsModal(root);
      return;
    }
    const overlay = event.target.closest('[data-deleted-history-clients-modal]');
    if (overlay && overlay === event.target) {
      closeDeletedHistoryClientsModal(root);
    }
  });
}

async function handleFormationDelete(id, container) {
  const targetId = normalizeEntityId(id);
  if (!targetId) return;
  const formation = state.formations.find(entry => normalizeEntityId(entry.id) === targetId);
  if (!formation) return;
  const soldCount = getFormationSoldCount(formation);
  const soldLabel = `${soldCount} client${soldCount > 1 ? 's' : ''}`;
  let deletePayload = null;
  const confirmed = await confirmAction({
    title: 'Supprimer cette formation ?',
    message: `
      <p>Cette formation a ete achetee par <strong>${escapeHtml(soldLabel)}</strong>.</p>
      <p>La supprimer peut entrainer :</p>
      <ul class="gmf-delete-confirm-list">
        <li>l obligation de remboursement,</li>
        <li>des litiges clients,</li>
        <li>une responsabilite contractuelle.</li>
      </ul>
      <p>Souhaitez-vous vraiment continuer ?</p>
    `,
    allowHtml: true,
    confirmLabel: 'Supprimer',
    cancelLabel: 'Annuler',
    loadingLabel: 'Suppression...',
    danger: true,
    onConfirm: async () => {
      const response = await fetch(`${API_ROOT}/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      deletePayload = await getJson(response);
      if (!response.ok) {
        throw new Error(deletePayload?.error || 'Impossible de supprimer la formation.');
      }
    }
  });
  if (!confirmed) return;

  await fetchFormations();
  await fetchDeletedFormationHistory(container, { force: true });
  if (state.catalogTab === CATALOG_TAB_HISTORY) {
    renderDeletedHistory(container);
  }
  const deletedCount = Number(deletePayload?.deleted?.clientsCount || soldCount || 0);
  showToast({
    type: 'success',
    message: `Formation supprim?e (${deletedCount} client${deletedCount > 1 ? 's' : ''} archives).`,
    durationMs: 1000
  });
}

function formatSoldCountLabel(count) {
  const total = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
  return `${total} ${total > 1 ? 'ventes' : 'vente'}`;
}

function extractTextPreviewFromHtml(html = '') {
  const holder = document.createElement('div');
  holder.innerHTML = String(html || '');
  const text = (holder.textContent || holder.innerText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 220 ? `${text.slice(0, 219).trim()}…` : text;
}

function buildFormattedPreviewMarkup(text = '') {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div class="editorial-detail">${paragraphs || `<p>${escapeHtml(normalized)}</p>`}</div>`;
}

function renderFormationDescriptionPreview(formation = null, container) {
  const root = getRoot(container);
  const preview = root?.querySelector('[data-formation-description-preview-content]') ||
    root?.querySelector('[data-formation-description-preview]');
  if (!preview) return;
  const editorialHtml = String(formation?.editorialHtml || '').trim();
  const previewDescription = String(formation?.previewDescription || formation?.description || '').trim();
  if (editorialHtml) {
    preview.innerHTML = `<div class="editorial-detail">${editorialHtml}</div>`;
    return;
  }
  if (previewDescription) {
    preview.innerHTML = buildFormattedPreviewMarkup(previewDescription);
    return;
  }
  preview.innerHTML = '<p class="module-placeholder">Aucune description editoriale pour le moment.</p>';
}

function getDashboardFormation() {
  const formationId = normalizeEntityId(state.activeFormationId);
  if (!formationId) return null;
  return state.formations.find(entry => normalizeEntityId(entry.id) === formationId) || null;
}

function normalizeDashboardTab(tabName) {
  return DASHBOARD_TAB_VALUES.has(tabName) ? tabName : DASHBOARD_TAB_SALES;
}

function normalizeDashboardPeriod(period) {
  return DASHBOARD_PERIODS.includes(period) ? period : 'month';
}

function getDashboardPeriodBounds(period = state.dashboardPeriod, referenceDate = state.dashboardReferenceDate) {
  const safePeriod = normalizeDashboardPeriod(period);
  const base = referenceDate instanceof Date ? new Date(referenceDate) : new Date(referenceDate || Date.now());
  if (Number.isNaN(base.getTime())) {
    base.setTime(Date.now());
  }
  if (safePeriod === 'year') {
    const start = new Date(base.getFullYear(), 0, 1);
    const end = new Date(base.getFullYear() + 1, 0, 1);
    return { start, end };
  }
  if (safePeriod === 'month') {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    return { start, end };
  }
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function moveDashboardReference(period, direction) {
  const safePeriod = normalizeDashboardPeriod(period);
  const next = state.dashboardReferenceDate instanceof Date
    ? new Date(state.dashboardReferenceDate)
    : new Date();
  if (safePeriod === 'year') {
    next.setFullYear(next.getFullYear() + direction);
    return new Date(next.getFullYear(), 0, 1);
  }
  if (safePeriod === 'month') {
    next.setMonth(next.getMonth() + direction, 1);
    return new Date(next.getFullYear(), next.getMonth(), 1);
  }
  next.setDate(next.getDate() + direction);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatDashboardPeriodLabel(period, bounds) {
  const { start, end } = bounds || {};
  if (!start || !end) return '';
  if (period === 'year') {
    return `Annee ${start.getFullYear()}`;
  }
  if (period === 'month') {
    return start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }
  return start.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function getDashboardPeriodOptionLabel(period) {
  if (period === 'day') return 'Jour';
  if (period === 'year') return 'Annee';
  return 'Mois';
}

function getFormationItemAmount(item) {
  const finalPrice = Number(item?.finalPrice);
  if (Number.isFinite(finalPrice)) {
    return finalPrice;
  }
  const price = Number(item?.price);
  if (Number.isFinite(price)) {
    return price;
  }
  const basePrice = Number(item?.basePrice);
  if (Number.isFinite(basePrice)) {
    return basePrice;
  }
  return 0;
}

function getDashboardSalesEntriesForFormation(formationId) {
  const targetId = normalizeEntityId(formationId);
  if (!targetId) return [];
  return (Array.isArray(state.dashboardSales) ? state.dashboardSales : [])
    .map(sale => {
      const saleItems = Array.isArray(sale?.items) ? sale.items : [];
      const matchedItems = saleItems.filter(item => {
        if (String(item?.type || '').trim() !== 'formation') return false;
        return normalizeEntityId(item?.itemId) === targetId;
      });
      if (!matchedItems.length) return null;
      const amount = roundToCents(
        matchedItems.reduce((sum, item) => sum + getFormationItemAmount(item), 0)
      );
      return {
        sale,
        saleId: String(sale?.saleId || sale?._id || ''),
        date: new Date(sale?.createdAt || Date.now()),
        amount,
        matchedItems
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.date.getTime() - left.date.getTime());
}

function getDashboardFilteredSalesEntries(formationId) {
  const entries = getDashboardSalesEntriesForFormation(formationId);
  const bounds = getDashboardPeriodBounds();
  const filtered = entries.filter(entry => entry.date >= bounds.start && entry.date < bounds.end);
  return { entries, filtered, bounds };
}

function buildDashboardSeries(entries, period, bounds) {
  const safePeriod = normalizeDashboardPeriod(period);
  if (!bounds?.start || !bounds?.end) return [];
  if (safePeriod === 'year') {
    const points = Array.from({ length: 12 }, (_unused, monthIndex) => ({
      label: new Date(bounds.start.getFullYear(), monthIndex, 1).toLocaleDateString('fr-FR', { month: 'short' }),
      value: 0
    }));
    entries.forEach(entry => {
      const month = entry.date.getMonth();
      if (points[month]) {
        points[month].value += 1;
      }
    });
    return points;
  }
  if (safePeriod === 'month') {
    const days = new Date(bounds.start.getFullYear(), bounds.start.getMonth() + 1, 0).getDate();
    const points = Array.from({ length: days }, (_unused, dayIndex) => ({
      label: String(dayIndex + 1),
      value: 0
    }));
    entries.forEach(entry => {
      const day = entry.date.getDate();
      if (points[day - 1]) {
        points[day - 1].value += 1;
      }
    });
    return points;
  }
  const points = Array.from({ length: 24 }, (_unused, hour) => ({
    label: `${String(hour).padStart(2, '0')}h`,
    value: 0
  }));
  entries.forEach(entry => {
    const hour = entry.date.getHours();
    if (points[hour]) {
      points[hour].value += 1;
    }
  });
  return points;
}

function buildDashboardLineGraph(points) {
  if (!Array.isArray(points) || !points.length) {
    return '<p class="module-placeholder">Aucune vente sur cette periode.</p>';
  }
  const graphPoints = points.map(point => ({
    label: point?.label || '',
    value: Math.max(0, Number(point?.value || 0))
  }));
  const labels = points.length > 16
    ? `${escapeHtml(points[0]?.label || '')} - ${escapeHtml(points[points.length - 1]?.label || '')}`
    : points.map(point => escapeHtml(point.label)).join(' · ');
  return `
    ${buildGestionLineGraph({
      points: graphPoints,
      intent: 'accent',
      ariaLabel: 'Courbe des ventes',
      width: 520,
      height: 160,
      showLabels: false,
      pointRadius: 3
    })}
    <p class="muted gmf-dashboard-chart-label">${labels}</p>
  `;
}

function buildDashboardRatingPaws(rating) {
  const normalized = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return Array.from({ length: 5 }, (_unused, index) => `
    <span class="gmf-dashboard-paw ${index < normalized ? 'is-active' : ''}" aria-hidden="true">&#128062;</span>
  `).join('');
}

function formatDashboardDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatDashboardDateTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return date.toLocaleString('fr-FR');
}

function renderDashboardSaleDetailModal(entry) {
  if (!entry) {
    return `
      <div data-dashboard-sale-modal class="module-modal-overlay gmf-mini-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal gmf-dashboard-sale-modal" role="dialog" aria-modal="true" aria-label="Détail vente">
          <header class="module-modal__header">
            <h3>Détail vente</h3>
            <button type="button" class="module-modal__close" data-action="close-dashboard-sale-detail" aria-label="Fermer">&times;</button>
          </header>
          <p class="module-placeholder">Aucune vente selectionnee.</p>
        </div>
      </div>
    `;
  }
  const sale = entry.sale || {};
  const customer = `${sale?.customer?.firstName || ''} ${sale?.customer?.lastName || ''}`.trim() || sale?.customer?.email || 'Client';
  const items = Array.isArray(sale.items) ? sale.items : [];
  const itemRows = items.length
    ? items.map(item => `
        <li>
          <strong>${escapeHtml(item.name || item.type || 'Item')}</strong>
          <span>${formatPrice(getFormationItemAmount(item))}</span>
          ${item.promotionApplied ? '<small class="muted">Promotion appliquee</small>' : ''}
        </li>
      `).join('')
    : '<li class="muted">Aucun item</li>';
  return `
    <div data-dashboard-sale-modal class="module-modal-overlay gmf-mini-modal-overlay module-modal-overlay--visible" tabindex="-1">
      <div class="module-modal gmf-mini-modal gmf-dashboard-sale-modal" role="dialog" aria-modal="true" aria-label="Détail vente">
        <header class="module-modal__header">
          <h3>Détail vente</h3>
          <button type="button" class="module-modal__close" data-action="close-dashboard-sale-detail" aria-label="Fermer">&times;</button>
        </header>
        <div class="gmf-dashboard-sale-detail">
          <p><strong>ID vente :</strong> ${escapeHtml(String(sale.saleId || sale._id || ''))}</p>
          <p><strong>Date :</strong> ${escapeHtml(formatDashboardDateTime(sale.createdAt))}</p>
          <p><strong>Client :</strong> ${escapeHtml(customer)}</p>
          <p><strong>Email :</strong> ${escapeHtml(String(sale?.customer?.email || 'Non renseigne'))}</p>
          <p><strong>Montant formation :</strong> ${formatPrice(entry.amount)}</p>
          <p><strong>Montant total :</strong> ${formatPrice(sale.totalAmount)}</p>
          <ul class="gmf-dashboard-sale-items">${itemRows}</ul>
        </div>
      </div>
    </div>
  `;
}

function getDashboardReviewCache(formationId) {
  const key = normalizeEntityId(formationId);
  if (!key) return null;
  if (!state.dashboardReviewsByFormation[key]) {
    state.dashboardReviewsByFormation[key] = {
      loading: false,
      error: '',
      reviews: [],
      loaded: false
    };
  }
  return state.dashboardReviewsByFormation[key];
}

function renderFormationDashboard(container) {
  const root = getRoot(container);
  const panel = root?.querySelector('[data-panel="dashboard"]');
  const content = panel?.querySelector('[data-dashboard-content]');
  const headerTitle = panel?.querySelector('[data-dashboard-view-title]');
  const editButton = panel?.querySelector('[data-action="open-dashboard-edit"]');
  if (!content || !panel) return;
  const formation = getDashboardFormation();
  if (!formation) {
    if (headerTitle) {
      headerTitle.textContent = 'Dashboard formation';
    }
    if (editButton) {
      editButton.setAttribute('hidden', '');
    }
    content.innerHTML = '<p class="module-placeholder">Formation introuvable.</p>';
    return;
  }
  if (headerTitle) {
    headerTitle.textContent = formation.name || 'Dashboard formation';
  }
  if (editButton) {
    editButton.removeAttribute('hidden');
    editButton.dataset.id = formation.id || '';
  }
  const activeTab = normalizeDashboardTab(state.dashboardTab);
  const activePeriod = normalizeDashboardPeriod(state.dashboardPeriod);
  const atCurrentPeriod = isDashboardAtCurrentPeriod();
  const reviewCache = getDashboardReviewCache(formation.id);
  const salesSnapshot = getDashboardFilteredSalesEntries(formation.id);
  const totalGenerated = roundToCents(
    salesSnapshot.filtered.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  );
  const salesPoints = buildDashboardSeries(salesSnapshot.filtered, activePeriod, salesSnapshot.bounds);
  const salesListMarkup = state.dashboardSalesLoading
    ? '<p class="module-placeholder">Chargement des ventes...</p>'
    : state.dashboardSalesError
      ? `<p class="form-message error">${escapeHtml(state.dashboardSalesError)}</p>`
      : salesSnapshot.filtered.length
        ? `
          <div class="data-list gmf-dashboard-sales-list">
            ${salesSnapshot.filtered.map(entry => {
              const sale = entry.sale || {};
              const customer = `${sale?.customer?.firstName || ''} ${sale?.customer?.lastName || ''}`.trim() || sale?.customer?.email || 'Client';
              return `
                <article class="gmf-dashboard-sales-item">
                  <div>
                    <p class="gmf-dashboard-sales-item__title">${escapeHtml(customer)}</p>
                    <p class="muted">${escapeHtml(formatDashboardDateTime(sale.createdAt))}</p>
                    <p class="muted">Montant formation : ${formatPrice(entry.amount)}</p>
                  </div>
                  <button
                    type="button"
                    class="gmf-dashboard-sales-detail-button"
                    data-action="open-dashboard-sale-detail"
                    data-sale-id="${escapeHtml(entry.saleId)}"
                    aria-label="Voir le detail de la vente"
                  >
                    <i class="bi bi-chevron-right" aria-hidden="true"></i>
                  </button>
                </article>
              `;
            }).join('')}
          </div>
        `
        : '<p class="module-placeholder">Aucune vente sur cette periode.</p>';
  const reviewsMarkup = reviewCache?.loading
    ? '<p class="module-placeholder">Chargement des avis...</p>'
    : reviewCache?.error
      ? `<p class="form-message error">${escapeHtml(reviewCache.error)}</p>`
      : Array.isArray(reviewCache?.reviews) && reviewCache.reviews.length
        ? `
          <div class="data-list gmf-dashboard-reviews-list">
            ${reviewCache.reviews.map(review => {
              const reviewAuthorEmail = String(review?.authorEmail || '').trim() || 'compte supprimé';
              return `
                <article class="gmf-dashboard-review-item">
                  <div class="gmf-dashboard-review-item__head">
                    <div class="gmf-dashboard-review-rating">${buildDashboardRatingPaws(review.rating)}</div>
                    <span class="muted">${escapeHtml(formatDashboardDate(review.createdAt))}</span>
                  </div>
                  <p>${escapeHtml(review.comment || 'Avis sans commentaire.')}</p>
                  <small class="muted">${escapeHtml(reviewAuthorEmail)}</small>
                </article>
              `;
            }).join('')}
          </div>
        `
        : '<p class="module-placeholder">Aucun avis pour cette formation.</p>';
  const selectedEntry = salesSnapshot.entries.find(entry => entry.saleId === state.dashboardSaleDetailId) || null;
  content.innerHTML = `
    <article class="gmf-dashboard-hero">
      <div class="gmf-dashboard-hero__cover">
        ${formation.coverImage
          ? `<img src="${escapeHtml(formation.coverImage)}" alt="Couverture de ${escapeHtml(formation.name || 'formation')}" loading="lazy">`
          : '<div class="gmf-dashboard-hero__cover-empty"><i class="bi bi-card-image" aria-hidden="true"></i></div>'}
      </div>
      <div class="gmf-dashboard-hero__body">
        <h4>${escapeHtml(formation.name || 'Formation')}</h4>
        <div class="gmf-dashboard-hero__description">
          ${formation.editorialHtml
            ? `<div class="editorial-detail">${formation.editorialHtml}</div>`
            : `<p>${escapeHtml(formation.previewDescription || formation.description || 'Aucune description editoriale.')}</p>`}
        </div>
      </div>
    </article>

    <nav class="gmf-editor-tabs gmf-dashboard-tabs" data-dashboard-tabs>
      <div class="gmf-editor-tabs__track gmf-dashboard-tabs__track" data-dashboard-tabs-track role="tablist" aria-label="Dashboard formation">
        <button type="button" class="gmf-editor-tab ${activeTab === DASHBOARD_TAB_SALES ? 'is-active' : ''}" data-action="set-dashboard-tab" data-dashboard-tab="${DASHBOARD_TAB_SALES}" role="tab" aria-selected="${activeTab === DASHBOARD_TAB_SALES ? 'true' : 'false'}">
          <span class="gmf-editor-tab__icon"><i class="bi bi-graph-up-arrow"></i></span>
          <span class="gmf-editor-tab__label">Ventes</span>
        </button>
        <button type="button" class="gmf-editor-tab ${activeTab === DASHBOARD_TAB_REVIEWS ? 'is-active' : ''}" data-action="set-dashboard-tab" data-dashboard-tab="${DASHBOARD_TAB_REVIEWS}" role="tab" aria-selected="${activeTab === DASHBOARD_TAB_REVIEWS ? 'true' : 'false'}">
          <span class="gmf-editor-tab__icon"><i class="bi bi-chat-quote"></i></span>
          <span class="gmf-editor-tab__label">Avis</span>
        </button>
      </div>
      <span class="gmf-editor-tabs__arrow" data-dashboard-tab-arrow aria-hidden="true"></span>
    </nav>

    <section class="gmf-dashboard-panel ${activeTab === DASHBOARD_TAB_SALES ? 'is-active' : 'is-hidden'}" data-dashboard-panel="${DASHBOARD_TAB_SALES}">
      <div class="gmf-dashboard-period-controls">
        <div class="gmf-dashboard-period-picker" data-dashboard-period-picker>
          <button
            type="button"
            class="gmf-dashboard-period-trigger"
            data-action="toggle-dashboard-period-picker"
            aria-haspopup="listbox"
            aria-expanded="${state.dashboardPeriodPickerOpen ? 'true' : 'false'}"
          >
            <span>P?riode : ${getDashboardPeriodOptionLabel(activePeriod)}</span>
            <i class="bi bi-chevron-down"></i>
          </button>
          <div
            class="gmf-dashboard-period-menu ${state.dashboardPeriodPickerOpen ? 'is-open' : ''}"
            data-dashboard-period-menu
            role="listbox"
            ${state.dashboardPeriodPickerOpen ? '' : 'hidden'}
          >
            ${DASHBOARD_PERIODS.map(period => `
              <button
                type="button"
                class="gmf-dashboard-period-option ${activePeriod === period ? 'is-active' : ''}"
                data-action="set-dashboard-period"
                data-period="${period}"
                role="option"
                aria-selected="${activePeriod === period ? 'true' : 'false'}"
              >
                ${getDashboardPeriodOptionLabel(period)}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="gmf-dashboard-period-nav">
          <button type="button" class="secondary-button" data-action="dashboard-period-nav" data-direction="-1" aria-label="Période précédente">&lsaquo;</button>
          <span>${escapeHtml(formatDashboardPeriodLabel(activePeriod, salesSnapshot.bounds))}</span>
          <button type="button" class="secondary-button" data-action="dashboard-period-nav" data-direction="1" aria-label="Période suivante" ${atCurrentPeriod ? 'disabled' : ''}>&rsaquo;</button>
        </div>
      </div>
      <article class="gmf-dashboard-chart-card">
        <header>
          <strong>Ventes</strong>
          <p class="muted">${salesSnapshot.filtered.length} vente(s) sur la periode</p>
        </header>
        ${state.dashboardSalesLoading ? '<p class="module-placeholder">Chargement du graphique...</p>' : buildDashboardLineGraph(salesPoints)}
      </article>
      <div class="gmf-dashboard-kpi">
        <p class="muted">Total genere</p>
        <strong>${formatPrice(totalGenerated)}</strong>
      </div>
      ${salesListMarkup}
    </section>

    <section class="gmf-dashboard-panel ${activeTab === DASHBOARD_TAB_REVIEWS ? 'is-active' : 'is-hidden'}" data-dashboard-panel="${DASHBOARD_TAB_REVIEWS}">
      ${reviewsMarkup}
    </section>

    ${renderDashboardSaleDetailModal(selectedEntry)}
  `;
  const dashboardTabsTrack = content.querySelector('[data-dashboard-tabs-track]');
  dashboardTabsTrack?.addEventListener('scroll', () => updateDashboardTabArrow(root), { passive: true });
  updateDashboardTabArrow(root);
}

function updateDashboardTabArrow(container) {
  const root = getRoot(container);
  const arrow = root?.querySelector('[data-dashboard-tab-arrow]');
  const track = root?.querySelector('[data-dashboard-tabs-track]');
  const active = track?.querySelector('[data-dashboard-tab].is-active');
  if (!arrow || !track || !active) return;
  const arrowHalfWidth = 8;
  const nextX = track.offsetLeft + active.offsetLeft - track.scrollLeft + active.offsetWidth / 2 - arrowHalfWidth;
  arrow.style.transform = `translateX(${Math.max(0, Math.round(nextX))}px)`;
}

function closeDashboardSaleDetail(container) {
  if (!state.dashboardSaleDetailId) return;
  state.dashboardSaleDetailId = null;
  renderFormationDashboard(container);
}

function isDashboardAtCurrentPeriod() {
  const currentBounds = getDashboardPeriodBounds(state.dashboardPeriod, state.dashboardReferenceDate);
  const nowBounds = getDashboardPeriodBounds(state.dashboardPeriod, new Date());
  return currentBounds.start.getTime() >= nowBounds.start.getTime();
}

function closeDashboardPeriodPicker(container) {
  if (!state.dashboardPeriodPickerOpen) return false;
  state.dashboardPeriodPickerOpen = false;
  renderFormationDashboard(container);
  return true;
}

function ensureDashboardPeriodPickerGlobalListeners(container) {
  if (dashboardPeriodPickerOutsideListenerAttached) return;
  document.addEventListener('click', event => {
    if (!state.dashboardPeriodPickerOpen || state.view !== VIEW_DASHBOARD) return;
    if (event.target.closest('[data-dashboard-period-picker]')) return;
    const root = getRoot(container);
    if (!root || !document.body.contains(root)) return;
    closeDashboardPeriodPicker(root);
  });
  dashboardPeriodPickerOutsideListenerAttached = true;
}

function attachDashboardEvents(container) {
  const root = getRoot(container);
  const panel = root?.querySelector('[data-panel="dashboard"]');
  if (!root || !panel || panel.dataset.dashboardEventsBound === 'true') return;
  panel.dataset.dashboardEventsBound = 'true';
  ensureDashboardPeriodPickerGlobalListeners(root);

  panel.addEventListener('click', event => {
    if (
      state.dashboardPeriodPickerOpen &&
      !event.target.closest('[data-dashboard-period-picker]') &&
      !event.target.closest('[data-dashboard-sale-modal]')
    ) {
      state.dashboardPeriodPickerOpen = false;
      renderFormationDashboard(root);
      return;
    }

    const overlay = event.target.closest('[data-dashboard-sale-modal]');
    if (overlay && event.target === overlay) {
      closeDashboardSaleDetail(root);
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = String(actionButton.dataset.action || '').trim();
    if (!action) return;

    if (action === 'set-dashboard-tab') {
      event.preventDefault();
      const nextTab = normalizeDashboardTab(actionButton.dataset.dashboardTab);
      if (state.dashboardTab === nextTab) return;
      state.dashboardPeriodPickerOpen = false;
      state.dashboardTab = nextTab;
      state.dashboardSaleDetailId = null;
      renderFormationDashboard(root);
      const formation = getDashboardFormation();
      if (nextTab === DASHBOARD_TAB_REVIEWS && formation) {
        void loadDashboardReviewsForFormation(formation.id, { container: root });
      }
      return;
    }

    if (action === 'toggle-dashboard-period-picker') {
      event.preventDefault();
      state.dashboardPeriodPickerOpen = !state.dashboardPeriodPickerOpen;
      renderFormationDashboard(root);
      return;
    }

    if (action === 'set-dashboard-period') {
      event.preventDefault();
      const nextPeriod = normalizeDashboardPeriod(actionButton.dataset.period);
      if (state.dashboardPeriod === nextPeriod) {
        closeDashboardPeriodPicker(root);
        return;
      }
      state.dashboardPeriodPickerOpen = false;
      state.dashboardPeriod = nextPeriod;
      state.dashboardReferenceDate = getDashboardPeriodBounds(nextPeriod, state.dashboardReferenceDate).start;
      renderFormationDashboard(root);
      return;
    }

    if (action === 'dashboard-period-nav') {
      event.preventDefault();
      const direction = Number(actionButton.dataset.direction) < 0 ? -1 : 1;
      const candidate = moveDashboardReference(state.dashboardPeriod, direction);
      const candidateBounds = getDashboardPeriodBounds(state.dashboardPeriod, candidate);
      const nowBounds = getDashboardPeriodBounds(state.dashboardPeriod, new Date());
      if (direction > 0 && candidateBounds.start.getTime() > nowBounds.start.getTime()) {
        return;
      }
      state.dashboardReferenceDate = candidate;
      renderFormationDashboard(root);
      return;
    }

    if (action === 'open-dashboard-sale-detail') {
      event.preventDefault();
      state.dashboardSaleDetailId = normalizeEntityId(actionButton.dataset.saleId);
      renderFormationDashboard(root);
      return;
    }

    if (action === 'close-dashboard-sale-detail') {
      event.preventDefault();
      closeDashboardSaleDetail(root);
      return;
    }

    if (action === 'open-dashboard-edit') {
      event.preventDefault();
      const formationId = normalizeEntityId(actionButton.dataset.id || state.activeFormationId);
      if (!formationId) return;
      void openFormationEditor(formationId, root);
    }
  });

  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (closeDashboardPeriodPicker(root)) {
      event.preventDefault();
      return;
    }
    if (closeSessionTimePicker()) {
      event.preventDefault();
      return;
    }
    if (state.dashboardSaleDetailId) {
      event.preventDefault();
      closeDashboardSaleDetail(root);
    }
  });
}

async function loadDashboardSales({ force = false, container } = {}) {
  if (state.dashboardSalesRequestInFlight && !force) {
    return state.dashboardSalesRequestInFlight;
  }
  if (!force && state.dashboardSalesLoaded && !state.dashboardSalesError) {
    return state.dashboardSales;
  }
  state.dashboardSalesLoading = true;
  state.dashboardSalesError = '';
  renderFormationDashboard(container);
  const request = (async () => {
    try {
      const response = await fetch(`${SALES_ENDPOINT}?limit=1000`, { credentials: 'include' });
      const payload = await getJson(response);
      if (!response.ok) {
        throw new Error(payload?.error || 'Impossible de charger les ventes.');
      }
      state.dashboardSales = Array.isArray(payload?.sales) ? payload.sales : [];
      state.dashboardSalesError = '';
      state.dashboardSalesLoaded = true;
      return state.dashboardSales;
    } catch (error) {
      state.dashboardSalesError = error?.message || 'Impossible de charger les ventes.';
      state.dashboardSales = [];
      state.dashboardSalesLoaded = false;
      logUiError('FormationManager:DashboardSales', error);
      return [];
    } finally {
      state.dashboardSalesLoading = false;
      state.dashboardSalesRequestInFlight = null;
      renderFormationDashboard(container);
    }
  })();
  state.dashboardSalesRequestInFlight = request;
  return request;
}

async function loadDashboardReviewsForFormation(formationId, { force = false, container } = {}) {
  const targetId = normalizeEntityId(formationId);
  if (!targetId) return [];
  const cache = getDashboardReviewCache(targetId);
  if (!cache) return [];
  if (cache.loading) return cache.reviews || [];
  if (!force && cache.loaded) return cache.reviews || [];
  cache.loading = true;
  cache.error = '';
  renderFormationDashboard(container);
  const aggregated = [];
  let page = 1;
  let hasMore = true;
  try {
    while (hasMore) {
      const url = new URL(FORMATION_REVIEWS_ENDPOINT(targetId), window.location.origin);
      url.searchParams.set('page', String(page));
      url.searchParams.set('sort', 'recent');
      const response = await fetch(url.toString(), { credentials: 'include' });
      const payload = await getJson(response);
      if (!response.ok) {
        throw new Error(payload?.error || 'Impossible de charger les avis.');
      }
      const rows = Array.isArray(payload?.reviews) ? payload.reviews : [];
      aggregated.push(...rows);
      hasMore = Boolean(payload?.hasMore);
      page += 1;
      if (page > 30) {
        hasMore = false;
      }
    }
    cache.reviews = aggregated;
    cache.loaded = true;
    cache.error = '';
  } catch (error) {
    cache.reviews = [];
    cache.loaded = false;
    cache.error = error?.message || 'Impossible de charger les avis.';
    logUiError('FormationManager:DashboardReviews', error, { formationId: targetId });
  } finally {
    cache.loading = false;
    renderFormationDashboard(container);
  }
  return cache.reviews || [];
}

async function openFormationDashboard(formationId, container) {
  const root = getRoot(container);
  const normalizedFormationId = normalizeEntityId(formationId);
  if (!normalizedFormationId) return;
  const formation = state.formations.find(entry => normalizeEntityId(entry.id) === normalizedFormationId);
  if (!formation) return;
  closeAllKebabMenus(root);
  closeFormationPromotionModal(root);
  closeFormationBoostModal(root);
  closeSessionTimePicker();
  closeSessionConflictModal();
  state.activeFormationId = formation.id;
  state.dashboardTab = normalizeDashboardTab(state.dashboardTab);
  state.dashboardPeriod = normalizeDashboardPeriod(state.dashboardPeriod);
  state.dashboardPeriodPickerOpen = false;
  if (!(state.dashboardReferenceDate instanceof Date) || Number.isNaN(state.dashboardReferenceDate.getTime())) {
    state.dashboardReferenceDate = new Date();
  }
  state.dashboardSaleDetailId = null;
  setView(VIEW_DASHBOARD, root);
  renderFormationDashboard(root);
  await loadDashboardSales({ container: root });
  if (state.dashboardTab === DASHBOARD_TAB_REVIEWS) {
    await loadDashboardReviewsForFormation(formation.id, { container: root });
  }
}

async function openFormationEditor(formationId, container) {
  const normalizedFormationId = normalizeEntityId(formationId);
  if (!normalizedFormationId) return;
  const formation = state.formations.find(entry => normalizeEntityId(entry.id) === normalizedFormationId);
  if (!formation) return;
  state.dashboardSaleDetailId = null;
  state.dashboardPeriodPickerOpen = false;
  state.editorTab = EDITOR_TAB_INFO;
  await populateForm(formation);
  const root = getRoot(container);
  if (root) {
    setView(VIEW_EDIT, root);
  }
}

function renderList(container) {
  if (!container) return;
  if (!state.formations.length) {
    container.innerHTML = '<p class="module-placeholder">Aucune formation enregistr?e.</p>';
    return;
  }
  container.innerHTML = state.formations
    .map(formation => {
      const typeLabel = TYPE_LABELS[formation.type] || formation.type;
      const cover = formation.coverImage
        ? `<img src=\"${escapeHtml(formation.coverImage)}\" alt=\"Couverture de ${escapeHtml(formation.name)}\" loading=\"lazy\">`
        : `<div class=\"formation-card__placeholder\"><i class=\"bi bi-image\"></i></div>`;
      const statusLabel = formatStatus(formation.status);
      const previewSource = String(formation.previewDescription || formation.description || '');
      const desc = escapeHtml(previewSource || 'Pas de description');
      const soldCount = getFormationSoldCount(formation);
      return `
        <article class=\"formation-card\" data-formation-card data-id=\"${formation.id}\">
          <div class=\"formation-card__media\">${cover}</div>
          <div class=\"formation-card__body\">
            <div class=\"formation-card__top\">
              <span class=\"formation-badge formation-badge--${formation.type}\">${typeLabel}</span>
              <span class=\"formation-card__price\">${formatPrice(formation.price)}</span>
            </div>
            <h3 class=\"formation-card__title\">${escapeHtml(formation.name || 'Sans titre')}</h3>
            <p class=\"formation-card__desc\">${desc}</p>
            <p class=\"formation-card__meta\">
              ${statusLabel} - ${typeLabel}
              <span class="formation-sales-badge">👥 ${formatSoldCountLabel(soldCount)}</span>
            </p>
          </div>
          <div class=\"formation-card__actions\">
            <button class=\"kebab-button\" type=\"button\" data-kebab-toggle data-id=\"${formation.id}\" aria-label=\"Actions\">
              <span aria-hidden=\"true\">⋮</span>
            </button>
            <div class=\"formation-card__menu\" data-kebab-menu data-id=\"${formation.id}\" hidden>
              <button type=\"button\" data-kebab-action=\"view\" data-id=\"${formation.id}\" aria-label=\"Voir\">
                <i class=\"bi bi-eye\"></i>
              </button>
              <button type=\"button\" data-kebab-action=\"edit\" data-id=\"${formation.id}\" aria-label=\"Modifier\">
                <i class=\"bi bi-pencil\"></i>
              </button>
              <button type=\"button\" data-kebab-action=\"delete\" data-id=\"${formation.id}\" aria-label=\"Supprimer\">
                <i class=\"bi bi-trash\"></i>
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
  attachListActions(container);
}

let kebabOutsideListenerAttached = false;

function attachListActions(container) {
  if (!container || container.dataset.listActionsBound === 'true') return;
  container.dataset.listActionsBound = 'true';
  container.addEventListener('click', event => {
    const toggle = event.target.closest('[data-kebab-toggle]');
    if (toggle) {
      event.preventDefault();
      toggleKebabMenu(toggle.dataset.id, container);
      return;
    }
    const action = event.target.closest('[data-kebab-action]');
    if (!action) return;
    event.preventDefault();
    const id = normalizeEntityId(action.dataset.id);
    const formation = state.formations.find(entry => normalizeEntityId(entry.id) === id);
    if (!formation) return;
    closeAllKebabMenus(container);
    if (action.dataset.kebabAction === 'view') {
      void openFormationDashboard(id, container);
      return;
    }
    if (action.dataset.kebabAction === 'edit') {
      void openFormationEditor(id, container);
      return;
    }
    if (action.dataset.kebabAction === 'delete') {
      void handleFormationDelete(id, container);
    }
  });
  if (!kebabOutsideListenerAttached) {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-kebab-toggle]') || event.target.closest('[data-kebab-menu]')) {
        return;
      }
      closeAllKebabMenus();
    });
    kebabOutsideListenerAttached = true;
  }
}

async function openFormationEditorial(container, formation) {
  try {
    const payload = await fetchEditableContent('formation', formation.id);
    const zone = Array.isArray(payload?.zones) && payload.zones.length
      ? payload.zones[0]
      : { key: 'description', label: 'Description éditoriale', description: '' };
    const entry = Array.isArray(payload?.entries)
      ? payload.entries.find(item => item.zoneKey === zone.key)
      : null;
    openEditorialEditor({
      title: zone.label,
      description: zone.description || 'Texte affiché sur la fiche formation.',
      label: `${formation.name} - ${zone.label}`,
      initialHtml: entry?.contentHtml || formation.editorialHtml || formation.legacyDescription || '',
      onSave: html => saveFormationEditorial(formation.id, zone.key, html, container)
    });
  } catch (error) {
    logUiError('FormationManager:LoadFormationEditorial', error, { formationId: formation?.id || null });
    showFeedback(
      container?.querySelector('[data-formation-form-message]'),
      'Impossible de charger le contenu éditorial.',
      'error'
    );
  }
}

async function loadData() {
  await fetchFormations();
}

async function saveFormationEditorial(targetId, zoneKey, html, container) {
  try {
    const payload = await saveEditableContent('formation', targetId, zoneKey, html);
    const contentHtml = String(payload?.entry?.contentHtml || html || '');
    const previewDescription = extractTextPreviewFromHtml(contentHtml);
    const cached = state.formations.find(entry => entry.id === targetId);
    if (cached) {
      cached.editorialHtml = contentHtml;
      cached.previewDescription = previewDescription || cached.previewDescription || cached.description || '';
      cached.description = cached.previewDescription;
    }
    if (state.editingId === targetId) {
      renderFormationDescriptionPreview(
        {
          editorialHtml: contentHtml,
          previewDescription
        },
        container
      );
    }
    showFeedback(
      container?.querySelector('[data-formation-form-message]'),
      'Description editoriale mise a jour.',
      'success'
    );
    showToast({ type: 'success', message: ACTION_TOAST_SUCCESS, durationMs: 1000 });
    await loadData(container);
    if (state.editingId === targetId) {
      const refreshed = state.formations.find(entry => entry.id === targetId);
      renderFormationDescriptionPreview(refreshed, container);
    }
  } catch (error) {
    setActionError(null, 'FormationManager:SaveFormationEditorial', error, { targetId, zoneKey });
    showFeedback(
      container?.querySelector('[data-formation-form-message]'),
      "Impossible d'enregistrer la description editoriale.",
      'error'
    );
  }
}

async function loadFormationRelatedData(formation) {
  if (!formation?.id) return;
  if (formation.type === 'distanciel') {
    state.selectedFormationId = formation.id;
    await fetchModulesForSelectedFormation(formation.id, { silent: true });
  } else {
    state.selectedPresentielId = formation.id;
    state.sessionDurationDays = normalizeDurationDaysValue(formation.durationDays, 1);
    await fetchSessionsForSelectedPresentiel(formation.id, { silent: true });
  }
}

async function populateForm(formation) {
  const form = document.querySelector('[data-formation-form]');
  const feedback = document.querySelector('[data-formation-form-message]');
  const root = document.querySelector('[data-module-root]');
  if (!form) return;
  state.editingId = formation.id;
  state.activeFormationId = formation.id;
  form.querySelector('[name="id"]').value = formation.id || '';
  form.querySelector('[name="type"]').value = formation.type || 'distanciel';
  form.querySelector('[name="status"]').value = formation.status || 'draft';
  form.querySelector('[name="durationDays"]').value = formation.durationDays || 1;
  form.querySelector('[name="refundDays"]').value = normalizeRefundDaysValue(formation.refundDays, 7);
  openEditView();
  const title = root?.querySelector('[data-create-title]');
  if (title) {
    title.textContent = formation.name || 'Edition de formation';
  }
  form.querySelector('[name="name"]').value = formation.name || '';
  form.querySelector('[name="formalities"]').value = formation.formalities || '';
  form.querySelector('[name="price"]').value = formation.price || '';
  form.querySelector('[name="coverImage"]').value = formation.coverImage || '';
  form.querySelector('[name="trailerVideoTitle"]').value = formation.trailerVideoTitle || '';
  form.querySelector('[name="trailerVideoUrl"]').value = formation.trailerVideoUrl || '';
  form.querySelector('[name="whatsappGroupTitle"]').value = formation.whatsappGroupTitle || '';
  form.querySelector('[name="whatsappGroupUrl"]').value = formation.whatsappGroupUrl || '';
  syncRefundDaysWidget(form, formation.refundDays);
  updateTypeToggleUI(form);
  renderFormationDescriptionPreview(formation, root);
  showFeedback(feedback, 'Modification en cours', 'info');
  closeFormationMetaKebab();
  closeStatusPicker(form);
  const coverField = form.querySelector('[name="coverImage"]');
  const fileField = form.querySelector('[name="coverImageFile"]');
  if (coverField) {
    coverField.value = formation.coverImage || '';
  }
  if (fileField) {
    fileField.value = '';
  }
  setCoverPreview(formation.coverImage || '');
  renderFormationInfoWidgets();
  showCoverUploadFeedback('', '');
  logDev('[FM] promo raw', formation.id || formation._id || null, formation.activePromotion, formation.promotions);
  const normalizedFormationId = String(formation.id || formation._id || '');
  if (state.dismissedPromotionFormationId && state.dismissedPromotionFormationId !== normalizedFormationId) {
    state.dismissedPromotionFormationId = null;
  }
  state.activePromotion = state.dismissedPromotionFormationId === normalizedFormationId
    ? null
    : getActivePromotion(formation);
  renderFormationPromotionStatus(root, state.activePromotion);
  updateFormationPromotionPricePreview(root);
  syncCurrentFormationBoostState(root, { silent: true });
  await loadFormationRelatedData(formation);
  await loadFormationPromotionState(formation.id, root);
  await loadBoosts(root);
  syncTypeManagedSections(root);
  updateSecondaryActionsState(root);
}

function resetForm() {
  const form = document.querySelector('[data-formation-form]');
  const feedback = document.querySelector('[data-formation-form-message]');
  if (!form) return;
  form.reset();
  form.querySelector('[name="id"]').value = '';
  state.editingId = null;
  state.activeFormationId = null;
  state.editorTab = EDITOR_TAB_INFO;
  showFeedback(feedback, '');
  const coverField = form.querySelector('[name="coverImage"]');
  if (coverField) {
    coverField.value = '';
  }
  const durationField = form.querySelector('[name="durationDays"]');
  if (durationField) {
    durationField.value = '1';
  }
  const refundDaysField = form.querySelector('[name="refundDays"]');
  if (refundDaysField) {
    refundDaysField.value = '7';
  }
  const formalitiesField = form.querySelector('[name="formalities"]');
  if (formalitiesField) {
    formalitiesField.value = '';
  }
  const typeField = form.querySelector('[name="type"]');
  if (typeField) {
    typeField.value = 'distanciel';
  }
  setFormationFieldValue('trailerVideoTitle', '');
  setFormationFieldValue('trailerVideoUrl', '');
  setFormationFieldValue('whatsappGroupTitle', '');
  setFormationFieldValue('whatsappGroupUrl', '');
  setFormationFieldValue('status', 'draft');
  syncRefundDaysWidget(form, 7);
  state.dismissedPromotionFormationId = null;
  const title = document.querySelector('[data-create-title]');
  if (title) {
    title.textContent = 'Créer ou modifier une formation';
  }
  updateTypeToggleUI(form);
  renderFormationDescriptionPreview(null, document.querySelector('[data-module-root]'));
  state.pendingTypeChange = null;
  state.selectedFormationId = null;
  state.selectedPresentielId = null;
  state.modules = [];
  resetModuleDragState();
  teardownModuleDragListeners();
  clearModuleDragIndicator();
  releaseModuleDragMirror();
  closeAllModuleKebabs();
  closeAllModuleEditorKebabs();
  setModuleView(MODULE_PANEL_LIST);
  state.sessions = [];
  state.sessionSelectedDates = [];
  renderModuleFormationOptions();
  renderSessionFormationOptions();
  renderModuleList();
  renderSessionList();
  renderSessionCalendar();
  setCoverPreview('');
  renderFormationInfoWidgets();
  showCoverUploadFeedback('', '');
  const root = document.querySelector('[data-module-root]');
  closeFormationMetaKebab();
  closeStatusPicker(form);
  closeTrailerModal();
  closeWhatsappModal();
  resetFormationPromotionForm(root);
  resetFormationBoostControls(root);
  syncTypeManagedSections(root);
  updateSecondaryActionsState(root);
}

async function fetchFormations() {
  const container = document.querySelector('[data-formation-list]');
  try {
    const response = await fetch(API_ROOT, { credentials: 'include' });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de charger les formations.');
    }
    state.formations = Array.isArray(payload.formations) ? payload.formations : [];
    renderList(container);
    syncDistancielFormations();
    syncPresentielFormations();
    if (state.view !== VIEW_LIST && state.editingId) {
      const current = state.formations.find(item => item.id === state.editingId);
      if (current) {
        await loadFormationRelatedData(current);
      }
    }
    if (state.view === VIEW_DASHBOARD && state.activeFormationId) {
      renderFormationDashboard();
    }
    syncTypeManagedSections();
    syncViewVisibility();
  } catch (error) {
    console.error('Erreur chargement formations', error);
    if (container) {
      container.innerHTML = '<p class="module-placeholder">Impossible de charger les formations.</p>';
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const feedback = document.querySelector('[data-formation-form-message]');
  const saveButton = form?.querySelector('button[type="submit"]');
  if (!form) return;
  if (saveButton?.dataset.actionState === 'loading') return;
  const wasEditing = Boolean(state.editingId);
  const coverField = form.querySelector('[name="coverImage"]');
  const payload = {
    name: (form.querySelector('[name="name"]')?.value || '').trim(),
    formalities: (form.querySelector('[name="formalities"]')?.value || '').trim(),
    durationDays: Number(form.querySelector('[name="durationDays"]')?.value) || 1,
    refundDays: normalizeRefundDaysValue(form.querySelector('[name="refundDays"]')?.value, 7),
    price: Number(form.querySelector('[name="price"]')?.value) || 0,
    coverImage: (coverField?.value || '').trim(),
    trailerVideoTitle: (form.querySelector('[name="trailerVideoTitle"]')?.value || '').trim(),
    trailerVideoUrl: (form.querySelector('[name="trailerVideoUrl"]')?.value || '').trim(),
    whatsappGroupTitle: (form.querySelector('[name="whatsappGroupTitle"]')?.value || '').trim(),
    whatsappGroupUrl: (form.querySelector('[name="whatsappGroupUrl"]')?.value || '').trim() || null,
    type: form.querySelector('[name="type"]')?.value,
    status: form.querySelector('[name="status"]')?.value
  };
  if (!payload.name) {
    setActionError(saveButton, 'FormationManager:SaveFormation', new Error('Le nom est requis.'), { payload });
    return showFeedback(feedback, 'Le nom est requis.', 'error');
  }
  const endpoint = state.editingId ? `${API_ROOT}/${state.editingId}` : API_ROOT;
  const method = state.editingId ? 'PUT' : 'POST';
  setActionLoading(saveButton, 'Enregistrement...');
  try {
    const response = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await getJson(response);
    if (!response.ok) {
      if (body?.error === 'FORMATION_TYPE_LOCKED') {
        updateTypeToggleUI(form);
      }
      const message = body?.message || body?.error || 'Impossible de sauvegarder.';
      setActionError(saveButton, 'FormationManager:SaveFormation', new Error(message), {
        endpoint,
        method,
        status: response.status,
        payload,
        responseBody: body
      });
      return showFeedback(feedback, message, 'error');
    }
    const savedId = body?.formation?.id || state.editingId;
    setActionSuccess(saveButton, 'R?ussi');
    showFeedback(feedback, wasEditing ? 'Formation mise a jour.' : 'Formation creee.', 'success');
    await fetchFormations();
    if (savedId) {
      const saved = state.formations.find(item => item.id === savedId);
      if (saved) {
        await populateForm(saved);
      }
    } else {
      resetForm();
      backToListView();
    }
  } catch (error) {
    setActionError(saveButton, 'FormationManager:SaveFormation', error, {
      endpoint,
      method,
      payload
    });
    showFeedback(feedback, 'Erreur r?seau.', 'error');
  }
}

function attachFormEvents(container) {
  const form = container.querySelector('[data-formation-form]');
  form?.addEventListener('submit', handleSubmit);
  container.querySelector('[data-action="reset-formation"]')?.addEventListener('click', resetForm);
  const priceInput = form?.querySelector('[name="price"]');
  priceInput?.addEventListener('input', () => updateFormationPromotionPricePreview(container));
  const durationInput = form?.querySelector('[name="durationDays"]');
  durationInput?.addEventListener('input', () => {
    const parsed = Number(durationInput.value);
    state.sessionDurationDays = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
    updateSessionDurationText(state.sessionDurationDays);
    renderSessionScheduleInputs(state.sessionDurationDays);
    renderSessionCalendar();
  });
  syncRefundDaysWidget(form, form?.querySelector('[name="refundDays"]')?.value || 7);
  const messageTarget = container.querySelector('[data-formation-form-message]');
  container.querySelector('[data-action="open-editorial"]')?.addEventListener('click', event => {
    event.preventDefault();
    const fallbackId = normalizeEntityId(form?.querySelector('[name="id"]')?.value || '');
    const editingId = normalizeEntityId(state.editingId || fallbackId);
    if (!editingId) {
      showFeedback(messageTarget, 'Sauvegardez la formation pour ouvrir l editor.', 'info');
      return;
    }
    state.editingId = editingId;
    const formation = state.formations.find(entry => normalizeEntityId(entry.id) === editingId) || {
      id: editingId,
      name: String(form?.querySelector('[name="name"]')?.value || '').trim() || 'Formation',
      editorialHtml: ''
    };
    if (!formation?.id) {
      showFeedback(messageTarget, "Impossible d'ouvrir l editor.", 'error');
      return;
    }
    void openFormationEditorial(container, formation);
  });
  form?.addEventListener('click', event => {
    if (handleRefundDaysWidgetAction(event, form)) {
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action || '';
    if (!action) return;
    if (action === 'trigger-cover-upload') {
      event.preventDefault();
      form.querySelector('[name="coverImageFile"]')?.click();
      return;
    }
    if (action === 'toggle-formation-meta-kebab') {
      event.preventDefault();
      const kind = event.target.closest('[data-action="toggle-formation-meta-kebab"]')?.dataset.kind || '';
      toggleFormationMetaKebab(kind);
      return;
    }
    if (action === 'open-trailer-modal-create') {
      event.preventDefault();
      closeFormationMetaKebab();
      openTrailerModal('create');
      return;
    }
    if (action === 'open-trailer-modal-edit') {
      event.preventDefault();
      closeFormationMetaKebab();
      openTrailerModal('edit');
      return;
    }
    if (action === 'save-trailer-modal') {
      event.preventDefault();
      saveTrailerModal();
      return;
    }
    if (action === 'cancel-trailer-modal') {
      event.preventDefault();
      closeTrailerModal();
      return;
    }
    if (action === 'delete-trailer-meta') {
      event.preventDefault();
      closeFormationMetaKebab();
      void deleteTrailerMeta();
      return;
    }
    if (action === 'open-whatsapp-modal-create') {
      event.preventDefault();
      closeFormationMetaKebab();
      openWhatsappModal('create');
      return;
    }
    if (action === 'open-whatsapp-modal-edit') {
      event.preventDefault();
      closeFormationMetaKebab();
      openWhatsappModal('edit');
      return;
    }
    if (action === 'save-whatsapp-modal') {
      event.preventDefault();
      saveWhatsappModal();
      return;
    }
    if (action === 'cancel-whatsapp-modal') {
      event.preventDefault();
      closeWhatsappModal();
      return;
    }
    if (action === 'delete-whatsapp-meta') {
      event.preventDefault();
      closeFormationMetaKebab();
      void deleteWhatsappMeta();
      return;
    }
    if (action === 'toggle-status-picker') {
      event.preventDefault();
      if (state.statusPickerOpen) {
        closeStatusPicker(form);
      } else {
        openStatusPicker(form);
      }
      return;
    }
    if (action === 'choose-status-option') {
      event.preventDefault();
      const value = event.target.closest('[data-status-option]')?.dataset.value || '';
      void applyStatusChange(value, { confirmChange: true });
      return;
    }
  });
  form?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeFormationMetaKebab();
    closeStatusPicker(form);
    closeTrailerModal();
    closeWhatsappModal();
  });
  if (!form?.dataset.metaOutsideBound) {
    document.addEventListener('click', event => {
      const root = getRoot(container);
      if (!root || !document.body.contains(root)) return;
      if (
        event.target.closest('[data-action="toggle-formation-meta-kebab"]') ||
        event.target.closest('[data-formation-meta-menu]')
      ) {
        return;
      }
      closeFormationMetaKebab();
    });
    document.addEventListener('click', event => {
      const root = getRoot(container);
      if (!root || !document.body.contains(root)) return;
      if (
        event.target.closest('[data-action="toggle-status-picker"]') ||
        event.target.closest('[data-status-picker-menu]')
      ) {
        return;
      }
      closeStatusPicker(root.querySelector('[data-formation-form]'));
    });
    form.dataset.metaOutsideBound = 'true';
  }
}

function attachFormationMiniModalEvents(container) {
  const root = getRoot(container);
  if (!root) return;
  const trailerOverlay = root.querySelector('[data-trailer-modal]');
  if (trailerOverlay && trailerOverlay.dataset.bound !== 'true') {
    trailerOverlay.dataset.bound = 'true';
    trailerOverlay.addEventListener('click', event => {
      if (event.target === trailerOverlay) {
        closeTrailerModal();
      }
    });
    trailerOverlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTrailerModal();
      }
    });
    trailerOverlay.querySelector('[data-action="save-trailer-modal"]')?.addEventListener('click', event => {
      event.preventDefault();
      saveTrailerModal();
    });
    trailerOverlay.querySelector('[data-action="cancel-trailer-modal"]')?.addEventListener('click', event => {
      event.preventDefault();
      closeTrailerModal();
    });
  }
  const whatsappOverlay = root.querySelector('[data-whatsapp-modal]');
  if (whatsappOverlay && whatsappOverlay.dataset.bound !== 'true') {
    whatsappOverlay.dataset.bound = 'true';
    whatsappOverlay.addEventListener('click', event => {
      if (event.target === whatsappOverlay) {
        closeWhatsappModal();
      }
    });
    whatsappOverlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWhatsappModal();
      }
    });
    whatsappOverlay.querySelector('[data-action="save-whatsapp-modal"]')?.addEventListener('click', event => {
      event.preventDefault();
      saveWhatsappModal();
    });
    whatsappOverlay.querySelector('[data-action="cancel-whatsapp-modal"]')?.addEventListener('click', event => {
      event.preventDefault();
      closeWhatsappModal();
    });
  }
  const fileRenameOverlay = root.querySelector('[data-file-rename-modal]');
  if (fileRenameOverlay && fileRenameOverlay.dataset.bound !== 'true') {
    fileRenameOverlay.dataset.bound = 'true';
    fileRenameOverlay.addEventListener('click', event => {
      if (event.target === fileRenameOverlay) {
        closeFileRenameModal();
      }
    });
    fileRenameOverlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFileRenameModal();
      }
    });
    fileRenameOverlay.querySelector('[data-action="save-file-rename"]')?.addEventListener('click', event => {
      event.preventDefault();
      void saveFileRenameModal(event.target.closest('[data-action="save-file-rename"]'));
    });
    fileRenameOverlay.querySelector('[data-action="cancel-file-rename"]')?.addEventListener('click', event => {
      event.preventDefault();
      closeFileRenameModal();
    });
  }
}

function getModuleRoot(container) {
  const root = getRoot(container);
  if (!root) return null;
  if (typeof root.matches === 'function' && root.matches('[data-module-workspace]')) {
    return root;
  }
  return root.querySelector('[data-module-workspace]') || null;
}

function getOrderedModules() {
  if (!state.moduleOrderMode || !Array.isArray(state.moduleDraftOrderIds) || !state.moduleDraftOrderIds.length) {
    return [...state.modules];
  }
  const byId = new Map(state.modules.map(module => [String(module.id || ''), module]));
  const ordered = [];
  state.moduleDraftOrderIds.forEach(id => {
    const module = byId.get(String(id || ''));
    if (module) ordered.push(module);
  });
  state.modules.forEach(module => {
    if (!ordered.some(entry => entry.id === module.id)) {
      ordered.push(module);
    }
  });
  return ordered;
}

function syncModuleDraftOrderFromModules() {
  state.moduleDraftOrderIds = getOrderedModules().map(module => module.id);
}

function setModuleView(viewName, container) {
  const root = getModuleRoot(container);
  if (!root) return;
  state.moduleView = viewName === MODULE_PANEL_EDITOR ? MODULE_PANEL_EDITOR : MODULE_PANEL_LIST;
  root.querySelectorAll('[data-module-panel]').forEach(panel => {
    const shouldShow = panel.dataset.modulePanel === state.moduleView;
    const displayClass = panel.dataset.panelDisplay || 'block';
    setElementVisibility(panel, shouldShow, displayClass);
  });
  const title = root.querySelector('[data-module-editor-title]');
  if (title) {
    title.textContent = state.moduleEditingId ? 'Modifier un module' : 'Créer un module';
  }
  const inlineDelete = root.querySelector('[data-action="delete-module-inline"]');
  if (inlineDelete) {
    inlineDelete.hidden = !state.moduleEditingId;
    inlineDelete.disabled = !state.moduleEditingId;
  }
  if (state.moduleView === MODULE_PANEL_EDITOR) {
    ensureModuleDraft();
    const titleInput = root.querySelector('[name="moduleTitle"]');
    if (titleInput) {
      titleInput.value = state.moduleDraft.title || '';
    }
    renderModuleDescriptionPreview();
    renderModuleVideosList();
    renderModuleFilesPreview();
    setModuleEditorTab(state.moduleEditorTab || MODULE_EDITOR_TAB_INFO);
  } else {
    state.moduleEditorTab = MODULE_EDITOR_TAB_INFO;
    state.moduleVideoInfoOpen = false;
    state.moduleVideoInfoAnchorEl = null;
    state.moduleVideoKebabId = null;
    state.moduleVideoOrderMode = false;
    state.moduleVideoDraftOrderIds = [];
    state.moduleVideoView = MODULE_VIDEO_VIEW_LIST;
    state.moduleVideoEditingId = null;
    state.moduleVideoEditorDraft = {
      id: null,
      title: '',
      url: '',
      descriptionEditorial: ''
    };
    state.moduleFileKebabId = null;
    state.moduleFileOrderMode = false;
    state.moduleFileDraftOrderIds = [];
    teardownModuleVideoDragListeners();
    teardownModuleFileDragListeners();
    clearModuleDragIndicator();
    syncModuleVideoInfoOverlay();
  }
  if (FM_DEV_LOGS) {
    console.debug('[FormationModules] view=', state.moduleView, 'editing=', state.moduleEditingId || null);
  }
}

function closeAllModuleKebabs(container) {
  const root = getModuleRoot(container) || document;
  root.querySelectorAll('[data-module-kebab-menu]').forEach(menu => {
    menu.classList.remove('is-open');
    menu.hidden = true;
  });
  state.moduleKebabId = null;
}

function closeAllModuleEditorKebabs(container) {
  const root = getModuleRoot(container) || document;
  root.querySelectorAll('[data-module-video-kebab-menu], [data-module-file-kebab-menu]').forEach(menu => {
    menu.classList.remove('is-open');
    menu.hidden = true;
  });
  state.moduleVideoKebabId = null;
  state.moduleFileKebabId = null;
}

function toggleModuleKebab(moduleId, container) {
  if (!moduleId || state.moduleOrderMode) return;
  const root = getModuleRoot(container);
  if (!root) return;
  const menu = root.querySelector(`[data-module-kebab-menu][data-id="${moduleId}"]`);
  if (!menu) return;
  const isOpen = !menu.hidden;
  closeAllModuleKebabs(root);
  if (!isOpen) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    state.moduleKebabId = moduleId;
  }
}

function ensureModuleKebabGlobalListeners(container) {
  if (!moduleKebabOutsideListenerAttached) {
    document.addEventListener('click', event => {
      if (
        event.target.closest('[data-module-kebab-toggle]') ||
        event.target.closest('[data-module-kebab-menu]') ||
        event.target.closest('[data-module-video-kebab-toggle]') ||
        event.target.closest('[data-module-video-kebab-menu]') ||
        event.target.closest('[data-module-file-kebab-toggle]') ||
        event.target.closest('[data-module-file-kebab-menu]') ||
        event.target.closest('[data-action="open-module-video-info"]') ||
        event.target.closest('[data-module-video-info-card]')
      ) {
        return;
      }
      closeAllModuleKebabs();
      closeAllModuleEditorKebabs();
      closeModuleVideoInfoOverlay();
    });
    moduleKebabOutsideListenerAttached = true;
  }
  if (!moduleKebabEscapeListenerAttached) {
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeAllModuleKebabs(container);
      closeAllModuleEditorKebabs(container);
      closeModuleVideoInfoOverlay();
    });
    moduleKebabEscapeListenerAttached = true;
  }
}

function ensureModuleVideoInfoViewportListeners() {
  if (moduleVideoInfoViewportListenersAttached) return;
  const reposition = () => {
    if (!state.moduleVideoInfoOpen) return;
    positionModuleVideoInfoOverlay();
  };
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  moduleVideoInfoViewportListenersAttached = true;
}

function resetModuleDragState() {
  state.moduleOrderMode = false;
  state.moduleDraftOrderIds = [];
  moduleDragSourceId = null;
  moduleDropTargetId = null;
  moduleDropAfter = false;
  modulePendingDragCard = null;
  moduleManualDragStarted = false;
  moduleDragStartPoint = null;
}

function resetModuleEditorState(container) {
  resetModuleForm();
  setModuleView(MODULE_PANEL_LIST, container);
}

function getModuleForm() {
  return document.querySelector('[data-module-form]');
}

function getModuleListContainer() {
  return document.querySelector('[data-module-list]');
}

function getModuleFeedbackElement() {
  return document.querySelector('[data-module-form-message]');
}

function getModuleFileInput() {
  const form = getModuleForm();
  return form?.querySelector('[name="moduleFilesUpload"]');
}

function getModuleEditorRoot() {
  const form = getModuleForm();
  if (form) return form;
  return document.querySelector('[data-module-editor-root]');
}

function getModuleEditorTrack() {
  return getModuleEditorRoot()?.querySelector('[data-module-editor-tabs-track]') || null;
}

function getModuleEditorArrow() {
  return getModuleEditorRoot()?.querySelector('[data-module-editor-tab-arrow]') || null;
}

function getModuleVideoListContainer() {
  return document.querySelector('[data-module-videos-list]');
}

function getModuleVideoEditorContainer() {
  return document.querySelector('[data-module-video-editor]');
}

function getModuleVideoEditorPreviewElement() {
  return document.querySelector('[data-module-video-description-preview-content]');
}

function getModuleVideoInfoOverlay() {
  return document.querySelector('[data-module-video-info-overlay]');
}

function syncModuleVideoInfoOverlay() {
  const overlay = getModuleVideoInfoOverlay();
  if (!overlay) return;
  const shouldShow = Boolean(state.moduleVideoInfoOpen);
  if (!shouldShow) {
    overlay.classList.remove('is-open');
    overlay.style.removeProperty('left');
    overlay.style.removeProperty('top');
    setElementVisibility(overlay, false, overlay.dataset.panelDisplay || 'block');
    return;
  }
  setElementVisibility(overlay, true, overlay.dataset.panelDisplay || 'block');
  positionModuleVideoInfoOverlay();
  overlay.classList.remove('is-open');
  requestAnimationFrame(() => {
    positionModuleVideoInfoOverlay();
    overlay.classList.add('is-open');
  });
  overlay.focus();
}

function positionModuleVideoInfoOverlay() {
  const overlay = getModuleVideoInfoOverlay();
  if (!overlay || !state.moduleVideoInfoOpen) return;
  const anchor =
    state.moduleVideoInfoAnchorEl && document.contains(state.moduleVideoInfoAnchorEl)
      ? state.moduleVideoInfoAnchorEl
      : document.querySelector('[data-action="open-module-video-info"]');
  if (!anchor) return;
  const anchorRect = anchor.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const viewportPadding = 8;
  const gap = 8;
  let left = anchorRect.left + anchorRect.width - overlayRect.width;
  let top = anchorRect.bottom + gap;
  if (left < viewportPadding) {
    left = viewportPadding;
  }
  if (left + overlayRect.width > window.innerWidth - viewportPadding) {
    left = window.innerWidth - overlayRect.width - viewportPadding;
  }
  if (top + overlayRect.height > window.innerHeight - viewportPadding) {
    top = anchorRect.top - overlayRect.height - gap;
  }
  if (top < viewportPadding) {
    top = viewportPadding;
  }
  overlay.style.left = `${Math.round(left)}px`;
  overlay.style.top = `${Math.round(top)}px`;
}

function getModuleDescriptionPreviewElement() {
  return document.querySelector('[data-module-description-preview-content]');
}

function normalizeModuleVideoEntry(entry = {}, fallbackIndex = 0) {
  const normalized = entry && typeof entry === 'object' ? entry : {};
  const id = String(normalized.id || normalized.videoId || `video-${Date.now()}-${fallbackIndex}-${Math.random().toString(16).slice(2)}`);
  const title = String(normalized.title || normalized.label || '').trim();
  const url = String(normalized.url || '').trim();
  const descriptionEditorial = String(normalized.descriptionEditorial || normalized.descriptionHtml || '').trim();
  const previewDescription = extractTextPreviewFromHtml(descriptionEditorial);
  const rawOrder = Number(normalized.order);
  return {
    id,
    title,
    url,
    descriptionEditorial,
    previewDescription,
    order: Number.isFinite(rawOrder) && rawOrder > 0 ? Math.floor(rawOrder) : fallbackIndex + 1
  };
}

function normalizeModuleFileEntry(entry = {}, fallbackIndex = 0) {
  const normalized = entry && typeof entry === 'object' ? entry : {};
  const id = String(normalized.fileId || normalized.id || `file-${Date.now()}-${fallbackIndex}-${Math.random().toString(16).slice(2)}`);
  const name = String(normalized.name || 'Fichier').trim() || 'Fichier';
  const title = String(normalized.title || normalized.displayTitle || '').trim();
  const url = String(normalized.url || '').trim();
  const rawSize = Number(normalized.size);
  const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.floor(rawSize) : 0;
  const rawOrder = Number(normalized.order);
  return {
    fileId: id,
    name,
    title,
    url,
    size,
    order: Number.isFinite(rawOrder) && rawOrder > 0 ? Math.floor(rawOrder) : fallbackIndex + 1
  };
}

function normalizeModuleDraftVideos(videos = []) {
  if (!Array.isArray(videos)) return [];
  const normalized = videos
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return normalizeModuleVideoEntry({ url: entry, order: index + 1 }, index);
      }
      const source = entry && typeof entry === 'object' ? entry : {};
      if (!source.url && !source.embedUrl && typeof source === 'object') {
        source.url = source.embedUrl || '';
      }
      return normalizeModuleVideoEntry(source, index);
    });
  normalized.sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  return normalized.map((entry, index) => ({
    ...entry,
    order: index + 1
  }));
}

function normalizeModuleDraftFiles(files = []) {
  if (!Array.isArray(files)) return [];
  const normalized = files
    .map((entry, index) => normalizeModuleFileEntry(entry, index))
    .filter(entry => entry.url);
  normalized.sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  return normalized.map((entry, index) => ({
    ...entry,
    order: index + 1
  }));
}

function buildEmptyModuleDraft() {
  return {
    title: '',
    descriptionEditorial: '',
    videos: [],
    files: []
  };
}

function ensureModuleDraft() {
  if (!state.moduleDraft || typeof state.moduleDraft !== 'object') {
    state.moduleDraft = buildEmptyModuleDraft();
  }
  state.moduleDraft.title = String(state.moduleDraft.title || '').trim();
  state.moduleDraft.descriptionEditorial = String(state.moduleDraft.descriptionEditorial || '').trim();
  state.moduleDraft.videos = normalizeModuleDraftVideos(state.moduleDraft.videos);
  state.moduleDraft.files = normalizeModuleDraftFiles(state.moduleDraft.files);
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isLikelyVideoUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) return false;
  return MODULE_VIDEO_URL_PATTERN.test(url);
}

function renderModuleFormationOptions() {
  // The modules panel is scoped to the currently edited distanciel formation.
  // Keep this helper as a no-op to avoid side effects in existing call sites.
}

function normalizeModuleEditorTab(tabName) {
  return MODULE_EDITOR_TAB_VALUES.has(tabName) ? tabName : MODULE_EDITOR_TAB_INFO;
}

function updateModuleEditorTabArrow() {
  const nav = getModuleEditorRoot();
  const track = getModuleEditorTrack();
  const arrow = getModuleEditorArrow();
  if (!track) return;
  updateTabsScrollToggle(nav, track);
  const activeButton = track?.querySelector('[data-module-editor-tab].is-active');
  if (!track || !arrow || !activeButton) return;
  const arrowHalfWidth = 8;
  const x =
    track.offsetLeft +
    activeButton.offsetLeft -
    track.scrollLeft +
    activeButton.offsetWidth / 2 -
    arrowHalfWidth;
  arrow.style.transform = `translateX(${Math.max(0, Math.round(x))}px)`;
}

function setModuleEditorTab(tabName) {
  const root = getModuleEditorRoot();
  if (!root) return;
  const nextTab = normalizeModuleEditorTab(tabName);
  state.moduleEditorTab = nextTab;
  root.querySelectorAll('[data-module-editor-panel]').forEach(panel => {
    const shouldShow = panel.dataset.moduleEditorPanel === nextTab;
    setElementVisibility(panel, shouldShow, panel.dataset.panelDisplay || 'block');
  });
  root.querySelectorAll('[data-module-editor-tab]').forEach(button => {
    const isActive = button.dataset.moduleEditorTab === nextTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (nextTab === MODULE_EDITOR_TAB_INFO) {
    renderModuleDescriptionPreview();
  }
  if (nextTab === MODULE_EDITOR_TAB_VIDEOS) {
    renderModuleVideosList();
    setModuleVideoView(state.moduleVideoView || MODULE_VIDEO_VIEW_LIST);
    renderModuleVideoEditorPreview();
  }
  if (nextTab === MODULE_EDITOR_TAB_FILES) {
    renderModuleFilesPreview();
    if (state.moduleFileOrderMode) {
      setupModuleFileDragListeners();
    }
  } else {
    teardownModuleFileDragListeners();
    clearModuleDragIndicator();
  }
  if (nextTab !== MODULE_EDITOR_TAB_VIDEOS) {
    state.moduleVideoInfoOpen = false;
    state.moduleVideoInfoAnchorEl = null;
    syncModuleVideoInfoOverlay();
    if (state.moduleVideoOrderMode) {
      teardownModuleVideoDragListeners();
      clearModuleDragIndicator();
    }
  }
  requestAnimationFrame(() => updateModuleEditorTabArrow());
}

function renderModuleDescriptionPreview() {
  ensureModuleDraft();
  const preview = getModuleDescriptionPreviewElement();
  if (!preview) return;
  if (!state.moduleDraft.descriptionEditorial) {
    preview.innerHTML = '<p class="module-placeholder">Aucune description editoriale pour le moment.</p>';
    return;
  }
  preview.innerHTML = `<div class="editorial-detail">${state.moduleDraft.descriptionEditorial}</div>`;
}

function getVideoTitleFromUrl(videoUrl = '', index = 0) {
  const url = String(videoUrl || '').trim();
  if (!url) return `Video ${index + 1}`;
  try {
    const normalized = url.startsWith('//') ? `https:${url}` : url;
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, '');
    return host || `Video ${index + 1}`;
  } catch (_error) {
    return `Video ${index + 1}`;
  }
}

function getOrderedModuleDraftVideos() {
  ensureModuleDraft();
  if (!state.moduleVideoOrderMode || !Array.isArray(state.moduleVideoDraftOrderIds) || !state.moduleVideoDraftOrderIds.length) {
    return [...state.moduleDraft.videos];
  }
  const byId = new Map(state.moduleDraft.videos.map(video => [String(video.id || ''), video]));
  const ordered = [];
  state.moduleVideoDraftOrderIds.forEach(videoId => {
    const video = byId.get(String(videoId || ''));
    if (video) ordered.push(video);
  });
  state.moduleDraft.videos.forEach(video => {
    if (!ordered.some(entry => entry.id === video.id)) {
      ordered.push(video);
    }
  });
  return ordered;
}

function syncModuleVideoDraftOrderFromVideos() {
  const ordered = getOrderedModuleDraftVideos();
  state.moduleVideoDraftOrderIds = ordered.map(video => video.id);
}

function getOrderedModuleDraftFiles() {
  ensureModuleDraft();
  if (!state.moduleFileOrderMode || !state.moduleFileDraftOrderIds.length) {
    return [...state.moduleDraft.files];
  }
  const byId = new Map(state.moduleDraft.files.map(file => [String(file.fileId || ''), file]));
  const ordered = [];
  state.moduleFileDraftOrderIds.forEach(fileId => {
    const file = byId.get(String(fileId || ''));
    if (file) ordered.push(file);
  });
  state.moduleDraft.files.forEach(file => {
    if (!ordered.some(entry => entry.fileId === file.fileId)) {
      ordered.push(file);
    }
  });
  return ordered;
}

function syncModuleFileDraftOrderFromFiles() {
  const ordered = getOrderedModuleDraftFiles();
  state.moduleFileDraftOrderIds = ordered.map(file => file.fileId);
}

function setModuleVideoView(viewName) {
  const nextView = viewName === MODULE_VIDEO_VIEW_EDITOR ? MODULE_VIDEO_VIEW_EDITOR : MODULE_VIDEO_VIEW_LIST;
  state.moduleVideoView = nextView;
  state.moduleVideoInfoOpen = false;
  state.moduleVideoInfoAnchorEl = null;
  document.querySelectorAll('[data-module-video-view]').forEach(panel => {
    const shouldShow = panel.dataset.moduleVideoView === nextView;
    setElementVisibility(panel, shouldShow, panel.dataset.panelDisplay || 'block');
  });
  syncModuleVideoInfoOverlay();
}

function renderModuleVideoEditorPreview() {
  const preview = getModuleVideoEditorPreviewElement();
  if (!preview) return;
  const descriptionEditorial = String(state.moduleVideoEditorDraft?.descriptionEditorial || '').trim();
  if (!descriptionEditorial) {
    preview.innerHTML = '<p class="module-placeholder">Aucune description editoriale video.</p>';
    return;
  }
  preview.innerHTML = `<div class="editorial-detail">${descriptionEditorial}</div>`;
}

function populateModuleVideoEditor(video = null) {
  const nextVideo = video && typeof video === 'object'
    ? { ...video }
    : {
        id: `video-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: '',
        url: '',
        descriptionEditorial: '',
        order: state.moduleDraft.videos.length + 1
      };
  state.moduleVideoEditingId = nextVideo.id;
  state.moduleVideoEditorDraft = {
    id: nextVideo.id,
    title: String(nextVideo.title || '').trim(),
    url: String(nextVideo.url || '').trim(),
    descriptionEditorial: String(nextVideo.descriptionEditorial || '').trim()
  };
  const editor = getModuleVideoEditorContainer();
  const title = editor?.querySelector('[data-module-video-editor-title]');
  if (title) {
    title.textContent = video ? 'Modifier la video' : 'Ajouter une video';
  }
  const editorialButton = editor?.querySelector('[data-action="open-video-editorial"]');
  if (editorialButton) {
    editorialButton.dataset.id = state.moduleVideoEditorDraft.id;
  }
  const titleInput = editor?.querySelector('[data-module-video-editor-title-input]');
  if (titleInput) {
    titleInput.value = state.moduleVideoEditorDraft.title;
  }
  const input = editor?.querySelector('[data-module-video-editor-url]');
  if (input) {
    input.value = state.moduleVideoEditorDraft.url;
    if (!state.moduleVideoEditorDraft.title) {
      titleInput?.focus();
    } else {
      input.focus();
    }
  }
  renderModuleVideoEditorPreview();
}

function openModuleVideoEditor(videoId = null) {
  ensureModuleDraft();
  if (state.moduleVideoOrderMode) {
    cancelModuleVideoOrderMode();
  }
  closeAllModuleEditorKebabs();
  const sourceVideo = videoId
    ? state.moduleDraft.videos.find(video => video.id === videoId) || null
    : null;
  setModuleVideoView(MODULE_VIDEO_VIEW_EDITOR);
  populateModuleVideoEditor(sourceVideo);
}

function closeModuleVideoEditor() {
  state.moduleVideoEditingId = null;
  state.moduleVideoEditorDraft = {
    id: null,
    title: '',
    url: '',
    descriptionEditorial: ''
  };
  state.moduleVideoKebabId = null;
  setModuleVideoView(MODULE_VIDEO_VIEW_LIST);
}

let moduleVideoDragSourceId = null;
let moduleVideoDropTargetId = null;
let moduleVideoDropAfter = false;
let moduleVideoDragListElement = null;

function teardownModuleVideoDragListeners() {
  if (!moduleVideoDragListElement) return;
  moduleVideoDragListElement.removeEventListener('dragover', handleModuleVideoDragOver);
  moduleVideoDragListElement.removeEventListener('drop', handleModuleVideoDrop);
  moduleVideoDragListElement.querySelectorAll('[data-module-video-card]').forEach(card => {
    card.removeEventListener('dragstart', handleModuleVideoDragStart);
    card.removeEventListener('dragend', handleModuleVideoDragEnd);
  });
  moduleVideoDragListElement = null;
}

function setupModuleVideoDragListeners() {
  const list = getModuleVideoListContainer();
  if (!list || !state.moduleVideoOrderMode) return;
  teardownModuleVideoDragListeners();
  moduleVideoDragListElement = list;
  moduleVideoDragListElement.addEventListener('dragover', handleModuleVideoDragOver);
  moduleVideoDragListElement.addEventListener('drop', handleModuleVideoDrop);
  moduleVideoDragListElement.querySelectorAll('[data-module-video-card]').forEach(card => {
    card.addEventListener('dragstart', handleModuleVideoDragStart);
    card.addEventListener('dragend', handleModuleVideoDragEnd);
  });
}

function findModuleVideoInsertionTarget(pointerY) {
  if (!moduleVideoDragListElement) return null;
  const cards = Array.from(moduleVideoDragListElement.querySelectorAll('[data-module-video-card]')).filter(
    card => card.dataset.moduleVideoId !== moduleVideoDragSourceId
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

function moveModuleVideoIndicator(target, after) {
  if (!target) return;
  const indicator = ensureModuleDragIndicator();
  const parent = target.parentElement;
  if (!parent) return;
  if (
    moduleVideoDropTargetId === target.dataset.moduleVideoId &&
    moduleVideoDropAfter === after &&
    indicator.parentElement === parent
  ) {
    return;
  }
  if (after) {
    parent.insertBefore(indicator, target.nextElementSibling);
  } else {
    parent.insertBefore(indicator, target);
  }
  moduleVideoDropTargetId = target.dataset.moduleVideoId;
  moduleVideoDropAfter = after;
  revealModuleDragIndicator();
}

function reorderModuleVideoDraft(targetId, targetAfter) {
  if (!moduleVideoDragSourceId) return false;
  const orderedIds = state.moduleVideoDraftOrderIds.length
    ? [...state.moduleVideoDraftOrderIds]
    : state.moduleDraft.videos.map(video => video.id);
  const fromIndex = orderedIds.findIndex(videoId => videoId === moduleVideoDragSourceId);
  if (fromIndex === -1) return false;
  const [moved] = orderedIds.splice(fromIndex, 1);
  if (!targetId) {
    orderedIds.push(moved);
  } else {
    const targetIndex = orderedIds.findIndex(videoId => videoId === targetId);
    if (targetIndex === -1) {
      orderedIds.push(moved);
    } else {
      const insertIndex = targetAfter ? targetIndex + 1 : targetIndex;
      orderedIds.splice(insertIndex, 0, moved);
    }
  }
  state.moduleVideoDraftOrderIds = orderedIds;
  state.moduleDraft.videos = getOrderedModuleDraftVideos().map((entry, index) => ({
    ...entry,
    order: index + 1
  }));
  return true;
}

function handleModuleVideoDragStart(event) {
  if (!state.moduleVideoOrderMode) return;
  const card = event.currentTarget;
  moduleVideoDragSourceId = card.dataset.moduleVideoId;
  card.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', moduleVideoDragSourceId);
  const blankImage = new Image();
  blankImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==';
  event.dataTransfer?.setDragImage(blankImage, 0, 0);
}

function handleModuleVideoDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  moduleVideoDragSourceId = null;
  moduleVideoDropTargetId = null;
  moduleVideoDropAfter = false;
  clearModuleDragIndicator();
}

function handleModuleVideoDragOver(event) {
  if (!moduleVideoDragSourceId) return;
  event.preventDefault();
  const targetCard = event.target.closest('[data-module-video-card]');
  if (targetCard && targetCard.dataset.moduleVideoId !== moduleVideoDragSourceId) {
    const rect = targetCard.getBoundingClientRect();
    moveModuleVideoIndicator(targetCard, event.clientY > rect.top + rect.height / 2);
    return;
  }
  const fallback = findModuleVideoInsertionTarget(event.clientY);
  if (fallback) {
    moveModuleVideoIndicator(fallback.card, fallback.after);
  } else {
    clearModuleDragIndicator();
  }
}

function handleModuleVideoDrop(event) {
  event.preventDefault();
  if (!moduleVideoDragSourceId) return;
  reorderModuleVideoDraft(moduleVideoDropTargetId, moduleVideoDropAfter);
  moduleVideoDragSourceId = null;
  moduleVideoDropTargetId = null;
  moduleVideoDropAfter = false;
  clearModuleDragIndicator();
  renderModuleVideosList();
  setupModuleVideoDragListeners();
}

function renderModuleVideosList() {
  ensureModuleDraft();
  const container = getModuleVideoListContainer();
  if (!container) return;
  const orderActions = document.querySelector('[data-module-video-order-actions]');
  if (orderActions) {
    orderActions.hidden = !state.moduleVideoOrderMode;
  }
  const toggleOrderButton = document.querySelector('[data-action="toggle-module-video-order"]');
  if (toggleOrderButton) {
    toggleOrderButton.textContent = state.moduleVideoOrderMode ? 'Mode ordre actif' : 'Changer l ordre';
    toggleOrderButton.classList.toggle('is-active', state.moduleVideoOrderMode);
  }
  const addButton = document.querySelector('[data-action="add-module-video"]');
  if (addButton) {
    addButton.disabled = state.moduleVideoOrderMode;
    addButton.setAttribute('aria-disabled', state.moduleVideoOrderMode ? 'true' : 'false');
  }
  const videos = getOrderedModuleDraftVideos().sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  if (!videos.length) {
    if (state.moduleVideoOrderMode) {
      cancelModuleVideoOrderMode();
      return;
    }
    container.innerHTML = '<p class="module-placeholder">Aucune vidéo ajoutée pour ce module.</p>';
    return;
  }
  container.innerHTML = videos
    .map((video, index) => {
      const kebabOpen = state.moduleVideoKebabId === video.id;
      const title = String(video.title || '').trim() || `Video #${index + 1}`;
      const previewText = video.descriptionEditorial
        ? extractTextPreviewFromHtml(video.descriptionEditorial)
        : 'Aucune description editoriale';
      return `
        <article
          class="gmf-module-editor-card ${state.moduleVideoOrderMode ? 'gmf-module-editor-card--draggable' : ''}"
          data-module-video-card
          data-module-video-id="${escapeHtml(video.id)}"
          ${state.moduleVideoOrderMode ? 'draggable="true"' : ''}
        >
          <div class="gmf-module-editor-card__head">
            <div class="gmf-module-video-row">
              <i class="bi bi-camera-video"></i>
              <div class="gmf-module-video-main">
                <p class="gmf-module-video-title">${escapeHtml(title)}</p>
                <p class="gmf-module-video-subline" title="${escapeHtml(video.url || '')}">${escapeHtml(
        video.url || 'URL non renseignée'
      )}</p>
                <p class="muted">${escapeHtml(previewText)}</p>
              </div>
            </div>
            <div class="gmf-module-file-actions">
              <button
                type="button"
                class="gmf-module-drag-handle"
                data-module-video-drag-handle
                ${state.moduleVideoOrderMode ? '' : 'hidden'}
                aria-label="Reordonner la video"
              >
                <i class="bi bi-grip-vertical"></i>
              </button>
              <div class="formation-card__actions">
              <button
                class="kebab-button"
                type="button"
                data-module-video-kebab-toggle
                data-id="${escapeHtml(video.id)}"
                aria-label="Actions video"
                ${state.moduleVideoOrderMode ? 'disabled' : ''}
              >
                <span aria-hidden="true">⋮</span>
              </button>
              <div class="formation-card__menu ${kebabOpen ? 'is-open' : ''}" data-module-video-kebab-menu data-id="${escapeHtml(video.id)}" ${kebabOpen ? '' : 'hidden'}>
                <button type="button" data-module-video-action="edit" data-id="${escapeHtml(video.id)}" aria-label="Modifier">
                  <i class="bi bi-pencil"></i>
                </button>
                <button type="button" data-module-video-action="delete" data-id="${escapeHtml(video.id)}" aria-label="Supprimer">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
  if (state.moduleVideoOrderMode) {
    setupModuleVideoDragListeners();
  } else {
    teardownModuleVideoDragListeners();
    clearModuleDragIndicator();
  }
}

function renderModuleFilesPreview() {
  ensureModuleDraft();
  const container = document.querySelector('[data-module-files-list]');
  if (!container) return;
  const orderActions = document.querySelector('[data-module-file-order-actions]');
  if (orderActions) {
    orderActions.hidden = !state.moduleFileOrderMode;
  }
  const toggleOrderButton = document.querySelector('[data-action="toggle-module-file-order"]');
  if (toggleOrderButton) {
    toggleOrderButton.textContent = state.moduleFileOrderMode ? 'Mode ordre actif' : 'Changer l ordre';
    toggleOrderButton.classList.toggle('is-active', state.moduleFileOrderMode);
  }
  const uploadButton = document.querySelector('[data-action="trigger-module-files-upload"]');
  if (uploadButton) {
    uploadButton.disabled = state.moduleFileOrderMode;
    uploadButton.setAttribute('aria-disabled', state.moduleFileOrderMode ? 'true' : 'false');
  }
  const orderedFiles = getOrderedModuleDraftFiles();
  const pendingUploads = Array.isArray(state.modulePendingUploadFiles) ? state.modulePendingUploadFiles : [];
  const pendingMarkup = pendingUploads.length
    ? `
      <article class="gmf-module-editor-card">
        <p class="muted"><i class="bi bi-clock-history"></i> ${pendingUploads.length} fichier(s) en attente d upload.</p>
      </article>
    `
    : '';
  if (!orderedFiles.length) {
    if (state.moduleFileOrderMode) {
      state.moduleFileOrderMode = false;
      state.moduleFileDraftOrderIds = [];
      teardownModuleFileDragListeners();
      clearModuleDragIndicator();
    }
    container.innerHTML = `${pendingMarkup}<p class="module-placeholder">Aucun fichier annexe enregistre.</p>`;
    return;
  }
  container.innerHTML =
    pendingMarkup +
    orderedFiles
      .map(file => {
      const kebabOpen = state.moduleFileKebabId === file.fileId;
      const sizeLabel = formatBytes(file.size);
      const displayTitle = String(file.title || '').trim() || String(file.name || '').trim() || 'Fichier';
      return `
        <article
          class="gmf-module-editor-card ${state.moduleFileOrderMode ? 'gmf-module-editor-card--draggable' : ''}"
          data-module-file-card
          data-module-file-id="${escapeHtml(file.fileId)}"
          ${state.moduleFileOrderMode ? 'draggable="true"' : ''}
        >
          <div class="gmf-module-editor-card__head">
            <div class="gmf-module-video-row">
              <i class="bi bi-file-earmark"></i>
              <div class="gmf-module-video-main">
                <p class="gmf-module-video-title gmf-module-file-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</p>
                <p class="gmf-module-video-subline">${sizeLabel ? escapeHtml(sizeLabel) : 'Taille inconnue'}</p>
              </div>
            </div>
            <div class="gmf-module-file-actions">
              <button
                type="button"
                class="gmf-module-drag-handle"
                data-module-file-drag-handle
                ${state.moduleFileOrderMode ? '' : 'hidden'}
                aria-label="Reordonner le fichier"
              >
                <i class="bi bi-grip-vertical"></i>
              </button>
              <div class="formation-card__actions">
                <button
                  class="kebab-button"
                  type="button"
                  data-module-file-kebab-toggle
                  data-id="${escapeHtml(file.fileId)}"
                  aria-label="Actions fichier"
                  ${state.moduleFileOrderMode ? 'disabled' : ''}
                >
                  <span aria-hidden="true">⋮</span>
                </button>
                <div class="formation-card__menu ${kebabOpen ? 'is-open' : ''}" data-module-file-kebab-menu data-id="${escapeHtml(file.fileId)}" ${kebabOpen ? '' : 'hidden'}>
                  <button type="button" data-module-file-action="edit" data-id="${escapeHtml(file.fileId)}" aria-label="Editer">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button type="button" data-module-file-action="delete" data-id="${escapeHtml(file.fileId)}" aria-label="Supprimer">
                    <i class="bi bi-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="gmf-module-file-meta">
            <a href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">Ouvrir le fichier</a>
          </div>
        </article>
      `;
      })
      .join('');
}

function syncDistancielFormations() {
  const distanciels = state.formations.filter(entry => entry.type === 'distanciel');
  state.distancielFormations = distanciels;
  if (!distanciels.length) {
    state.selectedFormationId = null;
  } else if (!distanciels.some(entry => entry.id === state.selectedFormationId)) {
    state.selectedFormationId = distanciels[0].id;
  }
  renderModuleFormationOptions();
}

function renderSessionFormationOptions() {
  const select = getSessionSelect();
  if (!select) return;
  const options = state.presentielFormations
    .map(formation => `<option value="${formation.id}">${formation.name}</option>`)
    .join('');
  select.innerHTML = `
            <option value="">Sélectionner une formation présentielle</option>
    ${options}
  `;
  select.value = state.selectedPresentielId || '';
}

function syncPresentielFormations() {
  const presentiels = state.formations.filter(entry => entry.type === 'presentiel');
  state.presentielFormations = presentiels;
  if (!presentiels.length) {
    state.selectedPresentielId = null;
    state.sessionDurationDays = 1;
  } else if (!presentiels.some(entry => entry.id === state.selectedPresentielId)) {
    state.selectedPresentielId = presentiels[0].id;
  }
  if (presentiels.length) {
    const selectedFormation = state.presentielFormations.find(entry => entry.id === state.selectedPresentielId);
    state.sessionDurationDays = normalizeDurationDaysValue(
      selectedFormation?.durationDays,
      presentiels[0]?.durationDays
    );
  }
  state.planningSessionView = 'list';
  state.planningEditingSessionId = null;
  state.planningSessionKebabId = null;
  renderSessionFormationOptions();
  renderSessionList();
  resetSessionForm();
}

function renderModuleList() {
  const container = getModuleListContainer();
  if (!container) return;
  if (!state.selectedFormationId) {
    container.innerHTML = '<p class="module-placeholder">Aucune formation distancielle active.</p>';
    return;
  }
  const orderActions = document.querySelector('[data-module-order-actions]');
  if (orderActions) {
    orderActions.hidden = !state.moduleOrderMode;
  }
  const toggleOrderButton = document.querySelector('[data-action="toggle-module-order"]');
  if (toggleOrderButton) {
    toggleOrderButton.textContent = state.moduleOrderMode ? 'Mode ordre actif' : 'Changer l ordre';
    toggleOrderButton.classList.toggle('is-active', state.moduleOrderMode);
  }
  document.querySelectorAll('[data-disable-while-module-order]').forEach(control => {
    control.disabled = state.moduleOrderMode;
    control.setAttribute('aria-disabled', state.moduleOrderMode ? 'true' : 'false');
  });
  if (!state.modules.length) {
    container.innerHTML = '<p class="module-placeholder">Aucun module enregistre pour cette formation.</p>';
    return;
  }
  const orderedModules = getOrderedModules();
  container.innerHTML = orderedModules
    .map(module => {
      const createdLabel = module.createdAt ? new Date(module.createdAt).toLocaleDateString() : 'Date inconnue';
      const isDraggable = state.moduleOrderMode;
      const moduleVideos = Array.isArray(module.videoItems)
        ? module.videoItems
        : Array.isArray(module.videos)
          ? module.videos
          : [];
      const moduleFiles = Array.isArray(module.files) ? module.files : [];
      return `
        <article class="data-item gmf-module-card ${isDraggable ? 'gmf-module-card--draggable' : ''}" data-module-card data-module-id="${module.id}" ${isDraggable ? 'draggable="true"' : ''}>
          <div class="gmf-module-card__icon" aria-hidden="true">
            <i class="bi bi-journal-richtext"></i>
          </div>
          <div class="gmf-module-card__main">
            <strong>${escapeHtml(module.title || 'Sans titre')}</strong>
            <p class="gmf-module-card__description">${escapeHtml(module.previewDescription || module.description || 'Sans description')}</p>
            <p class="muted">Videos : ${moduleVideos.length} - Fichiers : ${moduleFiles.length} - Cree le ${createdLabel}</p>
          </div>
          <div class="gmf-module-card__actions">
            <span class="gmf-module-card__order">#${module.order || '?'}</span>
            <button type="button" class="gmf-module-drag-handle" data-module-drag-handle ${isDraggable ? '' : 'hidden'} aria-label="Deplacer le module">
              <i class="bi bi-grip-vertical"></i>
            </button>
            <div class="formation-card__actions">
              <button
                class="kebab-button"
                type="button"
                data-module-kebab-toggle
                data-id="${module.id}"
                aria-label="Actions module"
                ${state.moduleOrderMode ? 'disabled' : ''}
              >
                <span aria-hidden="true">⋮</span>
              </button>
              <div class="formation-card__menu" data-module-kebab-menu data-id="${module.id}" hidden>
                <button type="button" data-module-action="edit" data-id="${module.id}" aria-label="Modifier">
                  <i class="bi bi-pencil"></i>
                </button>
                <button type="button" data-module-action="delete" data-id="${module.id}" aria-label="Supprimer">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
  if (state.moduleOrderMode) {
    setupModuleDragListeners();
  } else {
    teardownModuleDragListeners();
  }
}

function populateModuleForm(module) {
  const form = getModuleForm();
  const feedback = getModuleFeedbackElement();
  if (!form) return;
  state.moduleDraft = buildEmptyModuleDraft();
  state.moduleDraft.title = String(module?.title || '').trim();
  state.moduleDraft.descriptionEditorial = String(module?.descriptionEditorial || '').trim();
  if (!state.moduleDraft.descriptionEditorial && module?.description) {
    state.moduleDraft.descriptionEditorial = `<p>${escapeHtml(String(module.description || '').trim())}</p>`;
  }
  state.moduleDraft.videos = normalizeModuleDraftVideos(module?.videoItems || module?.videos || []);
  state.moduleDraft.files = normalizeModuleDraftFiles(module?.files || []);
  state.modulePendingUploadFiles = [];
  state.moduleVideoInfoOpen = false;
  state.moduleVideoInfoAnchorEl = null;
  state.moduleVideoKebabId = null;
  state.moduleVideoOrderMode = false;
  syncModuleVideoDraftOrderFromVideos();
  state.moduleVideoView = MODULE_VIDEO_VIEW_LIST;
  state.moduleVideoEditingId = null;
  state.moduleVideoEditorDraft = {
    id: null,
    title: '',
    url: '',
    descriptionEditorial: ''
  };
  teardownModuleVideoDragListeners();
  state.moduleFileKebabId = null;
  state.moduleFileOrderMode = false;
  syncModuleFileDraftOrderFromFiles();
  form.querySelector('[name="moduleTitle"]').value = state.moduleDraft.title;
  const hiddenFileInput = form.querySelector('[name="moduleFilesUpload"]');
  if (hiddenFileInput) {
    hiddenFileInput.value = '';
  }
  state.moduleEditingId = module.id;
  showFeedback(feedback, 'Modification du module en cours', 'info');
  renderModuleDescriptionPreview();
  renderModuleVideosList();
  renderModuleFilesPreview();
  setModuleEditorTab(MODULE_EDITOR_TAB_INFO);
  syncModuleVideoInfoOverlay();
  setModuleView(MODULE_PANEL_EDITOR);
}

function resetModuleForm() {
  const form = getModuleForm();
  const feedback = getModuleFeedbackElement();
  if (!form) return;
  form.reset();
  state.moduleDraft = buildEmptyModuleDraft();
  state.modulePendingUploadFiles = [];
  state.moduleVideoInfoOpen = false;
  state.moduleVideoInfoAnchorEl = null;
  state.moduleVideoKebabId = null;
  state.moduleVideoOrderMode = false;
  state.moduleVideoDraftOrderIds = [];
  state.moduleVideoView = MODULE_VIDEO_VIEW_LIST;
  state.moduleVideoEditingId = null;
  state.moduleVideoEditorDraft = {
    id: null,
    title: '',
    url: '',
    descriptionEditorial: ''
  };
  teardownModuleVideoDragListeners();
  state.moduleFileKebabId = null;
  state.moduleEditorTab = MODULE_EDITOR_TAB_INFO;
  state.moduleFileOrderMode = false;
  state.moduleFileDraftOrderIds = [];
  teardownModuleFileDragListeners();
  clearModuleDragIndicator();
  state.moduleEditingId = null;
  showFeedback(feedback, '');
  const fileInput = form.querySelector('[name="moduleFilesUpload"]');
  if (fileInput) {
    fileInput.value = '';
  }
  renderModuleDescriptionPreview();
  renderModuleVideosList();
  renderModuleFilesPreview();
  syncModuleVideoInfoOverlay();
}

function toggleModuleVideoKebab(videoId) {
  if (!videoId || state.moduleVideoOrderMode) return;
  const menu = document.querySelector(`[data-module-video-kebab-menu][data-id="${videoId}"]`);
  if (!menu) return;
  const isOpen = !menu.hidden;
  closeAllModuleEditorKebabs();
  if (!isOpen) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    state.moduleVideoKebabId = videoId;
  }
}

function toggleModuleFileKebab(fileId) {
  if (!fileId || state.moduleFileOrderMode) return;
  const menu = document.querySelector(`[data-module-file-kebab-menu][data-id="${fileId}"]`);
  if (!menu) return;
  const isOpen = !menu.hidden;
  closeAllModuleEditorKebabs();
  if (!isOpen) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    state.moduleFileKebabId = fileId;
  }
}

function addModuleVideo() {
  if (state.moduleVideoOrderMode) return;
  state.moduleEditorTab = MODULE_EDITOR_TAB_VIDEOS;
  setModuleEditorTab(MODULE_EDITOR_TAB_VIDEOS);
  openModuleVideoEditor();
}

function updateModuleVideoEditorUrl(nextUrl) {
  state.moduleVideoEditorDraft = {
    ...state.moduleVideoEditorDraft,
    url: String(nextUrl || '').trim()
  };
}

function updateModuleVideoEditorTitle(nextTitle) {
  state.moduleVideoEditorDraft = {
    ...state.moduleVideoEditorDraft,
    title: String(nextTitle || '').trim()
  };
}

function getModuleVideoEditorPayload() {
  return normalizeModuleVideoEntry(
    {
      id: state.moduleVideoEditorDraft.id || `video-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: state.moduleVideoEditorDraft.title,
      url: state.moduleVideoEditorDraft.url,
      descriptionEditorial: state.moduleVideoEditorDraft.descriptionEditorial,
      order: state.moduleDraft.videos.length + 1
    },
    state.moduleDraft.videos.length
  );
}

async function saveModuleVideoEditor(actionButton = null) {
  ensureModuleDraft();
  const feedback = getModuleFeedbackElement();
  setActionLoading(actionButton, 'Enregistrement...');
  const payload = getModuleVideoEditorPayload();
  if (!payload.url) {
    setActionError(actionButton, 'FormationManager:SaveModuleVideo', new Error('URL video requise.'));
    showFeedback(feedback, 'L URL video est requise.', 'error');
    return;
  }
  if (!isLikelyVideoUrl(payload.url)) {
    setActionError(actionButton, 'FormationManager:SaveModuleVideo', new Error('URL video invalide.'), {
      url: payload.url
    });
    showFeedback(feedback, 'URL video invalide (YouTube, Vimeo, embed ou iframe).', 'error');
    return;
  }
  const existingIndex = state.moduleDraft.videos.findIndex(video => video.id === payload.id);
  if (existingIndex === -1) {
    state.moduleDraft.videos.push(payload);
  } else {
    state.moduleDraft.videos.splice(existingIndex, 1, {
      ...state.moduleDraft.videos[existingIndex],
      ...payload
    });
  }
  state.moduleDraft.videos = normalizeModuleDraftVideos(state.moduleDraft.videos);
  syncModuleVideoDraftOrderFromVideos();
  closeAllModuleEditorKebabs();
  closeModuleVideoEditor();
  renderModuleVideosList();
  showFeedback(feedback, 'Vid?o enregistr?e.', 'success');
  setActionSuccess(actionButton, 'R?ussi');
}

async function removeModuleVideo(videoId, actionButton = null) {
  if (!videoId) return;
  const confirmed = await confirmAction({
    title: 'Supprimer la video ?',
    message: 'Cette video sera retiree du module.',
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!confirmed) return;
  setActionLoading(actionButton, 'Suppression...');
  ensureModuleDraft();
  state.moduleDraft.videos = normalizeModuleDraftVideos(
    state.moduleDraft.videos.filter(video => video.id !== videoId)
  );
  syncModuleVideoDraftOrderFromVideos();
  if (state.moduleVideoEditingId === videoId && state.moduleVideoView === MODULE_VIDEO_VIEW_EDITOR) {
    closeModuleVideoEditor();
  }
  if (state.moduleVideoKebabId === videoId) {
    state.moduleVideoKebabId = null;
  }
  showFeedback(getModuleFeedbackElement(), 'Vidéo supprimée.', 'success');
  closeAllModuleEditorKebabs();
  renderModuleVideosList();
  setActionSuccess(actionButton, 'R?ussi');
}

function openModuleVideoInfoOverlay(triggerEl = null) {
  state.moduleVideoInfoAnchorEl = triggerEl || document.querySelector('[data-action="open-module-video-info"]');
  state.moduleVideoInfoOpen = true;
  syncModuleVideoInfoOverlay();
}

function closeModuleVideoInfoOverlay() {
  state.moduleVideoInfoOpen = false;
  state.moduleVideoInfoAnchorEl = null;
  syncModuleVideoInfoOverlay();
}

function startModuleVideoOrderMode() {
  ensureModuleDraft();
  if (state.moduleDraft.videos.length < 2) {
    showFeedback(getModuleFeedbackElement(), 'Au moins deux videos sont requises pour changer l ordre.', 'info');
    return;
  }
  closeModuleVideoEditor();
  state.moduleVideoOrderMode = true;
  syncModuleVideoDraftOrderFromVideos();
  closeAllModuleEditorKebabs();
  closeModuleVideoInfoOverlay();
  renderModuleVideosList();
  setupModuleVideoDragListeners();
}

function cancelModuleVideoOrderMode() {
  state.moduleVideoOrderMode = false;
  state.moduleVideoDraftOrderIds = [];
  moduleVideoDragSourceId = null;
  moduleVideoDropTargetId = null;
  moduleVideoDropAfter = false;
  teardownModuleVideoDragListeners();
  clearModuleDragIndicator();
  renderModuleVideosList();
}

async function saveModuleVideoOrderMode(actionButton = null) {
  const feedback = getModuleFeedbackElement();
  const resolvedActionButton = actionButton || document.querySelector('[data-action="save-module-video-order"]');
  if (resolvedActionButton?.dataset.actionState === 'loading') return;
  setActionLoading(resolvedActionButton, 'Enregistrement...');
  state.moduleVideoOrderMode = false;
  teardownModuleVideoDragListeners();
  clearModuleDragIndicator();
  state.moduleDraft.videos = normalizeModuleDraftVideos(state.moduleDraft.videos);
  if (state.moduleEditingId) {
    try {
      const response = await fetch(MODULE_ENDPOINT(state.moduleEditingId), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoItems: state.moduleDraft.videos.map((video, index) => ({
            title: String(video.title || '').trim(),
            url: String(video.url || '').trim(),
            descriptionEditorial: String(video.descriptionEditorial || '').trim(),
            order: index + 1
          }))
        })
      });
      const payload = await getJson(response);
      if (!response.ok) {
        throw new Error(payload?.error || "Impossible d'enregistrer l'ordre des videos.");
      }
      state.moduleDraft.videos = normalizeModuleDraftVideos(payload?.module?.videoItems || payload?.module?.videos || []);
      showFeedback(feedback, 'Ordre des videos enregistre.', 'success');
      setActionSuccess(resolvedActionButton, 'R?ussi');
    } catch (error) {
      setActionError(resolvedActionButton, 'FormationManager:ReorderModuleVideos', error, {
        moduleId: state.moduleEditingId
      });
      showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
    }
  } else {
    showFeedback(feedback, "Ordre des videos pret. Enregistrez le module pour l'appliquer.", 'info');
    setActionSuccess(resolvedActionButton, 'R?ussi');
  }
  syncModuleVideoDraftOrderFromVideos();
  renderModuleVideosList();
}

function openModuleDescriptionEditorialEditor() {
  ensureModuleDraft();
  openEditorialEditor({
    title: 'Description editoriale du module',
    description: 'Texte affiche aux clients dans le module.',
    label: state.moduleDraft.title || 'Description module',
    initialHtml: state.moduleDraft.descriptionEditorial || '',
    onSave: html => {
      state.moduleDraft.descriptionEditorial = String(html || '').trim();
      renderModuleDescriptionPreview();
    }
  });
}

function openModuleVideoEditorialEditor(videoId) {
  ensureModuleDraft();
  const resolvedId = String(videoId || state.moduleVideoEditingId || '').trim();
  const isEditorTarget = state.moduleVideoView === MODULE_VIDEO_VIEW_EDITOR &&
    resolvedId &&
    resolvedId === state.moduleVideoEditorDraft.id;
  const video = isEditorTarget
    ? {
        id: state.moduleVideoEditorDraft.id,
        url: state.moduleVideoEditorDraft.url,
        descriptionEditorial: state.moduleVideoEditorDraft.descriptionEditorial
      }
    : state.moduleDraft.videos.find(entry => entry.id === resolvedId);
  if (!video) return;
  openEditorialEditor({
    title: 'Description editoriale de la video',
    description: 'Texte affiche avec la video dans le module.',
    label: video.title || video.url || 'Description video',
    initialHtml: video.descriptionEditorial || '',
    onSave: html => {
      const sanitizedHtml = String(html || '').trim();
      if (isEditorTarget) {
        state.moduleVideoEditorDraft = {
          ...state.moduleVideoEditorDraft,
          descriptionEditorial: sanitizedHtml
        };
        renderModuleVideoEditorPreview();
        return;
      }
      state.moduleDraft.videos = normalizeModuleDraftVideos(
        state.moduleDraft.videos.map(entry =>
          entry.id === resolvedId
            ? {
                ...entry,
                descriptionEditorial: sanitizedHtml
              }
            : entry
        )
      );
      syncModuleVideoDraftOrderFromVideos();
      renderModuleVideosList();
    }
  });
}

function getModuleEditorPayload() {
  ensureModuleDraft();
  const titleInput = getModuleForm()?.querySelector('[name="moduleTitle"]');
  const title = String(titleInput?.value || state.moduleDraft.title || '').trim();
  const videos = normalizeModuleDraftVideos(state.moduleDraft.videos);
  const files = normalizeModuleDraftFiles(state.moduleDraft.files);
  return {
    title,
    descriptionEditorial: state.moduleDraft.descriptionEditorial || '',
    videoItems: videos.map((video, index) => ({
      title: String(video.title || '').trim(),
      url: String(video.url || '').trim(),
      descriptionEditorial: String(video.descriptionEditorial || '').trim(),
      order: index + 1
    })),
    files: files.map((file, index) => ({
      fileId: file.fileId,
      name: file.name,
      title: String(file.title || '').trim(),
      url: file.url,
      size: file.size || 0,
      order: index + 1
    }))
  };
}

function validateModuleEditorPayload(payload) {
  if (!payload.title) {
    return 'Le titre du module est requis.';
  }
  const invalidVideo = payload.videoItems.find(entry => !entry.url || !isLikelyVideoUrl(entry.url));
  if (invalidVideo) {
    return 'Ajoutez une URL video valide (YouTube, Vimeo, lien embed ou iframe).';
  }
  return '';
}

async function fetchModuleById(moduleId) {
  if (!moduleId) return null;
  await fetchModulesForSelectedFormation();
  return state.modules.find(entry => entry.id === moduleId) || null;
}

async function uploadModuleFiles(moduleId, files) {
  const endpoint = `${MODULE_ENDPOINT(moduleId)}/files`;
  const uploaded = [];
  for (const file of files) {
    const formData = new FormData();
    formData.append('moduleFile', file);
    formData.append('name', file.name);
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || "Impossible d'uploader les fichiers.");
    }
    if (payload?.file) {
      uploaded.push(payload.file);
    }
  }
  return uploaded;
}

function getFileRenameModalOverlay() {
  return document.querySelector('[data-file-rename-modal]');
}

function openFileRenameModal(fileId) {
  if (!fileId) return;
  ensureModuleDraft();
  const file = state.moduleDraft.files.find(entry => entry.fileId === fileId);
  if (!file) return;
  const overlay = getFileRenameModalOverlay();
  const input = overlay?.querySelector('[data-file-rename-input]');
  if (!overlay || !input) return;
  state.fileRenameModal = { open: true, fileId };
  input.value = String(file.title || file.name || '').trim();
  openModalOverlay(overlay);
  requestAnimationFrame(() => input.focus());
}

function closeFileRenameModal() {
  const overlay = getFileRenameModalOverlay();
  closeModalOverlay(overlay);
  state.fileRenameModal = { open: false, fileId: null };
}

async function saveFileRenameModal(actionButton = null) {
  const fileId = String(state.fileRenameModal?.fileId || '').trim();
  if (!fileId) return;
  ensureModuleDraft();
  const overlay = getFileRenameModalOverlay();
  const input = overlay?.querySelector('[data-file-rename-input]');
  const resolvedActionButton = actionButton || overlay?.querySelector('[data-action="save-file-rename"]');
  if (resolvedActionButton?.dataset.actionState === 'loading') return;
  setActionLoading(resolvedActionButton, 'Enregistrement...');
  const nextTitle = String(input?.value || '').trim();
  state.moduleDraft.files = normalizeModuleDraftFiles(
    state.moduleDraft.files.map(file =>
      file.fileId === fileId
        ? {
            ...file,
            title: nextTitle
          }
        : file
    )
  );
  if (state.moduleEditingId) {
    const payload = state.moduleDraft.files.map((file, index) => ({
      fileId: file.fileId,
      name: file.name,
      title: String(file.title || '').trim(),
      url: file.url,
      size: file.size || 0,
      order: index + 1
    }));
    try {
      const response = await fetch(MODULE_ENDPOINT(state.moduleEditingId), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payload })
      });
      const body = await getJson(response);
      if (!response.ok) {
        throw new Error(body?.error || 'Impossible de renommer le fichier.');
      }
      state.moduleDraft.files = normalizeModuleDraftFiles(body?.module?.files || []);
      showFeedback(getModuleFeedbackElement(), 'Titre du fichier mis a jour.', 'success');
      setActionSuccess(resolvedActionButton, 'R?ussi');
    } catch (error) {
      setActionError(resolvedActionButton, 'FormationManager:RenameModuleFile', error, {
        moduleId: state.moduleEditingId,
        fileId
      });
      showFeedback(getModuleFeedbackElement(), error.message || 'Erreur reseau.', 'error');
      return;
    }
  } else {
    showFeedback(getModuleFeedbackElement(), 'Titre du fichier mis a jour.', 'success');
    setActionSuccess(resolvedActionButton, 'R?ussi');
  }
  syncModuleFileDraftOrderFromFiles();
  closeFileRenameModal();
  renderModuleFilesPreview();
}

async function handleModuleFileDelete(fileId, actionButton = null) {
  if (!state.moduleEditingId || !fileId) return;
  const feedback = getModuleFeedbackElement();
  const confirmed = await confirmAction({
    title: 'Supprimer le fichier ?',
    message: 'Le fichier sera supprime du module et du stockage serveur.',
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!confirmed) return;
  setActionLoading(actionButton, 'Suppression...');
  try {
    const response = await fetch(MODULE_FILE_ENDPOINT(state.moduleEditingId, fileId), {
      method: 'DELETE',
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de supprimer le fichier.');
    }
    state.moduleDraft.files = normalizeModuleDraftFiles(payload?.files || []);
    syncModuleFileDraftOrderFromFiles();
    showFeedback(feedback, 'Fichier supprime.', 'success');
    renderModuleFilesPreview();
    setActionSuccess(actionButton, 'R?ussi');
  } catch (error) {
    setActionError(actionButton, 'FormationManager:DeleteModuleFile', error, {
      moduleId: state.moduleEditingId,
      fileId
    });
    showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
  }
}

async function handleModuleFilesPicked(event) {
  const fileInput = event.currentTarget;
  const files = Array.from(fileInput?.files || []);
  if (!files.length) return;
  const feedback = getModuleFeedbackElement();
  const actionButton = document.querySelector('[data-action="trigger-module-files-upload"]');
  if (!state.moduleEditingId) {
    state.modulePendingUploadFiles = [...state.modulePendingUploadFiles, ...files];
    showFeedback(
      feedback,
      `${state.modulePendingUploadFiles.length} fichier(s) en attente. Enregistrez le module pour les importer.`,
      'info'
    );
    renderModuleFilesPreview();
    fileInput.value = '';
    return;
  }
  try {
    setActionLoading(actionButton, 'Upload...');
    showFeedback(feedback, 'Upload des fichiers en cours...', 'loading');
    await uploadModuleFiles(state.moduleEditingId, files);
    const refreshed = await fetchModuleById(state.moduleEditingId);
    if (refreshed) {
      state.moduleDraft.files = normalizeModuleDraftFiles(refreshed.files || []);
      syncModuleFileDraftOrderFromFiles();
      renderModuleFilesPreview();
    }
    showFeedback(feedback, 'Fichiers importes.', 'success');
    setActionSuccess(actionButton, 'R?ussi');
  } catch (error) {
    setActionError(actionButton, 'FormationManager:UploadModuleFiles', error, {
      moduleId: state.moduleEditingId,
      fileCount: files.length
    });
    showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
  } finally {
    fileInput.value = '';
  }
}

let moduleFileDragSourceId = null;
let moduleFileDropTargetId = null;
let moduleFileDropAfter = false;
let moduleFileDragListElement = null;

function teardownModuleFileDragListeners() {
  if (!moduleFileDragListElement) return;
  moduleFileDragListElement.removeEventListener('dragover', handleModuleFileDragOver);
  moduleFileDragListElement.removeEventListener('drop', handleModuleFileDrop);
  moduleFileDragListElement.querySelectorAll('[data-module-file-card]').forEach(card => {
    card.removeEventListener('dragstart', handleModuleFileDragStart);
    card.removeEventListener('dragend', handleModuleFileDragEnd);
  });
  moduleFileDragListElement = null;
}

function setupModuleFileDragListeners() {
  const list = document.querySelector('[data-module-files-list]');
  if (!list || !state.moduleFileOrderMode) return;
  teardownModuleFileDragListeners();
  moduleFileDragListElement = list;
  moduleFileDragListElement.addEventListener('dragover', handleModuleFileDragOver);
  moduleFileDragListElement.addEventListener('drop', handleModuleFileDrop);
  moduleFileDragListElement.querySelectorAll('[data-module-file-card]').forEach(card => {
    card.addEventListener('dragstart', handleModuleFileDragStart);
    card.addEventListener('dragend', handleModuleFileDragEnd);
  });
}

function findModuleFileInsertionTarget(pointerY) {
  if (!moduleFileDragListElement) return null;
  const cards = Array.from(moduleFileDragListElement.querySelectorAll('[data-module-file-card]')).filter(
    card => card.dataset.moduleFileId !== moduleFileDragSourceId
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

function moveModuleFileIndicator(target, after) {
  if (!target) return;
  const indicator = ensureModuleDragIndicator();
  const parent = target.parentElement;
  if (!parent) return;
  if (
    moduleFileDropTargetId === target.dataset.moduleFileId &&
    moduleFileDropAfter === after &&
    indicator.parentElement === parent
  ) {
    return;
  }
  if (after) {
    parent.insertBefore(indicator, target.nextElementSibling);
  } else {
    parent.insertBefore(indicator, target);
  }
  moduleFileDropTargetId = target.dataset.moduleFileId;
  moduleFileDropAfter = after;
  revealModuleDragIndicator();
}

function reorderModuleFileDraft(targetId, targetAfter) {
  if (!moduleFileDragSourceId) return false;
  const orderedIds = [...state.moduleFileDraftOrderIds];
  const fromIndex = orderedIds.findIndex(fileId => fileId === moduleFileDragSourceId);
  if (fromIndex === -1) return false;
  const [moved] = orderedIds.splice(fromIndex, 1);
  if (!targetId) {
    orderedIds.push(moved);
  } else {
    const targetIndex = orderedIds.findIndex(fileId => fileId === targetId);
    if (targetIndex === -1) {
      orderedIds.push(moved);
    } else {
      const insertIndex = targetAfter ? targetIndex + 1 : targetIndex;
      orderedIds.splice(insertIndex, 0, moved);
    }
  }
  state.moduleFileDraftOrderIds = orderedIds;
  state.moduleDraft.files = getOrderedModuleDraftFiles().map((entry, index) => ({
    ...entry,
    order: index + 1
  }));
  return true;
}

function handleModuleFileDragStart(event) {
  if (!state.moduleFileOrderMode) return;
  const card = event.currentTarget;
  moduleFileDragSourceId = card.dataset.moduleFileId;
  card.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', moduleFileDragSourceId);
  const blankImage = new Image();
  blankImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==';
  event.dataTransfer?.setDragImage(blankImage, 0, 0);
}

function handleModuleFileDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  moduleFileDragSourceId = null;
  moduleFileDropTargetId = null;
  moduleFileDropAfter = false;
  clearModuleDragIndicator();
}

function handleModuleFileDragOver(event) {
  if (!moduleFileDragSourceId) return;
  event.preventDefault();
  const targetCard = event.target.closest('[data-module-file-card]');
  if (targetCard && targetCard.dataset.moduleFileId !== moduleFileDragSourceId) {
    const rect = targetCard.getBoundingClientRect();
    moveModuleFileIndicator(targetCard, event.clientY > rect.top + rect.height / 2);
    return;
  }
  const fallback = findModuleFileInsertionTarget(event.clientY);
  if (fallback) {
    moveModuleFileIndicator(fallback.card, fallback.after);
  } else {
    clearModuleDragIndicator();
  }
}

function handleModuleFileDrop(event) {
  event.preventDefault();
  if (!moduleFileDragSourceId) return;
  reorderModuleFileDraft(moduleFileDropTargetId, moduleFileDropAfter);
  moduleFileDragSourceId = null;
  moduleFileDropTargetId = null;
  moduleFileDropAfter = false;
  clearModuleDragIndicator();
  renderModuleFilesPreview();
  setupModuleFileDragListeners();
}

function startModuleFileOrderMode() {
  ensureModuleDraft();
  if (state.moduleDraft.files.length < 2) {
    showFeedback(getModuleFeedbackElement(), 'Au moins deux fichiers sont requis pour changer l ordre.', 'info');
    return;
  }
  state.moduleFileOrderMode = true;
  state.moduleEditorTab = MODULE_EDITOR_TAB_FILES;
  syncModuleFileDraftOrderFromFiles();
  closeAllModuleEditorKebabs();
  renderModuleFilesPreview();
  setModuleEditorTab(MODULE_EDITOR_TAB_FILES);
  setupModuleFileDragListeners();
}

function cancelModuleFileOrderMode() {
  state.moduleFileOrderMode = false;
  state.moduleFileDraftOrderIds = [];
  moduleFileDragSourceId = null;
  moduleFileDropTargetId = null;
  moduleFileDropAfter = false;
  teardownModuleFileDragListeners();
  clearModuleDragIndicator();
  renderModuleFilesPreview();
}

async function saveModuleFileOrderMode(actionButton = null) {
  const feedback = getModuleFeedbackElement();
  const resolvedActionButton = actionButton || document.querySelector('[data-action="save-module-file-order"]');
  if (resolvedActionButton?.dataset.actionState === 'loading') return;
  setActionLoading(resolvedActionButton, 'Enregistrement...');
  state.moduleFileOrderMode = false;
  teardownModuleFileDragListeners();
  clearModuleDragIndicator();
  state.moduleDraft.files = normalizeModuleDraftFiles(state.moduleDraft.files);
  const orderedFilesPayload = state.moduleDraft.files.map((file, index) => ({
    fileId: file.fileId,
    name: file.name,
    title: String(file.title || '').trim(),
    url: file.url,
    size: file.size || 0,
    order: index + 1
  }));
  if (state.moduleEditingId) {
    try {
      const response = await fetch(MODULE_ENDPOINT(state.moduleEditingId), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: orderedFilesPayload })
      });
      const payload = await getJson(response);
      if (!response.ok) {
        throw new Error(payload?.error || "Impossible d'enregistrer l'ordre des fichiers.");
      }
      state.moduleDraft.files = normalizeModuleDraftFiles(payload?.module?.files || []);
      showFeedback(feedback, 'Ordre des fichiers enregistre.', 'success');
      setActionSuccess(resolvedActionButton, 'R?ussi');
    } catch (error) {
      setActionError(resolvedActionButton, 'FormationManager:ReorderModuleFiles', error, {
        moduleId: state.moduleEditingId
      });
      showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
    }
  } else {
    showFeedback(feedback, "Ordre des fichiers pret. Enregistrez le module pour l'appliquer.", 'info');
    setActionSuccess(resolvedActionButton, 'R?ussi');
  }
  state.moduleFileDraftOrderIds = [];
  renderModuleFilesPreview();
}

async function handleModuleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const feedback = getModuleFeedbackElement();
  const submitButton = form?.querySelector('button[type="submit"]');
  if (submitButton?.dataset.actionState === 'loading') return;
  if (!state.selectedFormationId) {
    setActionError(submitButton, 'FormationManager:SaveModule', new Error('Formation distancielle manquante.'));
    return showFeedback(feedback, 'Sélectionnez une formation distancielle.', 'error');
  }
  const payload = getModuleEditorPayload();
  const validationError = validateModuleEditorPayload(payload);
  if (validationError) {
    setActionError(submitButton, 'FormationManager:SaveModule', new Error(validationError));
    return showFeedback(feedback, validationError, 'error');
  }
  const endpoint = state.moduleEditingId
    ? MODULE_ENDPOINT(state.moduleEditingId)
    : MODULES_FOR_FORMATION_ENDPOINT(state.selectedFormationId);
  const method = state.moduleEditingId ? 'PUT' : 'POST';
  const pendingUploads = [...state.modulePendingUploadFiles];
  setActionLoading(submitButton, 'Enregistrement...');
  try {
    const response = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await getJson(response);
    if (!response.ok) {
      if (FM_DEV_LOGS) {
        console.debug('[FM][ModuleSave] update failed', {
          endpoint,
          method,
          status: response.status,
          body
        });
      }
      setActionError(submitButton, 'FormationManager:SaveModule', new Error(body?.error || 'Impossible de sauvegarder le module.'), {
        endpoint,
        method,
        status: response.status,
        payload,
        responseBody: body
      });
      return showFeedback(feedback, body?.error || 'Impossible de sauvegarder le module.', 'error');
    }
    const moduleId = body?.module?.id || state.moduleEditingId;
    if (pendingUploads.length && moduleId) {
      showFeedback(feedback, 'Upload des fichiers en cours...', 'loading');
      await uploadModuleFiles(moduleId, pendingUploads);
    }
    const actionText = state.moduleEditingId ? 'Module mis a jour.' : 'Module cree.';
    const fileText = pendingUploads.length ? ' Fichiers importes.' : '';
    showFeedback(feedback, `${actionText}${fileText}`, 'success');
    setActionSuccess(submitButton, 'R?ussi');
    state.modulePendingUploadFiles = [];
    resetModuleForm();
    setModuleView(MODULE_PANEL_LIST);
    await fetchModulesForSelectedFormation();
  } catch (error) {
    setActionError(submitButton, 'FormationManager:SaveModule', error, {
      endpoint,
      method,
      payload
    });
    showFeedback(feedback, 'Erreur reseau.', 'error');
  }
}

// ── Formation Options ─────────────────────────────────────────────────────────

const FORMATION_OPTIONS_ENDPOINT = formationId =>
  `/api/gestion/formations/${formationId}/options`;
const FORMATION_OPTION_ENDPOINT = (formationId, optionId) =>
  `/api/gestion/formations/${formationId}/options/${optionId}`;
const FORMATION_OPTION_IMAGE_ENDPOINT = (formationId, optionId) =>
  `/api/gestion/formations/${formationId}/options/${optionId}/image`;

async function loadFormationOptions(formationId, container) {
  if (!formationId || state.optionsLoading) return;
  state.optionsLoading = true;
  const root = getRoot(container);
  const listEl = root?.querySelector('[data-options-list]');
  if (listEl) {
    listEl.innerHTML = `<div class="gmf-options-loading"><span class="muted">Chargement...</span></div>`;
  }
  try {
    const resp = await fetch(FORMATION_OPTIONS_ENDPOINT(formationId), { credentials: 'include' });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Erreur');
    state.formationOptions = Array.isArray(data.options) ? data.options : [];
    state.optionKebabId = null;
    renderOptionsList(root);
  } catch {
    if (listEl) {
      listEl.innerHTML = `<p class="muted">Impossible de charger les options.</p>`;
    }
  } finally {
    state.optionsLoading = false;
  }
}

function renderOptionsList(container) {
  const root = getRoot(container);
  const listEl = root?.querySelector('[data-options-list]');
  if (!listEl) return;
  listEl.classList.add('gmf-options-list');
  if (!state.formationOptions.length) {
    listEl.innerHTML = `<p class="module-placeholder">Aucune option pour l'instant. Cliquez sur "Ajouter une option" pour commencer.</p>`;
    return;
  }
  listEl.innerHTML = state.formationOptions
    .map(opt => {
      const optionId = String(opt.id || '').trim();
      const coverMarkup = opt.image
        ? `<img src="${escapeHtml(opt.image)}" alt="Couverture de ${escapeHtml(opt.name || 'option')}" loading="lazy">`
        : `<div class="formation-card__placeholder"><i class="bi bi-image"></i></div>`;
      const menuOpen = state.optionKebabId === optionId;
      return `
        <article class="formation-card gmf-option-card" data-option-id="${escapeHtml(optionId)}">
          <div class="formation-card__media">${coverMarkup}</div>
          <div class="formation-card__body">
            <div class="formation-card__top">
              <span class="formation-card__price">${Number(opt.price || 0).toFixed(2)} €</span>
            </div>
            <h3 class="formation-card__title">${escapeHtml(opt.name || 'Option sans nom')}</h3>
            <p class="formation-card__desc">${escapeHtml(String(opt.description || '').trim() || 'Pas de description')}</p>
            <p class="formation-card__meta">Délai : ${escapeHtml(String(Number(opt.deadlineDays || 0)))} jour(s) avant session</p>
          </div>
          <div class="formation-card__actions">
            <button
              class="kebab-button"
              type="button"
              data-option-kebab-toggle
              data-id="${escapeHtml(optionId)}"
              aria-label="Actions option"
            >
              <span aria-hidden="true">⋮</span>
            </button>
            <div class="formation-card__menu ${menuOpen ? 'is-open' : ''}" data-option-kebab-menu data-id="${escapeHtml(optionId)}" ${menuOpen ? '' : 'hidden'}>
              <button type="button" data-option-kebab-action="edit" data-option-id="${escapeHtml(optionId)}" aria-label="Modifier l option">
                <i class="bi bi-pencil"></i>
              </button>
              <button type="button" data-option-kebab-action="delete" data-option-id="${escapeHtml(optionId)}" aria-label="Supprimer l option">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function closeAllOptionKebabMenus(container) {
  const scope = getRoot(container) || document;
  scope.querySelectorAll('[data-option-kebab-menu]').forEach(menu => {
    const hideTimerId = Number(menu.dataset.hideTimerId || 0);
    if (hideTimerId) {
      window.clearTimeout(hideTimerId);
      menu.removeAttribute('data-hide-timer-id');
    }
    if (menu.hidden && !menu.classList.contains('is-open')) {
      return;
    }
    menu.classList.remove('is-open');
    const timerId = window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) {
        menu.hidden = true;
      }
    }, 150);
    menu.dataset.hideTimerId = String(timerId);
  });
  state.optionKebabId = null;
}

function toggleOptionKebabMenu(id, container) {
  const scope = getRoot(container) || document;
  if (!id) return;
  const menu = scope.querySelector(`[data-option-kebab-menu][data-id="${id}"]`);
  if (!menu) return;
  const isOpen = !menu.hidden;
  closeAllOptionKebabMenus(scope);
  if (!isOpen) {
    const hideTimerId = Number(menu.dataset.hideTimerId || 0);
    if (hideTimerId) {
      window.clearTimeout(hideTimerId);
      menu.removeAttribute('data-hide-timer-id');
    }
    menu.hidden = false;
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
    });
    state.optionKebabId = id;
  }
}

let optionKebabOutsideListenerAttached = false;

function ensureOptionKebabOutsideListener() {
  if (optionKebabOutsideListenerAttached) return;
  document.addEventListener('click', event => {
    if (!state.optionKebabId) return;
    if (
      event.target.closest('[data-option-kebab-toggle]') ||
      event.target.closest('[data-option-kebab-menu]')
    ) {
      return;
    }
    closeAllOptionKebabMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!state.optionKebabId) return;
    closeAllOptionKebabMenus();
  });
  optionKebabOutsideListenerAttached = true;
}

function clearOptionLocalImageSelection(overlay, { clearInput = true } = {}) {
  if (!overlay) return;
  const objectUrl = String(overlay.dataset.optionImageObjectUrl || '').trim();
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
  delete overlay.dataset.optionImageObjectUrl;
  delete overlay.dataset.optionImageLocalUrl;
  if (clearInput) {
    const imageInput = overlay.querySelector('[name="optionImage"]');
    if (imageInput) imageInput.value = '';
  }
}

function setOptionServerImage(overlay, imageUrl = '') {
  if (!overlay) return;
  overlay.dataset.optionImageServerUrl = String(imageUrl || '').trim();
}

function getOptionCurrentImageUrl(overlay) {
  if (!overlay) return '';
  const localImage = String(overlay.dataset.optionImageLocalUrl || '').trim();
  if (localImage) return localImage;
  return String(overlay.dataset.optionImageServerUrl || '').trim();
}

function renderOptionImageEditor(overlay) {
  if (!overlay) return;
  const currentImage = getOptionCurrentImageUrl(overlay);
  const previewWrap = overlay.querySelector('[data-option-image-preview-wrap]');
  const imagePreview = overlay.querySelector('[data-option-image-preview]');
  const addButton = overlay.querySelector('[data-action="add-option-image"]');
  const editButton = overlay.querySelector('[data-action="edit-option-image"]');
  const deleteButton = overlay.querySelector('[data-action="delete-option-image"]');
  if (imagePreview) {
    imagePreview.src = currentImage;
    imagePreview.hidden = !currentImage;
  }
  if (previewWrap) {
    previewWrap.hidden = !currentImage;
  }
  if (addButton) {
    addButton.hidden = Boolean(currentImage);
  }
  if (editButton) {
    editButton.hidden = !currentImage;
  }
  if (deleteButton) {
    deleteButton.hidden = !currentImage;
  }
}

function readOptionImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!(file instanceof File)) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(new Error('read-option-image-failed'));
    };
    reader.readAsDataURL(file);
  });
}

function openOptionModal(root, { mode = 'create', option = null } = {}) {
  const overlay = root?.querySelector('[data-option-modal]');
  if (!overlay) return;
  const heading = overlay.querySelector('[data-option-modal-heading]');
  const form = overlay.querySelector('[data-option-form]');
  const idInput = overlay.querySelector('[name="optionId"]');
  const nameInput = overlay.querySelector('[name="optionName"]');
  const descInput = overlay.querySelector('[name="optionDescription"]');
  const priceInput = overlay.querySelector('[name="optionPrice"]');
  const deadlineInput = overlay.querySelector('[name="optionDeadlineDays"]');

  if (heading) heading.textContent = mode === 'create' ? 'Ajouter une option' : 'Modifier l\'option';
  if (idInput) idInput.value = option?.id || '';
  if (nameInput) nameInput.value = option?.name || '';
  if (descInput) descInput.value = option?.description || '';
  if (priceInput) priceInput.value = option?.price != null ? option.price : '';
  if (deadlineInput) deadlineInput.value = option?.deadlineDays != null ? option.deadlineDays : '';
  clearOptionLocalImageSelection(overlay);
  setOptionServerImage(overlay, option?.image || '');
  renderOptionImageEditor(overlay);
  const feedback = overlay.querySelector('[data-option-form-message]');
  if (feedback) {
    feedback.textContent = '';
    feedback.className = 'form-message';
  }
  const body = overlay.querySelector('.gmf-option-modal__body');
  if (body) {
    body.scrollTop = 0;
  }
  openModalOverlay(overlay);
  requestAnimationFrame(() => {
    nameInput?.focus();
  });
}

async function handleDeleteOptionImage(root) {
  const overlay = root?.querySelector('[data-option-modal]');
  if (!overlay) return;

  const hasLocalImage = Boolean(String(overlay.dataset.optionImageLocalUrl || '').trim());
  if (hasLocalImage) {
    clearOptionLocalImageSelection(overlay);
    renderOptionImageEditor(overlay);
    return;
  }

  const existingImage = String(overlay.dataset.optionImageServerUrl || '').trim();
  if (!existingImage) return;

  const formationId = state.editingId;
  const optionId = String(overlay.querySelector('[name="optionId"]')?.value || '').trim();
  if (!formationId || !optionId) return;

  const confirmed = await confirmAction({
    title: 'Supprimer l\'image ?',
    message: 'Êtes-vous sûr de vouloir supprimer cette image ?',
    confirmLabel: 'Supprimer',
    cancelLabel: 'Annuler',
    danger: true
  });
  if (!confirmed) return;

  const feedback = overlay.querySelector('[data-option-form-message]');
  const deleteButton = overlay.querySelector('[data-action="delete-option-image"]');
  if (deleteButton) deleteButton.disabled = true;
  try {
    const resp = await fetch(FORMATION_OPTION_IMAGE_ENDPOINT(formationId, optionId), {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await resp.json();
    if (!data.ok) {
      showFeedback(feedback, data.error || 'Impossible de supprimer l image.', 'error');
      return;
    }
    setOptionServerImage(overlay, data.option?.image || '');
    clearOptionLocalImageSelection(overlay);
    renderOptionImageEditor(overlay);
    await loadFormationOptions(formationId, root);
    showToast({ type: 'success', message: 'Image supprimée.' });
  } catch {
    showFeedback(feedback, 'Erreur réseau.', 'error');
  } finally {
    if (deleteButton) deleteButton.disabled = false;
  }
}

async function handleOptionFormSubmit(root) {
  const overlay = root?.querySelector('[data-option-modal]');
  if (!overlay) return;
  const idInput = overlay.querySelector('[name="optionId"]');
  const nameInput = overlay.querySelector('[name="optionName"]');
  const descInput = overlay.querySelector('[name="optionDescription"]');
  const priceInput = overlay.querySelector('[name="optionPrice"]');
  const deadlineInput = overlay.querySelector('[name="optionDeadlineDays"]');
  const imageInput = overlay.querySelector('[name="optionImage"]');
  const feedback = overlay.querySelector('[data-option-form-message]');
  const saveBtn = overlay.querySelector('[data-action="save-option"]');

  const optionId = String(idInput?.value || '').trim();
  const mode = optionId ? 'edit' : 'create';
  const formationId = state.editingId;
  if (!formationId) return;

  const name = String(nameInput?.value || '').trim();
  if (!name) {
    showFeedback(feedback, 'Le nom est requis.', 'error');
    return;
  }
  const price = Number.parseFloat(priceInput?.value);
  if (!Number.isFinite(price) || price < 0) {
    showFeedback(feedback, 'Le prix est invalide.', 'error');
    return;
  }
  const deadlineDays = Number.parseInt(deadlineInput?.value, 10);
  if (!Number.isFinite(deadlineDays) || deadlineDays < 0) {
    showFeedback(feedback, 'Le délai est invalide.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('name', name);
  formData.append('description', String(descInput?.value || '').trim());
  formData.append('price', price);
  formData.append('deadlineDays', deadlineDays);
  if (imageInput?.files?.length) {
    formData.append('image', imageInput.files[0]);
  }

  if (saveBtn) saveBtn.disabled = true;
  try {
    const url = mode === 'create'
      ? FORMATION_OPTIONS_ENDPOINT(formationId)
      : FORMATION_OPTION_ENDPOINT(formationId, optionId);
    const method = mode === 'create' ? 'POST' : 'PUT';
    const resp = await fetch(url, { method, credentials: 'include', body: formData });
    const data = await resp.json();
    if (!data.ok) {
      showFeedback(feedback, data.error || 'Erreur serveur.', 'error');
      return;
    }
    clearOptionLocalImageSelection(overlay, { clearInput: false });
    closeModalOverlay(overlay);
    await loadFormationOptions(formationId, root);
    showToast({ type: 'success', message: mode === 'create' ? 'Option ajoutée.' : 'Option modifiée.' });
  } catch {
    showFeedback(feedback, 'Erreur réseau.', 'error');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function handleDeleteOption(root, optionId) {
  const formationId = state.editingId;
  if (!formationId || !optionId) return;
  const confirmed = await confirmAction({
    title: 'Supprimer l\'option ?',
    message: 'Êtes-vous sûr de vouloir supprimer cette option ?',
    confirmLabel: 'Supprimer',
    cancelLabel: 'Annuler',
    danger: true
  });
  if (!confirmed) return;
  try {
    const resp = await fetch(FORMATION_OPTION_ENDPOINT(formationId, optionId), {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await resp.json();
    if (!data.ok) {
      showToast({ type: 'error', message: data.error || 'Erreur lors de la suppression.' });
      return;
    }
    await loadFormationOptions(formationId, root);
    showToast({ type: 'success', message: 'Option supprimée.' });
  } catch {
    showToast({ type: 'error', message: 'Erreur réseau.' });
  }
}

function attachOptionsEvents(container) {
  const root = getRoot(container);
  if (!root) return;
  const panel = root.querySelector('[data-editor-panel="options"]');
  if (!panel || panel.dataset.optionEventsBound === 'true') return;
  panel.dataset.optionEventsBound = 'true';
  ensureOptionKebabOutsideListener();

  panel.addEventListener('click', event => {
    const addBtn = event.target.closest('[data-action="add-option"]');
    if (addBtn) {
      openOptionModal(root, { mode: 'create' });
      return;
    }
    const kebabToggle = event.target.closest('[data-option-kebab-toggle]');
    if (kebabToggle) {
      event.preventDefault();
      toggleOptionKebabMenu(String(kebabToggle.dataset.id || '').trim(), root);
      return;
    }
    const actionBtn = event.target.closest('[data-option-kebab-action]');
    if (actionBtn) {
      event.preventDefault();
      const optId = String(actionBtn.dataset.optionId || '').trim();
      closeAllOptionKebabMenus(root);
      if (!optId) return;
      const opt = state.formationOptions.find(o => o.id === optId);
      if (actionBtn.dataset.optionKebabAction === 'edit') {
        if (opt) openOptionModal(root, { mode: 'edit', option: opt });
        return;
      }
      if (actionBtn.dataset.optionKebabAction === 'delete') {
        void handleDeleteOption(root, optId);
      }
      return;
    }
  });

  const overlay = root.querySelector('[data-option-modal]');
  if (overlay) {
    overlay.addEventListener('click', event => {
      if (event.target === overlay) {
        clearOptionLocalImageSelection(overlay);
        closeModalOverlay(overlay);
        return;
      }
      if (event.target.closest('[data-action="cancel-option"]')) {
        clearOptionLocalImageSelection(overlay);
        closeModalOverlay(overlay);
        return;
      }
      if (event.target.closest('[data-action="save-option"]')) {
        void handleOptionFormSubmit(root);
        return;
      }
      if (event.target.closest('[data-action="add-option-image"]') || event.target.closest('[data-action="edit-option-image"]')) {
        overlay.querySelector('[name="optionImage"]')?.click();
        return;
      }
      if (event.target.closest('[data-action="delete-option-image"]')) {
        void handleDeleteOptionImage(root);
      }
    });
    const imageInput = overlay.querySelector('[name="optionImage"]');
    imageInput?.addEventListener('change', async () => {
      clearOptionLocalImageSelection(overlay, { clearInput: false });
      const selectedFile = imageInput.files?.[0];
      if (selectedFile) {
        try {
          const dataUrl = await readOptionImageAsDataUrl(selectedFile);
          if (dataUrl) {
            overlay.dataset.optionImageLocalUrl = dataUrl;
          }
        } catch {
          const url = URL.createObjectURL(selectedFile);
          overlay.dataset.optionImageObjectUrl = url;
          overlay.dataset.optionImageLocalUrl = url;
        }
      }
      renderOptionImageEditor(overlay);
    });
  }
}

// ── End Formation Options ──────────────────────────────────────────────────────

function attachModuleEvents(container) {
  const root = getModuleRoot(container);
  if (!root || root.dataset.moduleEventsBound === 'true') return;
  root.dataset.moduleEventsBound = 'true';
  const form = getModuleForm();
  form?.addEventListener('submit', handleModuleSubmit);
  form?.querySelector('[name="moduleTitle"]')?.addEventListener('input', event => {
    ensureModuleDraft();
    state.moduleDraft.title = String(event.target.value || '').trim();
  });
  getModuleEditorTrack()?.addEventListener('click', event => {
    const button = event.target.closest('[data-module-editor-tab]');
    if (!button) return;
    event.preventDefault();
    setModuleEditorTab(button.dataset.moduleEditorTab);
  });
  getModuleEditorTrack()?.addEventListener('scroll', () => updateModuleEditorTabArrow(), { passive: true });
  attachTabsScrollToggle(getModuleEditorRoot(), getModuleEditorTrack(), () => updateModuleEditorTabArrow());
  getModuleFileInput()?.addEventListener('change', handleModuleFilesPicked);
  root.addEventListener('click', handleModulePanelClick);
  root.addEventListener('input', event => {
    const videoTitleInput = event.target.closest('[data-module-video-editor-title-input]');
    if (videoTitleInput) {
      updateModuleVideoEditorTitle(videoTitleInput.value);
      return;
    }
    const videoInput = event.target.closest('[data-module-video-editor-url]');
    if (!videoInput) return;
    updateModuleVideoEditorUrl(videoInput.value);
  });
  ensureModuleKebabGlobalListeners(root);
  ensureModuleVideoInfoViewportListeners();
}

async function fetchModulesForSelectedFormation(targetId = state.selectedFormationId, options = {}) {
  const { silent = false } = options;
  const container = getModuleListContainer();
  const formationId = targetId;
  if (!formationId) {
    state.modules = [];
    state.moduleOrderMode = false;
    state.moduleDraftOrderIds = [];
    teardownModuleDragListeners();
    clearModuleDragIndicator();
    if (!silent) {
      renderModuleList();
    }
    return;
  }
  if (!silent && container) {
    container.innerHTML = '<p class="module-placeholder">Chargement des modules...</p>';
  }
  try {
    const response = await fetch(MODULES_FOR_FORMATION_ENDPOINT(formationId), {
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      const error = payload?.error || 'Impossible de charger les modules.';
      throw new Error(error);
    }
    state.modules = Array.isArray(payload.modules) ? payload.modules : [];
    state.modules.sort((a, b) => {
      const left = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return String(a?.title || '').localeCompare(String(b?.title || ''), 'fr', { sensitivity: 'base' });
    });
    if (!state.moduleOrderMode) {
      syncModuleDraftOrderFromModules();
    }
    if (!silent) {
      renderModuleList();
    }
  } catch (error) {
    console.error('Erreur chargement modules', error);
    if (!silent && container) {
      container.innerHTML = '<p class="module-placeholder">Impossible de charger les modules.</p>';
    }
  }
}

async function handleModuleDelete(moduleId, actionButton = null) {
  const feedback = getModuleFeedbackElement();
  if (!moduleId) return;
  const confirmed = await confirmAction({
    title: 'Supprimer ce module ?',
    message: 'Cette action est irreversible.',
    confirmLabel: 'Supprimer',
    danger: true
  });
  if (!confirmed) {
    return;
  }
  setActionLoading(actionButton, 'Suppression...');
  try {
    const response = await fetch(MODULE_ENDPOINT(moduleId), {
      method: 'DELETE',
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de supprimer le module.');
    }
    showFeedback(feedback, 'Module supprime.', 'success');
    if (state.moduleEditingId === moduleId) {
      resetModuleForm();
      setModuleView(MODULE_PANEL_LIST);
    }
    await fetchModulesForSelectedFormation();
    setActionSuccess(actionButton, 'R?ussi');
  } catch (error) {
    setActionError(actionButton, 'FormationManager:DeleteModule', error, { moduleId });
    showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
  }
}

function startModuleOrderMode() {
  if (!state.modules.length || state.modules.length < 2) {
    showFeedback(getModuleFeedbackElement(), 'Au moins deux modules sont requis pour changer l ordre.', 'info');
    return;
  }
  state.moduleOrderMode = true;
  syncModuleDraftOrderFromModules();
  closeAllModuleKebabs();
  setModuleView(MODULE_PANEL_LIST);
  renderModuleList();
}

function cancelModuleOrderMode() {
  state.moduleOrderMode = false;
  state.moduleDraftOrderIds = [];
  teardownModuleDragListeners();
  clearModuleDragIndicator();
  releaseModuleDragMirror();
  renderModuleList();
}

async function saveModuleOrder(actionButton = null) {
  if (!state.selectedFormationId || !state.moduleOrderMode || !state.moduleDraftOrderIds.length) {
    return;
  }
  const feedback = getModuleFeedbackElement();
  const resolvedActionButton = actionButton || document.querySelector('[data-action="save-module-order"]');
  if (resolvedActionButton?.dataset.actionState === 'loading') return;
  setActionLoading(resolvedActionButton, 'Enregistrement...');
  const orderedModuleIds = [...state.moduleDraftOrderIds];
  if (FM_DEV_LOGS) {
    console.debug('[FormationModules] order save payload', orderedModuleIds);
  }
  try {
    const response = await fetch(MODULES_ORDER_ENDPOINT(state.selectedFormationId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedModuleIds })
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible d enregistrer l ordre.');
    }
    state.modules = Array.isArray(payload.modules) ? payload.modules : state.modules;
    state.modules.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    state.moduleOrderMode = false;
    syncModuleDraftOrderFromModules();
    teardownModuleDragListeners();
    showFeedback(feedback, 'Ordre des modules enregistre.', 'success');
    renderModuleList();
    setActionSuccess(resolvedActionButton, 'R?ussi');
  } catch (error) {
    setActionError(resolvedActionButton, 'FormationManager:ReorderModules', error, {
      formationId: state.selectedFormationId,
      orderedModuleIds
    });
    showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
  }
}

function teardownModuleDragListeners() {
  if (!moduleDragListElement) return;
  moduleDragListElement.removeEventListener('dragover', handleModuleDragOver);
  moduleDragListElement.removeEventListener('drop', handleModuleDrop);
  moduleDragListElement.querySelectorAll('[data-module-card]').forEach(card => {
    card.removeEventListener('dragstart', handleModuleDragStart);
    card.removeEventListener('dragend', handleModuleDragEnd);
    card.removeEventListener('pointerdown', handleModulePointerDown);
    card.removeEventListener('touchstart', handleModuleTouchStart);
  });
  moduleDragListElement = null;
}

function setupModuleDragListeners() {
  const list = getModuleListContainer();
  if (!list || !state.moduleOrderMode) return;
  teardownModuleDragListeners();
  moduleDragListElement = list;
  moduleDragListElement.addEventListener('dragover', handleModuleDragOver);
  moduleDragListElement.addEventListener('drop', handleModuleDrop);
  moduleDragListElement.querySelectorAll('[data-module-card]').forEach(card => {
    card.addEventListener('dragstart', handleModuleDragStart);
    card.addEventListener('dragend', handleModuleDragEnd);
    card.addEventListener('pointerdown', handleModulePointerDown);
    card.addEventListener('touchstart', handleModuleTouchStart, { passive: false });
  });
}

function ensureModuleDragIndicator() {
  if (!moduleDragIndicator) {
    moduleDragIndicator = document.createElement('div');
    moduleDragIndicator.className = 'drag-indicator';
    moduleDragIndicator.setAttribute('aria-hidden', 'true');
    moduleDragIndicatorNeedsReveal = true;
  }
  return moduleDragIndicator;
}

function finalizeModuleDragIndicatorRemoval() {
  if (!moduleDragIndicator) return;
  if (moduleDragIndicatorRemovalHandler) {
    moduleDragIndicator.removeEventListener('transitionend', moduleDragIndicatorRemovalHandler);
    moduleDragIndicatorRemovalHandler = null;
  }
  if (moduleDragIndicator.parentNode) {
    moduleDragIndicator.parentNode.removeChild(moduleDragIndicator);
  }
  moduleDragIndicator = null;
  if (moduleDragIndicatorRemovalTimer) {
    clearTimeout(moduleDragIndicatorRemovalTimer);
    moduleDragIndicatorRemovalTimer = null;
  }
}

function clearModuleDragIndicator() {
  if (!moduleDragIndicator) {
    moduleDropTargetId = null;
    moduleDropAfter = false;
    return;
  }
  moduleDragIndicator.classList.remove('is-visible');
  if (moduleDragIndicatorRemovalHandler) {
    moduleDragIndicator.removeEventListener('transitionend', moduleDragIndicatorRemovalHandler);
  }
  moduleDragIndicatorRemovalHandler = event => {
    if (event.propertyName !== 'width') return;
    finalizeModuleDragIndicatorRemoval();
  };
  moduleDragIndicator.addEventListener('transitionend', moduleDragIndicatorRemovalHandler);
  if (moduleDragIndicatorRemovalTimer) {
    clearTimeout(moduleDragIndicatorRemovalTimer);
  }
  moduleDragIndicatorRemovalTimer = setTimeout(finalizeModuleDragIndicatorRemoval, 260);
  moduleDropTargetId = null;
  moduleDropAfter = false;
}

function revealModuleDragIndicator() {
  if (!moduleDragIndicator) return;
  if (moduleDragIndicatorNeedsReveal) {
    requestAnimationFrame(() => {
      if (!moduleDragIndicator) return;
      moduleDragIndicator.classList.add('is-visible');
      moduleDragIndicatorNeedsReveal = false;
    });
  } else if (!moduleDragIndicator.classList.contains('is-visible')) {
    moduleDragIndicator.classList.add('is-visible');
  }
}

function findModuleInsertionTarget(pointerY) {
  if (!moduleDragListElement) return null;
  const cards = Array.from(moduleDragListElement.querySelectorAll('[data-module-card]')).filter(
    card => card.dataset.moduleId !== moduleDragSourceId
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

function moveModuleIndicator(target, after) {
  if (!target) return;
  const indicator = ensureModuleDragIndicator();
  const parent = target.parentElement;
  if (!parent) return;
  if (
    moduleDropTargetId === target.dataset.moduleId &&
    moduleDropAfter === after &&
    indicator.parentElement === parent
  ) {
    return;
  }
  if (after) {
    parent.insertBefore(indicator, target.nextElementSibling);
  } else {
    parent.insertBefore(indicator, target);
  }
  moduleDropTargetId = target.dataset.moduleId;
  moduleDropAfter = after;
  revealModuleDragIndicator();
}

function updateModuleIndicatorFromPoint(clientX, clientY) {
  if (!moduleDragSourceId) return false;
  const element = document.elementFromPoint(clientX, clientY);
  const targetCard = element?.closest('[data-module-card]');
  if (targetCard && targetCard.dataset.moduleId !== moduleDragSourceId) {
    const rect = targetCard.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    moveModuleIndicator(targetCard, after);
    return true;
  }
  const fallback = findModuleInsertionTarget(clientY);
  if (fallback) {
    moveModuleIndicator(fallback.card, fallback.after);
    return true;
  }
  clearModuleDragIndicator();
  return false;
}

function clearModuleTextSelection() {
  if (!window.getSelection) return;
  const selection = window.getSelection();
  if (selection) selection.removeAllRanges();
}

function lockModuleInteraction() {
  modulePreviousBodyTouchAction = document.body.style.touchAction || '';
  modulePreviousHtmlTouchAction = document.documentElement.style.touchAction || '';
  document.body.style.touchAction = 'none';
  document.documentElement.style.touchAction = 'none';
  clearModuleTextSelection();
}

function unlockModuleInteraction() {
  document.body.style.touchAction = modulePreviousBodyTouchAction;
  document.documentElement.style.touchAction = modulePreviousHtmlTouchAction;
  modulePreviousBodyTouchAction = '';
  modulePreviousHtmlTouchAction = '';
}

function updateModuleDragMirrorPosition(clientX, clientY) {
  if (!moduleDragMirror) return;
  const offsetX = 14;
  const offsetY = 14;
  moduleDragMirror.style.transform = `translate(${clientX + offsetX}px, ${clientY + offsetY}px)`;
}

function releaseModuleDragMirror() {
  if (moduleDragMoveHandler) {
    document.removeEventListener('dragover', moduleDragMoveHandler);
    document.removeEventListener('drag', moduleDragMoveHandler);
    moduleDragMoveHandler = null;
  }
  if (moduleDragMirror && moduleDragMirror.parentNode) {
    moduleDragMirror.parentNode.removeChild(moduleDragMirror);
  }
  moduleDragMirror = null;
}

function createModuleDragMirror(card) {
  releaseModuleDragMirror();
  if (!card) return null;
  moduleDragMirror = card.cloneNode(true);
  moduleDragMirror.classList.add('drag-ghost');
  moduleDragMirror.style.width = `${card.offsetWidth}px`;
  moduleDragMirror.style.height = `${card.offsetHeight}px`;
  moduleDragMirror.style.position = 'fixed';
  moduleDragMirror.style.top = '0';
  moduleDragMirror.style.left = '0';
  moduleDragMirror.style.margin = '0';
  moduleDragMirror.style.pointerEvents = 'none';
  moduleDragMirror.style.zIndex = '9999';
  moduleDragMirror.style.transform = 'translate(0, 0)';
  document.body.appendChild(moduleDragMirror);
  moduleDragMoveHandler = event => {
    if (event.clientX === 0 && event.clientY === 0) return;
    updateModuleDragMirrorPosition(event.clientX, event.clientY);
  };
  document.addEventListener('dragover', moduleDragMoveHandler);
  document.addEventListener('drag', moduleDragMoveHandler);
  return moduleDragMirror;
}

function activateModuleDrag(card, clientX, clientY) {
  if (!card || !state.moduleOrderMode) return;
  moduleDragSourceId = card.dataset.moduleId;
  card.classList.add('dragging');
  document.body.classList.add('dragging-ui');
  document.documentElement.classList.add('dragging-ui');
  lockModuleInteraction();
  createModuleDragMirror(card);
  updateModuleDragMirrorPosition(clientX, clientY);
  updateModuleIndicatorFromPoint(clientX, clientY);
}

function cleanupModuleDragUI() {
  document.body.classList.remove('dragging-ui');
  document.documentElement.classList.remove('dragging-ui');
  unlockModuleInteraction();
}

function handleModuleDragStart(event) {
  if (!state.moduleOrderMode) return;
  const card = event.currentTarget;
  activateModuleDrag(card, event.clientX, event.clientY);
  event.dataTransfer?.setData('text/plain', moduleDragSourceId);
  const blankImage = new Image();
  blankImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==';
  event.dataTransfer?.setDragImage(blankImage, 0, 0);
}

function handleModuleDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  moduleDragSourceId = null;
  clearModuleDragIndicator();
  releaseModuleDragMirror();
  cleanupModuleDragUI();
}

function handleModuleDragOver(event) {
  if (!moduleDragSourceId) return;
  event.preventDefault();
  updateModuleIndicatorFromPoint(event.clientX, event.clientY);
  updateModuleDragMirrorPosition(event.clientX, event.clientY);
}

function handleModuleDrop(event) {
  event.preventDefault();
  if (!moduleDragSourceId) return;
  finalizeModuleDrop();
}

function resetModuleManualDragState() {
  modulePendingDragCard = null;
  moduleDragStartPoint = null;
  moduleManualDragStarted = false;
}

function tryStartModuleManualDrag(clientX, clientY) {
  if (!modulePendingDragCard || !moduleDragStartPoint) return false;
  const dx = clientX - moduleDragStartPoint.x;
  const dy = clientY - moduleDragStartPoint.y;
  if (Math.hypot(dx, dy) < MODULE_MANUAL_DRAG_THRESHOLD) return false;
  moduleManualDragStarted = true;
  clearModuleTextSelection();
  activateModuleDrag(modulePendingDragCard, clientX, clientY);
  return true;
}

function handleModulePointerDown(event) {
  if (event.pointerType !== 'touch') return;
  if (!state.moduleOrderMode || moduleDragSourceId || moduleManualDragStarted) return;
  modulePendingDragCard = event.currentTarget;
  moduleDragStartPoint = { x: event.clientX, y: event.clientY };
  moduleManualDragStarted = false;
  moduleActivePointerId = event.pointerId;
  modulePointerMoveListener = handleModulePointerMove;
  modulePointerUpListener = handleModulePointerUp;
  document.addEventListener('pointermove', modulePointerMoveListener);
  document.addEventListener('pointerup', modulePointerUpListener);
  document.addEventListener('pointercancel', modulePointerUpListener);
}

function handleModulePointerMove(event) {
  if (event.pointerId !== moduleActivePointerId) return;
  if (!moduleManualDragStarted) {
    if (!tryStartModuleManualDrag(event.clientX, event.clientY)) return;
  }
  event.preventDefault();
  clearModuleTextSelection();
  updateModuleDragMirrorPosition(event.clientX, event.clientY);
  updateModuleIndicatorFromPoint(event.clientX, event.clientY);
}

function handleModulePointerUp(event) {
  if (event.pointerId !== moduleActivePointerId) return;
  document.removeEventListener('pointermove', modulePointerMoveListener);
  document.removeEventListener('pointerup', modulePointerUpListener);
  document.removeEventListener('pointercancel', modulePointerUpListener);
  modulePointerMoveListener = null;
  modulePointerUpListener = null;
  moduleActivePointerId = null;
  if (moduleManualDragStarted) {
    event.preventDefault();
    finalizeModuleDrop();
    releaseModuleDragMirror();
    moduleDragSourceId = null;
    cleanupModuleDragUI();
  }
  resetModuleManualDragState();
}

function handleModuleTouchStart(event) {
  if (!state.moduleOrderMode || event.touches.length !== 1 || moduleDragSourceId || moduleManualDragStarted) return;
  const touch = event.changedTouches[0];
  if (!touch) return;
  modulePendingDragCard = event.currentTarget;
  moduleDragStartPoint = { x: touch.clientX, y: touch.clientY };
  moduleManualDragStarted = false;
  moduleActiveTouchId = touch.identifier;
  moduleTouchMoveListener = handleModuleTouchMove;
  moduleTouchEndListener = handleModuleTouchEnd;
  document.addEventListener('touchmove', moduleTouchMoveListener, { passive: false });
  document.addEventListener('touchend', moduleTouchEndListener);
  document.addEventListener('touchcancel', moduleTouchEndListener);
}

function handleModuleTouchMove(event) {
  if (moduleActiveTouchId === null) return;
  const touch = Array.from(event.changedTouches).find(item => item.identifier === moduleActiveTouchId);
  if (!touch) return;
  if (!moduleManualDragStarted) {
    if (!tryStartModuleManualDrag(touch.clientX, touch.clientY)) return;
  }
  event.preventDefault();
  clearModuleTextSelection();
  updateModuleDragMirrorPosition(touch.clientX, touch.clientY);
  updateModuleIndicatorFromPoint(touch.clientX, touch.clientY);
}

function handleModuleTouchEnd(event) {
  if (moduleActiveTouchId === null) return;
  const touch = Array.from(event.changedTouches).find(item => item.identifier === moduleActiveTouchId);
  if (!touch) return;
  document.removeEventListener('touchmove', moduleTouchMoveListener);
  document.removeEventListener('touchend', moduleTouchEndListener);
  document.removeEventListener('touchcancel', moduleTouchEndListener);
  moduleTouchMoveListener = null;
  moduleTouchEndListener = null;
  moduleActiveTouchId = null;
  if (moduleManualDragStarted) {
    event.preventDefault();
    finalizeModuleDrop();
    releaseModuleDragMirror();
    moduleDragSourceId = null;
    cleanupModuleDragUI();
  }
  resetModuleManualDragState();
}

function reorderModuleDraftOrder(targetId, targetAfter) {
  const sourceId = moduleDragSourceId;
  if (!sourceId) return null;
  const orderedIds = [...state.moduleDraftOrderIds];
  const fromIndex = orderedIds.findIndex(moduleId => moduleId === sourceId);
  if (fromIndex === -1) return null;
  const [moved] = orderedIds.splice(fromIndex, 1);
  if (!targetId) {
    orderedIds.push(moved);
    return orderedIds;
  }
  const targetIndex = orderedIds.findIndex(moduleId => moduleId === targetId);
  if (targetIndex === -1) {
    orderedIds.push(moved);
    return orderedIds;
  }
  const insertIndex = targetAfter ? targetIndex + 1 : targetIndex;
  orderedIds.splice(insertIndex, 0, moved);
  return orderedIds;
}

function finalizeModuleDrop() {
  if (!moduleDragSourceId) return false;
  const targetId = moduleDropTargetId;
  const targetAfter = moduleDropAfter;
  clearModuleDragIndicator();
  const reorderedIds = reorderModuleDraftOrder(targetId, targetAfter);
  if (!reorderedIds) return false;
  state.moduleDraftOrderIds = reorderedIds;
  renderModuleList();
  return true;
}

function handleModulePanelClick(event) {
  const root = getModuleRoot();
  if (!root) return;
  const infoOverlay = event.target.closest('[data-module-video-info-overlay]');
  if (infoOverlay && event.target === infoOverlay) {
    closeModuleVideoInfoOverlay();
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action || '';
  if (action === 'open-module-create') {
    event.preventDefault();
    if (state.moduleOrderMode) return;
    if (!state.selectedFormationId) {
      showFeedback(getModuleFeedbackElement(), 'Sélectionnez une formation distancielle.', 'info');
      return;
    }
    resetModuleForm();
    setModuleView(MODULE_PANEL_EDITOR, root);
    return;
  }
  if (action === 'back-to-module-list' || action === 'cancel-module-editor') {
    event.preventDefault();
    resetModuleEditorState(root);
    return;
  }
  if (action === 'open-module-description-editorial') {
    event.preventDefault();
    openModuleDescriptionEditorialEditor();
    return;
  }
  if (action === 'add-module-video') {
    event.preventDefault();
    addModuleVideo();
    return;
  }
  if (action === 'open-module-video-info') {
    event.preventDefault();
    openModuleVideoInfoOverlay(event.target.closest('[data-action="open-module-video-info"]'));
    return;
  }
  if (action === 'close-module-video-info') {
    event.preventDefault();
    closeModuleVideoInfoOverlay();
    return;
  }
  if (action === 'open-video-editorial') {
    event.preventDefault();
    openModuleVideoEditorialEditor(event.target.closest('[data-action="open-video-editorial"]')?.dataset.id || state.moduleVideoEditingId || '');
    return;
  }
  if (action === 'save-module-video-editor') {
    event.preventDefault();
    void saveModuleVideoEditor(event.target.closest('[data-action="save-module-video-editor"]'));
    return;
  }
  if (action === 'cancel-module-video-editor' || action === 'back-to-video-list') {
    event.preventDefault();
    closeModuleVideoEditor();
    renderModuleVideosList();
    return;
  }
  if (action === 'toggle-module-video-order') {
    event.preventDefault();
    if (state.moduleVideoOrderMode) return;
    startModuleVideoOrderMode();
    return;
  }
  if (action === 'save-module-video-order') {
    event.preventDefault();
    void saveModuleVideoOrderMode(event.target.closest('[data-action="save-module-video-order"]'));
    return;
  }
  if (action === 'cancel-module-video-order') {
    event.preventDefault();
    cancelModuleVideoOrderMode();
    return;
  }
  if (action === 'trigger-module-files-upload') {
    event.preventDefault();
    if (state.moduleFileOrderMode) return;
    getModuleFileInput()?.click();
    return;
  }
  if (action === 'toggle-module-file-order') {
    event.preventDefault();
    if (state.moduleFileOrderMode) {
      return;
    }
    startModuleFileOrderMode();
    return;
  }
  if (action === 'save-module-file-order') {
    event.preventDefault();
    void saveModuleFileOrderMode(event.target.closest('[data-action="save-module-file-order"]'));
    return;
  }
  if (action === 'cancel-module-file-order') {
    event.preventDefault();
    cancelModuleFileOrderMode();
    return;
  }
  if (action === 'cancel-file-rename') {
    event.preventDefault();
    closeFileRenameModal();
    return;
  }
  if (action === 'save-file-rename') {
    event.preventDefault();
    void saveFileRenameModal(event.target.closest('[data-action="save-file-rename"]'));
    return;
  }
  if (action === 'delete-module-inline') {
    event.preventDefault();
    if (!state.moduleEditingId) return;
    void handleModuleDelete(state.moduleEditingId, event.target.closest('[data-action="delete-module-inline"]'));
    return;
  }
  if (action === 'toggle-module-order') {
    event.preventDefault();
    if (state.moduleOrderMode) {
      return;
    }
    startModuleOrderMode();
    return;
  }
  if (action === 'save-module-order') {
    event.preventDefault();
    void saveModuleOrder(event.target.closest('[data-action="save-module-order"]'));
    return;
  }
  if (action === 'cancel-module-order') {
    event.preventDefault();
    cancelModuleOrderMode();
    return;
  }

  const kebabToggle = event.target.closest('[data-module-kebab-toggle]');
  if (kebabToggle) {
    event.preventDefault();
    toggleModuleKebab(kebabToggle.dataset.id, root);
    return;
  }
  const videoKebabToggle = event.target.closest('[data-module-video-kebab-toggle]');
  if (videoKebabToggle) {
    event.preventDefault();
    toggleModuleVideoKebab(videoKebabToggle.dataset.id);
    return;
  }
  const fileKebabToggle = event.target.closest('[data-module-file-kebab-toggle]');
  if (fileKebabToggle) {
    event.preventDefault();
    toggleModuleFileKebab(fileKebabToggle.dataset.id);
    return;
  }
  const videoAction = event.target.closest('[data-module-video-action]');
  if (videoAction) {
    event.preventDefault();
    const videoId = videoAction.dataset.id;
    closeAllModuleEditorKebabs(root);
    if (videoAction.dataset.moduleVideoAction === 'edit') {
      openModuleVideoEditor(videoId);
      return;
    }
    if (videoAction.dataset.moduleVideoAction === 'delete') {
      void removeModuleVideo(videoId, videoAction);
    }
    return;
  }
  const fileAction = event.target.closest('[data-module-file-action]');
  if (fileAction) {
    event.preventDefault();
    const fileId = fileAction.dataset.id;
    closeAllModuleEditorKebabs(root);
    if (fileAction.dataset.moduleFileAction === 'edit') {
      openFileRenameModal(fileId);
      return;
    }
    if (fileAction.dataset.moduleFileAction === 'delete') {
      if (state.moduleEditingId) {
        void handleModuleFileDelete(fileId, fileAction);
      } else {
        void (async () => {
          const confirmed = await confirmAction({
            title: 'Supprimer le fichier ?',
            message: 'Ce fichier sera retire de ce module.',
            confirmLabel: 'Supprimer',
            danger: true
          });
          if (!confirmed) return;
          ensureModuleDraft();
          state.moduleDraft.files = normalizeModuleDraftFiles(
            state.moduleDraft.files.filter(file => file.fileId !== fileId)
          );
          syncModuleFileDraftOrderFromFiles();
          showFeedback(getModuleFeedbackElement(), 'Fichier retire.', 'success');
          renderModuleFilesPreview();
        })();
      }
    }
    return;
  }
  const moduleAction = event.target.closest('[data-module-action]');
  if (!moduleAction) return;
  event.preventDefault();
  const moduleId = moduleAction.dataset.id;
  const module = state.modules.find(entry => entry.id === moduleId);
  if (!module) return;
  closeAllModuleKebabs(root);
  if (moduleAction.dataset.moduleAction === 'edit') {
    populateModuleForm(module);
    return;
  }
  if (moduleAction.dataset.moduleAction === 'delete') {
    void handleModuleDelete(moduleId, moduleAction);
  }
}

function getSessionForm() {
  return document.querySelector('[data-session-form]');
}

function getSessionListContainer() {
  return document.querySelector('[data-session-list]');
}

function getSessionSelect() {
  return document.querySelector('[data-session-formation-select]');
}

function getSessionFeedbackElement() {
  return document.querySelector('[data-session-form-message]');
}

function getPlanningSessionFeedbackElement() {
  return document.querySelector('[data-planning-session-message]');
}

function getPlanningSessionDetailContainer() {
  return document.querySelector('[data-planning-session-detail-content]');
}

function getCanceledSessionListContainer() {
  return document.querySelector('[data-canceled-session-list]');
}

function getPlanningSessionDetailFeedbackElement() {
  return document.querySelector('[data-planning-session-detail-feedback]');
}

function getSessionScheduleContainer() {
  return document.querySelector('[data-session-schedule]');
}

function getSessionCreateModalOverlay() {
  return document.querySelector('[data-session-create-modal]');
}

function getSessionModalOverlay() {
  return document.querySelector('[data-session-detail-modal]');
}

function getSessionModalFeedbackElement() {
  return document.querySelector('[data-session-detail-feedback]');
}

function getSessionConflictModalOverlay() {
  return document.querySelector('[data-session-conflict-modal]');
}

function getSessionMoveCalendarElement() {
  return getSessionModalOverlay()?.querySelector('[data-session-move-calendar]') || null;
}

function getSessionMoveFeedbackElement() {
  return getSessionModalOverlay()?.querySelector('[data-session-move-feedback]') || null;
}

function getSessionMoveConfirmModalOverlay() {
  const calendar = getSessionMoveCalendarElement();
  return calendar?.querySelector('[data-session-move-confirm-modal]') || null;
}

function clearSessionMoveConfirmOverlayBounds() {
  const overlay = getSessionMoveConfirmModalOverlay();
  if (!overlay) return;
  overlay.classList.remove(MODAL_VISIBLE_CLASS);
  overlay.classList.add('hidden');
  overlay.setAttribute('hidden', '');
}

function clearSessionMoveTimers() {
  const { suggestionTimerId, resumeTimerId } = state.sessionMove;
  if (Number.isFinite(Number(suggestionTimerId)) && Number(suggestionTimerId) > 0) {
    window.clearTimeout(Number(suggestionTimerId));
  }
  if (Number.isFinite(Number(resumeTimerId)) && Number(resumeTimerId) > 0) {
    window.clearTimeout(Number(resumeTimerId));
  }
  state.sessionMove.suggestionTimerId = null;
  state.sessionMove.resumeTimerId = null;
}

function closeSessionMoveConfirmModal({ suppressResume = false } = {}) {
  const overlay = getSessionMoveConfirmModalOverlay();
  if (overlay) {
    overlay.classList.remove(MODAL_VISIBLE_CLASS);
    overlay.classList.add('hidden');
    overlay.setAttribute('hidden', '');
    clearSessionMoveConfirmOverlayBounds();
  }
  state.sessionMoveConfirm.open = false;
  state.sessionMove.pendingStartKey = '';
  if (!suppressResume && state.sessionModal.open && !isSessionMoveSecondaryModalOpen()) {
    scheduleSessionMoveSuggestionResume(SESSION_MOVE_RESUME_DELAY_MS);
  }
}

function resetSessionMoveState({ keepMonth = false } = {}) {
  clearSessionMoveTimers();
  if (!keepMonth) {
    state.sessionMove.month = calendarToday.getMonth();
    state.sessionMove.year = calendarToday.getFullYear();
  }
  state.sessionMove.previewStartKey = '';
  state.sessionMove.touchPreviewStartKey = '';
  state.sessionMove.suggestionKeys = [];
  state.sessionMove.pendingStartKey = '';
  state.sessionMove.currentSessionId = null;
  closeSessionMoveConfirmModal({ suppressResume: true });
}

function isSessionMoveSecondaryModalOpen() {
  return Boolean(state.sessionTimePicker.open || state.sessionConflictModal.open || state.sessionMoveConfirm.open);
}

function normalizeDurationDaysValue(value, fallbackDays = 1) {
  const parsedValue = Number(value);
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return Math.max(1, Math.floor(parsedValue));
  }
  const parsedFallback = Number(fallbackDays);
  if (Number.isFinite(parsedFallback) && parsedFallback > 0) {
    return Math.max(1, Math.floor(parsedFallback));
  }
  return 1;
}

function normalizeRefundDaysValue(value, fallbackDays = 7) {
  const parsedValue = Number(value);
  if (Number.isFinite(parsedValue) && parsedValue >= 0) {
    return Math.max(0, Math.floor(parsedValue));
  }
  const parsedFallback = Number(fallbackDays);
  if (Number.isFinite(parsedFallback) && parsedFallback >= 0) {
    return Math.max(0, Math.floor(parsedFallback));
  }
  return 7;
}

function syncRefundDaysWidget(form, value = 7) {
  const widget = form?.querySelector('[data-refund-days-widget]');
  if (!widget) return;
  const input = widget.querySelector('[data-refund-days-input]');
  const display = widget.querySelector('[data-refund-days-display]');
  const decrementBtn = widget.querySelector('[data-action="refund-days-decrement"]');
  const incrementBtn = widget.querySelector('[data-action="refund-days-increment"]');
  const tooltip = form.querySelector('[data-refund-days-tooltip]');
  const minVal = Number(widget.dataset.refundMin ?? 0);
  const current = normalizeRefundDaysValue(value, 7);
  if (input) input.value = String(current);
  if (display) display.textContent = String(current);
  if (decrementBtn) decrementBtn.disabled = current <= minVal;
  if (incrementBtn) incrementBtn.disabled = current >= 100;
  if (tooltip) {
    tooltip.textContent =
      `Les clients pourront annuler et etre rembourses si la session est dans plus de ${current} jours. ` +
      'Le droit legal de retractation de 14 jours apres achat s applique toujours, sauf renonciation signee.';
  }
}

function resolveSessionDurationDays(session, fallbackDays = 1) {
  const parsedDuration = normalizeDurationDaysValue(session?.durationDays, 0);
  if (parsedDuration > 0) {
    return parsedDuration;
  }
  const scheduleEntries = Array.isArray(session?.schedule) ? session.schedule : [];
  const scheduleDuration = scheduleEntries.reduce((maxDays, entry) => {
    const dayIndex = Number(entry?.dayIndex);
    if (!Number.isFinite(dayIndex) || dayIndex < 1) return maxDays;
    return Math.max(maxDays, Math.floor(dayIndex));
  }, 0);
  if (scheduleDuration > 0) {
    return scheduleDuration;
  }
  return normalizeDurationDaysValue(fallbackDays, 1);
}

function getSessionMoveDurationDays(session) {
  return resolveSessionDurationDays(session, 1);
}

function buildSessionMoveBlock(startDateKey, durationDays) {
  const block = [];
  for (let offset = 0; offset < durationDays; offset += 1) {
    const key = addDaysToCalendarKey(startDateKey, offset);
    if (!key) {
      return [];
    }
    block.push(key);
  }
  return block;
}

function buildSessionMoveOccupiedMap(activeSession) {
  const occupiedMap = new Map();
  const activeSessionId = String(activeSession?.id || '');
  const addConflict = (dateKey, detail) => {
    if (!dateKey || !detail) return;
    if (!occupiedMap.has(dateKey)) {
      occupiedMap.set(dateKey, []);
    }
    occupiedMap.get(dateKey).push(detail);
  };
  state.sessions.forEach(session => {
    if (!session?.id || String(session.id) === activeSessionId) return;
    const rangeLabel = buildSessionDateRangeLabel(session);
    buildSessionCalendarKeys(session).forEach(dateKey => {
      addConflict(dateKey, {
        label: `Session ${rangeLabel}`,
        formationName: 'Cette formation'
      });
    });
  });
  state.sessionExternalSessions.forEach(entry => {
    const formationName = String(entry?.formationName || 'Autre formation').trim() || 'Autre formation';
    const sessions = Array.isArray(entry?.sessions) ? entry.sessions : [];
    sessions.forEach(session => {
      const rangeLabel = buildSessionDateRangeLabel(session);
      buildSessionCalendarKeys(session).forEach(dateKey => {
        addConflict(dateKey, {
          label: `Session ${rangeLabel}`,
          formationName
        });
      });
    });
  });
  return occupiedMap;
}

function evaluateSessionMoveBlock(startDateKey, activeSession, occupiedMap = null) {
  const durationDays = getSessionMoveDurationDays(activeSession);
  const blockKeys = buildSessionMoveBlock(startDateKey, durationDays);
  if (!blockKeys.length) {
    return { valid: false, durationDays, blockKeys: [], conflictDays: [] };
  }
  const map = occupiedMap instanceof Map ? occupiedMap : buildSessionMoveOccupiedMap(activeSession);
  const conflictDays = [];
  const today = getCalendarTodayStart();
  blockKeys.forEach((dateKey, index) => {
    const parsed = parseCalendarKey(dateKey);
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed < today) {
      conflictDays.push({
        key: dateKey,
        index: index + 1,
        conflicts: [{ label: 'Date passée', formationName: '' }]
      });
      return;
    }
    const conflicts = map.get(dateKey) || [];
    if (conflicts.length) {
      conflictDays.push({
        key: dateKey,
        index: index + 1,
        conflicts
      });
    }
  });
  return {
    valid: conflictDays.length === 0,
    durationDays,
    blockKeys,
    conflictDays
  };
}

function formatSessionMoveConflictMessage(evaluation) {
  const firstConflictDay = evaluation?.conflictDays?.[0];
  const firstConflict = firstConflictDay?.conflicts?.[0];
  if (!firstConflictDay || !firstConflict) {
    return 'Impossible, ce bloc de dates est indisponible.';
  }
  const conflictDayIndexes = evaluation.conflictDays.map(item => item.index);
  const label = conflictDayIndexes.length > 1
    ? `jours ${conflictDayIndexes.join(', ')}`
    : `jour ${conflictDayIndexes[0]}`;
  if (firstConflict.label === 'Date passée') {
    return `Impossible, le ${label} tombe dans le passé.`;
  }
  return `Impossible, chevauchement avec ${firstConflict.formationName} (${firstConflict.label}) sur ${label}.`;
}

function getSessionMoveValidStarts(activeSession) {
  const durationDays = getSessionMoveDurationDays(activeSession);
  const occupiedMap = buildSessionMoveOccupiedMap(activeSession);
  const { month, year } = state.sessionMove;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const starts = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = getCalendarKey(new Date(year, month, day));
    const evaluation = evaluateSessionMoveBlock(dateKey, activeSession, occupiedMap);
    if (evaluation.valid && evaluation.blockKeys.length === durationDays) {
      starts.push(dateKey);
    }
  }
  return starts;
}

function pickRandomSessionMoveStart(validStarts = []) {
  if (!Array.isArray(validStarts) || !validStarts.length) return '';
  const previousStart = state.sessionMove.suggestionKeys[0] || '';
  if (validStarts.length === 1) return validStarts[0];
  const candidates = validStarts.filter(key => key !== previousStart);
  const pool = candidates.length ? candidates : validStarts;
  return pool[Math.floor(Math.random() * pool.length)] || '';
}

function stopSessionMoveSuggestion({ clearSuggestion = false } = {}) {
  if (Number.isFinite(Number(state.sessionMove.suggestionTimerId)) && Number(state.sessionMove.suggestionTimerId) > 0) {
    window.clearTimeout(Number(state.sessionMove.suggestionTimerId));
  }
  state.sessionMove.suggestionTimerId = null;
  if (clearSuggestion) {
    state.sessionMove.suggestionKeys = [];
    renderSessionMoveCalendar();
  }
}

function scheduleSessionMoveSuggestionResume(delay = SESSION_MOVE_RESUME_DELAY_MS) {
  if (!state.sessionModal.open) return;
  if (Number.isFinite(Number(state.sessionMove.resumeTimerId)) && Number(state.sessionMove.resumeTimerId) > 0) {
    window.clearTimeout(Number(state.sessionMove.resumeTimerId));
  }
  state.sessionMove.resumeTimerId = window.setTimeout(() => {
    state.sessionMove.resumeTimerId = null;
    startSessionMoveSuggestionLoop();
  }, delay);
}

function startSessionMoveSuggestionLoop() {
  if (!state.sessionModal.open || isSessionMoveSecondaryModalOpen()) return;
  if (Number.isFinite(Number(state.sessionMove.suggestionTimerId)) && Number(state.sessionMove.suggestionTimerId) > 0) {
    return;
  }
  const activeSession = getActiveSessionModalSession();
  if (!activeSession) return;
  const validStarts = getSessionMoveValidStarts(activeSession);
  if (!validStarts.length) {
    state.sessionMove.suggestionKeys = [];
    renderSessionMoveCalendar();
    return;
  }
  const nextStart = pickRandomSessionMoveStart(validStarts);
  if (!nextStart) return;
  const block = buildSessionMoveBlock(nextStart, getSessionMoveDurationDays(activeSession));
  state.sessionMove.suggestionKeys = block;
  renderSessionMoveCalendar();
  const delayRange = SESSION_MOVE_SUGGESTION_MAX_MS - SESSION_MOVE_SUGGESTION_MIN_MS;
  const nextDelay = SESSION_MOVE_SUGGESTION_MIN_MS + Math.round(Math.random() * Math.max(0, delayRange));
  state.sessionMove.suggestionTimerId = window.setTimeout(() => {
    state.sessionMove.suggestionTimerId = null;
    startSessionMoveSuggestionLoop();
  }, nextDelay);
}

function setSessionMovePreview(startDateKey) {
  state.sessionMove.previewStartKey = String(startDateKey || '');
  renderSessionMoveCalendar();
}

function changeSessionMoveCalendarMonth(delta) {
  let month = Number(state.sessionMove.month);
  let year = Number(state.sessionMove.year);
  month += Number(delta || 0);
  if (month > 11) {
    month = 0;
    year += 1;
  } else if (month < 0) {
    month = 11;
    year -= 1;
  }
  state.sessionMove.month = month;
  state.sessionMove.year = year;
  state.sessionMove.previewStartKey = '';
  state.sessionMove.touchPreviewStartKey = '';
  state.sessionMove.suggestionKeys = [];
  renderSessionMoveCalendar();
  scheduleSessionMoveSuggestionResume(180);
}

function renderSessionMoveCalendar() {
  const calendar = getSessionMoveCalendarElement();
  if (!calendar) return;
  const monthLabel = calendar.querySelector('[data-session-move-month]');
  const grid = calendar.querySelector('[data-session-move-grid]');
  if (!monthLabel || !grid) return;
  const activeSession = getActiveSessionModalSession();
  if (!activeSession) {
    monthLabel.textContent = '';
    grid.innerHTML = '';
    return;
  }
  const { month, year } = state.sessionMove;
  monthLabel.textContent = `${MONTH_LABELS[month]} ${year}`;
  const activeSessionDays = new Set(buildSessionCalendarKeys(activeSession));
  const occupiedMap = buildSessionMoveOccupiedMap(activeSession);
  const previewEvaluation = state.sessionMove.previewStartKey
    ? evaluateSessionMoveBlock(state.sessionMove.previewStartKey, activeSession, occupiedMap)
    : null;
  const previewKeys = new Set(previewEvaluation?.blockKeys || []);
  const previewConflictKeys = new Set((previewEvaluation?.conflictDays || []).map(entry => entry.key));
  const suggestionKeys = new Set(
    state.sessionMove.previewStartKey ? [] : (Array.isArray(state.sessionMove.suggestionKeys) ? state.sessionMove.suggestionKeys : [])
  );
  const firstOfMonth = new Date(year, month, 1);
  const offset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = getCalendarTodayStart();
  const cells = [];
  for (let index = 0; index < offset; index += 1) {
    cells.push('<span class="calendar-day calendar-day--empty"></span>');
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const currentDate = new Date(year, month, day);
    const dateKey = getCalendarKey(currentDate);
    const isPast = currentDate < today && !activeSessionDays.has(dateKey);
    const hasConflict = occupiedMap.has(dateKey);
    const classes = ['calendar-day', 'session-move-day'];
    if (isPast) {
      classes.push('calendar-day--disabled');
    }
    if (hasConflict) {
      classes.push('calendar-day--session');
    }
    if (activeSessionDays.has(dateKey)) {
      classes.push('session-move-current-session');
    }
    if (suggestionKeys.has(dateKey) && !hasConflict && !isPast) {
      classes.push('session-move-suggestion');
    }
    if (previewKeys.has(dateKey) && !isPast) {
      classes.push(previewConflictKeys.has(dateKey) ? 'session-move-conflict' : 'session-move-preview');
    }
    cells.push(`
      <button
        type="button"
        class="${classes.join(' ')}"
        data-session-move-day
        data-date-key="${dateKey}"
        ${isPast ? 'disabled' : ''}
      >
        <span class="calendar-day__number">${day}</span>
        <span class="calendar-day__weekday">${WEEKDAY_LABELS[currentDate.getDay()]}</span>
      </button>
    `);
  }
  grid.innerHTML = cells.join('');
  const dayButtons = grid.querySelectorAll('[data-session-move-day]');
  const enabledButtons = Array.from(dayButtons).filter(button => !button.disabled);
  traceSessionMove('render move calendar grid', {
    month,
    year,
    totalDays: dayButtons.length,
    enabledDays: enabledButtons.length
  });
}

function openSessionMoveConfirmModal(startDateKey, evaluation) {
  const overlay = getSessionMoveConfirmModalOverlay();
  if (!overlay) {
    logDev('[FM][SessionMove] confirm overlay missing');
    traceSessionMove('confirm modal missing', {
      startDateKey,
      hasCalendar: Boolean(getSessionMoveCalendarElement())
    });
    return;
  }
  stopSessionMoveSuggestion({ clearSuggestion: true });
  state.sessionMove.pendingStartKey = startDateKey;
  state.sessionMoveConfirm.open = true;
  overlay.removeAttribute('hidden');
  overlay.classList.remove('hidden');
  const message = overlay.querySelector('[data-session-move-confirm-text]');
  const range = overlay.querySelector('[data-session-move-confirm-range]');
  const startLabel = formatCalendarKeyLabel(startDateKey);
  const endLabel = formatCalendarKeyLabel(evaluation?.blockKeys?.[evaluation.blockKeys.length - 1]);
  if (message) {
    message.textContent = 'Souhaitez-vous décaler la session à ces dates ?';
  }
  if (range) {
    range.hidden = false;
    range.textContent = evaluation?.durationDays > 1
      ? `${startLabel} → ${endLabel}`
      : startLabel;
  }
  traceSessionMove('open confirm modal', {
    startDateKey,
    duration: evaluation?.durationDays,
    hiddenAttr: overlay.hasAttribute('hidden'),
    className: overlay.className
  });
  overlay.focus();
  logDev('[FM][SessionMove] confirm open', {
    startDateKey,
    duration: evaluation?.durationDays,
    hiddenAttr: overlay.hasAttribute('hidden'),
    className: overlay.className
  });
}

function isSessionMoveTouchMode() {
  return Boolean(window.matchMedia && window.matchMedia('(hover: none)').matches);
}

function handleSessionMoveCalendarDaySelection(dateKey, { source = 'click' } = {}) {
  const activeSession = getActiveSessionModalSession();
  if (!activeSession || !dateKey) {
    traceSessionMove('day selection aborted', {
      source,
      dateKey,
      hasActiveSession: Boolean(activeSession)
    });
    return;
  }
  const evaluation = evaluateSessionMoveBlock(dateKey, activeSession);
  traceSessionMove('day selection evaluation', {
    source,
    dateKey,
    valid: Boolean(evaluation?.valid),
    conflictDays: Array.isArray(evaluation?.conflictDays) ? evaluation.conflictDays.length : 0
  });
  logDev('[FM][SessionMove] evaluation', {
    source,
    dateKey,
    valid: evaluation.valid,
    conflictDays: Array.isArray(evaluation.conflictDays) ? evaluation.conflictDays.length : 0
  });
  state.sessionMove.previewStartKey = dateKey;
  state.sessionMove.touchPreviewStartKey = source === 'touch' ? dateKey : '';
  renderSessionMoveCalendar();
  if (!evaluation.valid) {
    const message = formatSessionMoveConflictMessage(evaluation);
    traceSessionMove('open conflict modal', { dateKey, message });
    showFeedback(getSessionMoveFeedbackElement(), message, 'error');
    openSessionConflictModal({ message });
    return;
  }
  showFeedback(getSessionMoveFeedbackElement(), '', '');
  openSessionMoveConfirmModal(dateKey, evaluation);
}

function handleSessionMoveCalendarClick(event) {
  traceSessionMove('calendar click received', {
    target: describeEventTarget(event.target)
  });
  const navButton = event.target.closest('[data-session-move-calendar-action]');
  if (navButton) {
    event.preventDefault();
    const direction = navButton.dataset.sessionMoveCalendarAction === 'prev' ? -1 : 1;
    traceSessionMove('calendar nav click', { direction });
    changeSessionMoveCalendarMonth(direction);
    return true;
  }
  const dayButton = event.target.closest('[data-session-move-day]');
  if (!dayButton) {
    traceSessionMove('calendar click ignored (not a day button)', {
      target: describeEventTarget(event.target)
    });
    return false;
  }
  event.preventDefault();
  stopSessionMoveSuggestion({ clearSuggestion: true });
  const dateKey = String(dayButton.dataset.dateKey || '').trim();
  if (!dateKey) {
    traceSessionMove('day button missing date-key', {
      target: describeEventTarget(dayButton)
    });
    return true;
  }
  traceSessionMove('day button click', {
    dateKey,
    disabled: dayButton.disabled
  });
  const isTouchMode = isSessionMoveTouchMode();
  if (isTouchMode) {
    state.sessionMove.touchPreviewStartKey = dateKey;
    state.sessionMove.previewStartKey = dateKey;
    renderSessionMoveCalendar();
    logDev('[FM][SessionMove] touch selection', { dateKey });
  }
  handleSessionMoveCalendarDaySelection(dateKey, { source: isTouchMode ? 'touch' : 'click' });
  return true;
}

function handleSessionMoveCalendarMouseOver(event) {
  if (isSessionMoveTouchMode()) return;
  if (state.sessionMoveConfirm.open) return;
  const calendar = event.target.closest('[data-session-move-calendar]');
  if (!calendar) return;
  const fromOutside = !event.relatedTarget || !calendar.contains(event.relatedTarget);
  if (fromOutside && Array.isArray(state.sessionMove.suggestionKeys) && state.sessionMove.suggestionKeys.length) {
    stopSessionMoveSuggestion({ clearSuggestion: true });
  }
  const dayButton = event.target.closest('[data-session-move-day]');
  if (!dayButton) return;
  const dateKey = String(dayButton.dataset.dateKey || '').trim();
  if (!dateKey) return;
  if (state.sessionMove.previewStartKey === dateKey) return;
  state.sessionMove.previewStartKey = dateKey;
  renderSessionMoveCalendar();
}

function handleSessionMoveCalendarMouseOut(event) {
  if (isSessionMoveTouchMode()) return;
  if (state.sessionMoveConfirm.open) return;
  const calendar = event.target.closest('[data-session-move-calendar]');
  if (!calendar) return;
  const toOutside = !event.relatedTarget || !calendar.contains(event.relatedTarget);
  if (!toOutside) return;
  if (!state.sessionMove.previewStartKey) return;
  state.sessionMove.previewStartKey = '';
  renderSessionMoveCalendar();
  scheduleSessionMoveSuggestionResume(SESSION_MOVE_RESUME_DELAY_MS);
}

function handleSessionMoveCalendarTouchStart(event) {
  const calendar = event.target.closest('[data-session-move-calendar]');
  if (!calendar) return;
  stopSessionMoveSuggestion({ clearSuggestion: true });
}

function setSessionMoveConfirmLoading(isLoading) {
  const overlay = getSessionMoveConfirmModalOverlay();
  if (!overlay) return;
  overlay.querySelectorAll('[data-session-move-choice]').forEach(button => {
    button.disabled = Boolean(isLoading);
  });
}

async function executeSessionMoveChoice(choice, actionButton = null) {
  traceSessionMove('execute move choice', {
    choice,
    pendingStartKey: state.sessionMove.pendingStartKey
  });
  if (state.sessionMoveConfirm.inFlight) return;
  const startDate = String(state.sessionMove.pendingStartKey || '').trim();
  if (!startDate) {
    closeSessionMoveConfirmModal();
    return;
  }
  const activeSession = getActiveSessionModalSession();
  const form = getSessionModalOverlay()?.querySelector('[data-session-detail-form]');
  if (!activeSession || !form) {
    closeSessionMoveConfirmModal();
    return;
  }
  const evaluation = evaluateSessionMoveBlock(startDate, activeSession);
  if (!evaluation.valid) {
    const message = formatSessionMoveConflictMessage(evaluation);
    showFeedback(getSessionMoveFeedbackElement(), message, 'error');
    openSessionConflictModal({ message });
    closeSessionMoveConfirmModal();
    return;
  }
  const durationDays = getSessionMoveDurationDays(activeSession);
  const schedule = collectSessionModalScheduleEntries(form, durationDays);
  if (schedule.some(entry => !entry.startTime || !entry.endTime)) {
    showFeedback(getSessionModalFeedbackElement(), 'Les horaires sont requis pour chaque jour.', 'error');
    return;
  }
  if (schedule.some(entry => entry.startTime >= entry.endTime)) {
    showFeedback(getSessionModalFeedbackElement(), 'Chaque jour doit commencer avant sa fin.', 'error');
    return;
  }
  const maxClients = Math.floor(Number(form.querySelector('[name="maxClients"]')?.value));
  if (!Number.isFinite(maxClients) || maxClients < 1) {
    showFeedback(getSessionModalFeedbackElement(), 'Capacite invalide.', 'error');
    return;
  }
  const context = choice === 'edit' ? 'FormationManager:MoveSessionEditSchedule' : 'FormationManager:MoveSessionKeepSchedule';
  if (choice === 'keep') {
    const overlapConflict = await findScheduleConflictBeforeSave([startDate], schedule);
    if (overlapConflict) {
      const message = `La formation ${overlapConflict.formationName} a déjà une séance planifiée le ${formatCalendarKeyLabel(
        overlapConflict.dateKey
      )} de ${overlapConflict.startTime} a ${overlapConflict.endTime}.`;
      showFeedback(getSessionModalFeedbackElement(), message, 'error');
      openSessionConflictModal({ message });
      return;
    }
  }
  try {
    state.sessionMoveConfirm.inFlight = true;
    setSessionMoveConfirmLoading(true);
    setActionLoading(actionButton, 'Enregistrement...');
    await saveSessionModalPayload({
      sessionId: activeSession.id,
      startDate,
      maxClients,
      schedule
    });
    closeSessionMoveConfirmModal();
    stopSessionMoveSuggestion({ clearSuggestion: true });
    state.sessionMove.previewStartKey = startDate;
    state.sessionMove.touchPreviewStartKey = startDate;
    renderSessionMoveCalendar();
    if (choice === 'edit') {
      showFeedback(
        getSessionModalFeedbackElement(),
        'Session deplacee. Vous pouvez maintenant ajuster les horaires puis enregistrer.',
        'info'
      );
      requestAnimationFrame(() => {
        const firstInput = getSessionModalOverlay()?.querySelector('[data-modal-schedule-start][data-day-index="1"]');
        firstInput?.focus();
      });
    } else {
      showFeedback(getSessionModalFeedbackElement(), 'Session deplacee avec les memes horaires.', 'success');
    }
    setActionSuccess(actionButton, 'R?ussi');
  } catch (error) {
    setActionError(actionButton, context, error, {
      sessionId: activeSession.id,
      startDate,
      maxClients,
      schedule
    });
    showFeedback(getSessionModalFeedbackElement(), error.message || 'Erreur reseau.', 'error');
  } finally {
    state.sessionMoveConfirm.inFlight = false;
    setSessionMoveConfirmLoading(false);
  }
}

function updateSessionDurationText(durationDays) {
  const target = document.querySelector('[data-session-duration]');
  if (!target) return;
  const days = normalizeDurationDaysValue(durationDays, 1);
  target.textContent = `Durée : ${days === 1 ? '1 jour' : `${days} jours`}`;
}

function parseTimeToMinutes(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return null;
  const [hoursRaw, minutesRaw] = normalized.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return bStart < aEnd && bEnd > aStart;
}

function formatCalendarKeyLabel(dateKey) {
  const parsed = parseCalendarKey(String(dateKey || '').trim());
  if (!parsed || Number.isNaN(parsed.getTime())) return String(dateKey || '');
  return parsed.toLocaleDateString();
}

function addDaysToCalendarKey(dateKey, offsetDays = 0) {
  const parsed = parseCalendarKey(String(dateKey || '').trim());
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  parsed.setDate(parsed.getDate() + Number(offsetDays || 0));
  return getCalendarKey(parsed);
}

function buildSessionTimePickerRow(dayIndex, { startTime = '', endTime = '', context = 'create' } = {}) {
  const safeStart = escapeHtml(String(startTime || '').trim());
  const safeEnd = escapeHtml(String(endTime || '').trim());
  const contextValue = context === 'modal' || context === 'detail' || context === 'list-create' ? context : 'create';
  const startName =
    contextValue === 'modal'
      ? `modalSessionScheduleStart-${dayIndex}`
      : contextValue === 'detail'
        ? `detailSessionScheduleStart-${dayIndex}`
        : contextValue === 'list-create'
          ? `listCreateSessionScheduleStart-${dayIndex}`
          : `sessionScheduleStart-${dayIndex}`;
  const endName =
    contextValue === 'modal'
      ? `modalSessionScheduleEnd-${dayIndex}`
      : contextValue === 'detail'
        ? `detailSessionScheduleEnd-${dayIndex}`
        : contextValue === 'list-create'
          ? `listCreateSessionScheduleEnd-${dayIndex}`
          : `sessionScheduleEnd-${dayIndex}`;
  const startSelector =
    contextValue === 'modal' ? 'data-modal-schedule-start'
    : contextValue === 'detail' ? 'data-detail-schedule-start'
    : contextValue === 'list-create' ? 'data-list-create-schedule-start'
    : 'data-schedule-start';
  const endSelector =
    contextValue === 'modal' ? 'data-modal-schedule-end'
    : contextValue === 'detail' ? 'data-detail-schedule-end'
    : contextValue === 'list-create' ? 'data-list-create-schedule-end'
    : 'data-schedule-end';
  const rangeLabel = safeStart && safeEnd ? `${safeStart} → ${safeEnd}` : 'Sélectionnez un début et une fin';
  const durationLabel = safeStart && safeEnd ? computeDurationLabel(safeStart, safeEnd) : '';
  return `
    <div class="session-schedule-row session-time-row" data-schedule-day="${dayIndex}">
      <p class="session-time-row__title">Jour ${dayIndex} - horaires</p>
      <div class="session-time-picker" data-session-time-picker data-context="${contextValue}" data-day-index="${dayIndex}">
        <div class="stp-banner">
          <button
            type="button"
            class="stp-banner__chip stp-banner__chip--start"
            data-action="open-session-time-picker"
            data-target="start"
          >
            <i class="bi bi-play-circle-fill" aria-hidden="true"></i>
            <span class="stp-banner__chip-label">Début</span>
            <strong class="stp-banner__chip-value" data-session-time-chip-value="start">${safeStart || '--:--'}</strong>
          </button>
          <span class="stp-banner__sep">→</span>
          <button
            type="button"
            class="stp-banner__chip stp-banner__chip--end"
            data-action="open-session-time-picker"
            data-target="end"
          >
            <i class="bi bi-stop-circle-fill" aria-hidden="true"></i>
            <span class="stp-banner__chip-label">Fin</span>
            <strong class="stp-banner__chip-value" data-session-time-chip-value="end">${safeEnd || '--:--'}</strong>
          </button>
          <span class="stp-banner__duration" data-session-time-duration ${durationLabel ? '' : 'hidden'}>
            <i class="bi bi-clock" aria-hidden="true"></i>
            <span>${escapeHtml(durationLabel)}</span>
          </span>
        </div>
        <p class="session-time-picker__hint muted" data-session-time-hint hidden></p>
        <div class="stp-mosaic" data-session-time-grid></div>
        <input
          type="hidden"
          name="${startName}"
          ${startSelector}
          data-time-value
          data-target="start"
          data-day-index="${dayIndex}"
          value="${safeStart}"
        >
        <input
          type="hidden"
          name="${endName}"
          ${endSelector}
          data-time-value
          data-target="end"
          data-day-index="${dayIndex}"
          value="${safeEnd}"
        >
      </div>
    </div>
  `;
}

function getSessionTimePickerElement(context, dayIndex) {
  return document.querySelector(
    `[data-session-time-picker][data-context="${context}"][data-day-index="${Number(dayIndex)}"]`
  );
}

function getSessionTimePickerValues(pickerElement) {
  if (!pickerElement) {
    return { startTime: '', endTime: '' };
  }
  const startTime = String(
    pickerElement.querySelector('[data-time-value][data-target="start"]')?.value || ''
  ).trim();
  const endTime = String(pickerElement.querySelector('[data-time-value][data-target="end"]')?.value || '').trim();
  return { startTime, endTime };
}

function getSessionTimePickerDateKeys(context, dayIndex) {
  const offset = Math.max(0, Number(dayIndex) - 1);
  if (context === 'create' || context === 'list-create') {
    return Array.from(
      new Set(
        state.sessionSelectedDates
          .filter(key => !isCalendarKeyInPast(key))
          .map(startKey => addDaysToCalendarKey(startKey, offset))
          .filter(Boolean)
      )
    );
  }
  const form =
    context === 'detail'
      ? document.querySelector('[data-planning-session-detail-form]')
      : getSessionModalOverlay()?.querySelector('[data-session-detail-form]');
  const startDateValue = String(form?.querySelector('[name="startDate"]')?.value || '').trim();
  const fallbackKey =
    context === 'detail'
      ? formatDateInputValue(state.sessions.find(entry => entry.id === state.planningEditingSessionId)?.startDate)
      : String(state.sessionModal.dateKey || '').trim();
  const base = startDateValue || fallbackKey;
  if (!base) return [];
  const key = addDaysToCalendarKey(base, offset);
  return key ? [key] : [];
}

function buildExternalSessionIntervalsByDate() {
  const map = new Map();
  Object.entries(state.sessionConflictsByDate).forEach(([dateKey, slots]) => {
    const intervals = (slots || [])
      .map(slot => ({
        formationName: String(slot?.formationName || 'Autre formation').trim(),
        dateKey,
        startTime: String(slot?.startTime || '').trim(),
        endTime: String(slot?.endTime || '').trim(),
        startMinutes: parseTimeToMinutes(String(slot?.startTime || '').trim()),
        endMinutes: parseTimeToMinutes(String(slot?.endTime || '').trim())
      }))
      .filter(i => Number.isFinite(i.startMinutes) && Number.isFinite(i.endMinutes) && i.endMinutes > i.startMinutes);
    if (intervals.length) {
      map.set(dateKey, intervals);
    }
  });
  return map;
}

async function loadConflictsForDates(dateKeys, excludeSessionId = null) {
  const keys = (Array.isArray(dateKeys) ? dateKeys : []).filter(Boolean);
  if (!keys.length) return;
  const pending = keys.filter(k => !state.sessionConflictsLoadingDates.has(k));
  if (!pending.length) return;
  pending.forEach(k => state.sessionConflictsLoadingDates.add(k));
  try {
    await Promise.all(
      pending.map(async dateKey => {
        try {
          const params = new URLSearchParams({ date: dateKey });
          if (excludeSessionId) params.set('excludeSessionId', excludeSessionId);
          const response = await fetch(`${SESSIONS_CONFLICTS_ENDPOINT}?${params}`, { credentials: 'include' });
          const payload = await getJson(response);
          if (response.ok && payload?.ok) {
            state.sessionConflictsByDate[dateKey] = Array.isArray(payload.occupied) ? payload.occupied : [];
          }
        } catch (_err) {
          // silently ignore per-date failures
        } finally {
          state.sessionConflictsLoadingDates.delete(dateKey);
        }
      })
    );
  } catch (_err) {
    pending.forEach(k => state.sessionConflictsLoadingDates.delete(k));
  }
}

function getExcludeSessionIdForContext(context) {
  if (context === 'modal') return String(state.sessionModal.sessionId || '').trim() || null;
  if (context === 'detail') return String(state.planningEditingSessionId || '').trim() || null;
  return null;
}

function formatTimeAsHhMm(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  return `${h}h${m}`;
}

function computeDurationLabel(startTime, endTime) {
  const s = parseTimeToMinutes(startTime);
  const e = parseTimeToMinutes(endTime);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return '';
  const diff = e - s;
  const hrs = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hrs > 0 && mins > 0) return `${hrs}h${String(mins).padStart(2, '0')}`;
  if (hrs > 0) return `${hrs}h`;
  return `${mins}min`;
}

function findSessionConflict({ context, dayIndex, startTime, endTime, prebuiltIntervals = null, dateKeysOverride = null }) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) return null;
  const dateKeys = Array.isArray(dateKeysOverride) ? dateKeysOverride.filter(Boolean) : getSessionTimePickerDateKeys(context, dayIndex);
  if (!dateKeys.length) return null;
  const intervalsByDate = prebuiltIntervals instanceof Map ? prebuiltIntervals : buildExternalSessionIntervalsByDate();
  for (const dateKey of dateKeys) {
    const intervals = intervalsByDate.get(dateKey) || [];
    for (const interval of intervals) {
      if (intervalsOverlap(interval.startMinutes, interval.endMinutes, startMinutes, endMinutes)) {
        return {
          formationName: interval.formationName,
          dateKey,
          startTime: interval.startTime,
          endTime: interval.endTime
        };
      }
    }
  }
  return null;
}

function isSessionTimePickerTarget(target) {
  return target === 'start' || target === 'end';
}

function setSessionTimePickerActiveTarget(pickerElement, target = '') {
  if (!pickerElement) return '';
  const nextTarget = isSessionTimePickerTarget(target) ? target : '';
  if (nextTarget) {
    pickerElement.dataset.stpActiveTarget = nextTarget;
  } else {
    pickerElement.removeAttribute('data-stp-active-target');
  }
  pickerElement.querySelectorAll('[data-action="open-session-time-picker"]').forEach(btn => {
    btn.classList.toggle('stp-banner__chip--active', Boolean(nextTarget) && btn.dataset.target === nextTarget);
  });
  const mosaic = pickerElement.querySelector('[data-session-time-grid]');
  if (mosaic) {
    mosaic.classList.toggle('stp-mosaic--visible', Boolean(nextTarget));
    if (!nextTarget) {
      mosaic.innerHTML = '';
    }
  }
  return nextTarget;
}

function updateSessionTimePickerSummary(pickerElement) {
  if (!pickerElement) return;
  const { startTime, endTime } = getSessionTimePickerValues(pickerElement);
  const startLabel = pickerElement.querySelector('[data-session-time-chip-value="start"]');
  const endLabel = pickerElement.querySelector('[data-session-time-chip-value="end"]');
  if (startLabel) {
    startLabel.textContent = startTime || '--:--';
  }
  if (endLabel) {
    endLabel.textContent = endTime || '--:--';
  }
  const range = pickerElement.querySelector('[data-session-time-range]');
  if (range) {
    range.textContent = startTime && endTime ? `${startTime} → ${endTime}` : 'Sélectionnez un début et une fin';
  }
  const durationBadge = pickerElement.querySelector('[data-session-time-duration]');
  if (durationBadge) {
    const dur = startTime ? computeDurationLabel(startTime, endTime) : '';
    if (dur) {
      durationBadge.querySelector('span').textContent = dur;
      durationBadge.removeAttribute('hidden');
    } else {
      durationBadge.setAttribute('hidden', '');
    }
  }
  // Re-render mosaic grid only when a picker target is actively selected.
  const activeTarget = setSessionTimePickerActiveTarget(pickerElement, pickerElement.dataset.stpActiveTarget);
  if (activeTarget) {
    renderSessionTimePickerOptions(pickerElement, activeTarget);
  }
  const hint = pickerElement.querySelector('[data-session-time-hint]');
  if (!hint) return;
  const context = pickerElement.dataset.context || 'create';
  const dayIndex = Number(pickerElement.dataset.dayIndex);
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startTime && endTime && (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes)) {
    hint.hidden = false;
    hint.textContent = 'La fin doit être strictement après le début.';
    return;
  }
  if (startTime && endTime) {
    const conflict = findSessionConflict({ context, dayIndex, startTime, endTime });
    if (conflict) {
      hint.hidden = false;
      hint.textContent = `Conflit avec ${conflict.formationName} (${formatCalendarKeyLabel(conflict.dateKey)} ${conflict.startTime}-${conflict.endTime}).`;
      return;
    }
  }
  hint.hidden = true;
  hint.textContent = '';
}

function closeSessionTimePicker() {
  document.querySelectorAll('[data-session-time-picker]').forEach(pickerElement => {
    setSessionTimePickerActiveTarget(pickerElement, '');
  });
  state.sessionTimePicker = {
    open: false,
    context: '',
    dayIndex: null,
    target: '',
    key: ''
  };
  return true;
}

function closeSessionTimePickerForRow(pickerElement) {
  if (!pickerElement) return;
  setSessionTimePickerActiveTarget(pickerElement, '');
  const context = pickerElement.dataset.context || '';
  const dayIndex = Number(pickerElement.dataset.dayIndex);
  if (
    state.sessionTimePicker.open
    && state.sessionTimePicker.context === context
    && Number(state.sessionTimePicker.dayIndex) === dayIndex
  ) {
    state.sessionTimePicker = {
      open: false,
      context: '',
      dayIndex: null,
      target: '',
      key: ''
    };
  }
}

function renderSessionTimePickerOptions(pickerElement, target) {
  if (!pickerElement || !isSessionTimePickerTarget(target)) return;
  setSessionTimePickerActiveTarget(pickerElement, target);
  const context = pickerElement.dataset.context || 'create';
  const dayIndex = Number(pickerElement.dataset.dayIndex);
  const grid = pickerElement.querySelector('[data-session-time-grid]');
  if (!grid) return;
  const { startTime, endTime } = getSessionTimePickerValues(pickerElement);
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  // Collect all external intervals for this picker's date keys (Correctif 2)
  const intervalsByDate = buildExternalSessionIntervalsByDate();
  const dateKeys = getSessionTimePickerDateKeys(context, dayIndex);
  const externalIntervals = [];
  for (const dateKey of dateKeys) {
    const intervals = intervalsByDate.get(dateKey) || [];
    externalIntervals.push(...intervals);
  }

  const slotsHtml = SESSION_TIME_OPTIONS.map(option => {
    const optionMinutes = parseTimeToMinutes(option);
    const isStart = Boolean(startTime) && option === startTime;
    const isEnd = Boolean(endTime) && option === endTime;
    const isBetween = Number.isFinite(startMinutes) && Number.isFinite(endMinutes)
      && optionMinutes > startMinutes && optionMinutes < endMinutes;
    // Below: in end mode, slots at or before start time are unclickable
    const isBelow = target === 'end' && Number.isFinite(startMinutes)
      && optionMinutes <= startMinutes && !isStart;
    // Reserved: any external session occupies this slot (extStart <= slot < extEnd)
    let reservedBy = null;
    for (const interval of externalIntervals) {
      if (
        Number.isFinite(interval.startMinutes) && Number.isFinite(interval.endMinutes)
        && optionMinutes >= interval.startMinutes && optionMinutes < interval.endMinutes
      ) {
        reservedBy = interval;
        break;
      }
    }

    const classes = ['stp-slot'];
    if (isStart) classes.push('stp-slot--start');
    else if (isEnd) classes.push('stp-slot--end');
    else if (isBetween) classes.push('stp-slot--between');
    if (isBelow) classes.push('stp-slot--below');
    if (reservedBy) classes.push('stp-slot--reserved');

    const iconHtml = isStart
      ? `<i class="bi bi-play-circle-fill" aria-hidden="true"></i>`
      : isEnd
        ? `<i class="bi bi-stop-circle-fill" aria-hidden="true"></i>`
        : '';

    // Card tooltip for reserved slots (Correctif 3)
    const tooltipHtml = reservedBy
      ? `<div class="stp-card-tooltip" role="tooltip">
          <div class="stp-card-tooltip__header">
            <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
            <span>Créneau réservé</span>
          </div>
          <div class="stp-card-tooltip__body">
            <p class="stp-card-tooltip__name">${escapeHtml(reservedBy.formationName)}</p>
            <p class="stp-card-tooltip__time">${escapeHtml(formatTimeAsHhMm(reservedBy.startTime))} → ${escapeHtml(formatTimeAsHhMm(reservedBy.endTime))}</p>
          </div>
        </div>`
      : '';

    const conflictData = reservedBy
      ? `data-conflict-formation="${escapeHtml(reservedBy.formationName)}" data-conflict-date="${escapeHtml(reservedBy.dateKey)}" data-conflict-start="${escapeHtml(reservedBy.startTime)}" data-conflict-end="${escapeHtml(reservedBy.endTime)}"`
      : '';

    const blockedReason = isBelow ? 'below' : reservedBy ? 'conflict' : '';
    return `<button
        type="button"
        class="${classes.join(' ')}"
        data-action="pick-session-time-slot"
        data-target="${target}"
        data-value="${option}"
        data-blocked-reason="${blockedReason}"
        ${conflictData}
        aria-disabled="${blockedReason ? 'true' : 'false'}"
      >${iconHtml}<span>${option}</span>${tooltipHtml}</button>`;
  }).join('');

  grid.innerHTML = `<div class="stp-grid">${slotsHtml}</div>`;
}

async function openSessionTimePicker(pickerElement, target) {
  if (!pickerElement || !isSessionTimePickerTarget(target)) return;
  const context = pickerElement.dataset.context || 'create';
  const dayIndex = Number(pickerElement.dataset.dayIndex);
  const dateKeysForPicker = getSessionTimePickerDateKeys(context, dayIndex);
  const excludeId = getExcludeSessionIdForContext(context);
  await loadConflictsForDates(dateKeysForPicker, excludeId);
  document.querySelectorAll('[data-session-time-picker]').forEach(otherPicker => {
    if (otherPicker === pickerElement) return;
    setSessionTimePickerActiveTarget(otherPicker, '');
  });
  const activeTarget = setSessionTimePickerActiveTarget(pickerElement, target);
  state.sessionTimePicker = {
    open: true,
    context,
    dayIndex,
    target: activeTarget,
    key: `${context}:${dayIndex}`
  };
  renderSessionTimePickerOptions(pickerElement, activeTarget);
}

function applySessionTimePickerValue(optionButton) {
  const pickerElement = optionButton.closest('[data-session-time-picker]');
  if (!pickerElement) return;
  const target = optionButton.dataset.target;
  if (target !== 'start' && target !== 'end') return;
  const value = String(optionButton.dataset.value || '').trim();
  const hiddenInput = pickerElement.querySelector(`[data-time-value][data-target="${target}"]`);
  if (!hiddenInput) return;
  hiddenInput.value = value;
  let nextTarget = target;
  // Auto-advance: after selecting start, switch to end mode to guide user
  if (target === 'start') {
    nextTarget = 'end';
  }
  const activeTarget = setSessionTimePickerActiveTarget(pickerElement, nextTarget);
  const context = pickerElement.dataset.context || 'create';
  const dayIndex = Number(pickerElement.dataset.dayIndex);
  state.sessionTimePicker = {
    open: true,
    context,
    dayIndex,
    target: activeTarget,
    key: `${context}:${dayIndex}`
  };
  updateSessionTimePickerSummary(pickerElement);
}

function pulseConflictSlotsInPicker(context, scheduleEntries) {
  if (!Array.isArray(scheduleEntries)) return;
  scheduleEntries.forEach(entry => {
    const picker = getSessionTimePickerElement(context, entry?.dayIndex);
    if (!picker) return;
    const chips = picker.querySelectorAll('.stp-banner__chip');
    chips.forEach(chip => {
      chip.classList.add('stp-conflict-pulse');
      setTimeout(() => chip.classList.remove('stp-conflict-pulse'), 1600);
    });
  });
}

function openSessionConflictModal(conflict) {
  const overlay = getSessionConflictModalOverlay();
  if (!overlay) return;
  if (state.sessionModal.open) {
    stopSessionMoveSuggestion({ clearSuggestion: true });
  }
  const formationName = String(conflict?.formationName || 'une autre formation').trim();
  const dateLabel = formatCalendarKeyLabel(conflict?.dateKey);
  const startTime = String(conflict?.startTime || '').trim();
  const endTime = String(conflict?.endTime || '').trim();
  const message =
    conflict?.message ||
    `La formation ${formationName} a déjà une séance planifiée le ${dateLabel} de ${startTime} à ${endTime}.`;
  const messageTarget = overlay.querySelector('[data-session-conflict-message]');
  if (messageTarget) {
    messageTarget.textContent = message;
  }
  traceSessionMove('show conflict modal', { message });
  state.sessionConflictModal.open = true;
  state.sessionConflictModal.message = message;
  openModalOverlay(overlay);
}

function closeSessionConflictModal() {
  const overlay = getSessionConflictModalOverlay();
  if (!overlay) return;
  closeModalOverlay(overlay);
  state.sessionConflictModal.open = false;
  state.sessionConflictModal.message = '';
  if (state.sessionModal.open && !isSessionMoveSecondaryModalOpen()) {
    scheduleSessionMoveSuggestionResume(SESSION_MOVE_RESUME_DELAY_MS);
  }
}

function handleCapacityWidgetAction(event) {
  const decrementBtn = event.target.closest('[data-action="capacity-decrement"]');
  const incrementBtn = event.target.closest('[data-action="capacity-increment"]');
  const btn = decrementBtn || incrementBtn;
  if (!btn) return false;
  event.preventDefault();
  const widget = btn.closest('[data-capacity-widget]');
  if (!widget) return false;
  const input = widget.querySelector('[data-capacity-input]');
  const display = widget.querySelector('[data-capacity-display]');
  if (!input || !display) return false;
  const minVal = Number(widget.dataset.capacityMin ?? 1);
  let current = Number(input.value) || 1;
  if (decrementBtn) {
    current = Math.max(minVal, current - 1);
  } else {
    current = Math.min(100, current + 1);
  }
  input.value = current;
  display.textContent = current;
  widget.querySelector('[data-action="capacity-decrement"]').disabled = current <= minVal;
  widget.querySelector('[data-action="capacity-increment"]').disabled = current >= 100;
  // Bounce animation (Correctif 4)
  display.classList.remove('session-capacity-widget__value--bounce');
  void display.offsetWidth;
  display.classList.add('session-capacity-widget__value--bounce');
  return true;
}

function handleRefundDaysWidgetAction(event, form = null) {
  const decrementBtn = event.target.closest('[data-action="refund-days-decrement"]');
  const incrementBtn = event.target.closest('[data-action="refund-days-increment"]');
  const btn = decrementBtn || incrementBtn;
  if (!btn) return false;
  event.preventDefault();
  const widget = btn.closest('[data-refund-days-widget]');
  if (!widget) return false;
  const input = widget.querySelector('[data-refund-days-input]');
  const display = widget.querySelector('[data-refund-days-display]');
  if (!input || !display) return false;
  const minVal = Number(widget.dataset.refundMin ?? 0);
  let current = normalizeRefundDaysValue(input.value, 7);
  if (decrementBtn) {
    current = Math.max(minVal, current - 1);
  } else {
    current = Math.min(100, current + 1);
  }
  syncRefundDaysWidget(form || widget.closest('form'), current);
  display.classList.remove('session-capacity-widget__value--bounce');
  void display.offsetWidth;
  display.classList.add('session-capacity-widget__value--bounce');
  return true;
}

function handleSessionTimePickerAction(event) {
  if (handleCapacityWidgetAction(event)) {
    return true;
  }
  const openButton = event.target.closest('[data-action="open-session-time-picker"]');
  if (openButton) {
    event.preventDefault();
    const pickerElement = openButton.closest('[data-session-time-picker]');
    const target = openButton.dataset.target === 'end' ? 'end' : 'start';
    void openSessionTimePicker(pickerElement, target);
    return true;
  }
  const optionButton = event.target.closest('[data-action="pick-session-time-slot"]');
  if (!optionButton) return false;
  event.preventDefault();
  const blockedReason = String(optionButton.dataset.blockedReason || '').trim();
  if (blockedReason === 'conflict') {
    // Show conflict modal on click (card tooltip handles hover on desktop)
    openSessionConflictModal({
      formationName: optionButton.dataset.conflictFormation,
      dateKey: optionButton.dataset.conflictDate,
      startTime: optionButton.dataset.conflictStart,
      endTime: optionButton.dataset.conflictEnd
    });
    return true;
  }
  if (blockedReason) {
    return true;
  }
  applySessionTimePickerValue(optionButton);
  return true;
}


function renderSessionScheduleInputs(durationDays) {
  const container = getSessionScheduleContainer();
  if (!container) return;
  const normalizedDuration = normalizeDurationDaysValue(durationDays, 1);
  const rows = Array.from({ length: normalizedDuration }, (_, index) =>
    buildSessionTimePickerRow(index + 1, { context: 'create' })
  ).join('');
  container.innerHTML = rows;
  container.querySelectorAll('[data-session-time-picker]').forEach(updateSessionTimePickerSummary);
}


function collectSessionScheduleEntries() {
  const entries = [];
  const duration = normalizeDurationDaysValue(state.sessionDurationDays, 1);
  for (let day = 1; day <= duration; day++) {
    const startInput = document.querySelector(`[data-schedule-start][data-day-index="${day}"]`);
    const endInput = document.querySelector(`[data-schedule-end][data-day-index="${day}"]`);
    entries.push({
      dayIndex: day,
      startTime: String(startInput?.value || '').trim(),
      endTime: String(endInput?.value || '').trim()
    });
  }
  return entries;
}

function getCalendarTodayStart() {
  const reference = new Date();
  reference.setHours(0, 0, 0, 0);
  return reference;
}

function getCalendarKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseCalendarKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isCalendarKeyInPast(key) {
  const date = parseCalendarKey(key);
  const today = getCalendarTodayStart();
  return date < today;
}

function getSessionDurationDays() {
  return normalizeDurationDaysValue(state.sessionDurationDays, 1);
}

function buildSessionBlockKeys(startKey) {
  const startDate = parseCalendarKey(startKey);
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return [];
  }
  const block = [];
  const duration = getSessionDurationDays();
  for (let offset = 0; offset < duration; offset += 1) {
    const current = new Date(startDate);
    current.setDate(current.getDate() + offset);
    block.push(getCalendarKey(current));
  }
  return block;
}

function buildSessionCalendarKeys(session) {
  if (!session?.startDate) return [];
  const startDate = new Date(session.startDate);
  if (Number.isNaN(startDate.getTime())) return [];
  const duration = resolveSessionDurationDays(session, 1);
  const keys = [];
  for (let offset = 0; offset < duration; offset += 1) {
    const current = new Date(startDate);
    current.setDate(startDate.getDate() + offset);
    keys.push(getCalendarKey(current));
  }
  return keys;
}

function isSessionFullyPast(session) {
  const keys = buildSessionCalendarKeys(session);
  if (!keys.length) return false;
  return keys.every(isCalendarKeyInPast);
}

function getSessionsByCalendarDate() {
  const map = new Map();
  state.sessions.forEach(session => {
    buildSessionCalendarKeys(session).forEach(key => {
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(session);
    });
  });
  return map;
}

function getSessionsForCalendarDate(dateKey) {
  if (!dateKey) return [];
  return getSessionsByCalendarDate().get(dateKey) || [];
}

function getReusableSessionCalendarKeys(session) {
  return buildSessionCalendarKeys(session).filter(dateKey => dateKey && !isCalendarKeyInPast(dateKey));
}

function prunePastSessionSelections() {
  const filtered = state.sessionSelectedDates.filter(dateKey => !isCalendarKeyInPast(dateKey));
  if (filtered.length !== state.sessionSelectedDates.length) {
    state.sessionSelectedDates = filtered;
  }
}

function getSessionCalendarSelectionLabel(count) {
  if (count === 0) {
    return 'Aucune date selectionnee';
  }
  if (count === 1) {
    return '1 date selectionnee';
  }
  return `${count} dates selectionnees`;
}

function resetSessionCalendar() {
  const today = getCalendarTodayStart();
  state.sessionCalendar = {
    month: today.getMonth(),
    year: today.getFullYear()
  };
}

function changeSessionCalendarMonth(delta) {
  const { month, year } = state.sessionCalendar;
  let targetMonth = month + delta;
  let targetYear = year;
  if (targetMonth > 11) {
    targetMonth = 0;
    targetYear += 1;
  } else if (targetMonth < 0) {
    targetMonth = 11;
    targetYear -= 1;
  }
  state.sessionCalendar = { month: targetMonth, year: targetYear };
  renderSessionCalendar();
}

function toggleSessionCalendarDate(dateKey) {
  if (!dateKey || isCalendarKeyInPast(dateKey)) {
    return { changed: false, selected: false };
  }
  if (getSessionsForCalendarDate(dateKey).length) {
    return { changed: false, selected: false };
  }
  const selection = new Set(state.sessionSelectedDates);
  const wasSelected = selection.has(dateKey);
  if (selection.has(dateKey)) {
    selection.delete(dateKey);
  } else {
    selection.add(dateKey);
  }
  state.sessionSelectedDates = Array.from(selection).sort();
  return { changed: true, selected: !wasSelected };
}

async function openSessionCreateModal() {
  if (!state.sessionSelectedDates.length) return;
  const overlay = getSessionCreateModalOverlay();
  if (!overlay) return;
  const selectedFormation = state.presentielFormations.find(entry => entry.id === state.selectedPresentielId);
  state.sessionDurationDays = normalizeDurationDaysValue(selectedFormation?.durationDays, state.sessionDurationDays);
  updateSessionDurationText(state.sessionDurationDays);
  renderSessionScheduleInputs(state.sessionDurationDays);
  // Pre-load conflicts for all selected dates (creation context)
  const durationDays = normalizeDurationDaysValue(state.sessionDurationDays, 1);
  const allDateKeys = [];
  state.sessionSelectedDates.filter(k => !isCalendarKeyInPast(k)).forEach(startKey => {
    for (let d = 0; d < durationDays; d++) {
      const k = addDaysToCalendarKey(startKey, d);
      if (k) allDateKeys.push(k);
    }
  });
  state.sessionConflictsByDate = {};
  void loadConflictsForDates([...new Set(allDateKeys)], null);
  closeSessionTimePicker();
  closeSessionConflictModal();
  closeSessionDetailModal();
  openModalOverlay(overlay);
  overlay.querySelectorAll('[data-session-time-picker]').forEach(updateSessionTimePickerSummary);

  // 4b — Warning: same-day existing sessions
  const sessionDaysMap = getSessionsByCalendarDate();
  let sameDayCount = 0;
  state.sessionSelectedDates.filter(k => !isCalendarKeyInPast(k)).forEach(startKey => {
    const existing = sessionDaysMap.get(startKey) || [];
    sameDayCount += existing.length;
  });
  let warningEl = overlay.querySelector('[data-session-sameday-warning]');
  const modalInner = overlay.querySelector('.module-modal');
  if (modalInner) {
    if (!warningEl) {
      warningEl = document.createElement('p');
      warningEl.setAttribute('data-session-sameday-warning', '');
      warningEl.className = 'form-message form-message--warning';
      warningEl.style.cssText = 'margin: 0 0 0.5rem; padding: 0.5rem 0.75rem; background: rgba(245,158,11,0.08); border-left: 3px solid #f59e0b; border-radius: 0 4px 4px 0; font-size: 0.85rem;';
      const durationEl = modalInner.querySelector('[data-session-duration]');
      if (durationEl) {
        durationEl.insertAdjacentElement('afterend', warningEl);
      } else {
        modalInner.prepend(warningEl);
      }
    }
    if (sameDayCount > 0) {
      warningEl.textContent = `Ce jour a déjà ${sameDayCount} session${sameDayCount > 1 ? 's' : ''} planifiée${sameDayCount > 1 ? 's' : ''}. Les créneaux conflictuels seront bloqués au niveau des horaires.`;
      warningEl.hidden = false;
    } else {
      warningEl.hidden = true;
    }
  }
}

function resetSessionCreateModal(overlay = getSessionCreateModalOverlay()) {
  if (!overlay) return false;
  const hadSelection = state.sessionSelectedDates.length > 0;
  state.sessionSelectedDates = [];
  overlay.querySelectorAll('[data-session-time-picker][data-context="create"]').forEach(pickerElement => {
    pickerElement.querySelectorAll('[data-time-value]').forEach(input => {
      input.value = '';
    });
    setSessionTimePickerActiveTarget(pickerElement, '');
    const mosaic = pickerElement.querySelector('[data-session-time-grid]');
    if (mosaic) {
      mosaic.classList.remove('stp-mosaic--visible');
      mosaic.innerHTML = '';
    }
    updateSessionTimePickerSummary(pickerElement);
  });
  state.sessionConflictsByDate = {};
  if (state.sessionConflictsLoadingDates instanceof Set) {
    state.sessionConflictsLoadingDates.clear();
  } else {
    state.sessionConflictsLoadingDates = new Set();
  }
  return hadSelection;
}

function closeSessionCreateModal({ reset = true } = {}) {
  const overlay = getSessionCreateModalOverlay();
  if (!overlay) return;
  closeSessionTimePicker();
  closeSessionConflictModal();
  closeModalOverlay(overlay);
  if (!reset) return;
  const hadSelection = resetSessionCreateModal(overlay);
  if (hadSelection) {
    renderSessionCalendar();
  }
}

function renderSessionCalendar() {
  prunePastSessionSelections();
  const grid = document.querySelector('[data-calendar-grid]');
  const monthLabel = document.querySelector('[data-calendar-month-label]');
  const selectionLabel = document.querySelector('[data-calendar-selected-count]');
  const { month, year } = state.sessionCalendar;
  if (monthLabel) {
    monthLabel.textContent = `${MONTH_LABELS[month]} ${year}`;
  }
  if (selectionLabel) {
    selectionLabel.textContent = getSessionCalendarSelectionLabel(state.sessionSelectedDates.length);
  }
  if (!grid) {
    return;
  }
  const firstOfMonth = new Date(year, month, 1);
  const offset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = getCalendarTodayStart();
  const sessionDaysMap = getSessionsByCalendarDate();
  const highlightedDates = new Set();
  state.sessionSelectedDates.forEach(startKey => {
    buildSessionBlockKeys(startKey).forEach(key => highlightedDates.add(key));
  });
  const cells = [];
  for (let index = 0; index < offset; index++) {
    cells.push('<span class="calendar-day calendar-day--empty"></span>');
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month, day);
    const key = getCalendarKey(currentDate);
    const sessionsForDay = sessionDaysMap.get(key) || [];
    const hasSession = sessionsForDay.length > 0;
    const isPast = currentDate < today;
    const isSelected = !isPast && highlightedDates.has(key) && !hasSession;
    const classes = ['calendar-day'];
    if (isPast) {
      classes.push('calendar-day--disabled');
    }
    if (hasSession) {
      classes.push('calendar-day--session');
    }
    if (isSelected) {
      classes.push('calendar-day--selected');
    }
    const sessionCount = sessionsForDay.length;
    cells.push(`
      <button
        type="button"
        class="${classes.join(' ')}"
        data-calendar-date="${key}"
        ${hasSession ? 'data-calendar-has-session="true"' : ''}
        ${isPast ? 'data-calendar-past="true" disabled' : ''}
      >
        <span class="calendar-day__number">${day}</span>
        <span class="calendar-day__weekday">${WEEKDAY_LABELS[currentDate.getDay()]}</span>
        ${hasSession && sessionCount > 1 ? `<span class="calendar-day__count">${sessionCount}</span>` : hasSession ? '<span class="calendar-day__dot"></span>' : ''}
      </button>
    `);
  }
  grid.innerHTML = cells.join('');
  if (!state.sessionSelectedDates.length) {
    const createOverlay = getSessionCreateModalOverlay();
    if (createOverlay && !createOverlay.hasAttribute('hidden')) {
      closeSessionCreateModal({ reset: false });
    }
  }
}

function buildDaySessionCard(session) {
  const isOwn = session.isCurrentUserInstructor || !session.instructorId;
  const instructorBadge = session.instructorId
    ? `<span class="gmf-session-badge ${isOwn ? 'gmf-session-badge--own' : 'gmf-session-badge--other'}">
        <i class="bi bi-person" aria-hidden="true"></i> ${escapeHtml(session.instructorName || '')}
       </span>`
    : `<span class="gmf-session-badge gmf-session-badge--unassigned">
        <i class="bi bi-person-dash" aria-hidden="true"></i> Non assignée
       </span>`;
  const timeLabel = buildSessionScheduleSummaryShort(Array.isArray(session.schedule) ? session.schedule : []);
  const places = `${session.reservedCount || 0}/${session.maxClients || 0} places`;
  const isPast = isSessionFullyPast(session);
  const statusBadge = isPast
    ? `<span class="gmf-session-badge gmf-session-badge--past">Passée</span>`
    : session.isCanceled
      ? `<span class="gmf-session-badge gmf-session-badge--cancelled">Annulée</span>`
      : (session.reservedCount || 0) >= (session.maxClients || 0)
        ? `<span class="gmf-session-badge gmf-session-badge--full">Complet</span>`
        : `<span class="gmf-session-badge gmf-session-badge--active">Active</span>`;
  return `
    <div class="gmf-day-session-card">
      <div class="gmf-day-session-card__info">
        <div class="gmf-day-session-card__time">${escapeHtml(timeLabel)}</div>
        <div class="gmf-day-session-card__meta">
          ${instructorBadge}
          ${statusBadge}
          <span class="gmf-day-session-card__places">
            <i class="bi bi-people" aria-hidden="true"></i> ${escapeHtml(places)}
          </span>
        </div>
      </div>
      ${isOwn ? `
        <button type="button" class="gmf-day-session-card__edit" data-edit-session="${escapeHtml(session.id)}" aria-label="Modifier la session">
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>
      ` : ''}
    </div>
  `;
}

async function openDaySessionsModal(dateKey) {
  const sessions = getSessionsForCalendarDate(dateKey);
  if (!sessions.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'gmf-day-sessions-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Sessions du ${formatCalendarKeyLabel(dateKey)}`);
  overlay.innerHTML = `
    <div class="gmf-day-sessions-modal">
      <div class="gmf-day-sessions-modal__header">
        <span class="gmf-day-sessions-modal__title">
          <i class="bi bi-calendar3" aria-hidden="true"></i>
          Sessions du ${escapeHtml(formatCalendarKeyLabel(dateKey))}
        </span>
        <button type="button" class="gmf-day-sessions-modal__close" data-close aria-label="Fermer">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
      <div class="gmf-day-sessions-modal__list">
        ${sessions.map(session => buildDaySessionCard(session)).join('')}
      </div>
      <div class="gmf-day-sessions-modal__footer">
        <button type="button" class="gmf-day-sessions-modal__add" data-add-session>
          <i class="bi bi-plus-lg" aria-hidden="true"></i> Créer une session ce jour
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll('[data-edit-session]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sessionId = btn.dataset.editSession;
      overlay.remove();
      void openSessionDetailModal(dateKey, sessionId);
    });
  });
  overlay.querySelector('[data-add-session]').addEventListener('click', () => {
    overlay.remove();
    if (!state.sessionSelectedDates.includes(dateKey)) {
      state.sessionSelectedDates.push(dateKey);
    }
    void openSessionCreateModal();
  });
}

function handleSessionCalendarClick(event) {
  const dayButton = event.target.closest('[data-calendar-date]');
  if (dayButton) {
    const dateKey = dayButton.dataset.calendarDate;
    if (dayButton.disabled || dayButton.dataset.calendarPast === 'true' || isCalendarKeyInPast(dateKey)) {
      return;
    }
    if (dayButton.dataset.calendarHasSession === 'true') {
      void openDaySessionsModal(dateKey);
      return;
    }
    if (state.sessionSelectedDates.includes(dateKey)) {
      void openSessionCreateModal();
      return;
    }
    const { changed, selected } = toggleSessionCalendarDate(dateKey);
    renderSessionCalendar();
    if (changed && selected) {
      void openSessionCreateModal();
    }
    return;
  }
  const navButton = event.target.closest('[data-calendar-action]');
  if (navButton) {
    const action = navButton.dataset.calendarAction;
    if (action === 'prev') {
      changeSessionCalendarMonth(-1);
    } else if (action === 'next') {
      changeSessionCalendarMonth(1);
    }
  }
}

async function deleteSessionById(
  sessionId,
  { feedbackTarget = null, successMessage = 'Session supprimée.', button = null, context = 'FormationManager:DeleteSession' } = {}
) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return false;
  if (!state.selectedPresentielId) {
    showFeedback(feedbackTarget || getSessionFeedbackElement(), 'Sélectionnez une formation présentielle.', 'error');
    return false;
  }
  const targetSession = state.sessions.find(session => String(session?.id || '').trim() === normalizedSessionId) || null;
  const reusableDateKeys = getReusableSessionCalendarKeys(targetSession);
  const reservedClientsCount = Math.max(0, Number(targetSession?.reservedCount || 0));
  const confirmMessage =
    reservedClientsCount > 0
      ? `
        <p><strong>${reservedClientsCount}</strong> client${reservedClientsCount > 1 ? 's ont' : ' a'} reserve cette session.</p>
        <p>Si vous confirmez, la session sera annulée et chaque client recevra un email avec un lien unique pour choisir entre un décalage ou un remboursement.</p>
        <p>Sans choix sous 7 jours, le remboursement sera lance automatiquement.</p>
      `
      : "Cette action ne peut pas être annulée.";
  const confirmed = await confirmAction({
    title: 'Supprimer cette session ?',
    message: confirmMessage,
    confirmLabel: 'Supprimer',
    danger: true,
    allowHtml: reservedClientsCount > 0
  });
  if (!confirmed) {
    return false;
  }
  const feedback = feedbackTarget || getSessionFeedbackElement();
  setActionLoading(button, 'Suppression...');
  try {
    const response = await fetch(SESSION_ITEM_ENDPOINT(state.selectedPresentielId, normalizedSessionId), {
      method: 'DELETE',
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de supprimer la session.');
    }
    const finalSuccessMessage =
      payload?.canceledByInstitute
        ? payload?.emailFailuresCount > 0
          ? `Session annulée. ${Number(payload?.notifiedClientsCount || 0)}/${Number(
              payload?.reservedClientsCount || reservedClientsCount
            )} emails envoyes.`
          : `Session annulée. ${Number(payload?.notifiedClientsCount || 0)} client${
              Number(payload?.notifiedClientsCount || 0) > 1 ? 's' : ''
            } notifie${Number(payload?.notifiedClientsCount || 0) > 1 ? 's' : ''}.`
        : successMessage;
    if (reusableDateKeys.length) {
      state.sessionSelectedDates = reusableDateKeys;
    }
    showFeedback(feedback, finalSuccessMessage, 'success');
    await fetchSessionsForSelectedPresentiel();
    setActionSuccess(button, 'R?ussi');
    return { ok: true, payload, message: finalSuccessMessage, reusableDateKeys };
  } catch (error) {
    setActionError(button, context, error, {
      sessionId: normalizedSessionId,
      formationId: state.selectedPresentielId
    });
    showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
    return false;
  }
}

async function handleSessionDelete(event) {
  const button = event.target.closest('[data-action="delete-session"]');
  if (!button) return;
  event.preventDefault();
  const sessionId = button.dataset.sessionId;
  if (!sessionId) return;
  await deleteSessionById(sessionId, {
    feedbackTarget: getSessionFeedbackElement(),
    successMessage: 'Session supprim?e.',
    button,
    context: 'FormationManager:DeleteSession'
  });
}

function parseSessionDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatSessionDate(value) {
  const date = parseSessionDate(value);
  if (!date) return 'Date inconnue';
  return date.toLocaleDateString();
}

function getSessionEndDate(startDateValue, durationDays) {
  const startDate = parseSessionDate(startDateValue);
  if (!startDate) return null;
  const duration = Number.isFinite(Number(durationDays))
    ? Math.max(1, Math.floor(Number(durationDays)))
    : 1;
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + duration - 1);
  return endDate;
}

function buildSessionDateRangeLabel(session) {
  if (!session?.startDate) return 'Date inconnue';
  const startLabel = formatSessionDate(session.startDate);
  const endDate = getSessionEndDate(session.startDate, session.durationDays);
  if (!endDate) return startLabel;
  const endLabel = endDate.toLocaleDateString();
  if (startLabel === endLabel) {
    return startLabel;
  }
  return `Du ${startLabel} au ${endLabel}`;
}

function buildSessionScheduleSummary(schedule = []) {
  if (!Array.isArray(schedule) || !schedule.length) {
    return '<p class="muted">Horaires non définis.</p>';
  }
  return schedule
    .map(
      entry => `
        <p class="muted">
          Jour ${entry.dayIndex} : ${escapeHtml(entry.startTime)} - ${escapeHtml(entry.endTime)}
        </p>
      `
    )
    .join('');
}


function formatDateInputValue(value) {
  const date = parseSessionDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSessionModalSessions() {
  if (!state.sessionModal.open || !state.sessionModal.dateKey) return [];
  return getSessionsForCalendarDate(state.sessionModal.dateKey);
}

function getActiveSessionModalSession() {
  const sessions = getSessionModalSessions();
  if (!sessions.length) return null;
  return sessions.find(session => session.id === state.sessionModal.sessionId) || sessions[0];
}

function renderSessionDetailModal() {
  traceSessionMove('render session detail modal', {
    dateKey: state.sessionModal.dateKey,
    sessionId: state.sessionModal.sessionId
  });
  closeSessionTimePicker();
  const overlay = getSessionModalOverlay();
  if (!overlay) return;
  const content = overlay.querySelector('[data-session-detail-content]');
  if (!content) return;
  const sessions = getSessionModalSessions();
  if (!sessions.length) {
    content.innerHTML = '<p class="module-placeholder">Aucune session sur cette date.</p>';
    return;
  }
  const activeSession = getActiveSessionModalSession();
  if (!activeSession) {
    content.innerHTML = '<p class="module-placeholder">Session introuvable.</p>';
    return;
  }
  const selectedSessionId = activeSession.id;
  const durationDays = resolveSessionDurationDays(activeSession, state.sessionDurationDays);
  const scheduleByDay = new Map(
    (Array.isArray(activeSession.schedule) ? activeSession.schedule : []).map(entry => [Number(entry.dayIndex), entry])
  );
  const switcherMarkup =
    sessions.length > 1
      ? `
        <div class="session-detail-switcher">
          ${sessions
            .map(session => {
              const label = buildSessionDateRangeLabel(session);
              return `
                <button
                  type="button"
                  class="secondary-button ${session.id === selectedSessionId ? 'is-active' : ''}"
                  data-action="select-session-modal"
                  data-session-id="${session.id}"
                >
                  ${escapeHtml(label)}
                </button>
              `;
            })
            .join('')}
        </div>
      `
      : '';
  const scheduleInputs = Array.from({ length: durationDays }, (_unused, index) => {
    const dayIndex = index + 1;
    const row = scheduleByDay.get(dayIndex) || {};
    return buildSessionTimePickerRow(dayIndex, {
      startTime: String(row.startTime || ''),
      endTime: String(row.endTime || ''),
      context: 'modal'
    });
  }).join('');
  const remaining = Number.isFinite(activeSession.placesRemaining)
    ? activeSession.placesRemaining
    : Math.max(0, Number(activeSession.maxClients || 0) - Number(activeSession.reservedCount || 0));
  const statusLabel = activeSession.isAvailable ? 'Disponible' : 'Indisponible (complet)';
  const activeStartDate = parseSessionDate(activeSession.startDate);
  if (state.sessionMove.currentSessionId !== selectedSessionId) {
    if (activeStartDate) {
      state.sessionMove.month = activeStartDate.getMonth();
      state.sessionMove.year = activeStartDate.getFullYear();
    }
    state.sessionMove.previewStartKey = '';
    state.sessionMove.touchPreviewStartKey = '';
    state.sessionMove.suggestionKeys = [];
    state.sessionMove.currentSessionId = selectedSessionId;
  }
  const isOwn = activeSession.isCurrentUserInstructor || !activeSession.instructorId;
  const instructorLine = activeSession.instructorName
    ? `<p class="gmf-session-detail__instructor"><i class="bi bi-person-fill" aria-hidden="true"></i> ${escapeHtml(activeSession.instructorName)}</p>`
    : `<p class="gmf-session-detail__instructor gmf-session-detail__instructor--unassigned"><i class="bi bi-person-dash" aria-hidden="true"></i> <em>Non assigné</em></p>`;
  const ownerBadge = isOwn
    ? '<span class="gmf-session-badge gmf-session-badge--own">Votre session</span>'
    : `<span class="gmf-session-badge gmf-session-badge--other">Session de ${escapeHtml(activeSession.instructorName || 'un autre instructeur')}</span>`;
  const readonlyNotice = !isOwn
    ? `<div class="gmf-session-readonly-notice"><i class="bi bi-lock" aria-hidden="true"></i> Cette session appartient à <strong>${escapeHtml(activeSession.instructorName || 'un autre instructeur')}</strong> — vous ne pouvez pas la modifier.</div>`
    : '';
  const formDisabled = !isOwn ? 'data-session-form-readonly' : '';
  const btnDisabled = !isOwn ? 'disabled' : '';

  const readonlyNoticeHtml = !isOwn
    ? `<div class="gmf-session-edit-modal__readonly-notice">
        <i class="bi bi-lock" aria-hidden="true"></i>
        Session de <strong>${escapeHtml(activeSession.instructorName || 'un autre instructeur')}</strong> — lecture seule
       </div>`
    : '';

  content.innerHTML = `
    <div class="gmf-session-edit-modal">
      <div class="gmf-session-edit-modal__header">
        <div>
          <h3 class="gmf-session-edit-modal__title">Modifier la session</h3>
          <p class="gmf-session-edit-modal__subtitle">${escapeHtml(buildSessionDateRangeLabel(activeSession))}</p>
        </div>
        ${ownerBadge}
      </div>
      ${readonlyNoticeHtml}
      ${switcherMarkup}
      <form class="gmf-session-edit-modal__form" data-session-detail-form ${formDisabled}>
        <input type="hidden" name="sessionId" value="${escapeHtml(selectedSessionId)}">

        <div class="gmf-session-edit-modal__field">
          <label class="gmf-session-edit-modal__label">Date de début</label>
          <input type="date" name="startDate" class="gmf-session-edit-modal__input"
            value="${escapeHtml(formatDateInputValue(activeSession.startDate))}" required ${!isOwn ? 'readonly' : ''}>
        </div>

        <div class="gmf-session-edit-modal__field">
          <label class="gmf-session-edit-modal__label">Durée</label>
          <p class="gmf-session-edit-modal__value">${durationDays === 1 ? '1 jour' : `${durationDays} jours`}</p>
        </div>

        <div class="gmf-session-edit-modal__field">
          <label class="gmf-session-edit-modal__label">Horaires</label>
          <div class="schedule-fields">
            ${scheduleInputs}
          </div>
        </div>

        <div class="gmf-session-edit-modal__field">
          <label class="gmf-session-edit-modal__label">Capacité</label>
          <div class="gmf-session-edit-modal__capacity">
            <div class="session-capacity-widget" data-capacity-widget data-capacity-min="${Math.max(1, Number(activeSession.reservedCount || 0))}">
              <button type="button" class="session-capacity-widget__btn" data-action="capacity-decrement" aria-label="Réduire la capacité" ${Number(activeSession.maxClients || 1) <= Math.max(1, Number(activeSession.reservedCount || 0)) ? 'disabled' : ''}>
                <i class="bi bi-dash" aria-hidden="true"></i>
              </button>
              <span class="session-capacity-widget__value" data-capacity-display>${escapeHtml(String(activeSession.maxClients || 1))}</span>
              <button type="button" class="session-capacity-widget__btn" data-action="capacity-increment" aria-label="Augmenter la capacité" ${Number(activeSession.maxClients || 1) >= 100 ? 'disabled' : ''}>
                <i class="bi bi-plus" aria-hidden="true"></i>
              </button>
              <input type="hidden" name="maxClients" value="${escapeHtml(String(activeSession.maxClients || 1))}" data-capacity-input>
            </div>
            <span class="gmf-session-edit-modal__capacity-info">
              ${escapeHtml(String(activeSession.reservedCount || 0))} réservé(s) · ${escapeHtml(String(remaining))} place(s) restante(s)
            </span>
          </div>
        </div>

        <div class="gmf-session-edit-modal__actions">
          <button type="submit" class="gmf-session-edit-modal__btn-save" data-action="save-session-modal" ${btnDisabled}>
            <i class="bi bi-check2" aria-hidden="true"></i> Enregistrer
          </button>
          <button type="button" class="gmf-session-edit-modal__btn-delete" data-action="delete-session-modal" ${btnDisabled}>
            <i class="bi bi-trash" aria-hidden="true"></i> Supprimer
          </button>
        </div>
      </form>
    </div>
  `;
  content.querySelectorAll('[data-session-time-picker]').forEach(updateSessionTimePickerSummary);

  // Warning: other sessions on the same day (excluding current session)
  if (isOwn && activeStartDate) {
    const currentDayKey = getCalendarKey(activeStartDate);
    const sessionDaysMap = getSessionsByCalendarDate();
    const othersOnDay = (sessionDaysMap.get(currentDayKey) || []).filter(
      s => String(s.id) !== String(selectedSessionId)
    );
    if (othersOnDay.length > 0) {
      const form = content.querySelector('[data-session-detail-form]');
      if (form) {
        const warningEl = document.createElement('p');
        warningEl.className = 'form-message form-message--warning';
        warningEl.style.cssText = 'margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; background: rgba(245,158,11,0.08); border-left: 3px solid #f59e0b; border-radius: 0 4px 4px 0; font-size: 0.85rem;';
        warningEl.textContent = `Ce jour a déjà ${othersOnDay.length} autre${othersOnDay.length > 1 ? 's' : ''} session${othersOnDay.length > 1 ? 's' : ''} planifiée${othersOnDay.length > 1 ? 's' : ''}. Les créneaux conflictuels sont bloqués au niveau des horaires.`;
        form.insertAdjacentElement('beforebegin', warningEl);
      }
    }
  }
}

function closeSessionDetailModal() {
  const overlay = getSessionModalOverlay();
  if (!overlay) return;
  resetSessionMoveState();
  closeSessionTimePicker();
  closeSessionConflictModal();
  closeModalOverlay(overlay);
  state.sessionModal.open = false;
  state.sessionModal.dateKey = null;
  state.sessionModal.sessionId = null;
  showFeedback(getSessionModalFeedbackElement(), '');
}

async function openSessionDetailModal(dateKey, preferredSessionId = null) {
  traceSessionMove('open session detail modal requested', { dateKey, preferredSessionId });
  const sessions = getSessionsForCalendarDate(dateKey);
  traceSessionMove('sessions found for date', { dateKey, count: sessions.length });
  if (!sessions.length) return;
  const overlay = getSessionModalOverlay();
  if (!overlay) return;
  // Load conflicts for this date range (modal context — excludeSessionId set after sessionId is known)
  const preferredSession = sessions.find(s => s.id === preferredSessionId) || sessions[0];
  if (preferredSession) {
    const excludeId = String(preferredSession.id || '').trim() || null;
    const durationDays = Math.max(1, Number(preferredSession.durationDays || 1));
    const startKey = formatDateInputValue(preferredSession.startDate) || dateKey;
    const keysToLoad = [];
    for (let d = 0; d < durationDays; d++) {
      const k = addDaysToCalendarKey(startKey, d);
      if (k) keysToLoad.push(k);
    }
    state.sessionConflictsByDate = {};
    void loadConflictsForDates([...new Set(keysToLoad)], excludeId);
  }
  closeSessionTimePicker();
  closeSessionConflictModal();
  closeSessionMoveConfirmModal({ suppressResume: true });
  closeSessionCreateModal();
  state.sessionModal.open = true;
  state.sessionModal.dateKey = dateKey;
  const matchingSession = sessions.find(session => session.id === preferredSessionId);
  state.sessionModal.sessionId = matchingSession?.id || sessions[0].id;
  openModalOverlay(overlay);
  renderSessionDetailModal();
  showFeedback(getSessionModalFeedbackElement(), '');
}

function syncSessionModalWithSessions() {
  if (!state.sessionModal.open) return;
  const sessions = getSessionModalSessions();
  if (!sessions.length) {
    closeSessionDetailModal();
    return;
  }
  if (!sessions.some(session => session.id === state.sessionModal.sessionId)) {
    state.sessionModal.sessionId = sessions[0].id;
  }
  renderSessionDetailModal();
}

function collectSessionModalScheduleEntries(form, durationDays) {
  const entries = [];
  for (let day = 1; day <= durationDays; day += 1) {
    const startInput = form.querySelector(`[data-modal-schedule-start][data-day-index="${day}"]`);
    const endInput = form.querySelector(`[data-modal-schedule-end][data-day-index="${day}"]`);
    entries.push({
      dayIndex: day,
      startTime: String(startInput?.value || '').trim(),
      endTime: String(endInput?.value || '').trim()
    });
  }
  return entries;
}

function handleSessionModalSwitch(event) {
  const button = event.target.closest('[data-action="select-session-modal"]');
  if (!button) return;
  const sessionId = String(button.dataset.sessionId || '').trim();
  if (!sessionId || sessionId === state.sessionModal.sessionId) return;
  closeSessionTimePicker();
  state.sessionModal.sessionId = sessionId;
  renderSessionDetailModal();
  showFeedback(getSessionModalFeedbackElement(), '');
}

async function saveSessionModalPayload({ sessionId, startDate, maxClients, schedule }) {
  const response = await fetch(SESSION_ITEM_ENDPOINT(state.selectedPresentielId, sessionId), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate,
      maxClients,
      schedule
    })
  });
  const payload = await getJson(response);
  if (!response.ok) {
    if (response.status === 409 && Array.isArray(payload?.conflicts) && payload.conflicts.length) {
      const c = payload.conflicts[0];
      showToast({
        type: 'error',
        message: `Créneau indisponible — conflit avec ${c.formationName} de ${c.startTime} à ${c.endTime}`,
        durationMs: 5000
      });
      pulseConflictSlotsInPicker('modal', schedule);
    }
    throw new Error(payload?.error || 'Impossible de modifier la session.');
  }
  await fetchSessionsForSelectedPresentiel();
  const refreshed = state.sessions.find(session => session.id === sessionId);
  if (refreshed) {
    const newDateKey = buildSessionCalendarKeys(refreshed)[0] || state.sessionModal.dateKey;
    state.sessionModal.dateKey = newDateKey || state.sessionModal.dateKey;
    state.sessionModal.sessionId = refreshed.id;
  }
  syncSessionModalWithSessions();
  return refreshed || null;
}

async function handleSessionModalSave(event) {
  const form = event.target.closest('[data-session-detail-form]');
  if (!form) return;
  event.preventDefault();
  if (!state.selectedPresentielId) return;
  const saveButton = form.querySelector('[data-action="save-session-modal"]');
  if (saveButton?.dataset.actionState === 'loading') return;
  const context = 'FormationManager:UpdateSession';
  const sessionId = String(form.querySelector('[name="sessionId"]')?.value || '').trim();
  if (!sessionId) return;
  const activeSession = getActiveSessionModalSession();
  if (!activeSession) return;
  const durationDays = resolveSessionDurationDays(activeSession, state.sessionDurationDays);
  const schedule = collectSessionModalScheduleEntries(form, durationDays);
  if (schedule.some(entry => !entry.startTime || !entry.endTime)) {
    setActionError(saveButton, context, new Error('Les horaires sont requis pour chaque jour.'), { sessionId });
    return showFeedback(getSessionModalFeedbackElement(), 'Les horaires sont requis pour chaque jour.', 'error');
  }
  if (schedule.some(entry => entry.startTime >= entry.endTime)) {
    setActionError(saveButton, context, new Error('Chaque jour doit commencer avant sa fin.'), { sessionId });
    return showFeedback(getSessionModalFeedbackElement(), 'Chaque jour doit commencer avant sa fin.', 'error');
  }
  const maxClients = Math.floor(Number(form.querySelector('[name="maxClients"]')?.value));
  if (!Number.isFinite(maxClients) || maxClients < 1) {
    setActionError(saveButton, context, new Error('Capacite invalide.'), { sessionId, maxClients });
    return showFeedback(getSessionModalFeedbackElement(), 'Capacite invalide.', 'error');
  }
  const startDate = String(form.querySelector('[name="startDate"]')?.value || '').trim();
  if (!startDate) {
    setActionError(saveButton, context, new Error('Date de début invalide.'), { sessionId });
    return showFeedback(getSessionModalFeedbackElement(), 'Date de début invalide.', 'error');
  }
  const conflict = await findScheduleConflictBeforeSave([startDate], schedule, sessionId);
  if (conflict) {
    setActionError(saveButton, context, new Error('Conflit horaire detecte.'), {
      sessionId,
      conflict
    });
    showFeedback(
      getSessionModalFeedbackElement(),
      `Conflit horaire avec ${conflict.formationName} le ${formatCalendarKeyLabel(conflict.dateKey)}.`,
      'error'
    );
    openSessionConflictModal(conflict);
    return;
  }
  setActionLoading(saveButton, 'Enregistrement...');
  try {
    await saveSessionModalPayload({ sessionId, startDate, maxClients, schedule });
    showFeedback(getSessionModalFeedbackElement(), 'Session modifiée.', 'success');
    setActionSuccess(saveButton, 'Réussi');
  } catch (error) {
    setActionError(saveButton, context, error, {
      sessionId,
      startDate,
      maxClients,
      schedule
    });
    showFeedback(getSessionModalFeedbackElement(), error.message || 'Erreur reseau.', 'error');
  }
}

async function handleSessionModalDelete(event) {
  const button = event.target.closest('[data-action="delete-session-modal"]');
  if (!button) return;
  event.preventDefault();
  const activeSession = getActiveSessionModalSession();
  if (!activeSession?.id) return;
  const deleted = await deleteSessionById(activeSession.id, {
    feedbackTarget: getSessionModalFeedbackElement(),
    successMessage: 'Session supprim?e.',
    button,
    context: 'FormationManager:DeleteSessionModal'
  });
  if (!deleted) {
    return;
  }
  const sessionsForDate = getSessionModalSessions();
  if (!sessionsForDate.length) {
    closeSessionDetailModal();
    return;
  }
  state.sessionModal.sessionId = sessionsForDate[0].id;
  syncSessionModalWithSessions();
}

function collectSessionDetailScheduleEntries(form, durationDays) {
  const entries = [];
  for (let day = 1; day <= durationDays; day += 1) {
    const startInput = form.querySelector(`[data-detail-schedule-start][data-day-index="${day}"]`);
    const endInput = form.querySelector(`[data-detail-schedule-end][data-day-index="${day}"]`);
    entries.push({
      dayIndex: day,
      startTime: String(startInput?.value || '').trim(),
      endTime: String(endInput?.value || '').trim()
    });
  }
  return entries;
}

async function handlePlanningSessionDetailSubmit(event) {
  const form = event.target.closest('[data-planning-session-detail-form]');
  if (!form) return;
  event.preventDefault();
  if (!state.selectedPresentielId) return;
  const saveButton = form.querySelector('[data-action="save-planning-session-detail"]');
  if (saveButton?.dataset.actionState === 'loading') return;
  const context = 'FormationManager:UpdateSession';
  const sessionId = String(form.querySelector('[name="sessionId"]')?.value || '').trim();
  if (!sessionId) return;
  const activeSession = state.sessions.find(session => String(session.id || '') === sessionId);
  if (!activeSession) {
    setActionError(saveButton, context, new Error('Session introuvable.'), { sessionId });
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Session introuvable.', 'error');
    return;
  }
  if (isSessionFullyPast(activeSession)) {
    setActionError(saveButton, context, new Error('Session passee non modifiable.'), { sessionId });
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Cette session est passee et ne peut plus etre modifiee.', 'error');
    return;
  }
  const durationDays = resolveSessionDurationDays(activeSession, state.sessionDurationDays);
  const schedule = collectSessionDetailScheduleEntries(form, durationDays);
  if (schedule.some(entry => !entry.startTime || !entry.endTime)) {
    setActionError(saveButton, context, new Error('Les horaires sont requis pour chaque jour.'), { sessionId });
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Les horaires sont requis pour chaque jour.', 'error');
    return;
  }
  if (schedule.some(entry => entry.startTime >= entry.endTime)) {
    setActionError(saveButton, context, new Error('Chaque jour doit commencer avant sa fin.'), { sessionId });
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Chaque jour doit commencer avant sa fin.', 'error');
    return;
  }
  const maxClients = Math.floor(Number(form.querySelector('[name="maxClients"]')?.value));
  if (!Number.isFinite(maxClients) || maxClients < 1) {
    setActionError(saveButton, context, new Error('Capacite invalide.'), { sessionId, maxClients });
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Capacite invalide.', 'error');
    return;
  }
  const startDate = String(form.querySelector('[name="startDate"]')?.value || '').trim();
  if (!startDate) {
    setActionError(saveButton, context, new Error('Date de début invalide.'), { sessionId });
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Date de début invalide.', 'error');
    return;
  }
  const conflict = await findScheduleConflictBeforeSave([startDate], schedule);
  if (conflict) {
    setActionError(saveButton, context, new Error('Conflit horaire detecte.'), {
      sessionId,
      conflict
    });
    showFeedback(
      getPlanningSessionDetailFeedbackElement(),
      `Conflit horaire avec ${conflict.formationName} le ${formatCalendarKeyLabel(conflict.dateKey)}.`,
      'error'
    );
    openSessionConflictModal(conflict);
    return;
  }
  setActionLoading(saveButton, 'Enregistrement...');
  try {
    const response = await fetch(SESSION_ITEM_ENDPOINT(state.selectedPresentielId, sessionId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate,
        maxClients,
        schedule
      })
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de modifier la session.');
    }
    await fetchSessionsForSelectedPresentiel();
    const refreshed = state.sessions.find(session => String(session.id || '') === sessionId);
    if (refreshed) {
      state.planningEditingSessionId = refreshed.id;
    }
    renderPlanningSessionDetail();
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Session modifiee.', 'success');
    setActionSuccess(saveButton, 'R?ussi');
  } catch (error) {
    setActionError(saveButton, context, error, {
      sessionId,
      startDate,
      maxClients,
      schedule
    });
    showFeedback(getPlanningSessionDetailFeedbackElement(), error.message || 'Erreur reseau.', 'error');
  }
}

async function handlePlanningSessionDetailDelete(event) {
  const button = event.target.closest('[data-action="delete-planning-session-detail"]');
  if (!button) return;
  event.preventDefault();
  const sessionId = String(state.planningEditingSessionId || '').trim();
  if (!sessionId) return;
  const activeSession = state.sessions.find(session => String(session.id || '') === sessionId);
  if (activeSession && isSessionFullyPast(activeSession)) {
    showFeedback(getPlanningSessionDetailFeedbackElement(), 'Cette session est passee et ne peut plus etre supprimee.', 'error');
    return;
  }
  const deleted = await deleteSessionById(sessionId, {
    feedbackTarget: getPlanningSessionDetailFeedbackElement(),
    successMessage: 'Session supprim?e.',
    button,
    context: 'FormationManager:DeleteSessionPlanningDetail'
  });
  if (!deleted) return;
  setPlanningSessionView('list');
  showFeedback(getPlanningSessionFeedbackElement(), deleted.message || 'Session supprim?e.', 'success');
}

function handlePlanningSessionDetailClick(event) {
  if (handleSessionTimePickerAction(event)) {
    return;
  }
  const backButton = event.target.closest('[data-action="back-to-planning-sessions"]');
  if (backButton) {
    event.preventDefault();
    setPlanningSessionView('list');
    return;
  }
  handlePlanningSessionDetailDelete(event);
}

function attachSessionCreateModalEvents(container) {
  const overlay = container.querySelector('[data-session-create-modal]');
  if (!overlay) return;
  overlay.addEventListener('click', event => {
    if (handleSessionTimePickerAction(event)) {
      return;
    }
    if (event.target === overlay) {
      closeSessionCreateModal();
    }
  });
  overlay.querySelector('[data-action="close-session-create-modal"]')?.addEventListener('click', closeSessionCreateModal);
  overlay.addEventListener('hidden.bs.modal', () => {
    const hadSelection = resetSessionCreateModal(overlay);
    if (hadSelection) {
      renderSessionCalendar();
    }
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (closeSessionTimePicker()) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      closeSessionCreateModal();
    }
  });
}

function handleSessionMoveConfirmModalAction(event) {
  const overlay = event.target.closest('[data-session-move-confirm-modal]');
  if (!overlay) return false;
  traceSessionMove('confirm modal click', {
    target: describeEventTarget(event.target),
    inFlight: state.sessionMoveConfirm.inFlight
  });
  if (event.target === overlay && !state.sessionMoveConfirm.inFlight) {
    closeSessionMoveConfirmModal();
    return true;
  }
  const button = event.target.closest('[data-session-move-choice]');
  if (!button) return true;
  event.preventDefault();
  const choice = button.dataset.sessionMoveChoice;
  traceSessionMove('confirm modal choice', {
    choice,
    pendingStartKey: state.sessionMove.pendingStartKey
  });
  if (choice === 'cancel') {
    closeSessionMoveConfirmModal();
    return true;
  }
  if (choice === 'keep') {
    void executeSessionMoveChoice('keep', button);
    return true;
  }
  if (choice === 'edit') {
    void executeSessionMoveChoice('edit', button);
    return true;
  }
  return true;
}

function bindSessionMoveCalendarDirectHandlers() {
  const calendar = getSessionMoveCalendarElement();
  if (!calendar) {
    traceSessionMove('bind direct calendar handlers skipped (calendar missing)');
    return;
  }
  if (calendar.dataset.moveCalendarDirectBound === 'true') return;
  calendar.dataset.moveCalendarDirectBound = 'true';
  calendar.addEventListener(
    'click',
    event => {
      traceSessionMove('direct calendar click handler', {
        target: describeEventTarget(event.target)
      });
      const handled = handleSessionMoveCalendarClick(event);
      traceSessionMove('direct calendar click result', { handled });
      if (handled) {
        event.stopPropagation();
      }
    },
    true
  );
  calendar.addEventListener(
    'pointerdown',
    event => {
      traceSessionMove('direct calendar pointerdown', {
        target: describeEventTarget(event.target)
      });
    },
    true
  );
}

function attachSessionModalEvents(container) {
  const overlay = container.querySelector('[data-session-detail-modal]');
  if (!overlay) {
    traceSessionMove('attachSessionModalEvents skipped (overlay missing)');
    return;
  }
  traceSessionMove('attachSessionModalEvents bound');
  overlay.addEventListener('click', event => {
    traceSessionMove('session detail overlay click', {
      target: describeEventTarget(event.target)
    });
    if (handleSessionMoveConfirmModalAction(event)) {
      traceSessionMove('overlay click handled by confirm modal action');
      return;
    }
    if (handleSessionTimePickerAction(event)) {
      traceSessionMove('overlay click handled by time picker');
      return;
    }
    if (handleSessionMoveCalendarClick(event)) {
      traceSessionMove('overlay click handled by move calendar');
      return;
    }
    if (event.target === overlay) {
      traceSessionMove('overlay background click closes session detail');
      closeSessionDetailModal();
      return;
    }
    handleSessionModalSwitch(event);
    handleSessionModalDelete(event);
  });
  overlay.addEventListener('mouseover', handleSessionMoveCalendarMouseOver);
  overlay.addEventListener('mouseout', handleSessionMoveCalendarMouseOut);
  overlay.addEventListener('touchstart', handleSessionMoveCalendarTouchStart, { passive: true });
  overlay.querySelector('[data-action="close-session-detail-modal"]')?.addEventListener('click', closeSessionDetailModal);
  overlay.addEventListener('input', event => {
    if (event.target.matches('[name="startDate"]')) {
      overlay.querySelectorAll('[data-session-time-picker][data-context="modal"]').forEach(updateSessionTimePickerSummary);
      if (state.sessionTimePicker.open && state.sessionTimePicker.context === 'modal') {
        const picker = getSessionTimePickerElement('modal', state.sessionTimePicker.dayIndex);
        if (picker) {
          renderSessionTimePickerOptions(picker, state.sessionTimePicker.target);
        }
      }
      const parsed = parseSessionDate(event.target.value);
      if (parsed) {
        state.sessionMove.month = parsed.getMonth();
        state.sessionMove.year = parsed.getFullYear();
        renderSessionMoveCalendar();
      }
    }
  });
  overlay.addEventListener('submit', handleSessionModalSave);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (closeSessionTimePicker()) {
        event.preventDefault();
        return;
      }
      if (state.sessionMoveConfirm.open) {
        event.preventDefault();
        closeSessionMoveConfirmModal();
        return;
      }
      event.preventDefault();
      closeSessionDetailModal();
    }
  });
}

function attachSessionConflictModalEvents(container) {
  const overlay = container.querySelector('[data-session-conflict-modal]');
  if (!overlay) return;
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeSessionConflictModal();
    }
  });
  overlay.querySelector('[data-action="close-session-conflict-modal"]')?.addEventListener('click', event => {
    event.preventDefault();
    closeSessionConflictModal();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSessionConflictModal();
    }
  });
}

function ensureSessionTimePickerGlobalListeners() {
  if (sessionTimePickerOutsideListenerAttached) return;
  document.addEventListener('click', event => {
    const root = getRoot();
    if (!root || !document.body.contains(root)) return;
    if (event.target.closest('[data-session-time-picker]')) return;
    if (event.target.closest('[data-session-conflict-modal]')) return;
    closeSessionTimePicker();
  });
  document.addEventListener(
    'keydown',
    event => {
      if (event.key !== 'Escape') return;
      if (state.sessionConflictModal.open) {
        closeSessionConflictModal();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (state.sessionTimePicker.open) {
        closeSessionTimePicker();
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );
  sessionTimePickerOutsideListenerAttached = true;
}

function buildSessionCardHtml(session) {
  const dateRangeLabel = buildSessionDateRangeLabel(session);
  const isPastSession = isSessionFullyPast(session);
  const remaining = Number.isFinite(session.placesRemaining)
    ? session.placesRemaining
    : Math.max(0, (session.maxClients || 0) - (session.reservedCount || 0));
  const durationDays = resolveSessionDurationDays(session, state.sessionDurationDays);
  const durationLabel = durationDays > 1 ? `${durationDays} jours` : '1 jour';

  const isOwn = session.isCurrentUserInstructor || !session.instructorId;
  const instructorLabel = session.instructorName
    ? escapeHtml(session.instructorName)
    : '<em class="gmf-session-card__unassigned">Non assigné</em>';
  const instructorIcon = session.instructorName ? 'bi-person-fill' : 'bi-person-dash';

  let statusBadge;
  if (isPastSession) {
    statusBadge = '<span class="gmf-session-badge gmf-session-badge--past">Passée</span>';
  } else if (session.isCanceled) {
    statusBadge = '<span class="gmf-session-badge gmf-session-badge--cancelled">Annulée</span>';
  } else if (!session.isAvailable) {
    statusBadge = '<span class="gmf-session-badge gmf-session-badge--full">Complet</span>';
  } else {
    statusBadge = '<span class="gmf-session-badge gmf-session-badge--active">Active</span>';
  }

  let actionsHtml;
  if (isPastSession) {
    actionsHtml = '';
  } else if (!isOwn) {
    actionsHtml = `
      <button class="kebab-button" type="button" data-session-kebab-toggle data-id="${escapeHtml(session.id)}" aria-label="Actions session">
        <span aria-hidden="true">⋮</span>
      </button>
      <div class="formation-card__menu" data-session-kebab-menu data-id="${escapeHtml(session.id)}" hidden>
        <button type="button" data-session-action="view-participants" data-session-id="${escapeHtml(session.id)}" title="Voir les participants">
          <i class="bi bi-people"></i>
        </button>
      </div>`;
  } else {
    actionsHtml = `
      <button class="kebab-button" type="button" data-session-kebab-toggle data-id="${escapeHtml(session.id)}" aria-label="Actions session">
        <span aria-hidden="true">⋮</span>
      </button>
      <div class="formation-card__menu" data-session-kebab-menu data-id="${escapeHtml(session.id)}" hidden>
        <button type="button" data-session-action="edit" data-session-id="${escapeHtml(session.id)}" title="Modifier">
          <i class="bi bi-pencil"></i>
        </button>
        <button type="button" data-session-action="view-participants" data-session-id="${escapeHtml(session.id)}" title="Voir les participants">
          <i class="bi bi-people"></i>
        </button>
        <button type="button" data-session-action="delete" data-session-id="${escapeHtml(session.id)}" title="Supprimer">
          <i class="bi bi-trash"></i>
        </button>
      </div>`;
  }

  const cardClasses = [
    'gmf-planning-session-card',
    isPastSession ? 'gmf-planning-session-card--past' : '',
    !isOwn ? 'gmf-planning-session-card--other' : ''
  ].filter(Boolean).join(' ');

  return `
    <article class="${cardClasses}" data-session-card data-session-id="${escapeHtml(session.id)}"${isPastSession ? ' data-session-past="true" aria-disabled="true"' : ''}>
      <div class="gmf-planning-session-card__icon" aria-hidden="true">
        <i class="bi bi-calendar2-week"></i>
      </div>
      <div class="gmf-planning-session-card__body">
        <div class="gmf-session-card__header-row">
          <p class="gmf-planning-session-card__title">${escapeHtml(dateRangeLabel)}</p>
          ${statusBadge}
        </div>
        <p class="gmf-planning-session-card__meta">
          <i class="bi bi-clock" aria-hidden="true"></i>
          ${escapeHtml(durationLabel)} · ${escapeHtml(buildSessionScheduleSummaryShort(session.schedule))}
        </p>
        <p class="gmf-planning-session-card__meta gmf-session-card__instructor">
          <i class="bi ${instructorIcon}" aria-hidden="true"></i>
          ${instructorLabel}
        </p>
        <p class="gmf-planning-session-card__meta">
          <i class="bi bi-people" aria-hidden="true"></i>
          ${escapeHtml(String(session.reservedCount || 0))}/${escapeHtml(String(session.maxClients || 0))} participants
          ${remaining > 0 ? `· <span class="gmf-session-card__remaining">${escapeHtml(String(remaining))} restante${remaining > 1 ? 's' : ''}</span>` : ''}
        </p>
      </div>
      <div class="formation-card__actions">
        ${actionsHtml}
      </div>
    </article>
  `;
}

function buildSessionScheduleSummaryShort(schedule) {
  const entries = Array.isArray(schedule) ? schedule : [];
  if (!entries.length) return 'Horaires non définis';
  if (entries.length === 1) {
    const e = entries[0];
    return `${e.startTime || '--:--'} → ${e.endTime || '--:--'}`;
  }
  return entries
    .map(e => `J${Number(e.dayIndex || 0)} ${e.startTime || '--:--'}→${e.endTime || '--:--'}`)
    .join(' · ');
}

function renderSessionList() {
  const container = getSessionListContainer();
  if (!container) return;
  if (!state.presentielFormations.length) {
    container.innerHTML = '<p class="module-placeholder">Aucune formation présentielle disponible.</p>';
    return;
  }
  if (!state.selectedPresentielId) {
    container.innerHTML = '<p class="module-placeholder">Sélectionnez une formation présentielle pour afficher les sessions.</p>';
    return;
  }

  const allSessions = state.sessions;
  const filteredSessions = state.sessionListFilter === 'mine'
    ? allSessions.filter(s => s.isCurrentUserInstructor || !s.instructorId)
    : allSessions;

  const filterToggleHtml = `
    <div class="gmf-session-filter-toggle" data-session-filter-toggle>
      <button type="button" class="gmf-session-filter-btn${state.sessionListFilter === 'mine' ? ' gmf-session-filter-btn--active' : ''}" data-session-filter="mine">
        <i class="bi bi-person-check" aria-hidden="true"></i> Mes sessions
      </button>
      <button type="button" class="gmf-session-filter-btn${state.sessionListFilter === 'all' ? ' gmf-session-filter-btn--active' : ''}" data-session-filter="all">
        <i class="bi bi-calendar3" aria-hidden="true"></i> Toutes les sessions
      </button>
    </div>
  `;
  const createBtnHtml = `
    <button type="button" class="gmf-session-list-create-btn" data-action="open-create-session-from-list">
      <i class="bi bi-plus-lg" aria-hidden="true"></i> Créer une session
    </button>
  `;

  if (!filteredSessions.length) {
    container.innerHTML = filterToggleHtml + createBtnHtml + `<p class="module-placeholder">${state.sessionListFilter === 'mine' ? 'Aucune session assignée. Créez une session ou afficher toutes les sessions.' : 'Aucune session planifiée pour cette formation.'}</p>`;
    attachSessionFilterActions(container);
    return;
  }

  // 4d — Group sessions by date
  const sortedSessions = [...filteredSessions].sort((a, b) => {
    const da = a.startDate ? new Date(a.startDate).getTime() : 0;
    const db = b.startDate ? new Date(b.startDate).getTime() : 0;
    return da - db;
  });
  const sessionsByDay = new Map();
  sortedSessions.forEach(session => {
    const d = session.startDate ? new Date(session.startDate) : null;
    const dayKey = d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : 'Date inconnue';
    if (!sessionsByDay.has(dayKey)) sessionsByDay.set(dayKey, []);
    sessionsByDay.get(dayKey).push(session);
  });
  let groupedHtml = '';
  sessionsByDay.forEach((daySessions, dayLabel) => {
    groupedHtml += `<div class="session-list__date-separator" style="font-size:0.8rem;font-weight:600;color:var(--color-muted);text-transform:uppercase;letter-spacing:0.05em;padding:0.75rem 0 0.25rem;border-top:1px solid rgba(0,0,0,0.06);margin-top:0.5rem;">${escapeHtml(dayLabel)}</div>`;
    groupedHtml += daySessions.map(buildSessionCardHtml).join('');
  });
  container.innerHTML = filterToggleHtml + createBtnHtml + groupedHtml;
  attachSessionListActions(container);
  attachSessionFilterActions(container);
}

function renderCanceledSessionList() {
  const container = getCanceledSessionListContainer();
  if (!container) return;
  if (!state.presentielFormations.length) {
    container.innerHTML = '<p class="module-placeholder">Aucune formation présentielle disponible.</p>';
    return;
  }
  if (!state.selectedPresentielId) {
    container.innerHTML = '<p class="module-placeholder">Sélectionnez une formation présentielle pour afficher les sessions annulées.</p>';
    return;
  }
  if (!state.canceledSessions.length) {
    container.innerHTML = '<p class="module-placeholder">Aucune session annulée pour cette formation.</p>';
    return;
  }

  container.innerHTML = state.canceledSessions
    .map(session => {
      const dateRangeLabel = buildSessionDateRangeLabel(session);
      const scheduleSummary = buildSessionScheduleSummary(Array.isArray(session.schedule) ? session.schedule : []);
      const clients = Array.isArray(session.clients) ? session.clients : [];
      return `
        <article class="data-item">
          <div class="data-item__content">
            <strong>${escapeHtml(dateRangeLabel)}</strong>
            <p class="muted">Annulee le ${escapeHtml(formatSessionDate(session.canceledAt || session.startDate))}</p>
            <div class="muted">${scheduleSummary}</div>
            <div class="data-list" style="margin-top: 0.75rem;">
              ${
                clients.length
                  ? clients
                      .map(
                        client => `
                          <article class="data-item">
                            <div class="data-item__content">
                              <strong>${escapeHtml(
                                `${String(client.firstName || '').trim()} ${String(client.lastName || '').trim()}`.trim() ||
                                  client.email ||
                                  'Client'
                              )}</strong>
                              <p class="muted">${escapeHtml(client.email || 'Email indisponible')}</p>
                            </div>
                            <div class="data-item__actions">
                              <span class="badge">${
                                escapeHtml(client.statusLabel || 'En attente')
                              }</span>
                            </div>
                          </article>
                        `
                      )
                      .join('')
                  : '<p class="module-placeholder">Aucun client associe.</p>'
              }
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function attachSessionFilterActions(container) {
  if (!container) return;
  container.addEventListener('click', event => {
    const btn = event.target.closest('[data-session-filter]');
    if (!btn) return;
    const filter = btn.dataset.sessionFilter;
    if (!filter || filter === state.sessionListFilter) return;
    state.sessionListFilter = filter;
    renderSessionList();
  }, { capture: false });
}

function isSessionOwnedByCurrentUser(session) {
  return session.isCurrentUserInstructor || !session.instructorId;
}

function openSessionCreateFromListModal() {
  const selectedFormation = state.presentielFormations.find(f => f.id === state.selectedPresentielId);
  if (!selectedFormation) {
    showToast({ type: 'error', message: 'Sélectionnez une formation présentielle.', durationMs: 2000 });
    return;
  }

  const now = new Date();
  const modalState = {
    step: 1,
    selectedDate: null,
    capacity: 1,
    calYear: now.getFullYear(),
    calMonth: now.getMonth(),
  };

  const overlay = document.createElement('div');
  overlay.className = 'gmf-create-session-overlay';
  document.body.appendChild(overlay);

  function buildMiniCalendarHtml(year, month, selected) {
    const today = getCalendarTodayStart();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekdays = WEEKDAY_LABELS.map(d => `<span class="gmf-csm-cal__weekday">${escapeHtml(d)}</span>`).join('');
    let cells = '';
    for (let i = 0; i < startOffset; i++) {
      cells += '<span class="gmf-csm-cal__day gmf-csm-cal__day--empty"></span>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const key = getCalendarKey(d);
      const isPast = d < today;
      const isSelected = key === selected;
      const cls = [
        'gmf-csm-cal__day',
        isPast ? 'gmf-csm-cal__day--past' : 'gmf-csm-cal__day--future',
        isSelected ? 'gmf-csm-cal__day--selected' : '',
      ].filter(Boolean).join(' ');
      cells += `<button type="button" class="${cls}" data-pick-date="${key}" ${isPast ? 'disabled' : ''}>${day}</button>`;
    }
    return `
      <div class="gmf-csm-cal">
        <div class="gmf-csm-cal__nav">
          <button type="button" class="gmf-csm-cal__nav-btn" data-prev-month aria-label="Mois précédent">‹</button>
          <span class="gmf-csm-cal__month-label">${escapeHtml(MONTH_LABELS[month])} ${year}</span>
          <button type="button" class="gmf-csm-cal__nav-btn" data-next-month aria-label="Mois suivant">›</button>
        </div>
        <div class="gmf-csm-cal__weekdays">${weekdays}</div>
        <div class="gmf-csm-cal__days">${cells}</div>
      </div>
    `;
  }

  function buildStep2Html() {
    return `
      <div class="gmf-session-edit-modal__field">
        <label class="gmf-session-edit-modal__label">Horaires — Jour 1</label>
        <div class="schedule-fields">
          ${buildSessionTimePickerRow(1, { context: 'list-create', startTime: '', endTime: '' })}
        </div>
      </div>
      <div class="gmf-session-edit-modal__field">
        <label class="gmf-session-edit-modal__label">Capacité</label>
        <div class="gmf-session-edit-modal__capacity">
          <div class="session-capacity-widget" data-capacity-widget data-capacity-min="1">
            <button type="button" class="session-capacity-widget__btn" data-action="capacity-decrement" aria-label="Réduire la capacité" disabled>
              <i class="bi bi-dash" aria-hidden="true"></i>
            </button>
            <span class="session-capacity-widget__value" data-capacity-display>${modalState.capacity}</span>
            <button type="button" class="session-capacity-widget__btn" data-action="capacity-increment" aria-label="Augmenter la capacité">
              <i class="bi bi-plus" aria-hidden="true"></i>
            </button>
            <input type="hidden" name="maxClients" value="${modalState.capacity}" data-capacity-input>
          </div>
        </div>
      </div>
    `;
  }

  function renderModal() {
    const isStep1 = modalState.step === 1;
    overlay.innerHTML = `
      <div class="gmf-create-session-modal">
        <div class="gmf-session-edit-modal__header">
          <div>
            <h3 class="gmf-session-edit-modal__title">Nouvelle session</h3>
            <p class="gmf-session-edit-modal__subtitle">
              ${isStep1
                ? 'Étape 1/2 — Choisir une date'
                : `${escapeHtml(formatCalendarKeyLabel(modalState.selectedDate))} — Étape 2/2`}
            </p>
          </div>
          <button type="button" class="gmf-create-session-modal__close" data-close aria-label="Fermer">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
        <div class="gmf-create-session-modal__body">
          ${isStep1 ? buildMiniCalendarHtml(modalState.calYear, modalState.calMonth, modalState.selectedDate) : buildStep2Html()}
        </div>
        <div class="gmf-create-session-modal__footer">
          ${isStep1
            ? `<button type="button" class="gmf-session-edit-modal__btn-save" data-next ${!modalState.selectedDate ? 'disabled' : ''}>
                Suite <i class="bi bi-arrow-right" aria-hidden="true"></i>
               </button>`
            : `<button type="button" class="gmf-create-session-modal__btn-secondary" data-back>
                <i class="bi bi-arrow-left" aria-hidden="true"></i> Retour
               </button>
               <button type="button" class="gmf-session-edit-modal__btn-save" data-submit>
                <i class="bi bi-check2" aria-hidden="true"></i> Créer la session
               </button>`
          }
        </div>
      </div>
    `;
    bindModalEvents();
    if (!isStep1) {
      overlay.querySelectorAll('[data-session-time-picker]').forEach(updateSessionTimePickerSummary);
    }
  }

  function closeAndCleanup() {
    closeSessionTimePicker();
    overlay.remove();
  }

  function bindModalEvents() {
    overlay.querySelector('[data-close]')?.addEventListener('click', closeAndCleanup);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeAndCleanup();
      if (handleSessionTimePickerAction(e)) return;
    });

    overlay.querySelector('[data-prev-month]')?.addEventListener('click', () => {
      if (modalState.calMonth === 0) { modalState.calMonth = 11; modalState.calYear--; }
      else { modalState.calMonth--; }
      renderModal();
    });
    overlay.querySelector('[data-next-month]')?.addEventListener('click', () => {
      if (modalState.calMonth === 11) { modalState.calMonth = 0; modalState.calYear++; }
      else { modalState.calMonth++; }
      renderModal();
    });

    overlay.querySelectorAll('[data-pick-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        modalState.selectedDate = cell.dataset.pickDate;
        renderModal();
      });
    });

    overlay.querySelector('[data-next]')?.addEventListener('click', async () => {
      if (!modalState.selectedDate) return;
      // Sync state.sessionSelectedDates so the list-create time picker can load conflicts
      state.sessionSelectedDates = [modalState.selectedDate];
      await loadConflictsForDates([modalState.selectedDate], null);
      closeSessionTimePicker();
      modalState.step = 2;
      renderModal();
    });

    overlay.querySelector('[data-back]')?.addEventListener('click', () => {
      closeSessionTimePicker();
      modalState.step = 1;
      renderModal();
    });

    overlay.querySelector('[data-submit]')?.addEventListener('click', async () => {
      const picker = overlay.querySelector('[data-session-time-picker][data-context="list-create"][data-day-index="1"]');
      const { startTime, endTime } = getSessionTimePickerValues(picker);
      if (!startTime || !endTime) {
        showToast({ type: 'error', message: 'Définissez les horaires de début et de fin.', durationMs: 2500 });
        return;
      }
      if (startTime >= endTime) {
        showToast({ type: 'error', message: "L'heure de fin doit être après le début.", durationMs: 2500 });
        return;
      }
      const capacityInput = overlay.querySelector('[data-capacity-input]');
      const maxClients = Number(capacityInput?.value || 1);
      const submitBtn = overlay.querySelector('[data-submit]');
      if (submitBtn) submitBtn.disabled = true;
      const formationId = selectedFormation.id || selectedFormation._id;
      try {
        const res = await fetch(`/api/gestion/formations/${formationId}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            startDate: modalState.selectedDate,
            durationDays: 1,
            schedule: [{ dayIndex: 1, startTime, endTime }],
            maxClients,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          showToast({ type: 'success', message: 'Session créée.', durationMs: 1000 });
          closeAndCleanup();
          await fetchSessionsForSelectedPresentiel();
          renderSessionList();
        } else {
          showToast({ type: 'error', message: data.error || 'Erreur lors de la création.', durationMs: 3000 });
          if (submitBtn) submitBtn.disabled = false;
        }
      } catch {
        showToast({ type: 'error', message: 'Erreur réseau.', durationMs: 3000 });
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  renderModal();
}

function attachSessionListActions(container) {
  if (!container || container.dataset.boundSessionListActions === 'true') return;
  container.dataset.boundSessionListActions = 'true';
  container.addEventListener('click', event => {
    if (event.target.closest('[data-action="open-create-session-from-list"]')) {
      openSessionCreateFromListModal();
      return;
    }
    const toggle = event.target.closest('[data-session-kebab-toggle]');
    if (toggle) {
      event.preventDefault();
      togglePlanningSessionKebab(toggle.dataset.id, container);
      return;
    }
    const action = event.target.closest('[data-session-action]');
    if (!action) return;
    event.preventDefault();
    closePlanningSessionKebabs(container);
    const sessionId = String(action.dataset.sessionId || '').trim();
    if (!sessionId) return;
    const session = state.sessions.find(entry => String(entry?.id || '') === sessionId);
    if (!session) return;
    if (isSessionFullyPast(session)) {
      showFeedback(
        getPlanningSessionFeedbackElement() || getSessionFeedbackElement(),
        'Cette session est passée et ne peut plus être modifiée.',
        'error'
      );
      return;
    }
    if (action.dataset.sessionAction === 'edit') {
      if (!isSessionOwnedByCurrentUser(session)) return;
      openSessionDetailFromSessionList(sessionId);
      return;
    }
    if (action.dataset.sessionAction === 'delete') {
      if (!isSessionOwnedByCurrentUser(session)) return;
      void deleteSessionById(sessionId, {
        feedbackTarget: getPlanningSessionFeedbackElement() || getSessionFeedbackElement(),
        successMessage: 'Session supprimée.',
        button: action.closest('button')
      });
    }
    if (action.dataset.sessionAction === 'view-participants') {
      openPlanningSessionDetail(sessionId);
    }
  });
  ensurePlanningSessionKebabOutsideListener();
}

function openSessionDetailFromSessionList(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return;
  const session = state.sessions.find(entry => String(entry?.id || '') === normalizedSessionId);
  if (!session) return;
  if (isSessionFullyPast(session)) {
    showFeedback(
      getPlanningSessionFeedbackElement() || getSessionFeedbackElement(),
      'Cette session est passee et ne peut plus etre modifiee.',
      'error'
    );
    return;
  }
  const firstDateKey = buildSessionCalendarKeys(session)[0] || formatDateInputValue(session.startDate);
  if (!firstDateKey) return;
  closePlanningSessionKebabs();
  void openSessionDetailModal(firstDateKey, normalizedSessionId);
}

function closePlanningSessionKebabs(container) {
  const scope = getRoot(container) || document;
  scope.querySelectorAll('[data-session-kebab-menu]').forEach(menu => {
    const hideTimerId = Number(menu.dataset.hideTimerId || 0);
    if (hideTimerId) {
      window.clearTimeout(hideTimerId);
      menu.removeAttribute('data-hide-timer-id');
    }
    if (menu.hidden && !menu.classList.contains('is-open')) {
      return;
    }
    menu.classList.remove('is-open');
    const timerId = window.setTimeout(() => {
      if (!menu.classList.contains('is-open')) {
        menu.hidden = true;
      }
    }, 150);
    menu.dataset.hideTimerId = String(timerId);
  });
  state.planningSessionKebabId = null;
}

function togglePlanningSessionKebab(id, container) {
  const scope = getRoot(container) || document;
  if (!id) return;
  const menu = scope.querySelector(`[data-session-kebab-menu][data-id="${id}"]`);
  if (!menu) return;
  const isOpen = !menu.hidden;
  closePlanningSessionKebabs(scope);
  if (!isOpen) {
    const hideTimerId = Number(menu.dataset.hideTimerId || 0);
    if (hideTimerId) {
      window.clearTimeout(hideTimerId);
      menu.removeAttribute('data-hide-timer-id');
    }
    menu.hidden = false;
    requestAnimationFrame(() => {
      menu.classList.add('is-open');
    });
    state.planningSessionKebabId = id;
  }
}

function ensurePlanningSessionKebabOutsideListener() {
  if (planningSessionKebabOutsideListenerAttached) return;
  document.addEventListener('click', event => {
    if (!state.planningSessionKebabId) return;
    if (event.target.closest('[data-session-kebab-toggle]') || event.target.closest('[data-session-kebab-menu]')) {
      return;
    }
    closePlanningSessionKebabs();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!state.planningSessionKebabId) return;
    closePlanningSessionKebabs();
  });
  planningSessionKebabOutsideListenerAttached = true;
}

function openPlanningSessionDetail(sessionId) {
  if (!sessionId) return;
  state.planningEditingSessionId = sessionId;
  setPlanningSessionView('detail', { sessionId });
  showFeedback(getPlanningSessionDetailFeedbackElement(), '');
}

function renderPlanningSessionDetail() {
  const container = getPlanningSessionDetailContainer();
  if (!container) return;
  const sessionId = String(state.planningEditingSessionId || '').trim();
  const session = state.sessions.find(entry => String(entry.id || '') === sessionId);
  if (!session) {
    state.planningEditingSessionId = null;
    container.innerHTML = '<p class="module-placeholder">Session introuvable.</p>';
    return;
  }
  const isPastSession = isSessionFullyPast(session);
  const durationDays = resolveSessionDurationDays(session, state.sessionDurationDays);
  const scheduleByDay = new Map(
    (Array.isArray(session.schedule) ? session.schedule : []).map(entry => [Number(entry.dayIndex), entry])
  );
  const scheduleInputs = Array.from({ length: durationDays }, (_unused, index) => {
    const dayIndex = index + 1;
    const row = scheduleByDay.get(dayIndex) || {};
    return buildSessionTimePickerRow(dayIndex, {
      startTime: String(row.startTime || ''),
      endTime: String(row.endTime || ''),
      context: 'detail'
    });
  }).join('');
  const remaining = Number.isFinite(session.placesRemaining)
    ? session.placesRemaining
    : Math.max(0, Number(session.maxClients || 0) - Number(session.reservedCount || 0));
  container.innerHTML = `
    <article class="session-detail-card gmf-planning-session-detail-card">
      <header class="gmf-planning-session-detail-header">
        <button type="button" class="ghost-button" data-action="back-to-planning-sessions">
          <i class="bi bi-arrow-left"></i>
          Retour aux sessions
        </button>
        <h4>${escapeHtml(buildSessionDateRangeLabel(session))}</h4>
      </header>
      <form data-planning-session-detail-form>
        <input type="hidden" name="sessionId" value="${escapeHtml(String(session.id || ''))}">
        <label>
          Date de début
          <input type="date" name="startDate" value="${escapeHtml(formatDateInputValue(session.startDate))}" required ${isPastSession ? 'disabled' : ''}>
        </label>
        <p class="muted">Durée : ${durationDays === 1 ? '1 jour' : `${durationDays} jours`}</p>
        <div class="schedule-fields">
          ${scheduleInputs}
        </div>
        <div class="session-capacity-field">
          <p class="session-capacity-field__label">Capacité maximale</p>
          <div class="session-capacity-widget" data-capacity-widget data-capacity-min="${Math.max(1, Number(session.reservedCount || 0))}">
            <button type="button" class="session-capacity-widget__btn" data-action="capacity-decrement" aria-label="Réduire la capacité" ${isPastSession || Number(session.maxClients || 1) <= Math.max(1, Number(session.reservedCount || 0)) ? 'disabled' : ''}>
              <i class="bi bi-dash" aria-hidden="true"></i>
            </button>
            <span class="session-capacity-widget__value" data-capacity-display>${escapeHtml(String(session.maxClients || 1))}</span>
            <button type="button" class="session-capacity-widget__btn" data-action="capacity-increment" aria-label="Augmenter la capacité" ${isPastSession || Number(session.maxClients || 1) >= 100 ? 'disabled' : ''}>
              <i class="bi bi-plus" aria-hidden="true"></i>
            </button>
            <input type="hidden" name="maxClients" value="${escapeHtml(String(session.maxClients || 1))}" data-capacity-input>
          </div>
        </div>
        <p class="muted">Réservés : ${escapeHtml(String(session.reservedCount || 0))} · Restantes : ${escapeHtml(
    String(remaining)
  )}</p>
        <div class="form-actions">
          ${
            isPastSession
              ? '<p class="muted">Session passee : modification et suppression desactivees.</p>'
              : `
          <button type="submit" class="primary-button" data-action="save-planning-session-detail">Modifier la session</button>
          <button type="button" class="secondary-button" data-action="delete-planning-session-detail">Supprimer la session</button>
          `
          }
        </div>
      </form>
    </article>
  `;
  if (isPastSession) {
    container.querySelectorAll('[data-session-time-picker][data-context="detail"] [data-action="open-session-time-picker"]').forEach(button => {
      button.disabled = true;
    });
  }
  container.querySelectorAll('[data-session-time-picker]').forEach(updateSessionTimePickerSummary);
  showFeedback(getPlanningSessionDetailFeedbackElement(), '');
}

async function loadExternalPresentielSessions({ force = false } = {}) {
  const selectedFormationId = String(state.selectedPresentielId || '').trim();
  if (!selectedFormationId) {
    state.sessionExternalFormationsId = null;
    state.sessionExternalSessions = [];
    return [];
  }
  const shouldReuse =
    !force &&
    state.sessionExternalFormationsId === selectedFormationId &&
    Array.isArray(state.sessionExternalSessions);
  if (shouldReuse) {
    return state.sessionExternalSessions;
  }
  if (state.sessionExternalRequestInFlight) {
    return state.sessionExternalRequestInFlight;
  }
  const otherFormations = state.presentielFormations.filter(
    formation => String(formation.id || '') !== selectedFormationId
  );
  if (!otherFormations.length) {
    state.sessionExternalFormationsId = selectedFormationId;
    state.sessionExternalSessions = [];
    return [];
  }
  const request = Promise.all(
    otherFormations.map(async formation => {
      try {
        const response = await fetch(SESSIONS_ENDPOINT(formation.id), { credentials: 'include' });
        const payload = await getJson(response);
        if (!response.ok) {
          if (FM_DEV_LOGS) {
            console.debug('[FM] external sessions load failed', formation.id, payload?.error || response.statusText);
          }
          return null;
        }
        return {
          formationId: formation.id,
          formationName: formation.name || 'Formation',
          sessions: Array.isArray(payload.sessions) ? payload.sessions : []
        };
      } catch (error) {
        if (FM_DEV_LOGS) {
          console.debug('[FM] external sessions network failure', formation.id, error);
        }
        return null;
      }
    })
  )
    .then(results => {
      const normalized = results.filter(Boolean);
      state.sessionExternalSessions = normalized;
      state.sessionExternalFormationsId = selectedFormationId;
      return normalized;
    })
    .finally(() => {
      state.sessionExternalRequestInFlight = null;
    });
  state.sessionExternalRequestInFlight = request;
  return request;
}

async function findScheduleConflictBeforeSave(startDateKeys, scheduleEntries, excludeSessionId = null) {
  if (!Array.isArray(startDateKeys) || !startDateKeys.length) return null;
  if (!Array.isArray(scheduleEntries) || !scheduleEntries.length) return null;
  // Pre-load conflicts for all relevant dates
  const dateKeysNeeded = [];
  for (const startKey of startDateKeys) {
    const maxDayIndex = Math.max(...scheduleEntries.map(e => Number(e?.dayIndex) || 1));
    for (let d = 0; d < maxDayIndex; d++) {
      const k = addDaysToCalendarKey(startKey, d);
      if (k) dateKeysNeeded.push(k);
    }
  }
  if (dateKeysNeeded.length) {
    state.sessionConflictsByDate = {};
    await loadConflictsForDates([...new Set(dateKeysNeeded)], excludeSessionId);
  }
  const intervalsByDate = buildExternalSessionIntervalsByDate();
  for (const startDateKey of startDateKeys) {
    for (const entry of scheduleEntries) {
      const dayIndex = Number(entry?.dayIndex);
      if (!Number.isFinite(dayIndex) || dayIndex < 1) continue;
      const dateKey = addDaysToCalendarKey(startDateKey, dayIndex - 1);
      if (!dateKey) continue;
      const conflict = findSessionConflict({
        context: 'create',
        dayIndex,
        startTime: entry.startTime,
        endTime: entry.endTime,
        prebuiltIntervals: intervalsByDate,
        dateKeysOverride: [dateKey]
      });
      if (conflict) {
        return conflict;
      }
    }
  }
  return null;
}

function handleSessionFormationChange(event) {
  closeSessionTimePicker();
  closeSessionConflictModal();
  state.selectedPresentielId = event.target.value || null;
  state.sessionExternalFormationsId = null;
  state.sessionExternalSessions = [];
  state.sessionExternalRequestInFlight = null;
  const formation = state.presentielFormations.find(entry => entry.id === state.selectedPresentielId);
  state.sessionDurationDays = normalizeDurationDaysValue(formation?.durationDays, 1);
  resetSessionForm();
  renderSessionList();
  void fetchSessionsForSelectedPresentiel();
}

async function fetchSessionsForSelectedPresentiel(targetId = state.selectedPresentielId, options = {}) {
  const { silent = false } = options;
  const container = getSessionListContainer();
  const canceledContainer = getCanceledSessionListContainer();
  const formationId = targetId;
  if (!formationId) {
    state.sessions = [];
    state.canceledSessions = [];
    state.sessionExternalFormationsId = null;
    state.sessionExternalSessions = [];
    state.sessionExternalRequestInFlight = null;
    if (!silent) {
      renderSessionList();
      renderCanceledSessionList();
      renderSessionCalendar();
      renderPlanningSessionDetail();
      closeSessionDetailModal();
    }
    return;
  }
  if (!silent && container) {
    container.innerHTML = '<p class="module-placeholder">Chargement des sessions...</p>';
  }
  if (!silent && canceledContainer) {
    canceledContainer.innerHTML = '<p class="module-placeholder">Chargement des sessions annulées...</p>';
  }
  try {
    const [sessionsResponse, canceledResponse] = await Promise.all([
      fetch(SESSIONS_ENDPOINT(formationId), { credentials: 'include' }),
      fetch(CANCELED_SESSIONS_ENDPOINT(formationId), { credentials: 'include' })
    ]);
    const [payload, canceledPayload] = await Promise.all([getJson(sessionsResponse), getJson(canceledResponse)]);
    if (!sessionsResponse.ok) {
      const error = payload?.error || 'Impossible de charger les sessions.';
      throw new Error(error);
    }
    if (!canceledResponse.ok) {
      const error = canceledPayload?.error || 'Impossible de charger les sessions annulées.';
      throw new Error(error);
    }
    state.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    state.canceledSessions = Array.isArray(canceledPayload.sessions) ? canceledPayload.sessions : [];
    if (payload.currentUserId) state.currentUserId = String(payload.currentUserId);
    state.sessionConflictsByDate = {};
    if (!silent) {
      if (state.planningSessionView === 'detail') {
        renderPlanningSessionDetail();
      } else {
        renderSessionList();
      }
      renderCanceledSessionList();
      renderSessionCalendar();
      syncSessionModalWithSessions();
    }
  } catch (error) {
    console.error('Erreur chargement sessions', error);
    state.canceledSessions = [];
    state.sessionExternalFormationsId = null;
    state.sessionExternalSessions = [];
    state.sessionExternalRequestInFlight = null;
    if (!silent && container) {
      container.innerHTML = '<p class="module-placeholder">Impossible de charger les sessions presentiels.</p>';
      renderCanceledSessionList();
      renderPlanningSessionDetail();
      renderSessionCalendar();
    }
  }
}

function resetSessionForm() {
  const form = getSessionForm();
  const feedback = getSessionFeedbackElement();
  if (!form) return;
  closeSessionTimePicker();
  closeSessionConflictModal();
  form.reset();
  showFeedback(feedback, '');
  state.sessionSelectedDates = [];
  state.planningSessionView = 'list';
  state.planningEditingSessionId = null;
  state.planningSessionKebabId = null;
  resetSessionCalendar();
  updateSessionDurationText(state.sessionDurationDays);
  renderSessionScheduleInputs(state.sessionDurationDays);
  renderSessionCalendar();
  closeSessionDetailModal();
}

async function handleSessionSubmit(event) {
  event.preventDefault();
  const form = getSessionForm();
  const feedback = getSessionFeedbackElement();
  if (!form) return;
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.dataset.actionState === 'loading') return;
  const context = 'FormationManager:CreateSession';
  if (!state.selectedPresentielId) {
    setActionError(submitButton, context, new Error('Formation présentielle manquante.'));
    return showFeedback(feedback, 'Sélectionnez une formation présentielle.', 'error');
  }
  const selectedDates = state.sessionSelectedDates
    .filter(date => !isCalendarKeyInPast(date))
    .sort();
  if (!selectedDates.length) {
    setActionError(submitButton, context, new Error('Aucune date de début sélectionnée.'));
    return showFeedback(feedback, 'Sélectionnez au moins une date de début.', 'error');
  }
  const scheduleEntries = collectSessionScheduleEntries();
  if (scheduleEntries.some(entry => !entry.startTime || !entry.endTime)) {
    setActionError(submitButton, context, new Error('Les horaires sont requis pour chaque jour.'));
    return showFeedback(feedback, 'Les horaires sont requis pour chaque jour.', 'error');
  }
  if (
    scheduleEntries.some(entry => {
      return entry.startTime >= entry.endTime;
    })
  ) {
    setActionError(submitButton, context, new Error('Chaque jour doit commencer avant sa fin.'));
    return showFeedback(feedback, 'Chaque jour doit commencer avant sa fin.', 'error');
  }
  const conflict = await findScheduleConflictBeforeSave(selectedDates, scheduleEntries, null);
  if (conflict) {
    setActionError(submitButton, context, new Error('Conflit horaire detecte.'), {
      conflict,
      selectedDates
    });
    showFeedback(
      feedback,
      `Conflit horaire avec ${conflict.formationName} le ${formatCalendarKeyLabel(conflict.dateKey)}.`,
      'error'
    );
    openSessionConflictModal(conflict);
    return;
  }
  const maxValue = form.querySelector('[name="sessionCapacity"]')?.value;
  const maxClients = Math.floor(Number(maxValue));
  if (!Number.isFinite(maxClients) || maxClients < 1) {
    setActionError(submitButton, context, new Error('Capacite invalide.'), { maxValue });
    return showFeedback(feedback, 'Capacite invalide.', 'error');
  }
  setActionLoading(submitButton, 'Enregistrement...');
  try {
    let created = 0;
    for (const startDate of selectedDates) {
      const payload = {
        startDate,
        schedule: scheduleEntries,
        maxClients
      };
      const response = await fetch(SESSIONS_ENDPOINT(state.selectedPresentielId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await getJson(response);
      if (!response.ok) {
        if (response.status === 409 && Array.isArray(body?.conflicts) && body.conflicts.length) {
          const c = body.conflicts[0];
          showToast({
            type: 'error',
            message: `Créneau indisponible — conflit avec ${c.formationName} de ${c.startTime} à ${c.endTime}`,
            durationMs: 5000
          });
          pulseConflictSlotsInPicker('create', scheduleEntries);
        }
        throw new Error(body?.error || 'Impossible de sauvegarder la session.');
      }
      created += 1;
    }
    showFeedback(
      feedback,
      `${created} session${created > 1 ? 's' : ''} planifie${created > 1 ? 'es' : 'e'}.`,
      'success'
    );
    setActionSuccess(submitButton, 'Réussi');
    resetSessionForm();
  } catch (error) {
    setActionError(submitButton, context, error, {
      formationId: state.selectedPresentielId,
      selectedDates,
      scheduleEntries,
      maxClients
    });
    if (!error.message?.includes('Créneau indisponible')) {
      showFeedback(feedback, error.message || 'Erreur reseau.', 'error');
    }
  } finally {
    await fetchSessionsForSelectedPresentiel();
  }
}

function attachSessionEvents(container) {
  traceSessionMove('attachSessionEvents start');
  const form = getSessionForm();
  form?.addEventListener('submit', handleSessionSubmit);
  container.querySelector('[data-action="reset-session"]')?.addEventListener('click', resetSessionForm);
  const calendar = container.querySelector('[data-session-calendar]');
  calendar?.addEventListener('click', handleSessionCalendarClick);
  const planningDetailContainer = container.querySelector('[data-planning-session-detail-content]');
  planningDetailContainer?.addEventListener('click', handlePlanningSessionDetailClick);
  planningDetailContainer?.addEventListener('submit', handlePlanningSessionDetailSubmit);
  planningDetailContainer?.addEventListener('input', event => {
    if (event.target.matches('[name="startDate"]')) {
      planningDetailContainer
        .querySelectorAll('[data-session-time-picker][data-context="detail"]')
        .forEach(updateSessionTimePickerSummary);
      if (state.sessionTimePicker.open && state.sessionTimePicker.context === 'detail') {
        const picker = getSessionTimePickerElement('detail', state.sessionTimePicker.dayIndex);
        if (picker) {
          renderSessionTimePickerOptions(picker, state.sessionTimePicker.target);
        }
      }
      // Reload conflicts for the new date range (detail context)
      const newStartDate = String(event.target.value || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(newStartDate)) {
        const editingSession = state.sessions.find(s => s.id === state.planningEditingSessionId);
        const durationDays = Math.max(1, Number(editingSession?.durationDays || 1));
        const keysToLoad = [];
        for (let d = 0; d < durationDays; d++) {
          const k = addDaysToCalendarKey(newStartDate, d);
          if (k) keysToLoad.push(k);
        }
        state.sessionConflictsByDate = {};
        void loadConflictsForDates([...new Set(keysToLoad)], state.planningEditingSessionId || null);
      }
    }
  });
  attachSessionCreateModalEvents(container);
  attachSessionModalEvents(container);
  attachSessionConflictModalEvents(container);
  ensureSessionTimePickerGlobalListeners();
  ensureSessionMoveDebugListeners();
}

export async function renderModule(container) {
  if (!container) return;
  fmRenderCount += 1;
  logDev('[FM] renderModule call', { count: fmRenderCount });
  container.innerHTML = `
    <div class="gmf-shell" data-module-root>
      <div class="gmf-header" data-list-header>
        <div>
          <p class="gmf-kicker">Gestion des formations</p>
          <h2>Catalogue & creation</h2>
        </div>
      </div>

      <nav class="gmf-catalog-tabs" role="tablist" aria-label="Navigation formations">
        <button
          type="button"
          class="gmf-catalog-tab is-active"
          data-catalog-tab
          data-action="set-catalog-tab"
          data-tab="main"
          role="tab"
          aria-selected="true"
        >
          Principal
        </button>
        <button
          type="button"
          class="gmf-catalog-tab"
          data-catalog-tab
          data-action="set-catalog-tab"
          data-tab="history"
          role="tab"
          aria-selected="false"
        >
          Historiques
        </button>
      </nav>

      <div class="gmf-catalog-panels">
      <section class="gmf-catalog-panel" data-catalog-panel="main" data-panel-display="block">
      <section class="gmf-view" data-panel="list" data-panel-display="flex">
        <div class="gmf-toolbar gmf-toolbar--sticky">
          <p class="muted">Vue liste</p>
          <button type="button" class="primary-button gmf-create-cta" data-action="open-create">Créer une formation</button>
        </div>
        <div data-formation-list class="gmf-grid">
          <p class="module-placeholder">Chargement des formations...</p>
        </div>
      </section>

      <section class="gmf-view gmf-screen hidden" data-panel="dashboard" data-panel-display="flex" hidden>
        <header class="gmf-screen-header gmf-dashboard-header">
          <button type="button" class="ghost-button" data-action="back-to-list">
            <i class="bi bi-arrow-left"></i>
            Retour aux formations
          </button>
          <div class="gmf-dashboard-header__title">
            <p class="gmf-kicker">Voir</p>
            <h3 data-dashboard-view-title>Dashboard formation</h3>
          </div>
          <button type="button" class="primary-button" data-action="open-dashboard-edit" hidden>
            <i class="bi bi-pencil"></i>
            Modifier
          </button>
        </header>
        <div class="gmf-screen-body gmf-dashboard-body" data-dashboard-content>
          <p class="module-placeholder">Sélectionnez une formation pour afficher son dashboard.</p>
        </div>
      </section>

      <section class="gmf-view gmf-screen hidden" data-panel="edit" data-panel-display="flex" hidden>
        <header class="gmf-screen-header">
          <button type="button" class="ghost-button" data-action="back-to-list">
            <i class="bi bi-arrow-left"></i>
            Retour aux formations
          </button>
          <div>
            <p class="gmf-kicker">Edition</p>
            <h3 class="gmf-create-title" data-create-title>Créer ou modifier une formation</h3>
          </div>
        </header>

        <nav class="gmf-editor-tabs" data-editor-tabs>
          <div class="gmf-editor-tabs__track" data-editor-tabs-track role="tablist" aria-label="Sections formation">
            <button type="button" class="gmf-editor-tab is-active" data-editor-tab="info" role="tab" aria-selected="true">
              <span class="gmf-editor-tab__icon"><i class="bi bi-card-text"></i></span>
              <span class="gmf-editor-tab__label">Informations</span>
            </button>
            <button type="button" class="gmf-editor-tab" data-editor-tab="modules" data-requires-id role="tab" aria-selected="false">
              <span class="gmf-editor-tab__icon"><i class="bi bi-collection-play"></i></span>
              <span class="gmf-editor-tab__label">Modules pedagogiques</span>
            </button>
            <button type="button" class="gmf-editor-tab" data-editor-tab="planning" data-requires-id role="tab" aria-selected="false">
              <span class="gmf-editor-tab__icon"><i class="bi bi-calendar-event"></i></span>
              <span class="gmf-editor-tab__label">Planning sessions</span>
            </button>
            <button type="button" class="gmf-editor-tab" data-editor-tab="promotion" data-requires-id role="tab" aria-selected="false">
              <span class="gmf-editor-tab__icon"><i class="bi bi-percent"></i></span>
              <span class="gmf-editor-tab__label">Promotion</span>
            </button>
            <button type="button" class="gmf-editor-tab" data-editor-tab="boost" data-requires-id role="tab" aria-selected="false">
              <span class="gmf-editor-tab__icon"><i class="bi bi-lightning-charge"></i></span>
              <span class="gmf-editor-tab__label">Boost</span>
            </button>
            <button type="button" class="gmf-editor-tab" data-editor-tab="options" data-requires-id role="tab" aria-selected="false">
              <span class="gmf-editor-tab__icon"><i class="bi bi-box-seam"></i></span>
              <span class="gmf-editor-tab__label">Options</span>
            </button>
          </div>
          <button type="button" class="gmf-editor-tabs__scroll-toggle" data-tabs-scroll-toggle aria-label="Afficher les onglets à droite" hidden>›</button>
          <span class="gmf-editor-tabs__arrow" data-editor-tab-arrow aria-hidden="true"></span>
        </nav>

        <div class="gmf-screen-body">
          <section class="gmf-editor-panel" data-editor-panel="info" data-panel-display="block">
            <form data-formation-form class="gmf-form gmf-info-form">
              <input type="hidden" name="id">
              <input type="hidden" name="coverImage">
              <input type="hidden" name="type" value="distanciel">
              <input type="hidden" name="trailerVideoTitle">
              <input type="hidden" name="trailerVideoUrl">
              <input type="hidden" name="whatsappGroupTitle">
              <input type="hidden" name="whatsappGroupUrl">
              <input type="hidden" name="status" value="draft">

              <div class="gmf-create-notice" data-editor-create-notice hidden>
                <div class="gmf-create-notice__icon" aria-hidden="true">
                  <i class="bi bi-info-circle"></i>
                </div>
                <div class="gmf-create-notice__content">
                  <p class="gmf-create-notice__title">Etapes suivantes apres creation</p>
                  <p class="gmf-create-notice__message" data-editor-create-notice-message></p>
                </div>
              </div>

              <div class="gmf-field">
                <label>Nom</label>
                <input class="gmf-minimal-input" name="name" type="text" required placeholder="Titre de la formation">
              </div>

              <div class="gmf-field gmf-field--with-action">
                <label>Description (preview)</label>
                <div class="gmf-editorial-preview" data-formation-description-preview>
                  <button type="button" class="gmf-editorial-trigger" data-action="open-editorial">
                    <i class="bi bi-pencil"></i>
                    Modifier
                  </button>
                  <div data-formation-description-preview-content>
                    <p class="module-placeholder">Aucune description editoriale pour le moment.</p>
                  </div>
                </div>
               
              </div>

              <div class="gmf-field">
                <label>Prix (EUR)</label>
                <input class="gmf-minimal-input" name="price" type="number" step="0.01" min="0" placeholder="0.00">
              </div>

              <div class="gmf-field">
                <label>Couverture</label>
                <input name="coverImageFile" type="file" accept="image/*" hidden>
                <p class="muted">JPG / PNG / WebP / GIF / AVIF max 5 Mo</p>
                <div data-cover-preview class="cover-preview gmf-cover-preview">
                  <div class="gmf-cover-empty">
                    <i class="bi bi-card-image"></i>
                    <p>Vous n’avez pas encore de couverture.</p>
                    <button type="button" class="gmf-compact-action" data-action="trigger-cover-upload">Uploader une image</button>
                  </div>
                </div>
                <p data-cover-upload-message class="form-message"></p>
              </div>

              <div class="gmf-field gmf-meta-block">
                <label>Bande annonce</label>
                <p class="muted">Cette video est visible par vos clients avant l achat : elle sert a donner envie.</p>
                <div data-trailer-content></div>
              </div>

              <div class="gmf-field gmf-meta-block">
                <label>Groupe WhatsApp</label>
                <p class="muted">Ajoutez un groupe WhatsApp pour les membres de cette formation afin de communiquer avec eux et suivre leur progression.</p>
                <div data-whatsapp-content></div>
              </div>

              <div class="gmf-field">
                <div class="gmf-field__label-row">
                  <label>Type</label>
                  <span class="gmf-chip" data-type-label>Distanciel</span>
                </div>
                <div class="type-toggle" data-type-toggle role="group" aria-label="Choisir le type de formation">
                  <button type="button" class="type-toggle__option is-active" data-type-option="distanciel" aria-pressed="true">
                    Distanciel
                  </button>
                  <button type="button" class="type-toggle__option" data-type-option="presentiel" aria-pressed="false">
                    Présentiel
                  </button>
                </div>
                <p class="form-message" data-type-lock-message hidden></p>
                <p class="muted">Changer de type peut réinitialiser modules distanciels ou sessions présentielles.</p>
              </div>

              <div class="gmf-grid-inline">
                <div class="gmf-field" data-presentiel-only hidden>
                  <label>Durée formation (jours)</label>
                  <input class="gmf-minimal-input" name="durationDays" type="number" min="1" step="1" value="1">
                </div>
                <div class="gmf-field" data-presentiel-only hidden>
                  <label>
                    <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
                    Delai de remboursement
                  </label>
                  <div class="session-capacity-widget" data-refund-days-widget data-refund-min="0">
                    <button
                      type="button"
                      class="session-capacity-widget__btn"
                      data-action="refund-days-decrement"
                      aria-label="Reduire le delai de remboursement"
                    >
                      <i class="bi bi-dash" aria-hidden="true"></i>
                    </button>
                    <span class="session-capacity-widget__value" data-refund-days-display>7</span>
                    <button
                      type="button"
                      class="session-capacity-widget__btn"
                      data-action="refund-days-increment"
                      aria-label="Augmenter le delai de remboursement"
                    >
                      <i class="bi bi-plus" aria-hidden="true"></i>
                    </button>
                    <input type="hidden" name="refundDays" value="7" data-refund-days-input>
                  </div>
                  <p class="muted">jours avant la session</p>
                  <p class="muted" data-refund-days-tooltip></p>
                </div>
                <div class="gmf-field">
                  <label>Statut</label>
                  <button type="button" class="gmf-status-picker" data-action="toggle-status-picker" data-status-picker-trigger aria-haspopup="listbox" aria-expanded="false">
                    <span data-status-picker-label>Brouillon</span>
                    <i class="bi bi-chevron-down"></i>
                  </button>
                  <div class="gmf-status-picker-menu" data-status-picker-menu role="listbox" hidden>
                    ${STATUS_OPTIONS.map(option => `
                      <button type="button" class="gmf-status-option" data-action="choose-status-option" data-status-option data-value="${option.value}" role="option">
                        <i class="bi ${option.value === 'published' ? 'bi-check-circle' : option.value === 'disabled' ? 'bi-slash-circle' : 'bi-pencil-square'}"></i>
                        <span>${option.label}</span>
                      </button>
                    `).join('')}
                  </div>
                </div>
              </div>

              <div class="gmf-field" data-presentiel-only hidden>
                <label>Formalités (présentiel)</label>
                <textarea
                  class="gmf-minimal-input gmf-minimal-textarea"
                  name="formalities"
                  rows="3"
                  placeholder="Piece d'identite, documents, horaires..."
                ></textarea>
              </div>

              <div class="form-actions">
                <button class="primary-button" type="submit">Sauvegarder</button>
                <button type="button" class="secondary-button" data-action="reset-formation">Réinitialiser</button>
              </div>
            </form>
            <p data-formation-form-message class="form-message"></p>
          </section>

          <section class="gmf-editor-panel hidden" data-editor-panel="promotion" data-panel-display="block" hidden>
            <div class="gmf-placeholder-panel gmf-promotion-panel">
              <h4>Promotion de la formation</h4>
              <p data-formation-promotion-status class="form-message muted">Aucune promotion active.</p>
              <div data-formation-promotion-current>
                <article class="gmf-promotion-card gmf-promotion-card--empty">
                  <div class="gmf-promotion-empty-state">
                    <i class="bi bi-percent" aria-hidden="true"></i>
                    <p>Aucune promotion active pour cette formation.</p>
                    <button type="button" class="primary-button" data-action="open-formation-promotion-modal">
                      Appliquer une promotion
                    </button>
                  </div>
                </article>
              </div>
              <p data-formation-promotion-message class="form-message"></p>
            </div>
          </section>

          <section class="gmf-editor-panel hidden" data-editor-panel="boost" data-panel-display="block" hidden>
            <div class="gmf-placeholder-panel gmf-boost-panel">
              <div class="gmf-boost-panel__header">
                <h4>Les formations boostees</h4>
                <span class="gmf-boost-status-badge" data-formation-boost-badge data-active="false">NON BOOSTEE</span>
              </div>
              <p data-formation-boost-status class="form-message muted">
                Cette formation n est pas boostee. Vous pouvez la mettre en avant dans le top boost.
              </p>
              <p class="muted" data-formation-boost-count>Slots boost occupes : 0/3</p>
              <div data-formation-boosted-list class="data-list gmf-boost-list">
                <p class="module-placeholder">Chargement des boosts...</p>
              </div>
              <div class="form-actions gmf-boost-actions">
                <button
                  type="button"
                  class="gmf-compact-action"
                  data-action="toggle-formation-boost"
                  data-requires-id
                >
                  <i class="bi bi-lightning-charge"></i>
                  Booster la formation
                </button>
              </div>
              <p data-formation-boost-message class="form-message"></p>
            </div>
          </section>

          <section class="gmf-editor-panel hidden" data-editor-panel="modules" data-panel-display="block" hidden>
            <section class="manager-section gmf-modules-workspace" data-module-workspace>
              <div class="gmf-modules-list-view" data-module-panel="modulesList" data-panel-display="block">
                <div class="gmf-modules-toolbar">
                  <button type="button" class="primary-button" data-action="open-module-create" data-disable-while-module-order>
                    Créer un module
                  </button>
                  <button type="button" class="secondary-button" data-action="toggle-module-order">
                    Changer l ordre
                  </button>
                </div>
                <div class="gestion-order-actions gmf-module-order-actions" data-module-order-actions hidden>
                  <button type="button" class="primary-button" data-action="save-module-order">Enregistrer l ordre</button>
                  <button type="button" class="secondary-button" data-action="cancel-module-order">Annuler</button>
                </div>
                <div data-module-list class="data-list gmf-modules-list">
                  <p class="module-placeholder">Sélectionnez une formation distancielle pour afficher les modules.</p>
                </div>
              </div>

              <div class="gmf-modules-editor-view hidden" data-module-panel="moduleEditor" data-panel-display="block" hidden>
                <header class="gmf-modules-editor-header">
                  <button type="button" class="ghost-button" data-action="back-to-module-list">
                    <i class="bi bi-arrow-left"></i>
                    Retour aux modules
                  </button>
                  <h4 data-module-editor-title>Créer un module</h4>
                </header>
                <form data-module-form class="manager-form gmf-module-editor-form">
                  <input name="moduleFilesUpload" type="file" multiple hidden>

                  <nav class="gmf-module-editor-tabs" data-module-editor-root>
                    <div class="gmf-editor-tabs__track gmf-module-editor-tabs__track" data-module-editor-tabs-track role="tablist" aria-label="Sections du module">
                      <button type="button" class="gmf-editor-tab is-active" data-module-editor-tab="info" role="tab" aria-selected="true">
                        <span class="gmf-editor-tab__icon"><i class="bi bi-card-text"></i></span>
                        <span class="gmf-editor-tab__label">Informations</span>
                      </button>
                      <button type="button" class="gmf-editor-tab" data-module-editor-tab="videos" role="tab" aria-selected="false">
                        <span class="gmf-editor-tab__icon"><i class="bi bi-camera-video"></i></span>
                        <span class="gmf-editor-tab__label">Videos</span>
                      </button>
                      <button type="button" class="gmf-editor-tab" data-module-editor-tab="files" role="tab" aria-selected="false">
                        <span class="gmf-editor-tab__icon"><i class="bi bi-paperclip"></i></span>
                        <span class="gmf-editor-tab__label">Fichiers</span>
                      </button>
                    </div>
                    <button type="button" class="gmf-editor-tabs__scroll-toggle" data-tabs-scroll-toggle aria-label="Afficher les onglets à droite" hidden>›</button>
                    <span class="gmf-editor-tabs__arrow" data-module-editor-tab-arrow aria-hidden="true"></span>
                  </nav>

                  <section class="gmf-module-editor-panel" data-module-editor-panel="info" data-panel-display="block">
                    <div class="gmf-field">
                      <label>Titre du module</label>
                      <input name="moduleTitle" type="text" required placeholder="Titre du module">
                    </div>
                    <div class="gmf-field gmf-field--with-action">
                      <label>Description (preview)</label>
                      <div class="gmf-editorial-preview" data-module-description-preview>
                        <button type="button" class="gmf-editorial-trigger" data-action="open-module-description-editorial">
                          <i class="bi bi-pencil"></i>
                          Modifier
                        </button>
                        <div data-module-description-preview-content>
                          <p class="module-placeholder">Aucune description editoriale pour le moment.</p>
                        </div>
                      </div>
                      <p class="muted">La description du module est geree via l editorial.</p>
                    </div>
                  </section>

                  <section class="gmf-module-editor-panel hidden" data-module-editor-panel="videos" data-panel-display="block" hidden>
                    <div class="gmf-modules-toolbar">
                      <p class="muted">Ajoutez plusieurs videos pedagogiques pour ce module.</p>
                      <div class="gmf-modules-toolbar__actions">
                        <button type="button" class="gmf-compact-action" data-action="add-module-video">
                          <i class="bi bi-camera-video"></i>
                          Ajouter une video
                        </button>
                        <button type="button" class="secondary-button" data-action="toggle-module-video-order">
                          Changer l ordre
                        </button>
                      </div>
                    </div>
                    <div class="gestion-order-actions gmf-module-order-actions" data-module-video-order-actions hidden>
                      <button type="button" class="primary-button" data-action="save-module-video-order">Enregistrer l ordre</button>
                      <button type="button" class="secondary-button" data-action="cancel-module-video-order">Annuler</button>
                    </div>
                    <div data-module-video-view="list" data-panel-display="block">
                      <div data-module-videos-list class="data-list gmf-module-videos-list">
                        <p class="module-placeholder">Aucune vidéo ajoutée pour ce module.</p>
                      </div>
                    </div>
                    <div class="hidden gmf-module-video-editor" data-module-video-view="editor" data-panel-display="block" data-module-video-editor hidden>
                      <header class="gmf-video-editor-header">
                        <button type="button" class="ghost-button" data-action="back-to-video-list">
                          <i class="bi bi-arrow-left"></i>
                          Retour aux videos
                        </button>
                        <h5 data-module-video-editor-title>Ajouter une video</h5>
                      </header>
                      <div class="gmf-field">
                        <label>Titre</label>
                        <input
                          type="text"
                          class="gmf-minimal-input"
                          placeholder="Titre de la video"
                          data-module-video-editor-title-input
                        >
                      </div>
                      <div class="gmf-field">
                        <div class="gmf-field__label-row">
                          <label>URL video</label>
                          <button
                            type="button"
                            class="gmf-video-info-button"
                            data-action="open-module-video-info"
                            aria-label="Informations integration video"
                          >
                            <i class="bi bi-info-circle"></i>
                          </button>
                        </div>
                        <div class="gmf-input-with-icon">
                          <i class="bi bi-camera-video"></i>
                          <input
                            type="url"
                            placeholder="https://youtube.com/... ou iframe"
                            data-module-video-editor-url
                          >
                          <i class="bi bi-link-45deg"></i>
                        </div>
                      </div>
                      <div class="gmf-field gmf-field--with-action">
                        <label>Description (preview)</label>
                        <div class="gmf-editorial-preview" data-module-video-description-preview>
                          <button type="button" class="gmf-editorial-trigger" data-action="open-video-editorial">
                            <i class="bi bi-pencil"></i>
                            Modifier
                          </button>
                          <div data-module-video-description-preview-content>
                            <p class="module-placeholder">Aucune description editoriale video.</p>
                          </div>
                        </div>
                      </div>
                      <div class="form-actions">
                        <button type="button" class="primary-button" data-action="save-module-video-editor">Enregistrer</button>
                        <button type="button" class="secondary-button" data-action="cancel-module-video-editor">Annuler</button>
                      </div>
                    </div>
                    <div
                      class="gmf-module-video-info-overlay hidden"
                      data-module-video-info-overlay
                      data-panel-display="block"
                      tabindex="-1"
                      hidden
                    >
                      <div class="gmf-module-video-info-card" data-module-video-info-card>
                        <button type="button" class="gmf-module-video-info-close" data-action="close-module-video-info" aria-label="Fermer">
                          <i class="bi bi-x-lg"></i>
                        </button>
                        <p>
                          Cette video sera integrée directement sur le site (lecture dans la page). Vos clients n'auront pas besoin de cliquer sur un lien.
                        </p>
                      </div>
                    </div>
                  </section>

                  <section class="gmf-module-editor-panel hidden" data-module-editor-panel="files" data-panel-display="block" hidden>
                    <p class="muted">Ces fichiers seront accessibles aux clients comme ressources annexes.</p>
                    <div class="gmf-modules-toolbar">
                      <button type="button" class="gmf-compact-action" data-action="trigger-module-files-upload">
                        <i class="bi bi-upload"></i>
                        Ajouter des fichiers
                      </button>
                      <button type="button" class="secondary-button" data-action="toggle-module-file-order">
                        Changer l ordre
                      </button>
                    </div>
                    <div class="gestion-order-actions gmf-module-order-actions" data-module-file-order-actions hidden>
                      <button type="button" class="primary-button" data-action="save-module-file-order">Enregistrer l ordre</button>
                      <button type="button" class="secondary-button" data-action="cancel-module-file-order">Annuler</button>
                    </div>
                    <div data-module-files-list class="data-list gmf-module-files-list">
                      <p class="module-placeholder">Aucun fichier annexe enregistre.</p>
                    </div>
                  </section>

                  <div class="form-actions">
                    <button class="primary-button" type="submit">Enregistrer</button>
                    <button type="button" class="secondary-button" data-action="cancel-module-editor">Annuler</button>
                    <button type="button" class="danger-button" data-action="delete-module-inline" hidden>Supprimer</button>
                  </div>
                </form>
              </div>
              <p data-module-form-message class="form-message"></p>
            </section>
          </section>

          <section class="gmf-editor-panel hidden" data-editor-panel="planning" data-panel-display="block" hidden>
            <section class="manager-section gmf-planning-editor" data-planning-tabs-root>
              <nav class="gmf-editor-tabs gmf-planning-tabs" data-planning-tabs>
                <div class="gmf-editor-tabs__track gmf-planning-tabs__track" data-planning-tabs-track role="tablist" aria-label="Planning sessions">
                  <button type="button" class="gmf-editor-tab is-active" data-planning-tab="calendar" role="tab" aria-selected="true">
                    <span class="gmf-editor-tab__icon"><i class="bi bi-calendar-event"></i></span>
                    <span class="gmf-editor-tab__label">Calendrier global</span>
                  </button>
                  <button type="button" class="gmf-editor-tab" data-planning-tab="sessions" role="tab" aria-selected="false">
                    <span class="gmf-editor-tab__icon"><i class="bi bi-card-list"></i></span>
                    <span class="gmf-editor-tab__label">Sessions planifiees</span>
                  </button>
                  <button type="button" class="gmf-editor-tab" data-planning-tab="canceled" role="tab" aria-selected="false">
                    <span class="gmf-editor-tab__icon"><i class="bi bi-x-circle"></i></span>
                    <span class="gmf-editor-tab__label">Sessions annulées</span>
                  </button>
                </div>
                <button type="button" class="gmf-editor-tabs__scroll-toggle" data-tabs-scroll-toggle aria-label="Afficher les onglets à droite" hidden>›</button>
                <span class="gmf-editor-tabs__arrow" data-planning-tab-arrow aria-hidden="true"></span>
              </nav>

              <div class="gmf-planning-body">
                <section class="gmf-planning-panel" data-planning-panel="calendar" data-panel-display="block">
                  <form data-session-form class="manager-form">
                    <div data-session-calendar class="session-calendar">
                      <div class="session-calendar__header">
                        <button type="button" class="calendar-nav-button" data-calendar-action="prev" aria-label="Mois precedent">‹</button>
                        <div class="session-calendar__title">
                          <p data-calendar-month-label></p>
                          <p class="muted" data-calendar-selected-count>Aucune date selectionnee</p>
                        </div>
                        <button type="button" class="calendar-nav-button" data-calendar-action="next" aria-label="Mois suivant">›</button>
                      </div>
                      <p class="muted session-calendar__hint">Cliquez sur les dates libres pour planifier une session. Les dates déjà occupées ouvrent le détail de session.</p>
                      <div class="calendar-grid">
                        <div class="calendar-weekdays">
                          ${WEEKDAY_LABELS.map(day => `<span>${day}</span>`).join('')}
                        </div>
                        <div data-calendar-grid class="calendar-days"></div>
                      </div>
                    </div>
                    <div data-session-create-modal class="module-modal-overlay" tabindex="-1" hidden>
                      <div class="module-modal" role="dialog" aria-modal="true" aria-label="Definir les horaires de session">
                        <header class="module-modal__header">
                          <h3>Nouvelle session</h3>
                          <button
                            type="button"
                            class="module-modal__close"
                            data-action="close-session-create-modal"
                            aria-label="Fermer"
                          >
                            &times;
                          </button>
                        </header>
                        <p class="muted" data-session-duration>Durée : 1 jour</p>
                        <div data-session-schedule class="schedule-fields">
                          <p class="module-placeholder">Definissez les horaires pour chaque journee.</p>
                        </div>
                        <div class="session-capacity-field">
                          <p class="session-capacity-field__label">Capacité maximale</p>
                          <div class="session-capacity-widget" data-capacity-widget data-capacity-min="1">
                            <button type="button" class="session-capacity-widget__btn" data-action="capacity-decrement" aria-label="Réduire la capacité" disabled>
                              <i class="bi bi-dash" aria-hidden="true"></i>
                            </button>
                            <span class="session-capacity-widget__value" data-capacity-display>1</span>
                            <button type="button" class="session-capacity-widget__btn" data-action="capacity-increment" aria-label="Augmenter la capacité">
                              <i class="bi bi-plus" aria-hidden="true"></i>
                            </button>
                            <input type="hidden" name="sessionCapacity" value="1" data-capacity-input>
                          </div>
                        </div>
                        <div class="form-actions">
                          <button class="primary-button" type="submit">Ajouter la session</button>
                          <button type="button" class="secondary-button" data-action="reset-session">Réinitialiser</button>
                        </div>
                      </div>
                    </div>
                  </form>
                  <p data-session-form-message class="form-message"></p>
                </section>

                <section class="gmf-planning-panel hidden" data-planning-panel="sessions" data-panel-display="block" hidden>
                  <div class="gmf-planning-sessions-view" data-planning-sessions-list data-panel-display="block">
                    <div data-session-list class="data-list gmf-planning-sessions-list">
                      <p class="module-placeholder">Aucune session planifiee pour cette formation.</p>
                    </div>
                    <p data-planning-session-message class="form-message"></p>
                  </div>
                  <div class="gmf-planning-sessions-detail hidden" data-planning-sessions-detail data-panel-display="block" hidden>
                    <div data-planning-session-detail-content class="data-list">
                      <p class="module-placeholder">Sélectionnez une session pour la modifier.</p>
                    </div>
                    <p data-planning-session-detail-feedback class="form-message"></p>
                  </div>
                </section>

                <section class="gmf-planning-panel hidden" data-planning-panel="canceled" data-panel-display="block" hidden>
                  <div data-canceled-session-list class="data-list">
                    <p class="module-placeholder">Aucune session annulée pour cette formation.</p>
                  </div>
                </section>
              </div>
            </section>
          </section>
          <section class="gmf-editor-panel gmf-options-panel hidden" data-editor-panel="options" data-panel-display="block" hidden>
            <div class="manager-section">
              <div class="gmf-section-header">
                <p class="manager-section__title">Options payantes</p>
                <button type="button" class="primary-button" data-action="add-option">
                  <i class="bi bi-plus"></i> Ajouter une option
                </button>
              </div>
              <div data-options-list>
                <p class="module-placeholder">Aucune option pour l'instant.</p>
              </div>
            </div>
          </section>
        </div>
      </section>
      </section>

      <section class="gmf-catalog-panel hidden" data-catalog-panel="history" data-panel-display="block" hidden>
        <div class="gmf-history-toolbar">
          <div>
            <p class="gmf-kicker">Historique</p>
            <h3>Formations supprimées</h3>
          </div>
          <button type="button" class="secondary-button" data-action="reload-deleted-history">
            Actualiser
          </button>
        </div>
        <div data-formation-deleted-history class="gmf-history-grid">
          <p class="module-placeholder">Chargement de l historique...</p>
        </div>
      </section>
      </div>

      <div data-formation-promotion-modal class="module-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal" role="dialog" aria-modal="true" aria-label="Gestion promotion formation">
          <header class="module-modal__header">
            <h3>Promotion formation</h3>
            <button
              type="button"
              class="module-modal__close"
              data-action="close-formation-promotion-modal"
              aria-label="Fermer"
            >
              &times;
            </button>
          </header>
          <div class="modal-promotion-price">
            <p class="muted" data-formation-promotion-modal-preview-base>Prix actuel : <s>--</s></p>
            <p class="promotion-final-price" data-formation-promotion-modal-preview-final>Prix apres reduction : --</p>
          </div>
          <form data-formation-promotion-form class="manager-form">
            <label>
              Type de remise
              <select name="discountType">
                <option value="percentage">Pourcentage</option>
                <option value="fixed">Montant fixe</option>
              </select>
            </label>
            <label>
              Valeur
              <input name="discountValue" type="number" min="0" step="0.01" placeholder="Ex : 15">
            </label>
            <div class="form-actions">
              <label class="radio-field">
                <input type="radio" name="promotionMode" value="immediate" checked>
                Immediate
              </label>
              <label class="radio-field">
                <input type="radio" name="promotionMode" value="limited">
                Date de fin
              </label>
              <label class="radio-field">
                <input type="radio" name="promotionMode" value="scheduled">
                Date de début
              </label>
            </div>
            <label data-formation-promotion-field="scheduled">
              Date de début
              <input name="startAt" type="datetime-local">
            </label>
            <label data-formation-promotion-field="limited scheduled">
              Date de fin
              <input name="endAt" type="datetime-local">
            </label>
            <div class="form-actions">
              <button class="primary-button" type="submit">Enregistrer la promotion</button>
            </div>
          </form>
        </div>
      </div>

      <div data-formation-boost-modal class="module-modal-overlay gmf-mini-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal gmf-boost-replace-modal" role="dialog" aria-modal="true" aria-label="Remplacer une formation boostee">
          <header class="module-modal__header">
            <h3>Choisir une formation a remplacer</h3>
            <button
              type="button"
              class="module-modal__close"
              data-action="close-formation-boost-modal"
              aria-label="Fermer"
            >
              &times;
            </button>
          </header>
          <p class="muted">3 slots de boost sont déjà occupés. Sélectionnez un élément à remplacer.</p>
          <div data-formation-boost-modal-list class="data-list gmf-boost-replace-list">
            <p class="module-placeholder">Chargement des boosts...</p>
          </div>
          <p data-formation-boost-modal-message class="form-message"></p>
          <div class="form-actions">
            <button type="button" class="gmf-modal-cancel" data-action="close-formation-boost-modal">Annuler</button>
            <button type="button" class="gmf-modal-save" data-action="confirm-replace-formation-boost">
              Remplacer
            </button>
          </div>
        </div>
      </div>

      <div data-session-detail-modal class="module-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-session-detail-modal" role="dialog" aria-modal="true">
          <header class="module-modal__header">
            <h3>Detail session</h3>
            <button
              type="button"
              class="module-modal__close"
              data-action="close-session-detail-modal"
              aria-label="Fermer"
            >
              &times;
            </button>
          </header>
          <div data-session-detail-content class="data-list">
            <p class="module-placeholder">Sélectionnez une session.</p>
          </div>
          <p data-session-detail-feedback class="form-message"></p>
        </div>
      </div>

      <div data-session-conflict-modal class="module-modal-overlay gmf-mini-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal gmf-session-conflict-modal" role="dialog" aria-modal="true" aria-label="Conflit horaire">
          <header class="module-modal__header">
            <h3><i class="bi bi-exclamation-triangle"></i> Conflit horaire</h3>
            <button type="button" class="module-modal__close" data-action="close-session-conflict-modal" aria-label="Fermer">&times;</button>
          </header>
          <p data-session-conflict-message>Ce créneau est déjà indisponible.</p>
          <div class="form-actions">
            <button type="button" class="gmf-modal-save" data-action="close-session-conflict-modal">OK</button>
          </div>
        </div>
      </div>

      <div data-file-rename-modal class="module-modal-overlay gmf-mini-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal" role="dialog" aria-modal="true" aria-label="Renommer le fichier">
          <header class="module-modal__header">
            <h3>Renommer le fichier</h3>
            <button type="button" class="module-modal__close" data-action="cancel-file-rename" aria-label="Fermer">&times;</button>
          </header>
          <label>
            Titre du fichier
            <input type="text" class="gmf-minimal-input" data-file-rename-input>
          </label>
          <div class="form-actions">
            <button type="button" class="gmf-modal-save" data-action="save-file-rename">Enregistrer</button>
            <button type="button" class="gmf-modal-cancel" data-action="cancel-file-rename">Annuler</button>
          </div>
        </div>
      </div>

      <div data-trailer-modal class="module-modal-overlay gmf-mini-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal" role="dialog" aria-modal="true" aria-label="Bande annonce">
          <header class="module-modal__header">
            <h3 data-trailer-modal-heading>Ajouter une bande-annonce</h3>
            <button type="button" class="module-modal__close" data-action="cancel-trailer-modal" aria-label="Fermer">&times;</button>
          </header>
          <label>
            Titre de la bande-annonce
            <input type="text" class="gmf-minimal-input" name="trailerModalTitle" placeholder="Ex: Introduction formation">
          </label>
          <label>
            URL (iframe)
            <input type="url" class="gmf-minimal-input" name="trailerModalUrl" placeholder="https://...">
          </label>
          <div class="form-actions">
            <button type="button" class="primary-button" data-action="save-trailer-modal">Enregistrer</button>
            <button type="button" class="secondary-button" data-action="cancel-trailer-modal">Annuler</button>
          </div>
        </div>
      </div>

      <div data-whatsapp-modal class="module-modal-overlay gmf-mini-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal" role="dialog" aria-modal="true" aria-label="Groupe WhatsApp">
          <header class="module-modal__header">
            <h3 data-whatsapp-modal-heading>Ajouter un groupe WhatsApp</h3>
            <button type="button" class="module-modal__close" data-action="cancel-whatsapp-modal" aria-label="Fermer">&times;</button>
          </header>
          <label>
            Titre du groupe
            <input type="text" class="gmf-minimal-input" name="whatsappModalTitle" placeholder="Ex: Cohorte Janvier">
          </label>
          <label>
            Lien WhatsApp
            <input type="url" class="gmf-minimal-input" name="whatsappModalUrl" placeholder="https://chat.whatsapp.com/...">
          </label>
          <div class="form-actions">
            <button type="button" class="primary-button" data-action="save-whatsapp-modal">Enregistrer</button>
            <button type="button" class="secondary-button" data-action="cancel-whatsapp-modal">Annuler</button>
          </div>
        </div>
      </div>

      <div data-deleted-history-clients-modal class="module-modal-overlay gmf-mini-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal gmf-history-clients-modal" role="dialog" aria-modal="true" aria-label="Clients formation supprimée">
          <header class="module-modal__header">
            <h3 data-deleted-history-clients-title>Clients de la formation</h3>
            <button
              type="button"
              class="module-modal__close"
              data-action="close-deleted-history-clients-modal"
              aria-label="Fermer"
            >
              &times;
            </button>
          </header>
          <div data-deleted-history-clients-body>
            <p class="module-placeholder">Aucun client enregistre pour cette suppression.</p>
          </div>
          <div class="form-actions">
            <button type="button" class="secondary-button" data-action="close-deleted-history-clients-modal">Fermer</button>
          </div>
        </div>
      </div>

      <div data-option-modal class="module-modal-overlay gmf-mini-modal-overlay gmf-option-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal gmf-mini-modal gmf-option-modal" role="dialog" aria-modal="true" aria-label="Option payante">
          <header class="module-modal__header gmf-option-modal__header">
            <h3 data-option-modal-heading>Ajouter une option</h3>
            <button type="button" class="module-modal__close" data-action="cancel-option" aria-label="Fermer">&times;</button>
          </header>
          <div class="gmf-option-modal__body">
            <form data-option-form class="gmf-option-modal__form">
              <input type="hidden" name="optionId">
              <label class="gmf-option-form-field">
                Nom de l'option <span class="required">*</span>
                <input type="text" class="gmf-minimal-input" name="optionName" placeholder="Ex: Kit de démarrage" required>
              </label>
              <label class="gmf-option-form-field">
                Description
                <textarea class="gmf-minimal-input gmf-option-description-input" name="optionDescription" rows="2" placeholder="Description courte..."></textarea>
              </label>
              <label class="gmf-option-form-field">
                Prix (€) <span class="required">*</span>
                <input type="number" class="gmf-minimal-input" name="optionPrice" min="0" step="0.01" placeholder="0.00" required>
              </label>
              <label class="gmf-option-form-field">
                Délai minimum avant la session (jours) <span class="required">*</span>
                <input type="number" class="gmf-minimal-input" name="optionDeadlineDays" min="0" step="1" placeholder="0" required>
              </label>
              <div class="gmf-option-image-field">
                <label class="gmf-option-form-label">Image (optionnel)</label>
                <input type="file" name="optionImage" accept="image/*" hidden>
                <div class="gmf-option-image-actions">
                  <button type="button" class="gmf-compact-action" data-action="add-option-image">Ajouter une image</button>
                  <button type="button" class="gmf-compact-action" data-action="edit-option-image" hidden>Modifier l'image</button>
                  <button type="button" class="danger-button" data-action="delete-option-image" hidden>Supprimer l'image</button>
                </div>
                <div class="gmf-option-image-preview-wrap" data-option-image-preview-wrap hidden>
                  <img data-option-image-preview src="" alt="Aperçu de l'image de l'option">
                </div>
              </div>
            </form>
            <div data-option-form-message class="form-message gmf-option-modal__message"></div>
          </div>
          <div class="form-actions gmf-option-modal__actions">
            <button type="button" class="primary-button" data-action="save-option">Enregistrer</button>
            <button type="button" class="secondary-button" data-action="cancel-option">Annuler</button>
          </div>
        </div>
      </div>

      <div data-type-warning-modal class="module-modal-overlay" tabindex="-1" hidden>
        <div class="module-modal" role="dialog" aria-modal="true">
          <header class="module-modal__header">
            <h3>Attention</h3>
            <button type="button" class="module-modal__close" data-action="cancel-type-warning" aria-label="Fermer">
              &times;
            </button>
          </header>
          <p data-type-warning-text class="muted">
            Attention : si vous changez le type, les donnees actuelles seront perdues.
          </p>
          <div class="form-actions">
            <button type="button" class="secondary-button" data-action="cancel-type-warning">Annuler</button>
            <button type="button" class="primary-button" data-action="confirm-type-warning">Changer et reinitialiser</button>
          </div>
        </div>
      </div>
    </div>
  `;
  setView(VIEW_LIST, container);
  attachViewSwitchEvents(container);
  attachCatalogTabEvents(container);
  attachDashboardEvents(container);
  attachEditorTabEvents(container);
  attachPlanningTabEvents(container);
  attachFormEvents(container);
  attachCoverUploader(container);
  attachFormationMiniModalEvents(container);
  attachFormationPromotionFormEvents(container);
  attachFormationBoostEvents(container);
  attachOptionsEvents(container);
  attachModuleEvents(container);
  attachSessionEvents(container);
  attachTypeToggleEvents(container);
  renderFormationInfoWidgets();
  showCoverUploadFeedback('', '');
  resetForm();
  resetModuleForm();
  resetSessionForm();
  backToListView();
  setPlanningSessionView('list');
  setPlanningTab(PLANNING_TAB_CALENDAR, container);
  updateSecondaryActionsState(container);
  syncTypeManagedSections(container);
  await Promise.all([fetchFormations(), loadBoosts(container)]);
  state.catalogTab = CATALOG_TAB_MAIN;
  setCatalogTab(state.catalogTab, container);
  window.setTimeout(() => {
    setView(state.view, container);
    setCatalogTab(state.catalogTab, container);
    debugPanelStates(container, 'post-render-timeout');
  }, 0);
}


