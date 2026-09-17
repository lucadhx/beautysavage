import { updateSiteFavicon } from './helpers/siteFavicon.js';

const MODULE_PARAM = 'module';
const DEFAULT_MODULE = 'naviguationGestion';
const ACTIVE_THEME_ENDPOINT = '/api/vitrine/theme';
const SITE_IDENTITY_ENDPOINT = '/api/vitrine/site-identity';
const GESTION_PAGES_ENDPOINT = '/api/gestion/pages-gestion/pages';
const GESTION_CATEGORIES_ENDPOINT = '/api/gestion/pages-gestion/categories';
const GESTION_ALLOWED_ROLES = new Set(['admin', 'dev']);
const THEME_DEFAULTS = {
  primary: '#5f4ff7',
  secondary: '#f24692',
  background: '#f5f4ef',
  surface: '#ffffff',
  text: '#0f172a'
};

let currentUserRole = null;
let navigationModules = [];
let navigationSections = [];
let uncategorizedKey = 'UNCATEGORIZED';
let burgerBound = false;
let fixedOffsetsBound = false;
const ADMIN_SUSPENDED_REDIRECT = '/login.html?reason=site-suspended';
const LOGIN_REDIRECT = '/login.html';
const MAINTENANCE_REDIRECT = '/maintenance';
let gestionFetchGuardInstalled = false;
let gestionRedirectingToLogin = false;

const container = document.getElementById('module-container');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function redirectGestionToLogin(reason = '') {
  if (gestionRedirectingToLogin) return;
  gestionRedirectingToLogin = true;
  if (reason === 'site-maintenance') {
    window.location.replace(MAINTENANCE_REDIRECT);
    return;
  }
  const target =
    reason === 'site-suspended'
      ? ADMIN_SUSPENDED_REDIRECT
      : LOGIN_REDIRECT;
  window.location.replace(target);
}

function installGestionAuthRedirectGuard() {
  if (gestionFetchGuardInstalled || typeof window.fetch !== 'function') return;
  gestionFetchGuardInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response?.status === 401) {
      redirectGestionToLogin();
      return response;
    }
    if (response?.status === 403) {
      try {
        const payload = await response.clone().json();
        if (payload?.code === 'FORBIDDEN_GESTION_ROLE') {
          window.location.replace('/vitrine.html');
          return response;
        }
        if (payload?.code === 'SUSPENDED_ADMIN_LOGOUT') {
          redirectGestionToLogin('site-suspended');
          return response;
        }
        if (payload?.code === 'MAINTENANCE') {
          redirectGestionToLogin('site-maintenance');
        }
      } catch (_error) {
        // No-op: keep original response flow.
      }
    }
    if (response?.status === 503) {
      try {
        const payload = await response.clone().json();
        if (payload?.code === 'MAINTENANCE') {
          redirectGestionToLogin('site-maintenance');
        }
      } catch (_error) {
        // No-op: keep original response flow.
      }
    }
    return response;
  };
}

function sanitizeThemeColor(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function resolveDerivedTokens(colors = {}, overrides = {}) {
  const palette = { ...THEME_DEFAULTS, ...colors };
  const surfaceHeader =
    sanitizeThemeColor(overrides.surfaceHeader) ||
    `color-mix(in oklab, ${palette.primary} 26%, ${palette.background} 74%)`;
  const accent =
    sanitizeThemeColor(overrides.accent) ||
    `color-mix(in oklab, ${palette.primary} 70%, ${palette.secondary} 30%)`;
  const accentStrong =
    sanitizeThemeColor(overrides.accentStrong) ||
    `color-mix(in oklab, ${palette.primary} 45%, ${palette.secondary} 55%)`;
  return { surfaceHeader, accent, accentStrong };
}

function applyTheme(theme) {
  const colors = { ...THEME_DEFAULTS, ...(theme?.colors || {}) };
  const derived = resolveDerivedTokens(colors, theme?.derivedTokens || {});
  const root = document.documentElement;
  root.style.setProperty('--color-background', colors.background);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-secondary', colors.secondary);
  root.style.setProperty('--theme-surface-header', derived.surfaceHeader);
  root.style.setProperty('--theme-accent', derived.accent);
  root.style.setProperty('--theme-accent-strong', derived.accentStrong);
}

async function loadActiveTheme() {
  try {
    const response = await fetch(ACTIVE_THEME_ENDPOINT, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Theme indisponible');
    }
    const payload = await response.json().catch(() => ({}));
    applyTheme(payload?.theme || null);
  } catch (error) {
    console.error('Erreur chargement theme gestion', error);
    applyTheme(null);
  }
}

function getBrandInitials(siteName) {
  const cleaned = String(siteName || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim();
  if (!cleaned) return 'BS';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return 'BS';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase();
}

function applySiteIdentity(identity = {}) {
  const name = String(identity?.siteName || 'Beauty Savage').trim() || 'Beauty Savage';
  const logoUrl = String(identity?.logoUrlResolved || '').trim();
  updateSiteFavicon(logoUrl);
  const logo = document.querySelector('[data-gestion-logo]');
  const fallback = document.querySelector('[data-gestion-logo-fallback]');
  const nameNode = document.querySelector('[data-gestion-site-name]');
  if (nameNode) nameNode.textContent = name;
  if (!logo || !fallback) return;
  if (logoUrl) {
    logo.src = logoUrl;
    logo.hidden = false;
    fallback.hidden = true;
    fallback.textContent = '';
  } else {
    logo.removeAttribute('src');
    logo.hidden = true;
    fallback.textContent = getBrandInitials(name);
    fallback.hidden = false;
  }
}

async function loadSiteIdentity() {
  try {
    const response = await fetch(SITE_IDENTITY_ENDPOINT, { credentials: 'include' });
    if (!response.ok) throw new Error('Identite indisponible');
    const payload = await response.json().catch(() => ({}));
    applySiteIdentity(payload || {});
  } catch (error) {
    console.error('Erreur chargement identite site gestion', error);
    applySiteIdentity(null);
  }
}

function sanitizeModuleName(value) {
  if (!value) return null;
  let normalized = String(value).trim();
  if (!normalized) return null;
  normalized = normalized.replace(/\.js$/i, '');
  const withoutModule = normalized.replace(/Module$/i, '');
  const candidate = withoutModule || normalized;
  if (!candidate) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(candidate)) return null;
  return candidate;
}

function normalizeGestionRoles(values) {
  const source = Array.isArray(values) ? values : values ? [values] : [];
  const normalized = [
    ...new Set(
      source
        .map(value => String(value || '').trim().toLowerCase())
        .filter(value => GESTION_ALLOWED_ROLES.has(value))
    )
  ];
  return normalized.length ? normalized : ['admin', 'dev'];
}

function buildModuleLabel(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return 'Module';
  const withSpaces = candidate.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ');
  return withSpaces
    .split(/\s+/)
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function normalizeCategoryOrders(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => ({
      categoryId: entry?.categoryId ? String(entry.categoryId) : null,
      order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : Number.MAX_SAFE_INTEGER
    }))
    .filter(entry => entry.categoryId !== undefined);
}

function buildNavigationModules(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter(page => page?.type === 'gestion')
    .map(page => {
      const reference = page.moduleFile || page.slug;
      const moduleName = sanitizeModuleName(reference);
      if (!moduleName) return null;
      return {
        id: moduleName,
        label: buildModuleLabel(page.slug || page.moduleFile || moduleName),
        order: Number.isFinite(Number(page.order)) ? Number(page.order) : Number.MAX_SAFE_INTEGER,
        devOnly: Boolean(page.devOnly),
        allowedRoles: normalizeGestionRoles(page.allowedRolesGestion),
        createdAt: page.createdAt || null,
        categories: Array.isArray(page.categories) ? page.categories.map(value => String(value)) : [],
        categoryOrders: normalizeCategoryOrders(page.categoryOrders)
      };
    })
    .filter(Boolean);
}

function isDevUser() {
  return String(currentUserRole || '').toLowerCase() === 'dev';
}

function filterModulesByRole(entries) {
  if (!Array.isArray(entries)) return [];
  const role = String(currentUserRole || '').trim().toLowerCase();
  if (!GESTION_ALLOWED_ROLES.has(role)) return [];
  const devUser = role === 'dev';
  return entries.filter(module => {
    const roles = Array.isArray(module.allowedRoles) ? module.allowedRoles : ['admin', 'dev'];
    if (!roles.includes(role)) return false;
    return !module.devOnly || devUser;
  });
}

async function fetchSessionUserRole() {
  try {
    const response = await fetch('/auth/me', { credentials: 'include' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 && payload?.code === 'MAINTENANCE') {
        redirectGestionToLogin('site-maintenance');
        return null;
      }
      if (payload?.code === 'SUSPENDED_ADMIN_LOGOUT') {
        redirectGestionToLogin('site-suspended');
        return null;
      }
      redirectGestionToLogin();
      currentUserRole = null;
      return null;
    }
    const payload = await response.json().catch(() => ({}));
    const userRole = payload?.user?.role;
    currentUserRole = userRole ? String(userRole).trim().toLowerCase() : null;
    if (!GESTION_ALLOWED_ROLES.has(String(currentUserRole || '').trim().toLowerCase())) {
      window.location.replace('/vitrine.html');
      return null;
    }
    return currentUserRole;
  } catch (error) {
    console.error('Erreur de recuperation du profil', error);
    currentUserRole = null;
    return null;
  }
}

function parseSortDate(value) {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function getPageOrderInCategory(page, categoryId) {
  const categoryOrder = page.categoryOrders.find(entry => {
    if (!categoryId) return entry.categoryId === null;
    return entry.categoryId === categoryId;
  });
  if (categoryOrder) return categoryOrder.order;
  return page.order;
}

function buildNavigationSections(modules, categories, uncategorizedToken) {
  const categoryRows = Array.isArray(categories) ? categories : [];
  const categoryBucket = categoryRows
    .map(category => ({
      id: String(category?.id || '').trim(),
      name: String(category?.name || '').trim() || 'Cat?gorie',
      icon: String(category?.icon || 'bi-folder').trim() || 'bi-folder',
      order: Number.isFinite(Number(category?.order)) ? Number(category.order) : Number.MAX_SAFE_INTEGER,
      createdAt: category?.createdAt || null
    }))
    .filter(category => category.id);
  const sortedCategories = [...categoryBucket].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const dateDelta = parseSortDate(a.createdAt) - parseSortDate(b.createdAt);
    if (dateDelta !== 0) return dateDelta;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  });

  const categoryIds = new Set(sortedCategories.map(category => category.id));
  const sections = sortedCategories.map(category => {
    const pages = modules
      .filter(module => module.categories.includes(category.id))
      .sort((left, right) => {
        const leftOrder = getPageOrderInCategory(left, category.id);
        const rightOrder = getPageOrderInCategory(right, category.id);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' });
      });
    return { id: category.id, name: category.name, icon: category.icon, pages };
  });

  const uncategorizedModules = modules
    .filter(module => module.categories.length === 0 || module.categories.every(id => !categoryIds.has(id)))
    .sort((left, right) => {
      const leftOrder = getPageOrderInCategory(left, null);
      const rightOrder = getPageOrderInCategory(right, null);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' });
    });
  if (uncategorizedModules.length) {
    sections.push({
      id: uncategorizedToken || 'UNCATEGORIZED',
      name: 'Sans categorie',
      icon: 'bi-inboxes',
      pages: uncategorizedModules
    });
  }
  return sections;
}

async function loadNavigationPages() {
  try {
    const [pagesResponse, categoriesResponse] = await Promise.all([
      fetch(GESTION_PAGES_ENDPOINT, { credentials: 'include' }),
      fetch(GESTION_CATEGORIES_ENDPOINT, { credentials: 'include' })
    ]);
    if (!pagesResponse.ok || !categoriesResponse.ok) {
      throw new Error('Impossible de charger la navigation gestion');
    }
    const pagesPayload = await pagesResponse.json().catch(() => ({}));
    const categoriesPayload = await categoriesResponse.json().catch(() => ({}));
    uncategorizedKey = String(pagesPayload?.uncategorizedKey || categoriesPayload?.uncategorizedKey || 'UNCATEGORIZED');
    const modules = buildNavigationModules(pagesPayload.pages || []);
    navigationModules = filterModulesByRole(modules);
    navigationSections = buildNavigationSections(
      navigationModules,
      categoriesPayload.categories || [],
      uncategorizedKey
    );
  } catch (error) {
    console.error('Erreur de chargement des pages gestion', error);
    navigationModules = [];
    navigationSections = [];
  }
  return navigationModules;
}

function getAllowedModules() {
  return navigationModules;
}

function applyTailwindLayout(root) {
  if (!root) return;
  root.classList.add('flex', 'flex-col', 'gap-6');
  root.querySelectorAll('section, form, .manager-section, .card').forEach(el => {
    el.classList.add('flex', 'flex-col', 'gap-4');
  });
}

function syncGestionFixedOffsets() {
  if (fixedOffsetsBound) return;
  fixedOffsetsBound = true;
  const header = document.querySelector('[data-gestion-header]');
  const subheader = document.querySelector('[data-mode-subheader]');
  if (!header || !subheader) return;
  const root = document.documentElement;
  const update = () => {
    const rect = header.getBoundingClientRect();
    const offset = Math.max(0, Math.round(rect?.bottom || header.offsetHeight || 0));
    root.style.setProperty('--app-header-height', `${offset}px`);
  };
  update();
  window.addEventListener('resize', update, { passive: true });
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(update);
    observer.observe(header);
  }
}

function renderPlaceholder(message) {
  if (!container) return;
  container.innerHTML = `
    <p class="module-placeholder loading" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      ${escapeHtml(message)}
    </p>
  `;
}

function updateModuleParam(moduleName) {
  const params = new URLSearchParams(window.location.search);
  params.set(MODULE_PARAM, moduleName);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState({}, '', url);
}

function setActiveModule(name) {
  const moduleName = sanitizeModuleName(name) || DEFAULT_MODULE;
  document.querySelectorAll('[data-module-nav-link]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.moduleNavLink === moduleName);
  });
}

function getBurgerElements() {
  return {
    toggle: document.querySelector('[data-gestion-burger-toggle]'),
    close: document.querySelector('[data-gestion-burger-close]'),
    overlay: document.querySelector('[data-gestion-burger-overlay]'),
    panel: document.querySelector('[data-gestion-burger-panel]'),
    list: document.querySelector('[data-gestion-burger-list]')
  };
}

function setBurgerOpen(nextOpen) {
  const { toggle, overlay, panel } = getBurgerElements();
  if (!toggle || !overlay || !panel) return;
  const open = Boolean(nextOpen);
  overlay.classList.toggle('is-open', open);
  panel.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.classList.toggle('no-scroll', open);
}

function renderBurgerNavigation(activeModule) {
  const { list } = getBurgerElements();
  if (!list) return;
  const sections = navigationSections;
  if (!sections.length) {
    list.innerHTML = '<p class="module-placeholder">Aucune page de gestion disponible.</p>';
    return;
  }
  list.innerHTML = sections
    .map(section => {
      const sectionPages = Array.isArray(section.pages) ? section.pages : [];
      return `
        <section class="gestion-burger-section">
          <p class="gestion-burger-section__title">
            <i class="bi ${escapeHtml(section.icon || 'bi-folder')}" aria-hidden="true"></i>
            <span>${escapeHtml(section.name || 'Cat?gorie')}</span>
          </p>
          <div class="gestion-burger-section__pages">
            ${
              sectionPages.length
                ? sectionPages
                    .map(
                      module => `
                        <button
                          type="button"
                          class="burger-panel__item"
                          data-module-nav-link="${escapeHtml(module.id)}"
                        >
                          <span>${escapeHtml(module.label)}</span>
                        </button>
                      `
                    )
                    .join('')
                : '<p class="gestion-burger-section__empty">Aucune page.</p>'
            }
          </div>
        </section>
      `;
    })
    .join('');
  setActiveModule(activeModule);
}

function attachBurgerInteractions() {
  if (burgerBound) return;
  burgerBound = true;
  const { toggle, close, overlay, panel, list } = getBurgerElements();
  if (!toggle || !close || !overlay || !panel || !list) return;

  toggle.addEventListener('click', () => {
    const willOpen = panel.getAttribute('aria-hidden') !== 'false';
    setBurgerOpen(willOpen);
  });

  close.addEventListener('click', () => {
    setBurgerOpen(false);
  });

  overlay.addEventListener('click', () => {
    setBurgerOpen(false);
  });

  panel.addEventListener('click', event => {
    const button = event.target.closest('[data-module-nav-link]');
    if (!button) return;
    const moduleName = button.dataset.moduleNavLink;
    if (!moduleName) return;
    setBurgerOpen(false);
    loadModule(moduleName);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (panel.getAttribute('aria-hidden') === 'false') {
      setBurgerOpen(false);
    }
  });

  const homeButton = document.querySelector('[data-gestion-home]');
  homeButton?.addEventListener('click', () => {
    const fallbackModule = getAllowedModules()[0]?.id || DEFAULT_MODULE;
    loadModule(fallbackModule);
  });
}

async function loadModule(name) {
  if (!container) return;
  const allowedModules = getAllowedModules();
  if (!allowedModules.length) {
    renderPlaceholder('Aucun module disponible.');
    return;
  }
  const sanitized = sanitizeModuleName(name) || DEFAULT_MODULE;
  const moduleName = allowedModules.some(module => module.id === sanitized) ? sanitized : allowedModules[0].id;
  setActiveModule(moduleName);
  updateModuleParam(moduleName);
  renderPlaceholder('Chargement du module...');
  try {
    const pageModule = await import(`/js/modules/${moduleName}Module.js`);
    const runner =
      pageModule?.renderModule && typeof pageModule.renderModule === 'function'
        ? pageModule
        : pageModule?.default && typeof pageModule.default.renderModule === 'function'
          ? pageModule.default
          : null;
    if (runner) {
      await runner.renderModule(container);
      applyTailwindLayout(container);
    } else {
      renderPlaceholder('Module invalide : pas de fonction renderModule().');
    }
  } catch (error) {
    console.error('?chec du chargement du module', error);
    renderPlaceholder('Page introuvable.');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  installGestionAuthRedirectGuard();
  await loadActiveTheme();
  await loadSiteIdentity();
  syncGestionFixedOffsets();
  await fetchSessionUserRole();
  await loadNavigationPages();

  const params = new URLSearchParams(window.location.search);
  const requested = params.get(MODULE_PARAM);
  const initial = sanitizeModuleName(requested) || DEFAULT_MODULE;
  const allowedModules = getAllowedModules();
  const safeInitial = allowedModules.some(module => module.id === initial)
    ? initial
    : allowedModules[0]?.id || DEFAULT_MODULE;

  renderBurgerNavigation(safeInitial);
  attachBurgerInteractions();
  await loadModule(safeInitial);
});
