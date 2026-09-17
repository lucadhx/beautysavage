import GiftCardTemplate, {
  GIFT_CARD_TEMPLATE_VARIABLES
} from '../../models/GiftCardTemplate.js';

/**
 * M13 — Service Gift Card Template Studio.
 *
 * Gère le versioning (draft/published/archived), la sélection de l'actif (1 seul, jamais zéro)
 * et le seed du template système par défaut. Aucune transaction requise : on s'appuie sur les
 * index uniques partiels + des opérations séquentielles (compatible standalone), exactement comme
 * `themeController.activateTheme` (M5).
 */

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function httpError(message, status = 400, code = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export function serializeGiftCardTemplate(doc) {
  if (!doc) return null;
  const source = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: source._id?.toString(),
    name: source.name || '',
    slug: source.slug || '',
    html: source.html || '',
    css: source.css || '',
    variables: Array.isArray(source.variables) ? source.variables : [],
    previewData: source.previewData || null,
    visible: Boolean(source.visible),
    active: Boolean(source.active),
    version: Number(source.version || 1),
    status: source.status || 'published',
    publishedAt: source.publishedAt || null,
    archivedAt: source.archivedAt || null,
    isSystemDefault: Boolean(source.isSystemDefault),
    createdFromVersion: source.createdFromVersion ?? null,
    createdBy: source.createdBy || '',
    updatedBy: source.updatedBy || '',
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null
  };
}

/** Template actif (rendu réel des cartes). null si aucun (ne devrait pas arriver après seed). */
export async function getActiveGiftCardTemplate({ lean = true } = {}) {
  const query = GiftCardTemplate.findOne({ active: true });
  return lean ? query.lean() : query;
}

/** Published d'un slug donné. */
export async function getPublishedTemplateBySlug(slug, { lean = true } = {}) {
  const query = GiftCardTemplate.findOne({ slug: slugify(slug), status: 'published' });
  return lean ? query.lean() : query;
}

/** Librairie : la version publiée de chaque slug (option visibleOnly pour la librairie admin). */
export async function listGiftCardTemplates({ visibleOnly = false } = {}) {
  const filter = { status: 'published' };
  if (visibleOnly) filter.visible = true;
  const docs = await GiftCardTemplate.find(filter).sort({ name: 1, createdAt: 1 }).lean();
  return docs.map(serializeGiftCardTemplate);
}

/** Toutes les versions d'un slug (draft/published/archived), récentes d'abord. */
export async function listGiftCardTemplateVersions(slug) {
  const docs = await GiftCardTemplate.find({ slug: slugify(slug) }).sort({ version: -1 }).lean();
  return docs.map(serializeGiftCardTemplate);
}

async function nextVersionForSlug(slug) {
  const last = await GiftCardTemplate.findOne({ slug }).sort({ version: -1 }).select('version').lean();
  return Number(last?.version || 0) + 1;
}

const ALLOWED_CHANGE_FIELDS = ['name', 'html', 'css', 'variables', 'previewData', 'visible'];

function pickChanges(body = {}) {
  const changes = {};
  for (const field of ALLOWED_CHANGE_FIELDS) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  return changes;
}

/** Crée un nouveau template (slug neuf) publié en v1. */
export async function createGiftCardTemplate(body = {}, actor = '') {
  const name = String(body.name || '').trim();
  if (!name) throw httpError('Nom du template requis.', 400, 'TEMPLATE_NAME_REQUIRED');
  const slug = slugify(body.slug || name);
  if (!slug) throw httpError('Slug invalide.', 400, 'TEMPLATE_SLUG_INVALID');
  const existing = await GiftCardTemplate.findOne({ slug, status: 'published' }).lean();
  if (existing) throw httpError('Un template publié existe déjà pour ce slug.', 409, 'TEMPLATE_SLUG_TAKEN');

  const doc = await GiftCardTemplate.create({
    name,
    slug,
    html: String(body.html || ''),
    css: String(body.css || ''),
    variables: Array.isArray(body.variables) ? body.variables : [...GIFT_CARD_TEMPLATE_VARIABLES],
    previewData: body.previewData || undefined,
    visible: body.visible === undefined ? true : Boolean(body.visible),
    active: false,
    version: 1,
    status: 'published',
    publishedAt: new Date(),
    createdBy: actor,
    updatedBy: actor
  });
  return serializeGiftCardTemplate(doc);
}

/** Crée un brouillon depuis le template publié d'un slug. */
export async function createDraftFromPublished(slug, body = {}, actor = '') {
  const normalizedSlug = slugify(slug);
  const published = await GiftCardTemplate.findOne({ slug: normalizedSlug, status: 'published' }).lean();
  if (!published) throw httpError('Template publié introuvable.', 404, 'TEMPLATE_NOT_FOUND');
  // Un seul brouillon ouvert à la fois.
  const existingDraft = await GiftCardTemplate.findOne({ slug: normalizedSlug, status: 'draft' }).lean();
  if (existingDraft) throw httpError('Un brouillon est déjà ouvert pour ce template.', 409, 'TEMPLATE_DRAFT_EXISTS');

  const changes = pickChanges(body);
  const version = await nextVersionForSlug(normalizedSlug);
  const doc = await GiftCardTemplate.create({
    name: changes.name !== undefined ? String(changes.name).trim() : published.name,
    slug: normalizedSlug,
    html: changes.html !== undefined ? String(changes.html) : published.html,
    css: changes.css !== undefined ? String(changes.css) : published.css,
    variables: changes.variables !== undefined ? changes.variables : published.variables,
    previewData: changes.previewData !== undefined ? changes.previewData : published.previewData,
    visible: changes.visible !== undefined ? Boolean(changes.visible) : published.visible,
    active: false,
    version,
    status: 'draft',
    createdFromVersion: published.version,
    createdBy: actor,
    updatedBy: actor
  });
  return serializeGiftCardTemplate(doc);
}

/** Met à jour un brouillon existant (édition libre tant que non publié). */
export async function updateDraft(id, body = {}, actor = '') {
  const draft = await GiftCardTemplate.findById(id);
  if (!draft) throw httpError('Brouillon introuvable.', 404, 'TEMPLATE_NOT_FOUND');
  if (draft.status !== 'draft') throw httpError('Seul un brouillon peut être édité.', 409, 'TEMPLATE_NOT_DRAFT');
  const changes = pickChanges(body);
  if (changes.name !== undefined) draft.name = String(changes.name).trim();
  if (changes.html !== undefined) draft.html = String(changes.html);
  if (changes.css !== undefined) draft.css = String(changes.css);
  if (changes.variables !== undefined) draft.variables = changes.variables;
  if (changes.previewData !== undefined) draft.previewData = changes.previewData;
  if (changes.visible !== undefined) draft.visible = Boolean(changes.visible);
  draft.updatedBy = actor;
  await draft.save();
  return serializeGiftCardTemplate(draft);
}

/** Publie un brouillon : archive l'ancien publié, transfère l'actif si besoin. */
export async function publishDraft(id, actor = '') {
  const draft = await GiftCardTemplate.findById(id);
  if (!draft) throw httpError('Brouillon introuvable.', 404, 'TEMPLATE_NOT_FOUND');
  if (draft.status !== 'draft') throw httpError('Ce document n\'est pas un brouillon.', 409, 'TEMPLATE_NOT_DRAFT');

  const current = await GiftCardTemplate.findOne({ slug: draft.slug, status: 'published' });
  const wasActive = Boolean(current?.active);
  if (current) {
    // Libère d'abord l'actif (contrainte index unique), puis archive.
    current.active = false;
    current.status = 'archived';
    current.archivedAt = new Date();
    await current.save();
  }
  draft.status = 'published';
  draft.publishedAt = new Date();
  draft.active = wasActive; // l'actif suit la dernière version publiée du slug.
  draft.updatedBy = actor;
  await draft.save();
  return serializeGiftCardTemplate(draft);
}

/** Archive une version. Interdit si elle est active (il doit toujours rester un actif). */
export async function archiveTemplate(id, actor = '') {
  const doc = await GiftCardTemplate.findById(id);
  if (!doc) throw httpError('Template introuvable.', 404, 'TEMPLATE_NOT_FOUND');
  if (doc.active) {
    throw httpError(
      'Impossible d\'archiver le template actif. Activez d\'abord un autre template.',
      409,
      'TEMPLATE_ACTIVE_LOCKED'
    );
  }
  doc.status = 'archived';
  doc.archivedAt = new Date();
  doc.updatedBy = actor;
  await doc.save();
  return serializeGiftCardTemplate(doc);
}

/** Rollback : republie une version donnée d'un slug comme nouvelle version publiée. */
export async function rollbackToVersion(slug, version, actor = '') {
  const normalizedSlug = slugify(slug);
  const target = await GiftCardTemplate.findOne({ slug: normalizedSlug, version: Number(version) }).lean();
  if (!target) throw httpError('Version introuvable.', 404, 'TEMPLATE_VERSION_NOT_FOUND');

  const current = await GiftCardTemplate.findOne({ slug: normalizedSlug, status: 'published' });
  const wasActive = Boolean(current?.active);
  if (current) {
    current.active = false;
    current.status = 'archived';
    current.archivedAt = new Date();
    await current.save();
  }
  const nextVersion = await nextVersionForSlug(normalizedSlug);
  const doc = await GiftCardTemplate.create({
    name: target.name,
    slug: normalizedSlug,
    html: target.html,
    css: target.css,
    variables: target.variables,
    previewData: target.previewData,
    visible: target.visible,
    active: wasActive,
    version: nextVersion,
    status: 'published',
    publishedAt: new Date(),
    createdFromVersion: target.version,
    createdBy: actor,
    updatedBy: actor
  });
  return serializeGiftCardTemplate(doc);
}

/**
 * Sélectionne le template actif (librairie admin). Désactive les autres, active la cible.
 * Garantit "exactement un actif". La cible doit être publiée et visible.
 */
export async function activateGiftCardTemplate(id, actor = '') {
  const target = await GiftCardTemplate.findById(id);
  if (!target) throw httpError('Template introuvable.', 404, 'TEMPLATE_NOT_FOUND');
  if (target.status !== 'published') {
    throw httpError('Seul un template publié peut être activé.', 409, 'TEMPLATE_NOT_PUBLISHED');
  }
  if (target.active) {
    return serializeGiftCardTemplate(target); // déjà actif, idempotent.
  }
  // Désactive l'actif courant AVANT d'activer (index unique partiel).
  await GiftCardTemplate.updateMany({ active: true, _id: { $ne: target._id } }, { active: false });
  target.active = true;
  target.updatedBy = actor;
  await target.save();
  return serializeGiftCardTemplate(target);
}

export default {
  serializeGiftCardTemplate,
  getActiveGiftCardTemplate,
  getPublishedTemplateBySlug,
  listGiftCardTemplates,
  listGiftCardTemplateVersions,
  createGiftCardTemplate,
  createDraftFromPublished,
  updateDraft,
  publishDraft,
  archiveTemplate,
  rollbackToVersion,
  activateGiftCardTemplate
};
