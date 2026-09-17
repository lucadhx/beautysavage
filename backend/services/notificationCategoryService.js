// services/notificationCategoryService.js
// M7 — CRUD des catégories de notification (modèle métier). Slug auto depuis le nom.
import NotificationCategory from '../models/NotificationCategory.js';

export class NotificationCategoryError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function listCategories({ activeOnly = false } = {}) {
  const filter = activeOnly ? { active: true } : {};
  return NotificationCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
}

export async function createCategory({ name, icon, color, description, sortOrder, active } = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new NotificationCategoryError('name_required', 'Le nom est requis.');
  let slug = slugify(cleanName);
  if (!slug) throw new NotificationCategoryError('slug_invalid', 'Nom invalide.');
  // Unicité du slug : suffixe incrémental si nécessaire.
  let candidate = slug;
  let n = 1;
  while (await NotificationCategory.findOne({ slug: candidate }).lean()) {
    n += 1;
    candidate = `${slug}-${n}`;
  }
  const doc = await NotificationCategory.create({
    name: cleanName,
    slug: candidate,
    icon: String(icon || 'bi-bell').trim(),
    color: String(color || '').trim(),
    description: String(description || '').trim(),
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    active: active === undefined ? true : Boolean(active),
  });
  return doc.toObject();
}

export async function updateCategory(id, patch = {}) {
  const doc = await NotificationCategory.findById(id);
  if (!doc) throw new NotificationCategoryError('not_found', 'Catégorie introuvable.', 404);
  if (patch.name !== undefined) {
    const cleanName = String(patch.name).trim();
    if (!cleanName) throw new NotificationCategoryError('name_required', 'Le nom est requis.');
    doc.name = cleanName;
  }
  if (patch.icon !== undefined) doc.icon = String(patch.icon || 'bi-bell').trim();
  if (patch.color !== undefined) doc.color = String(patch.color || '').trim();
  if (patch.description !== undefined) doc.description = String(patch.description || '').trim();
  if (patch.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))) doc.sortOrder = Number(patch.sortOrder);
  if (patch.active !== undefined) doc.active = Boolean(patch.active);
  await doc.save();
  return doc.toObject();
}

export async function deleteCategory(id) {
  const doc = await NotificationCategory.findByIdAndDelete(id);
  if (!doc) throw new NotificationCategoryError('not_found', 'Catégorie introuvable.', 404);
  return { id: String(doc._id) };
}
