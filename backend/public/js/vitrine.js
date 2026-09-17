import { getItems, setCartUser } from './modules/cartService.js';
import { EMPTY_STATE_ACTION_EVENT } from './modules/emptyStateHelper.js';
import {
  ACQUISITION_PAGES,
  ACQUISITION_NOTIFICATION_EVENT,
  getNotificationCounts,
  getTotalNotificationCount
} from './modules/acquisitionNotificationService.js';
import { ACQUISITION_ANIMATION_COMPLETE_EVENT } from './ui/acquisitionAnimationService.js';
import { PAW_ICON_SVG } from './ui/pawIcon.js';
import { updateSiteFavicon } from './helpers/siteFavicon.js';

const container = document.getElementById('vitrine-module');
const vitrineContentRoot = document.querySelector('[data-vitrine-content]');
const headerIconsRoot = document.querySelector('[data-header-icons]');
const burgerOverlay = document.querySelector('[data-burger-overlay]');
const burgerPanel = document.querySelector('[data-burger-panel]');
const burgerListRoot = document.querySelector('[data-burger-list]');
const burgerToggle = document.querySelector('[data-burger-toggle]');
const burgerClose = document.querySelector('[data-burger-close]');
const headerHomeButton = document.querySelector('[data-header-home]');
const vitrineHeader = document.querySelector('[data-vitrine-header]');
const footerRoot = document.querySelector('[data-global-footer]');
const NAVIGATION_ROUTE = '/api/vitrine/menu';
const SITE_IDENTITY_ROUTE = '/api/vitrine/site-identity';
const HEADER_ICON_SLOTS = [
  { slug: 'myfavorites', icon: 'bi-heart', label: 'Favoris' },
  { slug: 'panier', icon: 'bi-bag', label: 'Panier' },
  { slug: 'myaccount', icon: 'bi-person', label: 'Mon compte' }
];

function applyTailwindPageLayout(root) {
  if (!root) return;
  root.classList.add('flex', 'flex-col', 'gap-6');
  root.querySelectorAll('section, article, .status-banner, .module-container > *').forEach(el => {
    if (el.classList.contains('home-premium') || el.closest('.home-premium')) {
      return;
    }
    el.classList.add('flex', 'flex-col', 'gap-4');
  });
}

function ensureModuleSlots() {
  if (!container) return {};
  let contentSlot = container.querySelector('[data-vitrine-module-slot]');
  let loaderSlot = container.querySelector('[data-vitrine-loader]');
  if (!contentSlot) {
    contentSlot = document.createElement('div');
    contentSlot.dataset.vitrineModuleSlot = '';
    while (container.firstChild) {
      contentSlot.append(container.firstChild);
    }
    container.append(contentSlot);
  }
  if (!loaderSlot) {
    loaderSlot = document.createElement('div');
    loaderSlot.dataset.vitrineLoader = '';
    loaderSlot.classList.add('vitrine-global-loader');
    loaderSlot.hidden = true;
    container.append(loaderSlot);
  }
  return { contentSlot, loaderSlot, viewport: container };
}

function getContentSlot() {
  const { contentSlot } = ensureModuleSlots();
  return contentSlot || null;
}

function setFooterHidden(hidden) {
  if (!footerRoot) return;
  footerRoot.classList.toggle('vitrine-footer--hidden', hidden);
}

const state = {
  user: null,
  navigation: [],
  activeSlug: null,
  theme: null,
  siteIdentity: null,
  uiConfig: null,
  socialLinks: []
};

const UI_STATES = {
  EMPTY: {
    title: 'Aucune donnée',
    description: 'Aucune donnée n’est disponible pour le moment.'
  },
  FORBIDDEN: {
    title: 'Accès restreint',
    description: 'Veuillez vous connecter pour accéder à ce contenu.'
  },
  PAGE_DISABLED: {
    title: 'Page désactivée',
    description: 'Cette page est momentanément indisponible.'
  },
  AUTH_REQUIRED: {
    title: 'Authentification requise',
    description: 'Connectez-vous pour accéder à cette section protégée.'
  }
};
const AUTH_REQUIRED_SLUGS = new Set(['panier', 'myfavorites', 'myaccount']);
const ACQUISITION_SLUG_SET = new Set(Object.values(ACQUISITION_PAGES));
const ACQUISITION_SLUG_ALIASES = {
  mygiftcards: ACQUISITION_PAGES.MY_GIFT_CARDS
};
const AUTH_REQUIRED_TARGETS = {
  panier: 'votre panier',
  myfavorites: 'vos favoris',
  myaccount: 'votre compte'
};
const LOGIN_PAGE = '/login.html';

const THEME_DEFAULTS = {
  primary: '#5f4ff7',
  secondary: '#f24692',
  background: '#f5f4ef',
  surface: '#ffffff',
  text: '#0f172a'
};

function sanitizeThemeColor(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function resolveDerivedTokens(colors = {}, overrides = {}) {
  const palette = { ...THEME_DEFAULTS, ...colors };
  const surfaceHeader = sanitizeThemeColor(overrides.surfaceHeader) || `color-mix(in oklab, ${palette.primary} 26%, ${palette.background} 74%)`;
  const accent = sanitizeThemeColor(overrides.accent) || `color-mix(in oklab, ${palette.primary} 70%, ${palette.secondary} 30%)`;
  const accentStrong = sanitizeThemeColor(overrides.accentStrong) || `color-mix(in oklab, ${palette.primary} 45%, ${palette.secondary} 55%)`;
  return { surfaceHeader, accent, accentStrong };
}

const UI_CONFIG_DEFAULT = {
  patienceTitle: "Patience, l'experience arrive...",
  patienceDescription: "Nous preparons actuellement une experience premium pour vous.",
  showTimer: true
};

const SOCIAL_TYPES = [
  { value: 'instagram', label: 'Instagram', icon: 'bi-instagram' },
  { value: 'tiktok', label: 'TikTok', icon: 'bi-tiktok' },
  { value: 'youtube', label: 'YouTube', icon: 'bi-youtube' }
];
const SOCIAL_ORDER = SOCIAL_TYPES.map(entry => entry.value);
const SOCIAL_LINKS_ROUTE = '/api/vitrine/social-links';
const FOOTER_NAV_LINKS = [
  { slug: 'home', label: 'Accueil' },
  { slug: 'about', label: 'À propos' },
  { slug: 'shop', label: 'Boutique / Formations' },
  { slug: 'contact', label: 'Contact', optional: true }
];
const FOOTER_LEGAL_LINKS = [
  { slug: 'mentions-legales', label: 'Mentions légales' },
  { slug: 'politique-confidentialite', label: 'Politique de confidentialité' },
  { slug: 'cgv', label: 'Conditions générales de vente' }
];

const NAV_CLICK_THROTTLE_MS = 220;
const VITRINE_NAV_EVENT = 'vitrine:navigate';
const PAGE_PARAM = 'page';
const SLUG_PARAM = 'slug';
const HISTORY_STATE_DELAY = 0;
const GLOBAL_LOADER_MIN_DISPLAY_MS = 1000;
const GLOBAL_LOADER_FADE_MS = 180;
const VITRINE_HEADER_OFFSET_CSS_VAR = '--vitrine-header-offset';
const SKELETON_PRESETS = Object.freeze({
  shop: 'list',
  myformations: 'list',
  myfavorites: 'list',
  'my-gift-cards': 'list',
  mygiftcards: 'list',
  panier: 'list',
  sales: 'list',
  'item-detail': 'detail',
  'gift-card-detail': 'detail',
  checkout: 'detail',
  payment: 'detail',
  invoice: 'detail'
});

let lastNavClickTimestamp = 0;
let navigationCounter = 0;
let currentNavigationId = null;
let navigationAbortController = null;
let menuAbortController = null;
let acquisitionBadgePulseTimeout = null;
let globalLoaderToken = 0;
let globalLoaderVisibleSince = 0;
let lastScrollNavigationId = null;
let globalLoaderActive = false;
let footerRenderPending = false;
let vitrineFetchGuardInstalled = false;
let vitrineRedirectingMaintenance = false;

function redirectVitrineToMaintenance() {
  if (vitrineRedirectingMaintenance) return;
  vitrineRedirectingMaintenance = true;
  window.location.replace('/maintenance');
}

function installVitrineAccessRedirectGuard() {
  if (vitrineFetchGuardInstalled || typeof window.fetch !== 'function') return;
  vitrineFetchGuardInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response?.status === 403) {
      try {
        const payload = await response.clone().json();
        if (payload?.code === 'MAINTENANCE') {
          redirectVitrineToMaintenance();
        }
      } catch (_error) {
        // No-op: keep original response flow.
      }
    }
    if (response?.status === 503) {
      try {
        const payload = await response.clone().json();
        if (payload?.code === 'MAINTENANCE') {
          redirectVitrineToMaintenance();
        }
      } catch (_error) {
        // No-op: keep original response flow.
      }
    }
    return response;
  };
}

function logNavigation(action, detail = {}) {
  console.log(`[VITRINE NAV] ${action}`, detail);
}

function logFetch(target, detail = {}) {
  console.log(`[VITRINE FETCH] ${target}`, detail);
}

function logHistory(action, detail = {}) {
  console.log(`[VITRINE HISTORY] ${action}`, detail);
}

function smoothLogWindowLocation(method, value) {
  console.log(`[WINDOW.LOCATION] ${method} -> ${value}`);
}

function patchLocationLogging() {
  if (typeof window === 'undefined' || typeof Location === 'undefined') return;
  try {
    const proto = Location.prototype;
    const hrefDescriptor = Object.getOwnPropertyDescriptor(proto, 'href');
    if (hrefDescriptor && typeof hrefDescriptor.set === 'function') {
      const originalSetter = hrefDescriptor.set;
      Object.defineProperty(proto, 'href', {
        configurable: true,
        enumerable: true,
        get: hrefDescriptor.get,
        set(value) {
          smoothLogWindowLocation('href=', value);
          return originalSetter.call(this, value);
        }
      });
    }
  } catch (error) {
    console.warn('Impossible de patcher window.location.href pour le logging', error);
  }
  try {
    const descriptorAssign = Object.getOwnPropertyDescriptor(window.location, 'assign');
    if (descriptorAssign?.writable || descriptorAssign?.configurable) {
      const originalAssign = window.location.assign.bind(window.location);
      window.location.assign = function (url) {
        smoothLogWindowLocation('assign', url);
        return originalAssign(url);
      };
    }
  } catch (error) {
    console.warn('Impossible de patcher window.location.assign', error);
  }
  try {
    const descriptorReplace = Object.getOwnPropertyDescriptor(window.location, 'replace');
    if (descriptorReplace?.writable || descriptorReplace?.configurable) {
      const originalReplace = window.location.replace.bind(window.location);
      window.location.replace = function (url) {
        smoothLogWindowLocation('replace', url);
        return originalReplace(url);
      };
    }
  } catch (error) {
    console.warn('Impossible de patcher window.location.replace', error);
  }
}

function sanitizeNavigationQuery(query) {
  if (!query || typeof query !== 'object') return null;
  const normalized = {};
  for (const [key, value] of Object.entries(query)) {
    if (!key || key === PAGE_PARAM || key === SLUG_PARAM) continue;
    if (value === null || value === undefined) continue;
    normalized[key] = String(value);
  }
  return Object.keys(normalized).length ? normalized : null;
}

function buildNavigationUrl(slug, query) {
  const params = new URLSearchParams();
  params.set(PAGE_PARAM, slug);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (!key || key === PAGE_PARAM) return;
      params.set(key, String(value));
    });
  }
  return `/vitrine.html?${params.toString()}`;
}

function extractQueryFromLocation() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const query = {};
  for (const [key, value] of params.entries()) {
    if (!key || key === PAGE_PARAM || key === SLUG_PARAM) continue;
    query[key] = value;
  }
  return sanitizeNavigationQuery(query);
}

function updateHistoryState(slug, { replace = false, query } = {}) {
  const sanitizedSlug = sanitizePage(slug) || 'home';
  const normalizedQuery = sanitizeNavigationQuery(query);
  const targetUrl = buildNavigationUrl(sanitizedSlug, normalizedQuery);
  const stateObj = { slug: sanitizedSlug, query: normalizedQuery };
  if (replace) {
    history.replaceState(stateObj, '', targetUrl);
    logHistory('replaceState', { url: targetUrl, slug: sanitizedSlug });
  } else {
    history.pushState(stateObj, '', targetUrl);
    logHistory('pushState', { url: targetUrl, slug: sanitizedSlug });
  }
}

function dispatchVitrineNavigation(slug, options = {}) {
  if (typeof window === 'undefined') return;
  const detail = {
    slug: sanitizePage(slug),
    source: options.source || 'api',
    skipThrottle: Boolean(options.skipThrottle)
  };
  if (!detail.slug) return;
  logNavigation('dispatch-event', detail);
  window.dispatchEvent(new CustomEvent(VITRINE_NAV_EVENT, { detail }));
}

function shouldThrottleNavigation(skipThrottle = false) {
  if (skipThrottle) return false;
  const now = Date.now();
  if (now - lastNavClickTimestamp < NAV_CLICK_THROTTLE_MS) {
    return true;
  }
  lastNavClickTimestamp = now;
  return false;
}

function evaluateNavigationSlug(slug) {
  return sanitizePage(slug) || 'home';
}

function getSlugFromLocation() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return sanitizePage(params.get(PAGE_PARAM) || params.get(SLUG_PARAM));
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function waitForDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function syncContentViewportMetrics() {
  if (typeof document === 'undefined') return;
  const rect = vitrineHeader?.getBoundingClientRect();
  const offset = Math.max(0, Math.ceil(rect?.bottom || rect?.height || 0));
  document.documentElement.style.setProperty(VITRINE_HEADER_OFFSET_CSS_VAR, `${offset}px`);
  document.documentElement.style.setProperty('--app-header-height', `${offset}px`);
}

function scrollViewportToTop(navigationId = null) {
  if (typeof window === 'undefined') return;
  if (navigationId !== null && navigationId === lastScrollNavigationId) return;
  lastScrollNavigationId = navigationId;
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  if (vitrineContentRoot?.scrollTo) {
    vitrineContentRoot.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (vitrineContentRoot) {
    vitrineContentRoot.scrollTop = 0;
  }
}

function resolveSkeletonPreset(slug) {
  const normalized = sanitizePage(slug);
  return SKELETON_PRESETS[normalized] || 'basic';
}

function buildSkeletonMarkup(preset) {
  if (preset === 'list') {
    return `
      <div class="vitrine-skeleton vitrine-skeleton--list" aria-hidden="true">
        ${Array.from({ length: 4 }, () => `
          <div class="vitrine-skeleton-card">
            <span class="vitrine-skeleton-card__media"></span>
            <span class="vitrine-skeleton-card__line"></span>
            <span class="vitrine-skeleton-card__line vitrine-skeleton-card__line--short"></span>
          </div>
        `).join('')}
      </div>
    `;
  }
  if (preset === 'detail') {
    return `
      <div class="vitrine-skeleton vitrine-skeleton--detail" aria-hidden="true">
        <span class="vitrine-skeleton-detail__hero"></span>
        <span class="vitrine-skeleton-detail__title"></span>
        <span class="vitrine-skeleton-detail__line"></span>
        <span class="vitrine-skeleton-detail__line vitrine-skeleton-detail__line--short"></span>
      </div>
    `;
  }
  return '';
}

function buildGlobalLoaderMarkup(preset) {
  return `
    <div class="vitrine-global-loader__inner" role="status" aria-live="polite" aria-busy="true">
      <div class="vitrine-global-loader__paws" aria-hidden="true">
        <span class="vitrine-global-loader__paw-icon">${PAW_ICON_SVG}</span>
        <span class="vitrine-global-loader__paw-icon">${PAW_ICON_SVG}</span>
        <span class="vitrine-global-loader__paw-icon">${PAW_ICON_SVG}</span>
      </div>
    </div>
  `;
}

function showGlobalLoader({ slug, navigationId } = {}) {
  const safeNavigationId = Number.isFinite(navigationId) ? navigationId : null;
  if (safeNavigationId !== null && currentNavigationId !== null && safeNavigationId !== currentNavigationId) {
    return null;
  }
  const { contentSlot, loaderSlot, viewport } = ensureModuleSlots();
  if (!contentSlot || !loaderSlot || !viewport) return null;
  syncContentViewportMetrics();
  scrollViewportToTop(safeNavigationId);
  globalLoaderActive = true;
  setFooterHidden(true);
  const preset = resolveSkeletonPreset(slug);
  const token = globalLoaderToken + 1;
  globalLoaderToken = token;
  globalLoaderVisibleSince = Date.now();
  viewport.classList.add('vitrine-module--loading');
  contentSlot.hidden = true;
  contentSlot.innerHTML = '';
  loaderSlot.innerHTML = buildGlobalLoaderMarkup(preset);
  loaderSlot.hidden = false;
  loaderSlot.classList.remove('is-hiding');
  document.body.classList.add('vitrine-global-loading');
  return { token, navigationId: safeNavigationId };
}

async function hideGlobalLoader(handle = {}) {
  if (!Number.isFinite(handle?.token)) return;
  const { contentSlot, loaderSlot, viewport } = ensureModuleSlots();
  if (!loaderSlot || loaderSlot.hidden) return;
  const expectedToken = handle.token;
  if (expectedToken !== globalLoaderToken) return;
  const navigationId = Number.isFinite(handle?.navigationId) ? handle.navigationId : null;
  if (navigationId !== null && currentNavigationId !== null && navigationId !== currentNavigationId) return;
  const elapsed = Date.now() - globalLoaderVisibleSince;
  if (elapsed < GLOBAL_LOADER_MIN_DISPLAY_MS) {
    await waitForDuration(GLOBAL_LOADER_MIN_DISPLAY_MS - elapsed);
  }
  if (expectedToken !== globalLoaderToken) return;
  if (navigationId !== null && currentNavigationId !== null && navigationId !== currentNavigationId) return;
  setFooterHidden(false);
  loaderSlot.classList.add('is-hiding');
  await waitForDuration(GLOBAL_LOADER_FADE_MS);
  if (expectedToken !== globalLoaderToken) return;
  if (navigationId !== null && currentNavigationId !== null && navigationId !== currentNavigationId) return;
  loaderSlot.hidden = true;
  loaderSlot.innerHTML = '';
  viewport?.classList.remove('vitrine-module--loading');
  if (contentSlot) {
    contentSlot.hidden = false;
  }
  document.body.classList.remove('vitrine-global-loading');
  if (footerRenderPending) {
    renderFooterIdentity();
    renderFooterNavigation();
    renderFooterLegalLinks();
    renderSocialFooter();
    footerRenderPending = false;
  }
  globalLoaderActive = false;
}

function getSocialMeta(type) {
  return SOCIAL_TYPES.find(entry => entry.value === type) || { label: type || '', icon: '' };
}

function sortSocialLinks(list = []) {
  return [...list].sort((a, b) => {
    const indexA = SOCIAL_ORDER.indexOf(a.type);
    const indexB = SOCIAL_ORDER.indexOf(b.type);
    const scoreA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
    const scoreB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
    return scoreA - scoreB;
  });
}

function renderSocialFooter() {
  const footer = document.querySelector('[data-social-footer]');
  if (!footer) return;
  if (globalLoaderActive) {
    footerRenderPending = true;
    return;
  }
  const listRoot = footer.querySelector('[data-social-links]');
  if (!listRoot) return;
  if (!state.socialLinks.length) {
    listRoot.innerHTML = '<p class="module-placeholder">Aucun réseau actif pour le moment.</p>';
    return;
  }
  listRoot.innerHTML = sortSocialLinks(state.socialLinks)
    .map(link => {
      const meta = getSocialMeta(link.type);
      const safeUrl = escapeHtml(link.url || '');
      const safeLabel = escapeHtml(meta.label || link.type || 'Réseau');
      const safeIcon = escapeHtml(meta.icon || '');
      return `
        <a
          class="footer-social-link"
          href="${safeUrl}"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="${safeLabel}"
          title="${safeLabel}"
        >
          <span class="footer-social-icon" aria-hidden="true">
            <i class="bi ${safeIcon}"></i>
          </span>
          <span class="sr-only">${safeLabel}</span>
        </a>
      `;
    })
    .join('');
}

function renderFooterLegalLinks() {
  const root = document.querySelector('[data-footer-legal]');
  if (!root) return;
  if (globalLoaderActive) {
    footerRenderPending = true;
    return;
  }
  root.innerHTML = FOOTER_LEGAL_LINKS.map(link => {
    return `<button type="button" class="footer-link" data-footer-link="${link.slug}">${escapeHtml(
      link.label
    )}</button>`;
  }).join('');
}

function renderFooterNavigation() {
  const root = document.querySelector('[data-footer-nav]');
  if (!root) return;
  if (globalLoaderActive) {
    footerRenderPending = true;
    return;
  }
  const hasContact = state.navigation.some(entry => entry.slug === 'contact');
  const links = FOOTER_NAV_LINKS.filter(link => !link.optional || hasContact);
  if (!links.length) {
    root.innerHTML = '<p class="module-placeholder">Navigation indisponible.</p>';
    return;
  }
  root.innerHTML = links
    .map(
      link =>
        `<button type="button" class="footer-link" data-footer-link="${link.slug}">${escapeHtml(link.label)}</button>`
    )
    .join('');
}

async function loadSocialLinks() {
  try {
    const response = await fetch(SOCIAL_LINKS_ROUTE);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de charger les réseaux sociaux.');
    }
    state.socialLinks = Array.isArray(payload.socialLinks) ? payload.socialLinks : [];
  } catch (error) {
    console.error('Erreur chargement réseaux sociaux', error);
    state.socialLinks = [];
  } finally {
    renderSocialFooter();
  }
}

function normalizeSiteIdentityPayload(payload = {}) {
  const siteName = String(payload?.siteName || '').trim();
  const logoUrlResolved = String(payload?.logoUrlResolved || '').trim();
  return {
    siteName: siteName || null,
    logoUrlResolved: logoUrlResolved || null
  };
}

function getBrandName() {
  return (
    String(state.siteIdentity?.siteName || state.theme?.name || 'Beauty Savage')
      .trim() || 'Beauty Savage'
  );
}

function getBrandLogoUrl() {
  return String(state.siteIdentity?.logoUrlResolved || '').trim();
}

function getBrandInitials(siteName) {
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

function updateBrandImage(element, fallbackElement, url, altText, fallbackText) {
  if (!element) return;
  const normalized = String(url || '').trim();
  if (normalized) {
    element.src = normalized;
    element.hidden = false;
    if (fallbackElement) {
      fallbackElement.hidden = true;
      fallbackElement.textContent = '';
    }
  } else {
    element.removeAttribute('src');
    element.hidden = true;
    if (fallbackElement) {
      fallbackElement.textContent = fallbackText;
      fallbackElement.hidden = false;
    }
  }
  element.alt = altText;
}

function renderThemeBrand() {
  const brandRoot = document.querySelector('[data-theme-brand]');
  if (!brandRoot) return;
  const brandName = getBrandName();
  const slogan = String(state.theme?.slogan || '');
  const logoUrl = getBrandLogoUrl();
  const initials = getBrandInitials(brandName);
  updateBrandImage(
    brandRoot.querySelector('[data-theme-logo]'),
    brandRoot.querySelector('[data-theme-logo-fallback]'),
    logoUrl,
    `Logo de ${brandName}`,
    initials
  );
  const nameEl = brandRoot.querySelector('[data-theme-name]');
  if (nameEl) {
    nameEl.textContent = brandName;
  }
  const sloganEl = brandRoot.querySelector('[data-theme-slogan]');
  if (sloganEl) {
    if (slogan) {
      sloganEl.textContent = slogan;
      sloganEl.hidden = false;
    } else {
      sloganEl.textContent = '';
      sloganEl.hidden = true;
    }
  }
}

function renderFooterIdentity() {
  const footerIdentity = document.querySelector('[data-footer-identity]');
  if (!footerIdentity) return;
  if (globalLoaderActive) {
    footerRenderPending = true;
    return;
  }
  const brandName = getBrandName();
  const slogan = String(state.theme?.slogan || '');
  const logoUrl = getBrandLogoUrl();
  const initials = getBrandInitials(brandName);
  updateBrandImage(
    footerIdentity.querySelector('[data-footer-logo]'),
    footerIdentity.querySelector('[data-footer-logo-fallback]'),
    logoUrl,
    `Logo de ${brandName}`,
    initials
  );
  const nameEl = footerIdentity.querySelector('[data-footer-name]');
  if (nameEl) {
    nameEl.textContent = brandName;
  }
  const sloganEl = footerIdentity.querySelector('[data-footer-slogan]');
  if (sloganEl) {
    if (slogan) {
      sloganEl.textContent = slogan;
      sloganEl.hidden = false;
    } else {
      sloganEl.textContent = '';
      sloganEl.hidden = true;
    }
  }
  const copyrightEl = footerIdentity.querySelector('[data-footer-copyright]');
  if (copyrightEl) {
    const year = new Date().getFullYear();
    copyrightEl.textContent = `© ${year} - ${brandName}`;
  }
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
  state.theme = theme ? { ...theme, resolvedDerivedTokens: derived } : null;
  renderThemeBrand();
  renderFooterIdentity();
}

function applySiteIdentity(identity) {
  state.siteIdentity = identity || null;
  updateSiteFavicon(getBrandLogoUrl());
  renderThemeBrand();
  renderFooterIdentity();
}

async function loadUIConfig() {
  try {
    const response = await fetch('/api/vitrine/ui-config');
    if (!response.ok) throw new Error('Configuration UI introuvable');
    const payload = await response.json().catch(() => ({}));
    state.uiConfig = payload?.config || UI_CONFIG_DEFAULT;
    return state.uiConfig;
  } catch (error) {
    console.error('Erreur chargement configuration UI', error);
    state.uiConfig = UI_CONFIG_DEFAULT;
    return state.uiConfig;
  }
}

async function loadTheme() {
  try {
    const response = await fetch('/api/vitrine/theme');
    if (!response.ok) throw new Error('Theme introuvable');
    const payload = await response.json().catch(() => ({}));
    const theme = payload?.theme || null;
    applyTheme(theme);
    return theme;
  } catch (error) {
    console.error('Erreur chargement theme', error);
    applyTheme(null);
    return null;
  }
}

async function loadSiteIdentity() {
  try {
    const response = await fetch(SITE_IDENTITY_ROUTE);
    if (!response.ok) throw new Error('Identite site introuvable');
    const payload = await response.json().catch(() => ({}));
    const identity = normalizeSiteIdentityPayload(payload);
    applySiteIdentity(identity);
    return identity;
  } catch (error) {
    console.error('Erreur chargement identite du site', error);
    applySiteIdentity(null);
    return null;
  }
}

let disabledTimerId = null;

function clearDisabledTimer() {
  if (disabledTimerId) {
    clearInterval(disabledTimerId);
    disabledTimerId = null;
  }
}

function formatRemaining(durationMs) {
  if (durationMs <= 0) return 'Réactivation imminente';
  const seconds = Math.floor(durationMs / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);
  return `Réactivation dans ${parts.join(' ')}`;
}

function startDisabledTimer(until) {
  const timerEl = getContentSlot()?.querySelector('[data-disabled-timer]');
  if (!timerEl) return;
  const target = new Date(until);
  if (Number.isNaN(target.getTime())) {
    timerEl.textContent = '';
    return;
  }
  const update = () => {
    const now = new Date();
    const diff = target.getTime() - now.getTime();
    timerEl.textContent = formatRemaining(diff);
  };
  update();
  clearDisabledTimer();
  disabledTimerId = setInterval(update, 1000);
}

function renderDisabledScreen(payload) {
  clearDevBanner();
  clearDisabledTimer();
  const entry = UI_STATES.PAGE_DISABLED;
  const untilLabel = payload.disabledUntil ? new Date(payload.disabledUntil).toLocaleString() : null;
  const patienceTitle = state.uiConfig?.patienceTitle || entry.title;
  const patienceDescription = state.uiConfig?.patienceDescription || entry.description;
  const showTimer = state.uiConfig?.showTimer !== false;
  const shouldRenderTimer = showTimer && Boolean(payload.disabledUntil);
  const slot = getContentSlot();
  if (!slot) return;
  slot.innerHTML = `
    <div class="status-banner status-forbidden disabled-screen">
      <span class="disabled-mention">Page inaccessible</span>
      <h2>${patienceTitle}</h2>
      <p>${patienceDescription}</p>
      ${untilLabel ? `<p class="module-placeholder">Réactivation prévue le ${untilLabel}</p>` : ''}
      ${shouldRenderTimer ? '<p class="form-message" data-disabled-timer></p>' : ''}
    </div>
  `;
  if (shouldRenderTimer) {
    startDisabledTimer(payload.disabledUntil);
  }
}

function renderDevBanner() {
  const slot = getContentSlot();
  if (!slot) return;
  clearDevBanner();
  const banner = document.createElement('div');
  banner.dataset.devBanner = 'true';
  banner.className = 'dev-banner';
  banner.textContent = 'Cette page est désactivée (accès développeur).';
  slot.prepend(banner);
}

function clearDevBanner() {
  const banner = getContentSlot()?.querySelector('[data-dev-banner]');
  if (banner) {
    banner.remove();
  }
}

function renderUIState(key, options = {}) {
  const entry = UI_STATES[key] || UI_STATES.EMPTY;
  const status = options.status || (key === 'EMPTY' ? 'empty' : 'forbidden');
  renderStatus(`${entry.title}<br>${entry.description}`, { status });
}

function getAuthTargetLabel(slug) {
  return AUTH_REQUIRED_TARGETS[slug] || 'cette page';
}

function renderAuthRequiredState(slug) {
  const entry = UI_STATES.AUTH_REQUIRED;
  const targetLabel = getAuthTargetLabel(slug);
  const message = `${entry.title}<br>${entry.description}<br>Vous n'êtes pas connecté. Connectez-vous pour accéder à :<br><strong>- ${targetLabel}</strong>`;
  renderStatus(message, {
    status: 'forbidden',
    action: {
      label: 'Se connecter',
      onClick: () => redirectToLogin()
    },
    secondaryAction: {
      label: 'S’inscrire',
      disabled: true
    }
  });
}

function redirectToLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `${LOGIN_PAGE}?next=${next}`;
}

let authActionModal = null;

function createAuthActionModal() {
  if (authActionModal) return authActionModal;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay auth-required-action-modal';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-panel">
      <h2>Action réservée</h2>
      <p class="modal-message"></p>
      <div class="modal-actions">
        <button class="primary-button" type="button">Se connecter</button>
        <button class="secondary-button" type="button" data-auth-action-cancel>Annuler</button>
      </div>
    </div>
  `;
  document.body.append(overlay);
  const messageEl = overlay.querySelector('.modal-message');
  const primaryButton = overlay.querySelector('.primary-button');
  const cancelButton = overlay.querySelector('[data-auth-action-cancel]');
  primaryButton.addEventListener('click', () => {
    hideAuthRequiredActionModal();
    redirectToLogin();
  });
  cancelButton.addEventListener('click', () => hideAuthRequiredActionModal());
  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      hideAuthRequiredActionModal();
    }
  });
  authActionModal = { overlay, messageEl };
  return authActionModal;
}

function showAuthRequiredActionModal(actionLabel) {
  const modal = createAuthActionModal();
  modal.messageEl.textContent = `Vous n'êtes pas connecté. Veuillez vous connecter pour ${actionLabel.toLowerCase()}.`;
  modal.overlay.hidden = false;
}

function hideAuthRequiredActionModal() {
  if (authActionModal) {
    authActionModal.overlay.hidden = true;
  }
}

function ensureAuthForAction(actionLabel) {
  if (state.user) return true;
  showAuthRequiredActionModal(actionLabel);
  return false;
}

window.ensureAuthForAction = ensureAuthForAction;
window.renderPostPurchaseConfirmation = renderPostPurchaseConfirmation;

function sanitizePage(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function renderStatus(message, options = {}) {
  const slot = getContentSlot();
  if (!slot) return;
  const { status = 'info', action, secondaryAction, loading = false } = options;
  const spinner = loading ? '<span class="loading-spinner" aria-hidden="true"></span>' : '';
  const busyAttr = loading ? ' aria-busy="true"' : '';
  const primaryButton = action
    ? `<button class="primary-button status-action" type="button">${escapeHtml(action.label)}</button>`
    : '';
  const secondaryButton = secondaryAction
    ? `<button class="secondary-button status-secondary-action" type="button" ${secondaryAction.disabled ? 'disabled' : ''
      }>${escapeHtml(secondaryAction.label)}</button>`
    : '';
  const actionsMarkup =
    primaryButton || secondaryButton
      ? `<div class="status-actions">
        ${primaryButton}
        ${secondaryButton}
      </div>`
      : '';
  slot.innerHTML = `
    <div class="status-banner status-${status}"${busyAttr}>
      ${spinner}
      <p>${message}</p>
      ${actionsMarkup}
    </div>
  `;
  if (action?.onClick) {
    const button = slot.querySelector('.status-action');
    if (button) {
      button.addEventListener('click', action.onClick);
    }
  }
  if (secondaryAction?.onClick) {
    const button = slot.querySelector('.status-secondary-action');
    if (button) {
      button.addEventListener('click', secondaryAction.onClick);
    }
  }
}

const POST_PURCHASE_CONFIRMATIONS = {
  formation: {
    emoji: '🎉',
    title: 'Formation ajoutée à vos formations',
    description: 'La formation premium est maintenant accessible depuis votre espace Mes formations. Vous pouvez y retourner quand vous le souhaitez.',
    buttonLabel: 'Accéder à mes formations',
    slug: 'myformations'
  },
  giftcard: {
    emoji: '🎁',
    title: 'Carte cadeau ajoutée à vos cartes',
    description: 'Votre carte cadeau est stockée dans votre espace Cartes cadeaux. Partagez-la ou utilisez-la lors de votre prochain achat.',
    buttonLabel: 'Voir mes cartes cadeaux',
    slug: 'my-gift-cards'
  }
};

function renderPostPurchaseConfirmation({ type } = {}) {
  const slot = getContentSlot();
  if (!slot) return;
  const normalized = type === 'giftcard' ? 'giftcard' : 'formation';
  const payload = POST_PURCHASE_CONFIRMATIONS[normalized];
  if (!payload) return;
  slot.innerHTML = `
    <article class="post-purchase-confirmation" role="status" aria-live="polite">
      <div class="post-purchase-confirmation__panel">
        <span class="post-purchase-confirmation__emoji" aria-hidden="true">${payload.emoji}</span>
        <h2 class="post-purchase-confirmation__title">${escapeHtml(payload.title)}</h2>
        <p class="post-purchase-confirmation__text">${escapeHtml(payload.description)}</p>
        <div class="post-purchase-confirmation__actions">
          <button class="primary-button" type="button" data-post-purchase-action>${escapeHtml(payload.buttonLabel)}</button>
        </div>
      </div>
    </article>
  `;
  applyTailwindPageLayout(slot);
  const actionButton = slot.querySelector('[data-post-purchase-action]');
  if (actionButton) {
    actionButton.addEventListener('click', () => {
      navigateToSlug(payload.slug, { source: 'post-purchase-action', skipThrottle: true });
    });
  }
}

async function fetchUserState() {
  try {
    const response = await fetch('/auth/me', { credentials: 'include' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 && payload?.code === 'MAINTENANCE') {
        redirectVitrineToMaintenance();
        return null;
      }
      if (payload?.code === 'SUSPENDED_ADMIN_LOGOUT') {
        window.location.href = '/login.html?reason=site-suspended';
      }
      return null;
    }
    const payload = await response.json().catch(() => ({}));
    return payload.user || null;
  } catch (error) {
    console.error('Erreur récupération utilisateur', error);
    return null;
  }
}

function isEntryAccessible(entry) {
  if (!entry || !entry.access) return true;
  if (entry.access.authenticated && !state.user) return false;
  return true;
}

function normalizeAcquisitionSlug(value) {
  const normalized = sanitizePage(value);
  if (!normalized) return null;
  const alias = ACQUISITION_SLUG_ALIASES[normalized] || normalized;
  return ACQUISITION_SLUG_SET.has(alias) ? alias : null;
}

function renderHeaderIcons() {
  if (!headerIconsRoot) return;
  const headerEntries = state.navigation.filter(
    entry => entry.navigationPlacement === 'header' && isEntryAccessible(entry)
  );
  headerIconsRoot.innerHTML = HEADER_ICON_SLOTS.map(slot => {
    const entry = headerEntries.find(item => item.slug === slot.slug);
    if (!entry) return '';
    const isActive = state.activeSlug === entry.slug;
    const badgeMarkup =
      slot.slug === CART_BADGE_SLUG
        ? `
          <span
            class="header-icon-badge header-icon-badge--hidden"
            data-header-icon-badge-for="${slot.slug}"
          ></span>
        `
        : '';
    return `
      <button
        type="button"
        class="header-icon-button ${isActive ? 'is-active' : ''}"
        data-header-icon="${entry.slug}"
        aria-label="${slot.label}"
      >
        <i class="${slot.icon}" aria-hidden="true"></i>
        <span class="sr-only">${slot.label}</span>
        ${badgeMarkup}
      </button>
    `;
  }).join('');
  headerIconsRoot.querySelectorAll('[data-header-icon]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      navigateToSlug(button.dataset.headerIcon, { source: 'header-icon' });
    });
  });
  updateNavigationHighlights(state.activeSlug);
  refreshCartBadge();
}

function renderBurgerList() {
  if (!burgerListRoot) return;
  const entries = state.navigation.filter(
    entry => entry.navigationPlacement === 'burger' && isEntryAccessible(entry)
  );
  if (!entries.length) {
    burgerListRoot.innerHTML = '<p class="module-placeholder">Navigation indisponible.</p>';
    return;
  }
  burgerListRoot.innerHTML = entries
    .map(entry => {
      const slug = sanitizePage(entry.slug) || '';
      if (!slug) return '';
      const badges = [];
      if (entry.access.requiresPurchase) badges.push('Payant');
      else if (entry.access.authenticated && !entry.access.public) badges.push('Connecte');
      const accessBadgeMarkup = badges.length ? `<small>${badges.join(' - ')}</small>` : '';
      const acquisitionSlug = normalizeAcquisitionSlug(slug);
      const acquisitionBadgeMarkup =
        acquisitionSlug
          ? `<span class="burger-panel__item-badge burger-panel__item-badge--hidden" data-burger-item-badge-for="${acquisitionSlug}" aria-hidden="true"></span>`
          : '';
      return `
        <button
          type="button"
          class="burger-panel__item ${state.activeSlug === slug ? 'is-active' : ''}"
          data-burger-link="${slug}"
        >
          <span>${escapeHtml(entry.label || entry.slug)}</span>
          <span class="burger-panel__item-trailing">
            ${acquisitionBadgeMarkup}
            ${accessBadgeMarkup}
          </span>
        </button>
      `;
    })
    .join('');
  hydrateBurgerItemBadges();
  burgerListRoot.querySelectorAll('[data-burger-link]').forEach(button => {
    button.addEventListener('click', () => {
      navigateToSlug(button.dataset.burgerLink, { source: 'burger-link' });
      closeBurger();
    });
  });
}

function updateNavigationHighlights(slug) {
  if (headerIconsRoot) {
    headerIconsRoot.querySelectorAll('[data-header-icon]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.headerIcon === slug);
    });
  }
  if (burgerListRoot) {
    burgerListRoot.querySelectorAll('[data-burger-link]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.burgerLink === slug);
    });
  }
}

const CART_BADGE_SLUG = 'panier';
const CART_ICON_PULSE_CLASS = 'header-icon-button--pulse';
const CART_BADGE_HIDDEN_CLASS = 'header-icon-badge--hidden';
const ACQUISITION_BADGE_HIDDEN_CLASS = 'header-icon-badge--hidden';
const ACQUISITION_BADGE_BUMP_CLASS = 'header-icon-badge--bump';
const BURGER_ITEM_BADGE_HIDDEN_CLASS = 'burger-panel__item-badge--hidden';

function getCartBadgeElement() {
  return headerIconsRoot?.querySelector(`[data-header-icon-badge-for="${CART_BADGE_SLUG}"]`);
}

function getCartIconButton() {
  return headerIconsRoot?.querySelector(`[data-header-icon="${CART_BADGE_SLUG}"]`);
}

function animateCartIconPulse() {
  const button = getCartIconButton();
  if (!button) return;
  button.classList.remove(CART_ICON_PULSE_CLASS);
  // Force reflow to restart animation
  void button.offsetWidth;
  button.classList.add(CART_ICON_PULSE_CLASS);
}

function refreshCartBadge(detail = {}) {
  const badge = getCartBadgeElement();
  if (!badge) return;
  if (!state.user) {
    badge.classList.add(CART_BADGE_HIDDEN_CLASS);
    badge.textContent = '';
    return;
  }
  const count =
    typeof detail?.count === 'number' ? detail.count : getItems().length;
  if (!count) {
    badge.classList.add(CART_BADGE_HIDDEN_CLASS);
    badge.textContent = '';
    return;
  }
  badge.textContent = String(count);
  badge.classList.remove(CART_BADGE_HIDDEN_CLASS);
  if (detail?.action === 'add') {
    animateCartIconPulse();
  }
}

function handleCartUpdated(event) {
  refreshCartBadge(event?.detail);
}

function bootstrapCartBadgeListeners() {
  if (typeof window === 'undefined') return;
  window.addEventListener('cart:updated', handleCartUpdated);
  window.addEventListener('storage', () => refreshCartBadge());
}

function getBurgerBadgeElement() {
  return burgerToggle?.querySelector('[data-burger-notification-badge]');
}

function hideBurgerBadge(badge) {
  if (!badge) return;
  badge.classList.add(ACQUISITION_BADGE_HIDDEN_CLASS);
  badge.textContent = '';
}

function refreshBurgerBadge(detail = {}) {
  const badge = getBurgerBadgeElement();
  if (!badge) return;
  if (!state.user) {
    hideBurgerBadge(badge);
    return;
  }
  const total =
    typeof detail?.total === 'number' ? detail.total : getTotalNotificationCount();
  if (!total) {
    hideBurgerBadge(badge);
    return;
  }
  badge.textContent = String(total);
  badge.classList.remove(ACQUISITION_BADGE_HIDDEN_CLASS);
}

function hydrateBurgerItemBadges(explicitCounts) {
  if (!burgerListRoot) return;
  const badges = burgerListRoot.querySelectorAll('[data-burger-item-badge-for]');
  if (!badges.length) return;
  const counts = state.user ? explicitCounts || getNotificationCounts() : {};
  badges.forEach(badge => {
    const slug = normalizeAcquisitionSlug(badge.dataset.burgerItemBadgeFor);
    const count = slug ? Number(counts?.[slug] || 0) : 0;
    if (count > 0) {
      badge.textContent = String(count);
      badge.classList.remove(BURGER_ITEM_BADGE_HIDDEN_CLASS);
      badge.setAttribute('aria-label', `${count} acquisition${count > 1 ? 's' : ''} en attente`);
      badge.removeAttribute('aria-hidden');
      return;
    }
    badge.textContent = '';
    badge.classList.add(BURGER_ITEM_BADGE_HIDDEN_CLASS);
    badge.setAttribute('aria-hidden', 'true');
    badge.removeAttribute('aria-label');
  });
}

function handleAcquisitionUpdate(event) {
  refreshBurgerBadge(event?.detail);
  hydrateBurgerItemBadges(event?.detail?.counts);
}

function bootstrapAcquisitionBadgeListeners() {
  if (typeof window === 'undefined') return;
  window.addEventListener(ACQUISITION_NOTIFICATION_EVENT, handleAcquisitionUpdate);
  window.addEventListener('storage', () => {
    refreshBurgerBadge();
    hydrateBurgerItemBadges();
  });
  window.addEventListener(ACQUISITION_ANIMATION_COMPLETE_EVENT, handleAnimationComplete);
}

function pulseBurgerBadge() {
  const badge = getBurgerBadgeElement();
  if (!badge) return;
  badge.classList.add(ACQUISITION_BADGE_BUMP_CLASS);
  if (acquisitionBadgePulseTimeout) {
    clearTimeout(acquisitionBadgePulseTimeout);
  }
  acquisitionBadgePulseTimeout = setTimeout(() => {
    badge.classList.remove(ACQUISITION_BADGE_BUMP_CLASS);
    acquisitionBadgePulseTimeout = null;
  }, 220);
}

function handleAnimationComplete(event) {
  const mode = sanitizePage(event?.detail?.mode || 'acquisition');
  if (mode !== 'acquisition') return;
  pulseBurgerBadge();
}

function setBurgerState(open) {
  if (!burgerPanel || !burgerOverlay || !burgerToggle) return;
  burgerPanel.classList.toggle('is-open', open);
  burgerOverlay.classList.toggle('is-open', open);
  burgerPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  burgerToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function openBurger() {
  renderBurgerList();
  setBurgerState(true);
}

function closeBurger() {
  setBurgerState(false);
}

function toggleBurger() {
  setBurgerState(!(burgerPanel && burgerPanel.classList.contains('is-open')));
}

let burgerTouchStartX = null;

function handleBurgerTouchStart(event) {
  if (!burgerPanel?.classList.contains('is-open')) return;
  burgerTouchStartX = event.touches?.[0]?.clientX ?? null;
}

function shouldUsePaymentResultModule(query) {
  if (!query || typeof query !== 'object') return false;
  const paymentIntentId = String(query.payment_intent || '').trim();
  const freeCheckout = String(query.freeCheckout || '').trim().toLowerCase();
  return Boolean(paymentIntentId) || freeCheckout === '1' || freeCheckout === 'true';
}

function handleBurgerTouchMove(event) {
  if (burgerTouchStartX === null) return;
  const currentX = event.touches?.[0]?.clientX ?? 0;
  const deltaX = currentX - burgerTouchStartX;
  if (deltaX < -40) {
    closeBurger();
    burgerTouchStartX = null;
  }
}

function handleBurgerTouchEnd() {
  burgerTouchStartX = null;
}

function setupBurgerInteractions() {
  if (burgerToggle) {
    burgerToggle.addEventListener('click', () => toggleBurger());
  }
  if (burgerOverlay) {
    burgerOverlay.addEventListener('click', () => closeBurger());
  }
  if (burgerClose) {
    burgerClose.addEventListener('click', () => closeBurger());
  }
  if (burgerPanel) {
    burgerPanel.addEventListener('touchstart', handleBurgerTouchStart, { passive: true });
    burgerPanel.addEventListener('touchmove', handleBurgerTouchMove, { passive: true });
    burgerPanel.addEventListener('touchend', handleBurgerTouchEnd, { passive: true });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeBurger();
    }
  });
}

function abortMenuFetch() {
  if (menuAbortController) {
    menuAbortController.abort('navigation refresh');
  }
  menuAbortController = new AbortController();
}

async function loadNavigation() {
  abortMenuFetch();
  logFetch('menu', { navigationId: navigationCounter, route: NAVIGATION_ROUTE });
  try {
    const response = await fetch(NAVIGATION_ROUTE, { signal: menuAbortController.signal });
    if (!response.ok) {
      throw new Error('Impossible de charger la navigation vitrine.');
    }
    const payload = await response.json().catch(() => ({}));
    state.navigation = Array.isArray(payload.navigation) ? payload.navigation : [];
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('[VITRINE FETCH MENU] aborted', error);
    } else {
      console.error('Erreur navigation vitrine', error);
      state.navigation = [];
    }
  } finally {
    renderHeaderIcons();
    renderBurgerList();
    renderFooterNavigation();
  }
}

async function loadPage(name, { signal, navigationId, query } = {}) {
  if (!container) return;
  const slot = getContentSlot();
  if (!slot) return;
  const slug = evaluateNavigationSlug(name);
  if (navigationId && navigationId !== currentNavigationId) {
    logNavigation('load-page-skipped-stale', { slug, navigationId, currentNavigationId });
    return;
  }
  const loaderHandle = showGlobalLoader({ slug, navigationId });
  state.activeSlug = slug;
  updateNavigationHighlights(slug);
  closeBurger();
  clearDevBanner();
  clearDisabledTimer();
  try {
    logFetch('page', { slug, navigationId });
    const response = await fetch(`/api/vitrine/pages/${slug}`, { credentials: 'include', signal });
    if (navigationId && navigationId !== currentNavigationId) {
      logNavigation('load-page-stale-after-fetch', { slug, navigationId, currentNavigationId });
      return;
    }
    if (!response.ok) {
      if (response.status === 404) {
        renderStatus('Page introuvable.', { status: 'forbidden' });
        return;
      }
      renderStatus('Erreur réseau lors du chargement de la page.', { status: 'forbidden' });
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (navigationId && navigationId !== currentNavigationId) {
      logNavigation('load-page-stale-after-payload', { slug, navigationId, currentNavigationId });
      return;
    }
    const pageState = payload.state || 'EMPTY';
    if (payload.access?.requiresAuth && !state.user) {
      renderAuthRequiredState(slug);
      return;
    }
    if (pageState === 'PAGE_DISABLED') {
      renderDisabledScreen(payload);
      return;
    }
    if (!payload.allowed) {
      if (payload.accessReason === 'purchase') {
        renderStatus('Achat requis : cette page est reservee aux utilisateurs ayant achete la formation.', {
          status: 'forbidden'
        });
      } else {
        renderUIState('FORBIDDEN');
      }
      return;
    }
    if (pageState === 'EMPTY') {
      renderUIState('EMPTY');
      return;
    }
    if (pageState !== 'OK') {
      renderStatus('Donnees mal formees.', { status: 'forbidden' });
      return;
    }
    if (payload.disabled) {
      renderDevBanner();
    }
    if (!payload.module) {
      renderStatus('Donnees mal formees.', { status: 'forbidden' });
      return;
    }
    if (navigationId && navigationId !== currentNavigationId) {
      logNavigation('load-page-stale-module', { slug, navigationId, currentNavigationId });
      return;
    }
    // Normaliser le moduleFile : retirer .js et suffixe Module si déjà présents
    // (protège contre les valeurs saisies comme "myServicesModule" ou "myServicesModule.js")
    function resolveModuleName(name) {
      let n = (name || '').replace(/\.js$/, '');
      if (!n.endsWith('Module')) n += 'Module';
      return n;
    }
    const resolvedModuleName = shouldUsePaymentResultModule(query)
      ? 'paymentResultModule'
      : resolveModuleName(payload.module);
    const pageModule = await import(`/js/modules/${resolvedModuleName}.js`);
    if (navigationId && navigationId !== currentNavigationId) {
      logNavigation('load-page-stale-after-import', { slug, navigationId, currentNavigationId });
      return;
    }
    if (pageModule && typeof pageModule.renderPage === 'function') {
      const moduleData = {
        ...(payload.data || {}),
        user: state.user,
        query
      };
      slot.innerHTML = '';
      await pageModule.renderPage(slot, moduleData);
      if (navigationId && navigationId !== currentNavigationId) {
        logNavigation('load-page-stale-after-render', { slug, navigationId, currentNavigationId });
        return;
      }
      applyTailwindPageLayout(slot);
    } else {
      renderStatus('Module invalide : pas de fonction renderPage().', { status: 'forbidden' });
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('[VITRINE LOAD PAGE] aborted', { slug, navigationId });
      return;
    }
    console.error('Erreur chargement page', error);
    renderStatus('Impossible de charger la page.', { status: 'forbidden' });
  } finally {
    await hideGlobalLoader(loaderHandle);
  }
}


function startNavigation(slug, options = {}) {
  navigationCounter += 1;
  const navigationId = navigationCounter;
  if (navigationAbortController) {
    navigationAbortController.abort('new navigation');
  }
  navigationAbortController = new AbortController();
  currentNavigationId = navigationId;
  const navigationQuery = sanitizeNavigationQuery(options.query);
  logNavigation('start', { slug, navigationId, source: options.source, query: navigationQuery });
  return loadPage(slug, { signal: navigationAbortController.signal, navigationId, query: navigationQuery })
    .then(() => {
      if (navigationId === navigationCounter && !options.skipHistoryUpdate) {
        updateHistoryState(slug, { replace: options.replaceHistory, query: navigationQuery });
      }
    })
    .finally(() => {
      if (navigationId === currentNavigationId) {
        currentNavigationId = null;
        navigationAbortController = null;
      }
    });
}

function navigateToSlug(slug, options = {}) {
  const normalizedSlug = evaluateNavigationSlug(slug);
  if (!normalizedSlug) return;
  if (shouldThrottleNavigation(options.skipThrottle)) {
    logNavigation('throttled', { slug: normalizedSlug });
    return;
  }
  if (!options.force && normalizedSlug === state.activeSlug && !navigationAbortController) {
    logNavigation('skip-same-page', { slug: normalizedSlug });
    return;
  }
  return startNavigation(normalizedSlug, options);
}

function handleNavigationEvent(event) {
  const slug = sanitizePage(event?.detail?.slug);
  if (!slug) return;
  navigateToSlug(slug, {
    source: event.detail?.source || 'event',
    skipThrottle: Boolean(event.detail?.skipThrottle),
    replaceHistory: Boolean(event.detail?.replaceHistory),
    skipHistoryUpdate: event.detail?.skipHistoryUpdate
    ,
    query: event.detail?.query
  });
}

if (typeof window !== 'undefined') {
  patchLocationLogging();
  window.addEventListener('resize', syncContentViewportMetrics);
  window.addEventListener(VITRINE_NAV_EVENT, handleNavigationEvent);
  window.addEventListener(EMPTY_STATE_ACTION_EVENT, event => {
    const slug = sanitizePage(event?.detail?.slug);
    if (slug) {
      navigateToSlug(slug, { source: 'empty-state', skipThrottle: true });
    }
  });
  window.addEventListener('popstate', event => {
    const slug = sanitizePage(event?.state?.slug) || getSlugFromLocation() || 'home';
    navigateToSlug(slug, {
      source: 'popstate',
      skipThrottle: true,
      skipHistoryUpdate: true
      ,
      query: event?.state?.query
    });
  });
}

document.addEventListener('click', event => {
  const link = event.target.closest('[data-footer-link]');
  if (!link) return;
  const slug = String(link.dataset.footerLink || '').trim();
  if (!slug) return;
  event.preventDefault();
  navigateToSlug(slug, { source: 'footer-link' });
});

bootstrapCartBadgeListeners();
bootstrapAcquisitionBadgeListeners();

document.addEventListener('DOMContentLoaded', async () => {
  installVitrineAccessRedirectGuard();
  syncContentViewportMetrics();
  renderFooterLegalLinks();
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('payment_intent')
    ? 'payment'
    : sanitizePage(params.get(PAGE_PARAM) || params.get(SLUG_PARAM)) || 'home';
  state.user = await fetchUserState();
  setCartUser(state.user, { forceReload: true, sync: true, emit: true });
  refreshCartBadge();
  refreshBurgerBadge();
  await loadUIConfig();
  await loadTheme();
  await loadSiteIdentity();
  setupBurgerInteractions();
  await loadNavigation();
  await loadSocialLinks();
  const fallback = requested || state.navigation[0]?.slug || 'home';
  if (headerHomeButton) {
    headerHomeButton.addEventListener('click', event => {
      event.preventDefault();
      navigateToSlug('home', { source: 'header-home' });
    });
  }
  const initialQuery = extractQueryFromLocation();
  navigateToSlug(fallback, {
    source: 'initial',
    skipThrottle: true,
    replaceHistory: true,
    query: initialQuery
  });
});


