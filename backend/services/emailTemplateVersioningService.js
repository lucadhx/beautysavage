// services/emailTemplateVersioningService.js
// Phase 5A — backend versioning for email templates (no UI, no automation).
//
// EmailTemplate is the version entity. Invariants:
//   - one PUBLISHED version per functionName (held by a partial unique index);
//   - the runtime reads only the published version (mailService.loadTemplate);
//   - publishing a draft archives the previous published (history, never deleted);
//   - a published version is NEVER overwritten by this service (new versions only).
//
// Variable/HTML safety is preserved: draft content is sanitized (scripts stripped).

import EmailTemplate from '../models/EmailTemplate.js';
import { sanitizeEditorialHtml } from './editableContentService.js';

function normFn(functionName) {
  return String(functionName || '').trim().toLowerCase() || null;
}

// Defense-in-depth full-HTML sanitizer (no <script>, no inline event handlers,
// no javascript: URLs). bodyHtml uses the shared editorial sanitizer.
function sanitizeFull(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

/** Runtime/published read: published version, else a legacy (status-less) doc. */
export async function getPublishedTemplate(functionName) {
  const fn = normFn(functionName);
  if (!fn) return null;
  return (await EmailTemplate.findOne({ functionName: fn, status: 'published' }).lean())
    || (await EmailTemplate.findOne({ functionName: fn, status: null }).lean());
}

/** History of all versions for a functionName (newest first). */
export async function listVersions(functionName) {
  const fn = normFn(functionName);
  if (!fn) return [];
  return EmailTemplate.find({ functionName: fn })
    .sort({ version: -1, updatedAt: -1 })
    .select('functionName version status publishedAt archivedAt publishedBy createdFromVersion isSystemDefault subject mode updatedAt createdAt')
    .lean();
}

async function nextVersion(fn) {
  const top = await EmailTemplate.findOne({ functionName: fn }).sort({ version: -1 }).select('version').lean();
  return Number(top?.version || 1) + 1;
}

/**
 * Create a DRAFT from the current published version (or from defaults/legacy),
 * applying optional content changes. Does NOT affect the runtime.
 */
export async function createDraftFromPublished(functionName, changes = {}, actor = '') {
  const fn = normFn(functionName);
  if (!fn) throw new Error('Fonction de template invalide.');
  const base = await getPublishedTemplate(fn); // may be null
  const version = await nextVersion(fn);

  const subject = changes.subject !== undefined ? String(changes.subject) : (base?.subject || '');
  const bodyHtml = sanitizeEditorialHtml(changes.bodyHtml !== undefined ? String(changes.bodyHtml) : (base?.bodyHtml || ''));
  const fullHtml = sanitizeFull(changes.fullHtml !== undefined ? String(changes.fullHtml) : (base?.fullHtml || ''));
  const mode = changes.mode ? String(changes.mode).toLowerCase() : (base?.mode || 'text');

  const draft = await EmailTemplate.create({
    functionName: fn,
    subject,
    bodyHtml,
    fullHtml,
    mode: mode === 'html' ? 'html' : 'text',
    categoryId: base?.categoryId || null,
    recipient: base?.recipient || 'client',
    isMetadataOnly: false,
    status: 'draft',
    version,
    createdFromVersion: base?.version || null,
    isSystemDefault: false,
    publishedBy: String(actor || '')
  });
  return draft.toObject();
}

/** Publish a draft: archive the current published (and any legacy) first. */
export async function publishDraft(templateId, actor = '') {
  const draft = await EmailTemplate.findById(templateId);
  if (!draft) throw new Error('Template introuvable.');
  if (draft.status === 'published') return draft.toObject(); // already live
  if (draft.status === 'archived') throw new Error('Impossible de publier une version archivée (faire un rollback).');

  // Archive the current published + any legacy (status null) so exactly one stays published.
  await EmailTemplate.updateMany(
    { functionName: draft.functionName, _id: { $ne: draft._id }, $or: [{ status: 'published' }, { status: null }] },
    { $set: { status: 'archived', archivedAt: new Date() } }
  );

  draft.status = 'published';
  draft.publishedAt = new Date();
  draft.publishedBy = String(actor || '');
  await draft.save();
  return draft.toObject();
}

/** Archive a template version explicitly. */
export async function archiveTemplate(templateId, actor = '') {
  const tpl = await EmailTemplate.findById(templateId);
  if (!tpl) throw new Error('Template introuvable.');
  tpl.status = 'archived';
  tpl.archivedAt = new Date();
  if (actor) tpl.publishedBy = tpl.publishedBy || String(actor);
  await tpl.save();
  return tpl.toObject();
}

/**
 * Rollback: copy an older version's content into a NEW draft, then publish it.
 * The old published is archived (never overwritten) -> full, reversible history.
 */
export async function rollbackToVersion(functionName, version, actor = '') {
  const fn = normFn(functionName);
  if (!fn) throw new Error('Fonction de template invalide.');
  const target = await EmailTemplate.findOne({ functionName: fn, version: Number(version) }).lean();
  if (!target) throw new Error('Version introuvable.');
  const draft = await createDraftFromPublished(
    fn,
    { subject: target.subject, bodyHtml: target.bodyHtml, fullHtml: target.fullHtml, mode: target.mode },
    actor
  );
  const published = await publishDraft(draft._id, actor);
  return published;
}
