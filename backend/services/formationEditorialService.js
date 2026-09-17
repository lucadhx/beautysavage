import EditableContent from '../models/EditableContent.js';

const FORMATION_EDITORIAL_TARGET_TYPE = 'formation';
const FORMATION_DESCRIPTION_ZONE_KEY = 'description';
const PREVIEW_MAX_LENGTH = 220;

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizePreviewText(value, maxLength = PREVIEW_MAX_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

export function extractPreviewFromEditorial(editorialHtml, fallbackDescription = '') {
  const editorialText = decodeHtmlEntities(
    String(editorialHtml || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, ' ')
      .replace(/<li[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
  const editorialPreview = normalizePreviewText(editorialText);
  if (editorialPreview) {
    return editorialPreview;
  }
  return normalizePreviewText(fallbackDescription);
}

function normalizeFormationIds(formationIds = []) {
  const seen = new Set();
  const normalized = [];
  formationIds.forEach(entry => {
    const id = String(entry || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

export async function getFormationEditorialMap(formationIds = []) {
  const normalizedIds = normalizeFormationIds(formationIds);
  if (!normalizedIds.length) {
    return new Map();
  }
  const entries = await EditableContent.find({
    targetType: FORMATION_EDITORIAL_TARGET_TYPE,
    targetId: { $in: normalizedIds },
    zoneKey: FORMATION_DESCRIPTION_ZONE_KEY
  })
    .select({ targetId: 1, contentHtml: 1 })
    .lean();
  const map = new Map();
  normalizedIds.forEach(id => {
    map.set(id, '');
  });
  entries.forEach(entry => {
    const id = String(entry?.targetId || '').trim();
    if (!id) return;
    map.set(id, String(entry?.contentHtml || ''));
  });
  return map;
}

