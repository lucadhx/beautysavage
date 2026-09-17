// services/notificationTemplateVersioningService.js
// M7 — Versioning des templates de notification (miroir de emailTemplateVersioningService, M5A).
// Invariants : 1 version publiée par templateKey (index unique partiel) ; le publié n'est jamais
// écrasé (nouvelles versions) ; publier archive le publié précédent ; historique conservé.
// Le template ne porte JAMAIS de scope/targetRole/couleur (le moteur choisit le scope ; la couleur
// vient de la catégorie).
import NotificationTemplate, { NOTIFICATION_PRIORITIES } from '../models/NotificationTemplate.js';

function normKey(templateKey) {
  return String(templateKey || '').trim().toLowerCase() || null;
}
function normPriority(value, fallback = 'normal') {
  const v = String(value || '').trim().toLowerCase();
  return NOTIFICATION_PRIORITIES.includes(v) ? v : fallback;
}
function normVariables(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return Array.from(new Set(value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean))).slice(0, 100);
}

export async function getPublishedTemplate(templateKey) {
  const key = normKey(templateKey);
  if (!key) return null;
  return (await NotificationTemplate.findOne({ templateKey: key, status: 'published' }).lean())
    || (await NotificationTemplate.findOne({ templateKey: key, status: null }).lean());
}

export async function listVersions(templateKey) {
  const key = normKey(templateKey);
  if (!key) return [];
  return NotificationTemplate.find({ templateKey: key })
    .sort({ version: -1, updatedAt: -1 })
    .select('templateKey title body categoryId variables priority persistent action version status publishedAt archivedAt publishedBy createdFromVersion isSystemDefault updatedAt createdAt')
    .lean();
}

async function nextVersion(key) {
  const top = await NotificationTemplate.findOne({ templateKey: key }).sort({ version: -1 }).select('version').lean();
  return top ? Number(top.version || 1) + 1 : 1;
}

/** Crée un DRAFT depuis le publié (ou vierge), avec changements optionnels. N'affecte pas le runtime. */
export async function createDraftFromPublished(templateKey, changes = {}, actor = '') {
  const key = normKey(templateKey);
  if (!key) throw new Error('Clé de template invalide.');
  const base = await getPublishedTemplate(key);
  const version = await nextVersion(key);

  const draft = await NotificationTemplate.create({
    templateKey: key,
    title: changes.title !== undefined ? String(changes.title) : (base?.title || ''),
    body: changes.body !== undefined ? String(changes.body) : (base?.body || ''),
    categoryId: changes.categoryId !== undefined ? (changes.categoryId || null) : (base?.categoryId || null),
    variables: changes.variables !== undefined ? normVariables(changes.variables) : normVariables(base?.variables),
    priority: changes.priority !== undefined ? normPriority(changes.priority) : normPriority(base?.priority),
    persistent: changes.persistent !== undefined ? Boolean(changes.persistent) : Boolean(base?.persistent),
    action: changes.action !== undefined ? String(changes.action || '').trim() : (base?.action || ''),
    status: 'draft',
    version,
    createdFromVersion: base?.version || null,
    isSystemDefault: false,
    publishedBy: String(actor || ''),
  });
  return draft.toObject();
}

export async function publishDraft(templateId, actor = '') {
  const draft = await NotificationTemplate.findById(templateId);
  if (!draft) throw new Error('Template introuvable.');
  if (draft.status === 'published') return draft.toObject();
  if (draft.status === 'archived') throw new Error('Impossible de publier une version archivée (faire un rollback).');

  await NotificationTemplate.updateMany(
    { templateKey: draft.templateKey, _id: { $ne: draft._id }, $or: [{ status: 'published' }, { status: null }] },
    { $set: { status: 'archived', archivedAt: new Date() } },
  );
  draft.status = 'published';
  draft.publishedAt = new Date();
  draft.publishedBy = String(actor || '');
  await draft.save();
  return draft.toObject();
}

export async function archiveTemplate(templateId, actor = '') {
  const tpl = await NotificationTemplate.findById(templateId);
  if (!tpl) throw new Error('Template introuvable.');
  tpl.status = 'archived';
  tpl.archivedAt = new Date();
  if (actor) tpl.publishedBy = tpl.publishedBy || String(actor);
  await tpl.save();
  return tpl.toObject();
}

export async function rollbackToVersion(templateKey, version, actor = '') {
  const key = normKey(templateKey);
  if (!key) throw new Error('Clé de template invalide.');
  const target = await NotificationTemplate.findOne({ templateKey: key, version: Number(version) }).lean();
  if (!target) throw new Error('Version introuvable.');
  const draft = await createDraftFromPublished(key, {
    title: target.title, body: target.body, categoryId: target.categoryId, variables: target.variables,
    priority: target.priority, persistent: target.persistent, action: target.action,
  }, actor);
  return publishDraft(draft._id, actor);
}

/** Crée un template (1re version, publiée d'emblée) — utilisé pour amorcer une nouvelle clé. */
export async function createTemplate(templateKey, input = {}, actor = '') {
  const key = normKey(templateKey);
  if (!key) throw new Error('Clé de template invalide.');
  const existing = await NotificationTemplate.findOne({ templateKey: key }).lean();
  if (existing) throw new Error('Ce template existe déjà (utiliser draft/publish).');
  const draft = await createDraftFromPublished(key, input, actor);
  return publishDraft(draft._id, actor);
}
