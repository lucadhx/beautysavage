import Page from '../models/Page.js';
import VitrineMenuItem from '../models/VitrineMenuItem.js';
import { PURCHASE_ITEM_TYPES } from '../models/Purchase.js';
import mongoose from 'mongoose';

const DEFAULT_PURCHASE_TYPE = 'product';

const NAVIGATION_PLACEMENTS = new Set(['header', 'burger']);
const ALLOWED_GESTION_ROLES = new Set(['admin', 'dev']);
const { Types } = mongoose;

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

function normalizePurchaseType(value) {
  if (!value) return DEFAULT_PURCHASE_TYPE;
  const candidate = String(value).trim().toLowerCase();
  return PURCHASE_ITEM_TYPES.includes(candidate) ? candidate : DEFAULT_PURCHASE_TYPE;
}

function normalizeNavigationPlacement(value) {
  if (!value) return null;
  const candidate = String(value).trim().toLowerCase();
  return NAVIGATION_PLACEMENTS.has(candidate) ? candidate : null;
}

function buildAccess(access = {}) {
  const requiresPurchase = Boolean(access.requiresPurchase);
  return {
    public: Boolean(access.public),
    requiresAuth: Boolean(access.requiresAuth),
    requiresPurchase,
    purchaseType: requiresPurchase ? normalizePurchaseType(access.purchaseType) : null
  };
}

function mapPagePayload(page) {
  return {
    id: page._id?.toString(),
    slug: page.slug,
    moduleFile: page.moduleFile,
    type: page.type,
    order: page.order,
    access: buildAccess(page.access),
    disabled: buildDisabled(page.disabled),
    devOnly: Boolean(page.devOnly),
    allowedRolesGestion: normalizeAllowedRolesGestion(page.allowedRolesGestion),
    navigationPlacement: page.navigationPlacement || null
  };
}

function mapMenuPayload(item) {
  return {
    id: item._id?.toString(),
    label: item.label,
    slug: item.slug,
    order: item.order,
    access: buildAccess(item.access)
  };
}

function normalizeType(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return candidate === 'gestion' ? 'gestion' : 'vitrine';
}

function extractAccess(body = {}) {
  const requiresPurchase = Boolean(body.requiresPurchase);
  return {
    public: Boolean(body.public),
    requiresAuth: Boolean(body.requiresAuth),
    requiresPurchase,
    purchaseType: requiresPurchase ? normalizePurchaseType(body.purchaseType) : null
  };
}

function buildDisabled(disabled = {}) {
  return {
    enabled: Boolean(disabled.enabled),
    from: formatDateForPayload(disabled?.from),
    to: formatDateForPayload(disabled?.to)
  };
}

function formatDateForPayload(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeOrderedPageIds(values) {
  const raw = Array.isArray(values) ? values : values ? [values] : [];
  const seen = new Set();
  const orderedIds = [];
  for (const value of raw) {
    const candidate = String(value || '').trim();
    if (!Types.ObjectId.isValid(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    orderedIds.push(candidate);
  }
  return orderedIds;
}

function extractDisabled(body = {}) {
  return {
    enabled: Boolean(body.enabled),
    from: body.from !== undefined ? parseDate(body.from) : null,
    to: body.to !== undefined ? parseDate(body.to) : null
  };
}

export async function getPages(req, res) {
  try {
    const userRole = String(req?.sessionUser?.role || '').trim().toLowerCase();
    const pages = await Page.find().sort({ order: 1 }).lean();
    const filteredPages = pages.filter(page => {
      if (page.type !== 'gestion') return true;
      const allowedRoles = normalizeAllowedRolesGestion(page.allowedRolesGestion);
      return allowedRoles.includes(userRole);
    });
    return res.json({ ok: true, pages: filteredPages.map(mapPagePayload) });
  } catch (error) {
    console.error('Impossible de lister les pages', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les pages.' });
  }
}

export async function createPage(req, res) {
  const { slug, moduleFile, order = 0 } = req.body || {};
  if (!slug || !moduleFile) {
    return res.status(400).json({ ok: false, error: 'Slug et moduleFile requis.' });
  }
  try {
    const normalizedSlug = String(slug).trim().toLowerCase();
    const type = normalizeType(req.body?.type || 'vitrine');
    const hasRoleInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedRolesGestion');
    const allowedRolesGestion =
      type === 'gestion'
        ? normalizeAllowedRolesGestion(req.body?.allowedRolesGestion, { allowDefault: !hasRoleInput })
        : undefined;
    if (type === 'gestion' && !allowedRolesGestion.length) {
      return res
        .status(400)
        .json({ ok: false, error: 'Au moins un role (admin ou dev) est requis pour la page gestion.' });
    }
    const existing = await Page.findOne({ slug: normalizedSlug }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Une page porte dÃ©jÃ  ce slug.' });
    }
    const candidate = new Page({
      slug: normalizedSlug,
      moduleFile: String(moduleFile).trim(),
      type,
      order: Number(order) || 0,
      allowedRolesGestion,
      access: type === 'vitrine' ? extractAccess(req.body) : undefined,
      disabled: extractDisabled(req.body?.disabled || {}),
      navigationPlacement: type === 'vitrine' ? normalizeNavigationPlacement(req.body?.navigationPlacement) : null,
      devOnly: Boolean(req.body?.devOnly)
    });
    if (type === 'gestion') {
      candidate.access = {};
    }
    await candidate.save();
    return res.status(201).json({ ok: true, page: mapPagePayload(candidate.toObject()) });
  } catch (error) {
    console.error('Erreur crÃ©ation page', error);
    return res.status(500).json({ ok: false, error: 'Impossible de crÃ©er la page.' });
  }
}

export async function updatePage(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  const { slug, moduleFile, order } = req.body || {};
  try {
    const page = await Page.findById(id);
    if (!page) {
      return res.status(404).json({ ok: false, error: 'Page introuvable.' });
    }
    if (slug) page.slug = String(slug).trim().toLowerCase();
    if (moduleFile) page.moduleFile = String(moduleFile).trim();
    if (typeof order !== 'undefined') page.order = Number(order) || 0;
    if (req.body && typeof req.body.type !== 'undefined') {
      page.type = normalizeType(req.body.type);
    }
    if (page.type === 'vitrine') {
      page.access = extractAccess(req.body);
      if (Object.prototype.hasOwnProperty.call(req.body, 'navigationPlacement')) {
        page.navigationPlacement = normalizeNavigationPlacement(req.body.navigationPlacement);
      }
    } else {
      page.access = {};
      page.navigationPlacement = null;
    }
    const hasRoleInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedRolesGestion');
    if (hasRoleInput || page.type === 'gestion') {
      const roles = normalizeAllowedRolesGestion(
        hasRoleInput ? req.body.allowedRolesGestion : page.allowedRolesGestion,
        { allowDefault: !hasRoleInput }
      );
      if (!roles.length) {
        return res
          .status(400)
          .json({ ok: false, error: 'Au moins un role (admin ou dev) est requis pour la page gestion.' });
      }
      page.allowedRolesGestion = roles;
    }
    if (req.body && typeof req.body.disabled !== 'undefined') {
      page.disabled = extractDisabled(req.body.disabled);
    }
    if (req.body && typeof req.body.devOnly !== 'undefined') {
      page.devOnly = Boolean(req.body.devOnly);
    }
    await page.save();
    return res.json({ ok: true, page: mapPagePayload(page.toObject()) });
  } catch (error) {
    console.error('Erreur mise Ã  jour page', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre Ã  jour la page.' });
  }
}

export async function deletePage(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  try {
    const deleted = await Page.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Page introuvable.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur suppression page', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer la page.' });
  }
}

export async function updatePagesOrder(req, res) {
  const orderedPageIds = normalizeOrderedPageIds(req.body?.orderedPageIds);
  if (!orderedPageIds.length) {
    return res.status(400).json({ ok: false, error: 'orderedPageIds est requis.' });
  }

  try {
    const pages = await Page.find({
      _id: { $in: orderedPageIds },
      type: 'vitrine'
    })
      .select({ _id: 1 })
      .lean();

    if (pages.length !== orderedPageIds.length) {
      return res.status(400).json({ ok: false, error: 'Certaines pages vitrines sont introuvables.' });
    }

    const orderedSet = new Set(orderedPageIds);
    const remainingPages = await Page.find({
      type: 'vitrine',
      _id: { $nin: orderedPageIds }
    })
      .sort({ order: 1, createdAt: 1 })
      .select({ _id: 1 })
      .lean();

    const finalOrderIds = [
      ...orderedPageIds,
      ...remainingPages
        .map(page => String(page._id))
        .filter(pageId => !orderedSet.has(pageId))
    ];

    const bulkOps = finalOrderIds.map((pageId, index) => ({
      updateOne: {
        filter: { _id: pageId, type: 'vitrine' },
        update: { $set: { order: index } }
      }
    }));

    if (bulkOps.length) {
      await Page.bulkWrite(bulkOps, { ordered: true });
    }

    const updatedPages = await Page.find({ type: 'vitrine' })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return res.json({ ok: true, pages: updatedPages.map(mapPagePayload) });
  } catch (error) {
    console.error('Impossible de mettre a jour l ordre des pages vitrine', error);
    return res.status(500).json({ ok: false, error: "Impossible d'enregistrer l'ordre des pages." });
  }
}

export async function getMenuItems(_req, res) {
  try {
    const menu = await VitrineMenuItem.find().sort({ order: 1 }).lean();
    return res.json({ ok: true, menu: menu.map(mapMenuPayload) });
  } catch (error) {
    console.error('Impossible de charger le menu', error);
    return res.status(500).json({ ok: false, error: 'Impossible de charger le menu vitrine.' });
  }
}

export async function createMenuItem(req, res) {
  const { label, slug, order = 0 } = req.body || {};
  if (!label || !slug) {
    return res.status(400).json({ ok: false, error: 'Label et slug requis.' });
  }
  try {
    const normalizedSlug = String(slug).trim().toLowerCase();
    const candidate = new VitrineMenuItem({
      label: String(label).trim(),
      slug: normalizedSlug,
      order: Number(order) || 0,
      access: extractAccess(req.body)
    });
    await candidate.save();
    return res.status(201).json({ ok: true, menu: mapMenuPayload(candidate.toObject()) });
  } catch (error) {
    console.error('Erreur crÃ©ation menu', error);
    return res.status(500).json({ ok: false, error: 'Impossible de crÃ©er un item de menu.' });
  }
}

export async function updateMenuItem(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  const { label, slug, order } = req.body || {};
  try {
    const menu = await VitrineMenuItem.findById(id);
    if (!menu) {
      return res.status(404).json({ ok: false, error: 'Item introuvable.' });
    }
    if (label) menu.label = String(label).trim();
    if (slug) menu.slug = String(slug).trim().toLowerCase();
    if (typeof order !== 'undefined') menu.order = Number(order) || 0;
    menu.access = extractAccess(req.body);
    await menu.save();
    return res.json({ ok: true, menu: mapMenuPayload(menu.toObject()) });
  } catch (error) {
    console.error('Erreur mise Ã  jour menu', error);
    return res.status(500).json({ ok: false, error: "Impossible de mettre à jour l'item." });
  }
}

export async function deleteMenuItem(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok: false, error: 'Identifiant manquant.' });
  try {
    const deleted = await VitrineMenuItem.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Item introuvable.' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Erreur suppression menu', error);
    return res.status(500).json({ ok: false, error: "Impossible de supprimer l'item." });
  }
}


