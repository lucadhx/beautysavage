import mongoose from 'mongoose';

import Page from '../models/Page.js';
import CategoryGestion from '../models/CategoryGestion.js';

const UNCATEGORIZED_KEY = 'UNCATEGORIZED';
const GESTION_TYPE = 'gestion';
const DEFAULT_CATEGORY_ICON = 'bi-folder';
const DEFAULT_PURCHASE_TYPE = 'product';
const NAVIGATION_PLACEMENTS = new Set(['header', 'burger']);
const ALLOWED_GESTION_ROLES = new Set(['admin', 'dev']);
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

function toObjectId(value) {
  if (!value) return null;
  const candidate = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(candidate)) return null;
  return new mongoose.Types.ObjectId(candidate);
}

function toObjectIdString(value) {
  const id = toObjectId(value);
  return id ? id.toString() : null;
}

function uniqueStrings(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeCategoryName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeBootstrapIcon(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return DEFAULT_CATEGORY_ICON;
  const normalized = raw.replace(/^bi\s+/, '').replace(/^bi-?/, '');
  if (!normalized || !/^[a-z0-9-]+$/.test(normalized)) return DEFAULT_CATEGORY_ICON;
  return `bi-${normalized}`;
}

function normalizeOrder(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function normalizeType(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return candidate === 'gestion' ? 'gestion' : 'vitrine';
}

function normalizePurchaseType(value) {
  if (!value) return DEFAULT_PURCHASE_TYPE;
  const candidate = String(value).trim().toLowerCase();
  return candidate === 'formation' || candidate === 'product' ? candidate : DEFAULT_PURCHASE_TYPE;
}

function normalizeNavigationPlacement(value) {
  if (!value) return null;
  const candidate = String(value).trim().toLowerCase();
  return NAVIGATION_PLACEMENTS.has(candidate) ? candidate : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateForPayload(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractDisabled(body = {}) {
  return {
    enabled: Boolean(body.enabled),
    from: body.from !== undefined ? parseDate(body.from) : null,
    to: body.to !== undefined ? parseDate(body.to) : null
  };
}

function buildDisabled(disabled = {}) {
  return {
    enabled: Boolean(disabled.enabled),
    from: formatDateForPayload(disabled?.from),
    to: formatDateForPayload(disabled?.to)
  };
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

function normalizeCategoryOrders(entries = []) {
  const bucket = new Map();
  for (const entry of entries || []) {
    const key = entry?.categoryId ? toObjectIdString(entry.categoryId) : UNCATEGORIZED_KEY;
    if (!key) continue;
    const order = normalizeOrder(entry?.order, 0);
    if (!bucket.has(key)) {
      bucket.set(key, { categoryId: key === UNCATEGORIZED_KEY ? null : key, order });
    }
  }
  return [...bucket.values()];
}

function findCategoryOrder(entries = [], categoryKey) {
  const normalized = categoryKey || UNCATEGORIZED_KEY;
  const list = normalizeCategoryOrders(entries);
  return list.find(entry => {
    const entryKey = entry.categoryId ? String(entry.categoryId) : UNCATEGORIZED_KEY;
    return entryKey === normalized;
  }) || null;
}

function setCategoryOrder(entries = [], categoryKey, order) {
  const normalizedKey = categoryKey || UNCATEGORIZED_KEY;
  const next = normalizeCategoryOrders(entries).filter(entry => {
    const entryKey = entry.categoryId ? String(entry.categoryId) : UNCATEGORIZED_KEY;
    return entryKey !== normalizedKey;
  });
  next.push({
    categoryId: normalizedKey === UNCATEGORIZED_KEY ? null : normalizedKey,
    order: normalizeOrder(order, 0)
  });
  return next;
}

function removeCategoryOrder(entries = [], categoryKey) {
  const normalizedKey = categoryKey || UNCATEGORIZED_KEY;
  return normalizeCategoryOrders(entries).filter(entry => {
    const entryKey = entry.categoryId ? String(entry.categoryId) : UNCATEGORIZED_KEY;
    return entryKey !== normalizedKey;
  });
}

function normalizeCategoryRefs(values = []) {
  return uniqueStrings(
    (Array.isArray(values) ? values : []).map(value => toObjectIdString(value))
  );
}

function buildPagePayload(page) {
  return {
    id: page._id?.toString(),
    slug: page.slug,
    moduleFile: page.moduleFile,
    type: page.type,
    order: normalizeOrder(page.order, 0),
    access: page.access
      ? {
          public: Boolean(page.access.public),
          requiresAuth: Boolean(page.access.requiresAuth),
          requiresPurchase: Boolean(page.access.requiresPurchase),
          purchaseType: page.access.requiresPurchase
            ? normalizePurchaseType(page.access.purchaseType)
            : null
        }
      : null,
    disabled: buildDisabled(page.disabled),
    devOnly: Boolean(page.devOnly),
    allowedRolesGestion: normalizeAllowedRolesGestion(page.allowedRolesGestion),
    navigationPlacement: page.navigationPlacement || null,
    categories: normalizeCategoryRefs(page.categories),
    categoryOrders: normalizeCategoryOrders(page.categoryOrders).map(entry => ({
      categoryId: entry.categoryId,
      order: normalizeOrder(entry.order, 0)
    })),
    createdAt: page.createdAt || null,
    updatedAt: page.updatedAt || null
  };
}

function buildCategoryPayload(category, pageCount = 0) {
  return {
    id: category._id?.toString(),
    name: category.name,
    icon: normalizeBootstrapIcon(category.icon),
    order: normalizeOrder(category.order, 0),
    pageCount: normalizeOrder(pageCount, 0),
    createdAt: category.createdAt || null,
    updatedAt: category.updatedAt || null
  };
}

async function getCategoryCountMap() {
  const rows = await Page.aggregate([
    {
      $match: {
        type: GESTION_TYPE
      }
    },
    { $unwind: '$categories' },
    {
      $group: {
        _id: '$categories',
        total: { $sum: 1 }
      }
    }
  ]);
  const map = new Map();
  for (const row of rows) {
    if (!row?._id) continue;
    map.set(String(row._id), normalizeOrder(row.total, 0));
  }
  return map;
}

async function getNextCategoryOrder() {
  const row = await CategoryGestion.findOne({})
    .sort({ order: -1, createdAt: -1 })
    .select({ order: 1 })
    .lean();
  return row ? normalizeOrder(row.order, 0) + 1 : 0;
}

async function getNextOrderForCategory(categoryKey) {
  if (!categoryKey || categoryKey === UNCATEGORIZED_KEY) {
    const uncategorizedPages = await Page.find({
      type: GESTION_TYPE,
      categories: { $size: 0 }
    })
      .select({ order: 1, categoryOrders: 1 })
      .lean();
    let maxOrder = -1;
    for (const page of uncategorizedPages) {
      const uncategorizedEntry = findCategoryOrder(page.categoryOrders, UNCATEGORIZED_KEY);
      const candidate = uncategorizedEntry
        ? normalizeOrder(uncategorizedEntry.order, 0)
        : normalizeOrder(page.order, 0);
      if (candidate > maxOrder) {
        maxOrder = candidate;
      }
    }
    return maxOrder + 1;
  }
  const categoryId = toObjectId(categoryKey);
  if (!categoryId) return 0;
  const rows = await Page.aggregate([
    { $match: { type: GESTION_TYPE } },
    { $unwind: '$categoryOrders' },
    { $match: { 'categoryOrders.categoryId': categoryId } },
    { $group: { _id: null, maxOrder: { $max: '$categoryOrders.order' } } }
  ]);
  if (!rows.length) return 0;
  return normalizeOrder(rows[0].maxOrder, 0) + 1;
}

function pageHasCategory(page, categoryKey) {
  const normalizedCategory = categoryKey || UNCATEGORIZED_KEY;
  const categories = normalizeCategoryRefs(page.categories);
  if (normalizedCategory === UNCATEGORIZED_KEY) {
    return categories.length === 0;
  }
  return categories.includes(normalizedCategory);
}

async function ensureCategoriesExist(categoryIds = []) {
  const normalizedIds = normalizeCategoryRefs(categoryIds);
  if (!normalizedIds.length) return [];
  const categories = await CategoryGestion.find({ _id: { $in: normalizedIds } })
    .select({ _id: 1 })
    .lean();
  return categories.map(category => String(category._id));
}

async function assignCategoryToPages(categoryId, pageIds = []) {
  const normalizedCategoryId = toObjectIdString(categoryId);
  const normalizedPageIds = normalizeCategoryRefs(pageIds);
  if (!normalizedCategoryId || !normalizedPageIds.length) return;
  const pages = await Page.find({
    _id: { $in: normalizedPageIds },
    type: GESTION_TYPE
  });
  if (!pages.length) return;
  let nextOrder = await getNextOrderForCategory(normalizedCategoryId);
  const bulkOps = [];
  for (const page of pages) {
    const categories = normalizeCategoryRefs(page.categories);
    const alreadyAssigned = categories.includes(normalizedCategoryId);
    const nextCategories = alreadyAssigned ? categories : [...categories, normalizedCategoryId];
    let categoryOrders = normalizeCategoryOrders(page.categoryOrders);
    if (!findCategoryOrder(categoryOrders, normalizedCategoryId)) {
      categoryOrders = setCategoryOrder(categoryOrders, normalizedCategoryId, nextOrder);
      nextOrder += 1;
    }
    categoryOrders = removeCategoryOrder(categoryOrders, UNCATEGORIZED_KEY);
    bulkOps.push({
      updateOne: {
        filter: { _id: page._id },
        update: {
          $set: {
            categories: nextCategories,
            categoryOrders
          }
        }
      }
    });
  }
  if (bulkOps.length) {
    await Page.bulkWrite(bulkOps, { ordered: false });
  }
}

async function removeCategoryFromPages(categoryId, pageIds = null) {
  const normalizedCategoryId = toObjectIdString(categoryId);
  if (!normalizedCategoryId) return;
  const filter = {
    type: GESTION_TYPE,
    categories: normalizedCategoryId
  };
  if (Array.isArray(pageIds) && pageIds.length) {
    filter._id = { $in: normalizeCategoryRefs(pageIds) };
  }
  const pages = await Page.find(filter);
  if (!pages.length) return;
  let nextUncategorizedOrder = await getNextOrderForCategory(UNCATEGORIZED_KEY);
  const bulkOps = [];
  for (const page of pages) {
    const categories = normalizeCategoryRefs(page.categories).filter(id => id !== normalizedCategoryId);
    let categoryOrders = removeCategoryOrder(page.categoryOrders, normalizedCategoryId);
    if (!categories.length) {
      if (!findCategoryOrder(categoryOrders, UNCATEGORIZED_KEY)) {
        categoryOrders = setCategoryOrder(categoryOrders, UNCATEGORIZED_KEY, nextUncategorizedOrder);
        nextUncategorizedOrder += 1;
      }
    }
    bulkOps.push({
      updateOne: {
        filter: { _id: page._id },
        update: {
          $set: {
            categories,
            categoryOrders
          }
        }
      }
    });
  }
  if (bulkOps.length) {
    await Page.bulkWrite(bulkOps, { ordered: false });
  }
}

export async function listGestionCategories(_req, res) {
  try {
    const [categories, countMap] = await Promise.all([
      CategoryGestion.find().sort({ order: 1, createdAt: 1 }).lean(),
      getCategoryCountMap()
    ]);
    const payload = categories.map(category =>
      buildCategoryPayload(category, countMap.get(String(category._id)) || 0)
    );
    return res.json({ ok: true, categories: payload, uncategorizedKey: UNCATEGORIZED_KEY });
  } catch (error) {
    console.error('Impossible de lister les categories gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les categories.' });
  }
}

export async function createGestionCategory(req, res) {
  const name = normalizeCategoryName(req.body?.name);
  const icon = normalizeBootstrapIcon(req.body?.icon);
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Le nom de categorie est requis.' });
  }
  try {
    const existing = await CategoryGestion.findOne({ name }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Une categorie avec ce nom existe deja.' });
    }
    const order = await getNextCategoryOrder();
    const category = await CategoryGestion.create({ name, icon, order });
    const pageIds = normalizeCategoryRefs(req.body?.pageIds);
    if (pageIds.length) {
      await assignCategoryToPages(category._id, pageIds);
    }
    return res.status(201).json({ ok: true, category: buildCategoryPayload(category.toObject(), 0) });
  } catch (error) {
    console.error('Impossible de creer la categorie gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de creer la categorie.' });
  }
}

export async function updateGestionCategory(req, res) {
  const categoryId = toObjectId(req.params.id);
  if (!categoryId) {
    return res.status(400).json({ ok: false, error: 'Identifiant categorie invalide.' });
  }
  const name = normalizeCategoryName(req.body?.name);
  const icon = normalizeBootstrapIcon(req.body?.icon);
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Le nom de categorie est requis.' });
  }
  try {
    const category = await CategoryGestion.findById(categoryId);
    if (!category) {
      return res.status(404).json({ ok: false, error: 'Categorie introuvable.' });
    }
    const duplicate = await CategoryGestion.findOne({ name, _id: { $ne: categoryId } }).lean();
    if (duplicate) {
      return res.status(409).json({ ok: false, error: 'Une categorie avec ce nom existe deja.' });
    }
    category.name = name;
    category.icon = icon;
    await category.save();

    if (Array.isArray(req.body?.pageIds)) {
      const targetPageIds = normalizeCategoryRefs(req.body.pageIds);
      const currentPages = await Page.find({
        type: GESTION_TYPE,
        categories: categoryId
      })
        .select({ _id: 1 })
        .lean();
      const currentSet = new Set(currentPages.map(page => String(page._id)));
      const targetSet = new Set(targetPageIds);
      const toAdd = targetPageIds.filter(id => !currentSet.has(id));
      const toRemove = [...currentSet].filter(id => !targetSet.has(id));
      if (toAdd.length) {
        await assignCategoryToPages(categoryId, toAdd);
      }
      if (toRemove.length) {
        await removeCategoryFromPages(categoryId, toRemove);
      }
    }

    const pageCount = await Page.countDocuments({ type: GESTION_TYPE, categories: categoryId });
    return res.json({ ok: true, category: buildCategoryPayload(category.toObject(), pageCount) });
  } catch (error) {
    console.error('Impossible de modifier la categorie gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de modifier la categorie.' });
  }
}

export async function deleteGestionCategory(req, res) {
  const categoryId = toObjectId(req.params.id);
  if (!categoryId) {
    return res.status(400).json({ ok: false, error: 'Identifiant categorie invalide.' });
  }
  try {
    const deleted = await CategoryGestion.findByIdAndDelete(categoryId);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: 'Categorie introuvable.' });
    }
    await removeCategoryFromPages(categoryId);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Impossible de supprimer la categorie gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer la categorie.' });
  }
}

export async function listGestionPages(req, res) {
  try {
    const userRole = String(req?.sessionUser?.role || '').trim().toLowerCase();
    const pages = await Page.find({ type: GESTION_TYPE })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    const filteredPages = pages.filter(page => {
      const roles = normalizeAllowedRolesGestion(page.allowedRolesGestion, { allowDefault: false });
      if (!roles.length) {
        return userRole === 'dev';
      }
      if (!roles.includes(userRole)) return false;
      if (Boolean(page?.devOnly) && userRole !== 'dev') return false;
      return true;
    });
    return res.json({
      ok: true,
      pages: filteredPages.map(buildPagePayload),
      uncategorizedKey: UNCATEGORIZED_KEY
    });
  } catch (error) {
    console.error('Impossible de lister les pages gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lister les pages.' });
  }
}

export async function createGestionPage(req, res) {
  const slug = String(req.body?.slug || '').trim().toLowerCase();
  const moduleFile = String(req.body?.moduleFile || '').trim();
  if (!slug || !moduleFile) {
    return res.status(400).json({ ok: false, error: 'Slug et moduleFile sont requis.' });
  }
  try {
    const existing = await Page.findOne({ slug }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Une page porte deja ce slug.' });
    }
    const hasRoleInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedRolesGestion');
    const allowedRolesGestion = normalizeAllowedRolesGestion(req.body?.allowedRolesGestion, {
      allowDefault: !hasRoleInput
    });
    if (!allowedRolesGestion.length) {
      return res.status(400).json({ ok: false, error: 'Au moins un role (admin ou dev) est requis.' });
    }
    const requestedCategoryIds = await ensureCategoriesExist(req.body?.categories);
    const page = await Page.create({
      slug,
      moduleFile,
      type: GESTION_TYPE,
      order: normalizeOrder(req.body?.order, 0),
      allowedRolesGestion,
      disabled: extractDisabled(req.body?.disabled || {}),
      devOnly: Boolean(req.body?.devOnly),
      access: {},
      navigationPlacement: null,
      categories: [],
      categoryOrders: []
    });
    if (requestedCategoryIds.length) {
      await assignCategoryToPages(requestedCategoryIds[0], [page._id]);
      if (requestedCategoryIds.length > 1) {
        for (const categoryId of requestedCategoryIds.slice(1)) {
          await assignCategoryToPages(categoryId, [page._id]);
        }
      }
    } else {
      page.categoryOrders = setCategoryOrder([], UNCATEGORIZED_KEY, page.order || 0);
      await page.save();
    }
    const fresh = await Page.findById(page._id).lean();
    return res.status(201).json({ ok: true, page: buildPagePayload(fresh) });
  } catch (error) {
    console.error('Impossible de creer la page gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de creer la page.' });
  }
}

export async function updateGestionPage(req, res) {
  const pageId = toObjectId(req.params.id);
  if (!pageId) {
    return res.status(400).json({ ok: false, error: 'Identifiant page invalide.' });
  }
  try {
    const page = await Page.findOne({ _id: pageId, type: GESTION_TYPE });
    if (!page) {
      return res.status(404).json({ ok: false, error: 'Page introuvable.' });
    }
    if (req.body?.slug) {
      page.slug = String(req.body.slug).trim().toLowerCase();
    }
    if (req.body?.moduleFile) {
      page.moduleFile = String(req.body.moduleFile).trim();
    }
    if (typeof req.body?.order !== 'undefined') {
      page.order = normalizeOrder(req.body.order, page.order || 0);
    }
    if (typeof req.body?.devOnly !== 'undefined') {
      page.devOnly = Boolean(req.body.devOnly);
    }
    const hasRoleInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedRolesGestion');
    if (hasRoleInput) {
      const roles = normalizeAllowedRolesGestion(req.body.allowedRolesGestion, { allowDefault: false });
      if (!roles.length) {
        return res.status(400).json({ ok: false, error: 'Au moins un role (admin ou dev) est requis.' });
      }
      page.allowedRolesGestion = roles;
    } else if (!page.allowedRolesGestion || !page.allowedRolesGestion.length) {
      page.allowedRolesGestion = normalizeAllowedRolesGestion(page.allowedRolesGestion);
    }
    if (typeof req.body?.disabled !== 'undefined') {
      page.disabled = extractDisabled(req.body.disabled || {});
    }
    page.type = GESTION_TYPE;
    page.navigationPlacement = null;
    page.access = {};

    if (Array.isArray(req.body?.categories)) {
      const nextCategories = await ensureCategoriesExist(req.body.categories);
      const previousCategories = normalizeCategoryRefs(page.categories);
      const previousSet = new Set(previousCategories);
      const nextSet = new Set(nextCategories);
      const removedCategories = previousCategories.filter(id => !nextSet.has(id));
      const addedCategories = nextCategories.filter(id => !previousSet.has(id));
      let categoryOrders = normalizeCategoryOrders(page.categoryOrders);
      for (const removed of removedCategories) {
        categoryOrders = removeCategoryOrder(categoryOrders, removed);
      }
      if (nextCategories.length) {
        categoryOrders = removeCategoryOrder(categoryOrders, UNCATEGORIZED_KEY);
      }
      for (const added of addedCategories) {
        const nextOrder = await getNextOrderForCategory(added);
        categoryOrders = setCategoryOrder(categoryOrders, added, nextOrder);
      }
      if (!nextCategories.length) {
        if (!findCategoryOrder(categoryOrders, UNCATEGORIZED_KEY)) {
          categoryOrders = setCategoryOrder(categoryOrders, UNCATEGORIZED_KEY, page.order || 0);
        }
      }
      page.categories = nextCategories;
      page.categoryOrders = categoryOrders;
    }

    await page.save();
    const fresh = await Page.findById(page._id).lean();
    return res.json({ ok: true, page: buildPagePayload(fresh) });
  } catch (error) {
    console.error('Impossible de modifier la page gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de modifier la page.' });
  }
}

export async function deleteGestionPage(req, res) {
  const pageId = toObjectId(req.params.id);
  if (!pageId) {
    return res.status(400).json({ ok: false, error: 'Identifiant page invalide.' });
  }
  try {
    const deleted = await Page.findOneAndDelete({ _id: pageId, type: GESTION_TYPE });
    if (!deleted) {
      return res.status(404).json({ ok: false, error: 'Page introuvable.' });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Impossible de supprimer la page gestion', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer la page.' });
  }
}

export async function updateGestionCategoriesOrder(req, res) {
  const orderedCategoryIds = normalizeCategoryRefs(req.body?.orderedCategoryIds);
  if (!orderedCategoryIds.length) {
    return res.status(400).json({ ok: false, error: 'orderedCategoryIds est requis.' });
  }
  try {
    const categories = await CategoryGestion.find({ _id: { $in: orderedCategoryIds } })
      .select({ _id: 1 })
      .lean();
    if (categories.length !== orderedCategoryIds.length) {
      return res.status(400).json({ ok: false, error: 'Certaines categories sont introuvables.' });
    }
    const orderedSet = new Set(orderedCategoryIds);
    const remaining = await CategoryGestion.find({ _id: { $nin: orderedCategoryIds } })
      .sort({ order: 1, createdAt: 1 })
      .select({ _id: 1 })
      .lean();
    const fullOrder = [...orderedCategoryIds, ...remaining.map(entry => String(entry._id)).filter(id => !orderedSet.has(id))];
    const bulkOps = fullOrder.map((categoryId, index) => ({
      updateOne: {
        filter: { _id: categoryId },
        update: { $set: { order: index } }
      }
    }));
    if (bulkOps.length) {
      await CategoryGestion.bulkWrite(bulkOps, { ordered: true });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Impossible de mettre a jour l ordre des categories gestion', error);
    return res.status(500).json({ ok: false, error: "Impossible d'enregistrer l'ordre des categories." });
  }
}

export async function updateGestionPagesOrder(req, res) {
  const categoryScope = String(req.body?.categoryId || '').trim();
  const orderedPageIds = normalizeCategoryRefs(req.body?.orderedPageIds);
  if (!categoryScope) {
    return res.status(400).json({ ok: false, error: 'categoryId est requis.' });
  }
  if (!orderedPageIds.length) {
    return res.status(400).json({ ok: false, error: 'orderedPageIds est requis.' });
  }

  const scopedCategoryId = categoryScope === UNCATEGORIZED_KEY ? UNCATEGORIZED_KEY : toObjectIdString(categoryScope);
  if (!scopedCategoryId) {
    return res.status(400).json({ ok: false, error: 'categoryId invalide.' });
  }

  try {
    if (scopedCategoryId !== UNCATEGORIZED_KEY) {
      const exists = await CategoryGestion.exists({ _id: scopedCategoryId });
      if (!exists) {
        return res.status(404).json({ ok: false, error: 'Categorie introuvable.' });
      }
    }

    const pages = await Page.find({
      _id: { $in: orderedPageIds },
      type: GESTION_TYPE
    });
    if (pages.length !== orderedPageIds.length) {
      return res.status(400).json({ ok: false, error: 'Certaines pages sont introuvables.' });
    }
    const byId = new Map(pages.map(page => [String(page._id), page]));
    const bulkOps = [];
    for (let index = 0; index < orderedPageIds.length; index += 1) {
      const pageId = orderedPageIds[index];
      const page = byId.get(pageId);
      if (!page) {
        return res.status(400).json({ ok: false, error: 'Page introuvable dans la sequence.' });
      }
      if (!pageHasCategory(page, scopedCategoryId === UNCATEGORIZED_KEY ? null : scopedCategoryId)) {
        return res.status(400).json({ ok: false, error: 'Une page ne correspond pas a la categorie cible.' });
      }
      const key = scopedCategoryId === UNCATEGORIZED_KEY ? UNCATEGORIZED_KEY : scopedCategoryId;
      let categoryOrders = normalizeCategoryOrders(page.categoryOrders);
      categoryOrders = setCategoryOrder(categoryOrders, key, index);
      const update = {
        categoryOrders
      };
      if (scopedCategoryId === UNCATEGORIZED_KEY) {
        update.order = index;
      }
      bulkOps.push({
        updateOne: {
          filter: { _id: page._id },
          update: {
            $set: update
          }
        }
      });
    }
    if (bulkOps.length) {
      await Page.bulkWrite(bulkOps, { ordered: true });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error('Impossible de mettre a jour l ordre des pages gestion', error);
    return res.status(500).json({ ok: false, error: "Impossible d'enregistrer l'ordre." });
  }
}
