import EditableContent from '../models/EditableContent.js';
import {
  buildContentMap,
  getZoneDefinition,
  getZoneDefinitions,
  isValidTargetType,
  sanitizeEditorialHtml,
  validateTargetIdentifier
} from '../services/editableContentService.js';

function parseTargetType(value) {
  if (!value) return '';
  return String(value).trim().toLowerCase();
}

function parseZoneKey(value) {
  if (!value) return '';
  return String(value).trim();
}

function respondWithInvalidTarget(res) {
  return res.status(400).json({ ok: false, error: 'Cible invalide pour le contenu éditorial.' });
}

function mapEntries(entries = []) {
  return entries.map(entry => ({
    zoneKey: entry.zoneKey,
    contentHtml: entry.contentHtml || '',
    updatedAt: entry.updatedAt
  }));
}

export async function listEditableContent(req, res) {
  try {
    const targetType = parseTargetType(req.query.targetType);
    const targetId = String(req.query.targetId || '').trim();
    if (!isValidTargetType(targetType) || !validateTargetIdentifier(targetType, targetId)) {
      return respondWithInvalidTarget(res);
    }
    const zones = getZoneDefinitions(targetType, targetId);
    if (!zones.length) {
      return res
        .status(400)
        .json({ ok: false, error: 'Aucune zone éditoriale définie pour cette cible.' });
    }
    const entries = await EditableContent.find({ targetType, targetId }).lean();
    return res.json({
      ok: true,
      targetType,
      targetId,
      zones,
      entries: mapEntries(entries)
    });
  } catch (error) {
    console.error('Erreur lecture contenu éditorial', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le contenu éditorial.' });
  }
}

export async function saveEditableContent(req, res) {
  try {
    const targetType = parseTargetType(req.body?.targetType);
    const targetId = String(req.body?.targetId || '').trim();
    const zoneKey = parseZoneKey(req.body?.zoneKey);
    if (!isValidTargetType(targetType) || !validateTargetIdentifier(targetType, targetId) || !zoneKey) {
      return respondWithInvalidTarget(res);
    }
    const zoneDef = getZoneDefinition(targetType, targetId, zoneKey);
    if (!zoneDef) {
      return res.status(400).json({ ok: false, error: 'Zone éditoriale inconnue.' });
    }
    const rawHtml = String(req.body?.contentHtml || '');
    const sanitizedHtml = sanitizeEditorialHtml(rawHtml);
    const now = new Date();
    const entry = await EditableContent.findOneAndUpdate(
      { targetType, targetId, zoneKey },
      { contentHtml: sanitizedHtml, updatedAt: now },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({
      ok: true,
      entry: {
        targetType,
        targetId,
        zoneKey,
        contentHtml: entry.contentHtml || '',
        updatedAt: entry.updatedAt
      },
      zone: zoneDef
    });
  } catch (error) {
    console.error('Erreur sauvegarde contenu éditorial', error);
    return res.status(500).json({ ok: false, error: 'Impossible de sauvegarder le contenu éditorial.' });
  }
}

export async function getEditableContentForVitrine(req, res) {
  try {
    const targetType = parseTargetType(req.query.targetType);
    const targetId = String(req.query.targetId || '').trim();
    const zoneKey = parseZoneKey(req.query.zoneKey);
    if (!isValidTargetType(targetType) || !validateTargetIdentifier(targetType, targetId)) {
      return respondWithInvalidTarget(res);
    }
    const zones = getZoneDefinitions(targetType, targetId);
    if (!zones.length) {
      return res.status(400).json({ ok: false, error: 'Aucune zone éditoriale disponible ici.' });
    }
    const query = { targetType, targetId };
    if (zoneKey) {
      query.zoneKey = zoneKey;
    }
    const entries = await EditableContent.find(query).lean();
    const content = buildContentMap(zones, entries);
    return res.json({
      ok: true,
      targetType,
      targetId,
      zones,
      content
    });
  } catch (error) {
    console.error('Erreur lecture édition vitrine', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire le contenu éditorial.' });
  }
}
