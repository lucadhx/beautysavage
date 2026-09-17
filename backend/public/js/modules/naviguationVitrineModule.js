import { setActionButtonState } from '../helpers/actionButtonState.js';
import { showToast } from '../helpers/toastService.js';
import { logUiError } from '../helpers/uiLogger.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const API_ROOT = '/api/gestion/vitrine';
const PAGES_ENDPOINT = `${API_ROOT}/pages`;
const ORDER_ENDPOINT = `${API_ROOT}/pages/order`;
const MIN_LOADER_MS = 500;
const MODAL_DELAY_MS = 180;

const state = {
  pages: [],
  knownModules: new Map(),
  moduleCache: new Map(),
  orderMode: false,
  draftOrderIds: [],
  openKebabId: null,
  drag: { sourceId: null, targetId: null, after: false, indicator: null }
};

let root = null;
let aborter = null;

const esc = value =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const getJson = async response => (response?.json ? response.json().catch(() => ({})) : {});

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', ...options });
  const payload = await getJson(response);
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Requete impossible.');
  return payload || {};
}

const loader = (label = 'Chargement...') => `
  <div class="gcg-inline-loader" role="status" aria-live="polite">
    <div class="gcg-inline-loader__paws" aria-hidden="true">
      <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
      <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
      <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
    </div>
    <p class="gcg-inline-loader__label">${esc(label)}</p>
  </div>
`;

const listNode = () => root?.querySelector('[data-vmm-list]') || null;
const pageById = id => state.pages.find(page => page.id === id) || null;

const parseModuleBase = moduleFile =>
  String(moduleFile || '')
    .trim()
    .replace(/^\/?js\/modules\//i, '')
    .replace(/\.js$/i, '')
    .replace(/module$/i, '')
    .trim();

function normalizeModuleInput(raw) {
  const value = String(raw || '')
    .trim()
    .replace(/^\/?js\/modules\//i, '')
    .replace(/\.js$/i, '')
    .replace(/module$/i, '');
  if (!/^[A-Za-z0-9-]+$/.test(value)) return null;
  const fromKnown = state.knownModules.get(value.toLowerCase());
  const moduleName = fromKnown || value;
  return { moduleName, moduleFile: `${moduleName}Module.js` };
}

async function validateModule(raw) {
  const normalized = normalizeModuleInput(raw);
  if (!normalized) return { ok: false, error: 'Module invalide. Exemple: shop ou shopModule.js.' };
  const cacheKey = normalized.moduleFile.toLowerCase();
  if (state.moduleCache.has(cacheKey)) return state.moduleCache.get(cacheKey);
  let exists = false;
  try {
    const probe = await fetch(`/js/modules/${encodeURIComponent(normalized.moduleFile)}`, {
      method: 'HEAD',
      credentials: 'include'
    });
    exists = probe.ok;
  } catch (_error) {
    exists = false;
  }
  const result = exists
    ? { ok: true, moduleFile: normalized.moduleFile }
    : { ok: false, error: `Le module ${normalized.moduleFile} est introuvable.` };
  state.moduleCache.set(cacheKey, result);
  return result;
}

const titleFromSlug = slug =>
  String(slug || '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ') || 'Page';

const slugify = title =>
  String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const orderedPages = () =>
  [...state.pages].sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.slug).localeCompare(String(b.slug)));

function displayedPages() {
  const pages = orderedPages();
  if (!state.orderMode) return pages;
  const map = new Map(pages.map(page => [page.id, page]));
  const visible = state.draftOrderIds.map(id => map.get(id)).filter(Boolean);
  const seen = new Set(visible.map(page => page.id));
  pages.forEach(page => {
    if (!seen.has(page.id)) visible.push(page);
  });
  return visible;
}

function setKnownModules() {
  const next = new Map();
  state.pages.forEach(page => {
    const base = parseModuleBase(page.moduleFile);
    if (base) next.set(base.toLowerCase(), base);
  });
  state.knownModules = next;
}

function syncOrderMode(enabled) {
  state.orderMode = Boolean(enabled);
  state.openKebabId = null;
  state.draftOrderIds = state.orderMode ? orderedPages().map(page => page.id) : [];
  clearDrag();
  const wrap = root?.querySelector('[data-vmm-order-actions]');
  const toggle = root?.querySelector('[data-action="toggle-order"]');
  const moduleRoot = root?.querySelector('[data-vmm-module]');
  if (wrap) wrap.hidden = !state.orderMode;
  if (toggle) {
    const text = state.orderMode ? 'Quitter le mode ordre' : "Changer l'ordre";
    toggle.innerHTML = `<i class="bi bi-arrow-left-right"></i><span>${text}</span>`;
  }
  if (moduleRoot) moduleRoot.classList.toggle('is-order-mode', state.orderMode);
  renderList();
}

function applyKebab() {
  root?.querySelectorAll('[data-kebab-id]').forEach(button => {
    const isOpen = !state.orderMode && button.dataset.kebabId === state.openKebabId;
    const menu = button.parentElement?.querySelector('.gestion-kebab-menu');
    if (menu) menu.classList.toggle('is-open', isOpen);
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

function renderCard(page, index, total) {
  const placement = page.navigationPlacement === 'header' ? 'Header' : page.navigationPlacement === 'burger' ? 'Burger' : 'Non affichée';
  return `
    <article class="data-item vmm-page-card ${state.orderMode ? 'is-ordering' : ''}" data-page-id="${esc(page.id)}" ${state.orderMode ? 'draggable="true"' : ''}>
      <div class="vmm-page-card__main">
        <span class="vmm-drag-handle"><i class="bi bi-grip-vertical"></i></span>
        <div class="vmm-page-card__content">
          <div class="vmm-page-card__topline"><strong>${esc(titleFromSlug(page.slug))}</strong><span class="vmm-badge">Ordre ${index + 1}</span></div>
          <p class="vmm-page-card__meta">Slug: <code>${esc(page.slug)}</code></p>
          <p class="vmm-page-card__meta">Module: <code>${esc(parseModuleBase(page.moduleFile) || page.moduleFile)}</code></p>
          <div class="vmm-badges"><span class="vmm-badge vmm-badge--placement">${esc(placement)}</span></div>
        </div>
      </div>
      <div class="vmm-page-card__actions">
        ${
          state.orderMode
            ? `<button type="button" class="gestion-icon-action" data-action="move-up" data-page-id="${esc(page.id)}" ${index === 0 ? 'disabled' : ''}><i class="bi bi-chevron-up"></i></button>
               <button type="button" class="gestion-icon-action" data-action="move-down" data-page-id="${esc(page.id)}" ${index === total - 1 ? 'disabled' : ''}><i class="bi bi-chevron-down"></i></button>`
            : `<div class="gestion-kebab">
                 <button type="button" class="gestion-icon-button" data-action="toggle-kebab" data-kebab-id="${esc(page.id)}" aria-expanded="false"><i class="bi bi-three-dots-vertical"></i></button>
                 <div class="gestion-kebab-menu">
                   <button type="button" class="gestion-icon-action" data-action="edit-page" data-page-id="${esc(page.id)}"><i class="bi bi-pencil"></i></button>
                   <button type="button" class="gestion-icon-action danger" data-action="delete-page" data-page-id="${esc(page.id)}"><i class="bi bi-trash"></i></button>
                 </div>
               </div>`
        }
      </div>
    </article>
  `;
}

function renderList() {
  const list = listNode();
  if (!list) return;
  const pages = displayedPages();
  if (!pages.length) {
    list.innerHTML = `<div class="gcg-empty-state"><i class="bi bi-layout-text-window"></i><p>Aucune page vitrine.</p></div>`;
    return;
  }
  list.innerHTML = `<div class="vmm-page-list">${pages.map((page, index) => renderCard(page, index, pages.length)).join('')}</div>`;
  applyKebab();
}

function mountModal(markup) {
  document.body.querySelector('.vmm-modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'gcg-modal-overlay vmm-modal-overlay';
  overlay.innerHTML = markup;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return overlay;
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  setTimeout(() => overlay.remove(), MODAL_DELAY_MS);
}

function bindModalClose(overlay, onClose) {
  const onEsc = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onClose();
  };
  const onOutside = event => {
    if (event.target === overlay) onClose();
  };
  window.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', onOutside);
  return () => {
    window.removeEventListener('keydown', onEsc);
    overlay.removeEventListener('click', onOutside);
  };
}

function setModalError(modal, message = '') {
  const node = modal.querySelector('[data-modal-error]');
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function setModalLoader(modal, visible, label) {
  const node = modal.querySelector('[data-modal-loader]');
  if (!node) return;
  node.hidden = !visible;
  if (visible) node.innerHTML = loader(label);
}

function knownModulesOptions() {
  return [...state.knownModules.values()]
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
    .map(name => `<option value="${esc(name)}"></option>`)
    .join('');
}

function createPayload(title, validatedModule) {
  return {
    slug: slugify(title),
    moduleFile: validatedModule.moduleFile,
    type: 'vitrine',
    order: orderedPages().reduce((max, page) => Math.max(max, Number(page.order || 0)), -1) + 1,
    navigationPlacement: 'burger',
    public: true,
    requiresAuth: false,
    requiresPurchase: false,
    disabled: { enabled: false, from: null, to: null }
  };
}

function updatePayload(page, validatedModule) {
  const requiresPurchase = Boolean(page?.access?.requiresPurchase);
  const payload = {
    slug: String(page?.slug || '').trim().toLowerCase(),
    moduleFile: validatedModule.moduleFile,
    type: 'vitrine',
    order: Number.isFinite(Number(page?.order)) ? Number(page.order) : 0,
    navigationPlacement: page?.navigationPlacement || null,
    public: Boolean(page?.access?.public),
    requiresAuth: Boolean(page?.access?.requiresAuth),
    requiresPurchase,
    disabled: {
      enabled: Boolean(page?.disabled?.enabled),
      from: page?.disabled?.from || null,
      to: page?.disabled?.to || null
    }
  };
  if (requiresPurchase && page?.access?.purchaseType) payload.purchaseType = page.access.purchaseType;
  return payload;
}

function openPageModal(mode, page = null) {
  const editMode = mode === 'edit';
  const overlay = mountModal(`
    <div class="gcg-modal-panel vmm-modal-panel" role="dialog" aria-modal="true">
      <header class="gcg-modal-panel__header">
        <h3>${editMode ? 'Modifier la page' : 'Créer une page'}</h3>
        <button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button>
      </header>
      <div class="gcg-modal-panel__body">
        <label class="vmm-field"><span>Titre</span><input class="gcg-minimal-input" name="title" value="${esc(
          editMode ? titleFromSlug(page?.slug) : ''
        )}" required></label>
        <label class="vmm-field"><span>Module</span><input class="gcg-minimal-input" name="module" value="${esc(
          parseModuleBase(page?.moduleFile || '')
        )}" list="vmm-modules" required></label>
        <datalist id="vmm-modules">${knownModulesOptions()}</datalist>
        <p class="vmm-modal-hint">${editMode ? `Slug conservé: <code>${esc(page?.slug || '')}</code>.` : 'Le slug est généré depuis le titre.'}</p>
        <p class="vmm-modal-error" data-modal-error hidden></p>
        <div class="vmm-modal-loader" data-modal-loader hidden></div>
      </div>
      <div class="gcg-modal-panel__actions">
        <button type="button" class="gcg-outline-button" data-cancel>Annuler</button>
        <button type="button" class="gcg-accent-button" data-save>${editMode ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </div>
  `);

  const close = () => {
    cleanup();
    closeModal(overlay);
  };
  const cleanup = bindModalClose(overlay, close);
  overlay.querySelector('[data-close]')?.addEventListener('click', close);
  overlay.querySelector('[data-cancel]')?.addEventListener('click', close);
  overlay.querySelector('[data-save]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const title = String(overlay.querySelector('[name="title"]')?.value || '').trim();
    const moduleInput = String(overlay.querySelector('[name="module"]')?.value || '').trim();
    if (!title) {
      setModalError(overlay, 'Le titre est requis.');
      return;
    }
    if (!editMode && !slugify(title)) {
      setModalError(overlay, 'Titre invalide pour générer un slug.');
      return;
    }
    setModalError(overlay, '');
    setModalLoader(overlay, true, 'Vérification du module...');
    setActionButtonState(button, 'loading', { loadingLabel: 'Vérification...' });
    try {
      const validated = await validateModule(moduleInput);
      if (!validated.ok) {
        setActionButtonState(button, 'error', { errorLabel: 'Échec' });
        setModalLoader(overlay, false);
        setModalError(overlay, validated.error || 'Module invalide.');
        showToast({ type: 'error', message: 'Échec', durationMs: 1000 });
        return;
      }
      const endpoint = editMode ? `${PAGES_ENDPOINT}/${encodeURIComponent(page.id)}` : PAGES_ENDPOINT;
      const payload = editMode ? updatePayload(page, validated) : createPayload(title, validated);
      await api(endpoint, {
        method: editMode ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setActionButtonState(button, 'success', { successLabel: editMode ? 'Enregistré' : 'Créé' });
      showToast({
        type: 'success',
        message: editMode ? 'Modifications enregistrées' : 'Page créée',
        durationMs: 1000
      });
      close();
      await refreshPages('Actualisation des pages...');
    } catch (error) {
      setActionButtonState(button, 'error', { errorLabel: 'Échec' });
      setModalLoader(overlay, false);
      setModalError(overlay, error.message || "Impossible d'enregistrer.");
      showToast({ type: 'error', message: 'Échec', durationMs: 1000 });
      logUiError('MenuVitrine:SavePage', error, { mode, pageId: page?.id || null });
    }
  });
}

function openDeleteModal(page) {
  const overlay = mountModal(`
    <div class="gcg-modal-panel vmm-modal-panel vmm-modal-panel--confirm" role="dialog" aria-modal="true">
      <header class="gcg-modal-panel__header">
        <h3>Supprimer la page ?</h3>
        <button type="button" class="gcg-modal-close" data-close><i class="bi bi-x-lg"></i></button>
      </header>
      <div class="gcg-modal-panel__body">
        <p>La page <strong>${esc(page.slug || '')}</strong> sera supprimée.</p>
        <p class="vmm-modal-error" data-modal-error hidden></p>
        <div class="vmm-modal-loader" data-modal-loader hidden></div>
      </div>
      <div class="gcg-modal-panel__actions">
        <button type="button" class="gcg-outline-button" data-cancel>Non</button>
        <button type="button" class="gcg-accent-button" data-confirm>Oui</button>
      </div>
    </div>
  `);
  const close = () => {
    cleanup();
    closeModal(overlay);
  };
  const cleanup = bindModalClose(overlay, close);
  overlay.querySelector('[data-close]')?.addEventListener('click', close);
  overlay.querySelector('[data-cancel]')?.addEventListener('click', close);
  overlay.querySelector('[data-confirm]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setActionButtonState(button, 'loading', { loadingLabel: 'Suppression...' });
    setModalError(overlay, '');
    setModalLoader(overlay, true, 'Suppression...');
    try {
      await api(`${PAGES_ENDPOINT}/${encodeURIComponent(page.id)}`, { method: 'DELETE' });
      setActionButtonState(button, 'success', { successLabel: 'Supprimé' });
      showToast({ type: 'success', message: 'Page supprimée', durationMs: 1000 });
      close();
      await refreshPages('Actualisation des pages...');
    } catch (error) {
      setActionButtonState(button, 'error', { errorLabel: 'Échec' });
      setModalLoader(overlay, false);
      setModalError(overlay, error.message || 'Suppression impossible.');
      showToast({ type: 'error', message: 'Échec', durationMs: 1000 });
      logUiError('MenuVitrine:DeletePage', error, { pageId: page.id });
    }
  });
}

async function refreshPages(label = 'Chargement des pages vitrines...') {
  const start = Date.now();
  const list = listNode();
  if (list) list.innerHTML = loader(label);
  try {
    const payload = await api(PAGES_ENDPOINT);
    state.pages = (Array.isArray(payload.pages) ? payload.pages : []).filter(page => String(page.type || '') === 'vitrine');
    setKnownModules();
    if (state.orderMode) {
      const allowed = new Set(state.pages.map(page => page.id));
      state.draftOrderIds = state.draftOrderIds.filter(id => allowed.has(id));
      orderedPages().forEach(page => {
        if (!state.draftOrderIds.includes(page.id)) state.draftOrderIds.push(page.id);
      });
    }
    const delay = MIN_LOADER_MS - (Date.now() - start);
    if (delay > 0) await wait(delay);
    renderList();
  } catch (error) {
    const delay = MIN_LOADER_MS - (Date.now() - start);
    if (delay > 0) await wait(delay);
    if (list) list.innerHTML = `<p class="gcg-error">${esc(error.message || 'Erreur de chargement.')}</p>`;
    showToast({ type: 'error', message: 'Échec', durationMs: 1000 });
    logUiError('MenuVitrine:LoadPages', error);
  }
}

function ensureIndicator() {
  if (state.drag.indicator && state.drag.indicator.parentElement) return state.drag.indicator;
  const node = document.createElement('div');
  node.className = 'vmm-drop-indicator';
  state.drag.indicator = node;
  return node;
}

function clearIndicator() {
  if (state.drag.indicator?.parentElement) state.drag.indicator.parentElement.removeChild(state.drag.indicator);
  state.drag.targetId = null;
  state.drag.after = false;
}

function clearDrag() {
  clearIndicator();
  state.drag.sourceId = null;
}

function reorderDraft(sourceId, targetId, after) {
  const from = state.draftOrderIds.indexOf(sourceId);
  if (from === -1) return;
  const next = [...state.draftOrderIds];
  const [moved] = next.splice(from, 1);
  if (!targetId) {
    next.push(moved);
    state.draftOrderIds = next;
    return;
  }
  const to = next.indexOf(targetId);
  if (to === -1) {
    next.push(moved);
    state.draftOrderIds = next;
    return;
  }
  next.splice(after ? to + 1 : to, 0, moved);
  state.draftOrderIds = next;
}

function moveDraft(pageId, delta) {
  const index = state.draftOrderIds.indexOf(pageId);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.draftOrderIds.length) return;
  const next = [...state.draftOrderIds];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  state.draftOrderIds = next;
  renderList();
}

async function saveOrder(button) {
  if (!state.orderMode || !state.draftOrderIds.length) return;
  setActionButtonState(button, 'loading', { loadingLabel: 'Enregistrement...' });
  const list = listNode();
  if (list) list.innerHTML = loader("Enregistrement de l'ordre...");
  try {
    const payload = await api(ORDER_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedPageIds: [...state.draftOrderIds] })
    });
    state.pages = (Array.isArray(payload.pages) ? payload.pages : []).filter(page => String(page.type || '') === 'vitrine');
    setKnownModules();
    syncOrderMode(false);
    setActionButtonState(button, 'success', { successLabel: 'Enregistré' });
    showToast({ type: 'success', message: 'Ordre enregistré', durationMs: 1000 });
  } catch (error) {
    setActionButtonState(button, 'error', { errorLabel: 'Échec' });
    showToast({ type: 'error', message: 'Échec', durationMs: 1000 });
    logUiError('MenuVitrine:SaveOrder', error, { orderedPageIds: state.draftOrderIds });
    renderList();
  }
}

function onRootClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  const pageId = actionNode.dataset.pageId || actionNode.dataset.kebabId;
  const page = pageId ? pageById(pageId) : null;

  if (action === 'open-create') {
    openPageModal('create');
    return;
  }
  if (action === 'toggle-order') {
    syncOrderMode(!state.orderMode);
    return;
  }
  if (action === 'save-order') {
    saveOrder(actionNode);
    return;
  }
  if (action === 'cancel-order') {
    syncOrderMode(false);
    return;
  }
  if (action === 'toggle-kebab') {
    if (state.orderMode) return;
    state.openKebabId = state.openKebabId === pageId ? null : pageId;
    applyKebab();
    return;
  }
  if (action === 'edit-page' && page) {
    state.openKebabId = null;
    applyKebab();
    openPageModal('edit', page);
    return;
  }
  if (action === 'delete-page' && page) {
    state.openKebabId = null;
    applyKebab();
    openDeleteModal(page);
    return;
  }
  if (action === 'move-up' && pageId) {
    moveDraft(pageId, -1);
    return;
  }
  if (action === 'move-down' && pageId) {
    moveDraft(pageId, 1);
  }
}

function onDocumentClick(event) {
  if (!state.openKebabId) return;
  if (event.target.closest('.gestion-kebab')) return;
  state.openKebabId = null;
  applyKebab();
}

function onDocumentKeydown(event) {
  if (event.key !== 'Escape') return;
  if (!state.openKebabId) return;
  state.openKebabId = null;
  applyKebab();
}

function onDragStart(event) {
  if (!state.orderMode) return;
  const card = event.target.closest('[data-page-id]');
  if (!card) return;
  state.drag.sourceId = card.dataset.pageId;
  card.classList.add('dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', state.drag.sourceId);
  }
}

function onDragOver(event) {
  if (!state.orderMode || !state.drag.sourceId) return;
  event.preventDefault();
  const target = event.target.closest('[data-page-id]');
  if (!target || target.dataset.pageId === state.drag.sourceId) {
    clearIndicator();
    return;
  }
  const rect = target.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  const indicator = ensureIndicator();
  const parent = target.parentElement;
  if (!parent) return;
  if (after) parent.insertBefore(indicator, target.nextElementSibling);
  else parent.insertBefore(indicator, target);
  state.drag.targetId = target.dataset.pageId;
  state.drag.after = after;
}

function onDrop(event) {
  if (!state.orderMode || !state.drag.sourceId) return;
  event.preventDefault();
  reorderDraft(state.drag.sourceId, state.drag.targetId, state.drag.after);
  clearDrag();
  renderList();
}

function onDragEnd(event) {
  const card = event.target.closest('[data-page-id]');
  if (card) card.classList.remove('dragging');
  clearDrag();
}

function bindEvents() {
  if (aborter) aborter.abort();
  aborter = new AbortController();
  const { signal } = aborter;
  root.addEventListener('click', onRootClick, { signal });
  document.addEventListener('click', onDocumentClick, { signal });
  document.addEventListener('keydown', onDocumentKeydown, { signal });
  root.addEventListener('dragstart', onDragStart, { signal });
  root.addEventListener('dragover', onDragOver, { signal });
  root.addEventListener('drop', onDrop, { signal });
  root.addEventListener('dragend', onDragEnd, { signal });
}

function renderLayout() {
  root.innerHTML = `
    <section class="vmm-module" data-vmm-module>
      <header class="vmm-header">
        <div>
          <h2>Menu vitrine</h2>
          <p>Gérez les pages vitrine, leur module et leur ordre global.</p>
        </div>
        <div class="vmm-header__actions">
          <button type="button" class="gcg-accent-button" data-action="open-create"><i class="bi bi-plus-lg"></i><span>Créer une page</span></button>
          <button type="button" class="gcg-outline-button" data-action="toggle-order"><i class="bi bi-arrow-left-right"></i><span>Changer l'ordre</span></button>
        </div>
      </header>
      <section class="manager-section vmm-list-section">
        <div class="vmm-order-actions" data-vmm-order-actions hidden>
          <button type="button" class="gcg-accent-button" data-action="save-order"><i class="bi bi-check2"></i><span>Enregistrer l'ordre</span></button>
          <button type="button" class="gcg-outline-button" data-action="cancel-order"><i class="bi bi-x-lg"></i><span>Annuler</span></button>
        </div>
        <div class="vmm-list" data-vmm-list>${loader('Chargement des pages vitrines...')}</div>
      </section>
    </section>
  `;
}

export async function renderModule(container) {
  if (!container) return;
  root = container;
  state.pages = [];
  state.orderMode = false;
  state.draftOrderIds = [];
  state.openKebabId = null;
  clearDrag();
  renderLayout();
  bindEvents();
  await refreshPages('Chargement des pages vitrines...');
}

export default { renderModule };
