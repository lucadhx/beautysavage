// controllers/notificationTemplateController.js
// M7 — Studio templates de notification (dev-only). Contenu pur + versioning. JAMAIS de scope/
// targetRole/e-mail. Le moteur choisit le scope ailleurs.
import mongoose from 'mongoose';
import NotificationTemplate from '../models/NotificationTemplate.js';
import {
  getPublishedTemplate,
  listVersions,
  createDraftFromPublished,
  publishDraft,
  archiveTemplate,
  rollbackToVersion,
  createTemplate,
} from '../services/notificationTemplateVersioningService.js';

function normKey(value) {
  return String(value || '').trim().toLowerCase() || null;
}

function toSafe(t) {
  if (!t) return null;
  return {
    id: String(t._id),
    templateKey: t.templateKey,
    title: t.title || '',
    body: t.body || '',
    categoryId: t.categoryId ? String(t.categoryId) : null,
    variables: Array.isArray(t.variables) ? t.variables : [],
    priority: t.priority || 'normal',
    persistent: Boolean(t.persistent),
    action: t.action || '',
    version: t.version,
    status: t.status,
    publishedAt: t.publishedAt || null,
    archivedAt: t.archivedAt || null,
    publishedBy: t.publishedBy || '',
    createdFromVersion: t.createdFromVersion ?? null,
    isSystemDefault: Boolean(t.isSystemDefault),
    updatedAt: t.updatedAt || null,
    createdAt: t.createdAt || null,
  };
}

const actorOf = (req) => String(req.sessionUser?.email || req.sessionUser?._id || 'dev');
const changesOf = (body = {}) => ({
  title: body.title,
  body: body.body,
  categoryId: body.categoryId,
  variables: body.variables,
  priority: body.priority,
  persistent: body.persistent,
  action: body.action,
});

export async function listTemplatesHandler(_req, res) {
  try {
    // Une ligne par templateKey : la version PUBLIÉE (ou la plus récente si aucune publiée).
    const all = await NotificationTemplate.find({}).sort({ version: -1 }).lean();
    const byKey = new Map();
    for (const t of all) {
      const cur = byKey.get(t.templateKey);
      if (!cur || (t.status === 'published' && cur.status !== 'published')) byKey.set(t.templateKey, t);
    }
    return res.json({ ok: true, templates: Array.from(byKey.values()).map(toSafe) });
  } catch (error) {
    console.error('[notificationTemplate] list error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getTemplateHandler(req, res) {
  try {
    const key = normKey(req.params.templateKey);
    if (!key) return res.status(400).json({ ok: false, error: 'Clé invalide.' });
    const tpl = await getPublishedTemplate(key);
    if (!tpl) return res.status(404).json({ ok: false, error: 'Template introuvable.' });
    return res.json({ ok: true, template: toSafe(tpl) });
  } catch (error) {
    console.error('[notificationTemplate] get error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function createTemplateHandler(req, res) {
  try {
    const key = normKey(req.params.templateKey || req.body?.templateKey);
    if (!key) return res.status(400).json({ ok: false, error: 'Clé invalide.' });
    const tpl = await createTemplate(key, changesOf(req.body), actorOf(req));
    return res.status(201).json({ ok: true, template: toSafe(tpl) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible de créer le template.' });
  }
}

export async function listVersionsHandler(req, res) {
  try {
    const key = normKey(req.params.templateKey);
    if (!key) return res.status(400).json({ ok: false, error: 'Clé invalide.' });
    const versions = await listVersions(key);
    return res.json({ ok: true, templateKey: key, versions: versions.map(toSafe) });
  } catch (error) {
    console.error('[notificationTemplate] versions error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function createDraftHandler(req, res) {
  try {
    const key = normKey(req.params.templateKey);
    if (!key) return res.status(400).json({ ok: false, error: 'Clé invalide.' });
    const draft = await createDraftFromPublished(key, changesOf(req.body), actorOf(req));
    return res.status(201).json({ ok: true, draft: toSafe(draft) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible de créer le brouillon.' });
  }
}

export async function publishDraftHandler(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const published = await publishDraft(id, actorOf(req));
    return res.json({ ok: true, published: toSafe(published) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible de publier.' });
  }
}

export async function archiveTemplateHandler(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const archived = await archiveTemplate(id, actorOf(req));
    return res.json({ ok: true, archived: toSafe(archived) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible d\'archiver.' });
  }
}

export async function rollbackHandler(req, res) {
  try {
    const key = normKey(req.params.templateKey);
    if (!key) return res.status(400).json({ ok: false, error: 'Clé invalide.' });
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) return res.status(400).json({ ok: false, error: 'Version invalide.' });
    const published = await rollbackToVersion(key, version, actorOf(req));
    return res.json({ ok: true, published: toSafe(published) });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'Impossible de revenir à cette version.' });
  }
}
