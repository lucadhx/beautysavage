// controllers/notificationCategoryController.js
// M7 — CRUD catégories de notification (dev-only). Aucune donnée sensible.
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  NotificationCategoryError,
} from '../services/notificationCategoryService.js';

function toSafe(c) {
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    icon: c.icon || 'bi-bell',
    color: c.color || '',
    description: c.description || '',
    sortOrder: c.sortOrder ?? 0,
    active: Boolean(c.active),
    createdAt: c.createdAt || null,
    updatedAt: c.updatedAt || null,
  };
}

function handleError(res, error) {
  if (error instanceof NotificationCategoryError) {
    return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message });
  }
  console.error('[notificationCategory] erreur', error?.message || error);
  return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
}

export async function listCategoriesHandler(req, res) {
  try {
    const cats = await listCategories({ activeOnly: req.query?.activeOnly === 'true' });
    return res.json({ ok: true, categories: cats.map(toSafe) });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function createCategoryHandler(req, res) {
  try {
    const cat = await createCategory(req.body || {});
    return res.status(201).json({ ok: true, category: toSafe(cat) });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function updateCategoryHandler(req, res) {
  try {
    const cat = await updateCategory(req.params.id, req.body || {});
    return res.json({ ok: true, category: toSafe(cat) });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function deleteCategoryHandler(req, res) {
  try {
    const result = await deleteCategory(req.params.id);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return handleError(res, error);
  }
}
