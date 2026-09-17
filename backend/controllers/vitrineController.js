import Page from '../models/Page.js';
import VitrineMenuItem from '../models/VitrineMenuItem.js';
import Purchase, { PURCHASE_ITEM_TYPES } from '../models/Purchase.js';
import Sale from '../models/Sale.js';
import User from '../models/user.js';
import { getSessionUserId } from '../utils/session.js';

const DEFAULT_PURCHASE_TYPE = 'product';
const PAGE_STATES = {
  OK: 'OK',
  FORBIDDEN: 'FORBIDDEN',
  PAGE_DISABLED: 'PAGE_DISABLED'
};

const ALLOWED_GESTION_ROLES = new Set(['admin', 'dev']);

const NAVIGATION_PLACEMENTS = ['header', 'burger'];
const NAV_LABEL_OVERRIDES = {
  home: 'Accueil',
  about: 'À propos',
  shop: 'Boutique',
  myaccount: 'Mon compte',
  myfavorites: 'Mes favoris',
  checkout: 'Panier',
  'my-gift-cards': 'Mes cartes cadeaux',
  'distanciel-modules': 'Modules distanciels',
  'presentiel-sessions': 'Sessions présentiel',
  'mentions-legales': 'Mentions légales',
  'politique-confidentialite': 'Politique de confidentialité',
  cgv: 'Conditions générales de vente'
};

function normalizeAllowedRolesGestion(values, { allowDefault = true } = {}) {
  const raw = Array.isArray(values) ? values : values ? [values] : [];
  const normalized = [
    ...new Set(
      raw
        .map(value => String(value || '').trim().toLowerCase())
        .filter(value => ALLOWED_GESTION_ROLES.has(value))
    )
  ];
  if (normalized.length) return normalized;
  return allowDefault ? ['admin', 'dev'] : [];
}

function formatSlugLabel(slug) {
  if (!slug) return '';
  if (NAV_LABEL_OVERRIDES[slug]) {
    return NAV_LABEL_OVERRIDES[slug];
  }
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map(fragment => fragment.charAt(0).toUpperCase() + fragment.slice(1))
    .join(' ');
}

function normalizePurchaseType(value) {
  if (!value) return DEFAULT_PURCHASE_TYPE;
  const candidate = String(value).trim().toLowerCase();
  return PURCHASE_ITEM_TYPES.includes(candidate) ? candidate : DEFAULT_PURCHASE_TYPE;
}

function buildAccess(access = {}) {
  const requiresPurchase = Boolean(access.requiresPurchase);
  return {
    public: Boolean(access.public),
    authenticated: Boolean(access.requiresAuth),
    requiresPurchase,
    purchaseType: requiresPurchase ? normalizePurchaseType(access.purchaseType) : null
  };
}

async function userHasPurchase(userId, itemType) {
  if (!userId) return false;
  const type = normalizePurchaseType(itemType);
  const purchaseExists = await Purchase.exists({ userId, itemType: type });
  const saleQuery = { userId, 'items.type': type };
  const saleExists = await Sale.exists(saleQuery);
  console.log(
    `[vitrine] userHasPurchase user=${userId} type=${type} purchase=${Boolean(
      purchaseExists
    )} saleQuery=${JSON.stringify(saleQuery)} sale=${Boolean(saleExists)}`
  );
  return Boolean(purchaseExists || saleExists);
}

async function determineAllowed(access, userId, options = {}) {
  if (!access) {
    return { allowed: true, reason: null };
  }
  if (access.requiresPurchase) {
    if (!userId) {
      return { allowed: false, reason: 'auth' };
    }
    const defaultPurchaseType = options.defaultPurchaseType || DEFAULT_PURCHASE_TYPE;
    const purchaseType =
      options.forcePurchaseType || access.purchaseType || defaultPurchaseType;
    const hasPurchase = await userHasPurchase(userId, purchaseType);
    console.log(
      `[vitrine] determineAllowed user=${userId} slug=${options.slug || 'n/a'} purchaseType=${purchaseType} hasPurchase=${hasPurchase}`
    );
    return { allowed: hasPurchase, reason: hasPurchase ? null : 'purchase' };
  }
  if (access.requiresAuth && !userId) {
    return { allowed: false, reason: 'auth' };
  }
  return { allowed: true, reason: null };
}

async function loadSessionUser(userId) {
  if (!userId) return null;
  try {
    return await User.findById(userId).lean();
  } catch (error) {
    console.error('Erreur récupération utilisateur session', error);
    return null;
  }
}

function isCurrentlyDisabled(disabled = {}) {
  const now = new Date();
  if (!disabled?.enabled) return false;
  const from = disabled?.from ? new Date(disabled.from) : null;
  const to = disabled?.to ? new Date(disabled.to) : null;
  const started = !from || now >= from;
  const ongoing = !to || now <= to;
  return started && ongoing;
}

function formatDisabledUntil(disabled = {}) {
  if (!disabled?.to) return null;
  const target = new Date(disabled.to);
  if (Number.isNaN(target.getTime())) return null;
  return target.toISOString();
}

export async function getMenu(_req, res) {
  try {
    const pages = await Page.find({
      type: 'vitrine',
      navigationPlacement: { $in: NAVIGATION_PLACEMENTS }
    })
      .sort({ order: 1 })
      .lean();
    const slugs = pages.map(page => page.slug);
    const menuItems = await VitrineMenuItem.find({ slug: { $in: slugs } }).lean();
    const labelMap = menuItems.reduce((acc, item) => {
      if (item.slug) {
        acc[item.slug] = item.label;
      }
      return acc;
    }, {});
    const navigation = pages.map(page => ({
      slug: page.slug,
      label: labelMap[page.slug] || formatSlugLabel(page.slug),
      order: page.order,
      navigationPlacement: page.navigationPlacement,
      access: buildAccess(page.access)
    }));
    return res.json({ ok: true, navigation });
  } catch (error) {
    console.error('Erreur menu vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le menu.' });
  }
}

const FALLBACK_PAGES = {
  accueil: {
    slug: 'accueil',
    moduleFile: 'home',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false },
    disabled: { enabled: false }
  },
  boutique: {
    slug: 'boutique',
    moduleFile: 'shop',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false },
    disabled: { enabled: false }
  },
  'item-detail': {
    slug: 'item-detail',
    moduleFile: 'itemDetail',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false },
    disabled: { enabled: false }
  },
  checkout: {
    slug: 'checkout',
    moduleFile: 'checkout',
    type: 'vitrine',
    order: 0,
    access: { public: false, requiresAuth: true },
    disabled: { enabled: false }
  },
  payment: {
    slug: 'payment',
    moduleFile: 'paymentSimulation',
    type: 'vitrine',
    order: 0,
    access: { public: false, requiresAuth: true },
    disabled: { enabled: false }
  },
  'gift-card': {
    slug: 'gift-card',
    moduleFile: 'giftCardPurchase',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: true, requiresPurchase: false },
    disabled: { enabled: false }
  },
  'gift-card-detail': {
    slug: 'gift-card-detail',
    moduleFile: 'myGiftCardDetail',
    type: 'vitrine',
    order: 0,
    access: { public: false, requiresAuth: true },
    disabled: { enabled: false }
  },
  'my-gift-cards': {
    slug: 'my-gift-cards',
    moduleFile: 'myGiftCards',
    type: 'vitrine',
    order: 0,
    access: { public: false, requiresAuth: true, requiresPurchase: false },
    disabled: { enabled: false }
  },
  signup: {
    slug: 'signup',
    moduleFile: 'signup',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  'verify-email': {
    slug: 'verify-email',
    moduleFile: 'verifyEmail',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  'session-cancel-decision': {
    slug: 'session-cancel-decision',
    moduleFile: 'sessionCanceledDecision',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  'refund-tracking': {
    slug: 'refund-tracking',
    moduleFile: 'refundTracking',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  },
  invoice: {
    slug: 'invoice',
    moduleFile: 'invoice',
    type: 'vitrine',
    order: 0,
    access: { public: true, requiresAuth: false, requiresPurchase: false },
    disabled: { enabled: false }
  }
};

export async function getPage(req, res) {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    let page = await Page.findOne({ slug }).lean();
    const fallback = FALLBACK_PAGES[slug] || null;
    if (!page && fallback) {
      page = fallback;
    }
    if (!page) {
      return res.status(404).json({ ok: false, error: 'Page introuvable.' });
    }
    const userId = getSessionUserId(req);
    const user = await loadSessionUser(userId);
    const disabledActive = isCurrentlyDisabled(page.disabled);
    let allowed = true;
    let state = PAGE_STATES.OK;
    let disabledUntil = null;
    let devOverride = false;
    let accessReason = null;

    if (page.type === 'gestion') {
      const allowedRoles = normalizeAllowedRolesGestion(page.allowedRolesGestion);
      const userRole = String(user?.role || '').trim().toLowerCase();
      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          ok: false,
          state: PAGE_STATES.FORBIDDEN,
          error: 'Accès réservé aux admins/devs autorisés par cette page.',
          code: 'FORBIDDEN_GESTION_ROLE'
        });
      }
      const currentMode = user?.currentMode;
      if (currentMode !== 'gestion') {
        allowed = false;
        state = PAGE_STATES.FORBIDDEN;
      } else if (disabledActive) {
        disabledUntil = formatDisabledUntil(page.disabled);
        if (user?.role === 'dev') {
          allowed = true;
          state = PAGE_STATES.OK;
          devOverride = true;
        } else {
          allowed = false;
          state = PAGE_STATES.PAGE_DISABLED;
        }
      }
    } else {
    const moduleName = (page.moduleFile || slug || '').trim().toLowerCase();
    const formationPurchaseModules = new Set(['myformations', 'distancielmodules', 'presentielsessions']);
    const defaultPurchaseTypeForPage = formationPurchaseModules.has(moduleName) ? 'formation' : DEFAULT_PURCHASE_TYPE;
    const forcePurchaseType = formationPurchaseModules.has(moduleName) ? 'formation' : null;
    const accessCheck = await determineAllowed(page.access, userId, {
      defaultPurchaseType: defaultPurchaseTypeForPage,
      forcePurchaseType,
      slug: page.slug
    });
      allowed = accessCheck.allowed;
      accessReason = accessCheck.reason;
      if (!allowed) {
        state = PAGE_STATES.FORBIDDEN;
      }
      if (disabledActive) {
        disabledUntil = formatDisabledUntil(page.disabled);
        if (user?.role === 'dev') {
          allowed = true;
          state = PAGE_STATES.OK;
          devOverride = true;
        } else {
          allowed = false;
          state = PAGE_STATES.PAGE_DISABLED;
        }
      }
    }

    const payload = {
      ok: true,
      allowed,
      state,
      module: page.moduleFile,
      data: { slug: page.slug },
      accessReason
    };
    if (state === PAGE_STATES.PAGE_DISABLED) {
      payload.disabledUntil = disabledUntil;
    }
    if (devOverride) {
      payload.disabled = true;
    }
    return res.json(payload);
  } catch (error) {
    console.error('Erreur page vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire la page.' });
  }
}
