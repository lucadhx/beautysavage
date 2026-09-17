import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

import Formation from '../models/Formation.js';
import FormationModule from '../models/FormationModule.js';
import { sanitizeEditorialHtml } from '../services/editableContentService.js';
import { extractPreviewFromEditorial } from '../services/formationEditorialService.js';

const MIN_ORDER = 1;
const MODULE_FILE_UPLOAD_DIR = path.resolve(path.join(process.cwd(), 'uploads', 'module-files'));
const MODULE_FILE_PUBLIC_PREFIX = '/uploads/module-files/';

function parseOrder(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(MIN_ORDER, Math.floor(number));
}

function normalizeOrderedModuleIds(input) {
  if (!Array.isArray(input)) return [];
  const unique = new Set();
  const ordered = [];
  input.forEach(entry => {
    const id = String(entry || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id) || unique.has(id)) {
      return;
    }
    unique.add(id);
    ordered.push(id);
  });
  return ordered;
}

function normalizeUrlCandidate(value) {
  return String(value || '').trim();
}

function normalizeModuleEditorial(rawEditorial, rawFallbackDescription = '') {
  const descriptionEditorial = sanitizeEditorialHtml(String(rawEditorial || ''));
  const fallbackDescription = String(rawFallbackDescription || '').trim();
  const previewDescription = extractPreviewFromEditorial(descriptionEditorial, fallbackDescription);
  return { descriptionEditorial, previewDescription };
}

function normalizeVideoItems(input) {
  if (!Array.isArray(input)) return [];
  const normalized = [];
  input.forEach((entry, index) => {
    try {
      const raw = entry;
      const isObject = raw && typeof raw === 'object' && !Array.isArray(raw);
      const url = isObject
        ? normalizeUrlCandidate(raw.url || raw.embedUrl || raw.link)
        : normalizeUrlCandidate(raw);
      if (!url) return;
      const rawDescriptionEditorial = isObject
        ? raw.descriptionEditorial || raw.descriptionHtml || raw.description || ''
        : '';
      const title = isObject ? String(raw.title || '').trim() : '';
      const descriptionEditorial = sanitizeEditorialHtml(String(rawDescriptionEditorial || ''));
      const rawDescriptionFallback = isObject ? raw.description || '' : '';
      const previewDescription = extractPreviewFromEditorial(descriptionEditorial, rawDescriptionFallback);
      const parsedOrder = isObject ? parseOrder(raw.order) : null;
      normalized.push({
        title,
        url,
        descriptionEditorial,
        previewDescription,
        order: parsedOrder ?? index + 1
      });
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[FormationModule] video item ignored (normalize failed)', { index, error });
      }
    }
  });
  normalized.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.url.localeCompare(right.url, 'fr', { sensitivity: 'base' });
  });
  return normalized.map((entry, index) => ({
    ...entry,
    order: index + 1
  }));
}

function buildFallbackFileName(url, fallback = 'module-file') {
  const candidate = String(url || '').trim();
  if (!candidate) return fallback;
  const parsed = candidate.split('/').filter(Boolean).pop() || fallback;
  return parsed.slice(0, 140);
}

function normalizeFiles(input) {
  if (!Array.isArray(input)) return [];
  const normalized = [];
  input.forEach((entry, index) => {
    try {
      if (!entry) return;
      const isObject = typeof entry === 'object' && !Array.isArray(entry);
      const url = isObject ? normalizeUrlCandidate(entry.url) : normalizeUrlCandidate(entry);
      if (!url) return;
      const name = isObject
        ? String(entry.name || '').trim() || buildFallbackFileName(url)
        : buildFallbackFileName(url);
      const parsedOrder = isObject ? parseOrder(entry.order) : null;
      const rawSize = isObject ? Number(entry.size) : 0;
      const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.floor(rawSize) : 0;
      const fileId = isObject ? String(entry.fileId || '').trim() : '';
      const title = isObject ? String(entry.title || '').trim() : '';
      const legacySeed = `${url}|${name}`.slice(0, 512);
      const deterministicLegacyId = `legacy-${Buffer.from(legacySeed)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 24)}`;
      normalized.push({
        fileId: fileId || deterministicLegacyId || new mongoose.Types.ObjectId().toString(),
        name,
        title,
        url,
        size,
        order: parsedOrder ?? index + 1
      });
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[FormationModule] file item ignored (normalize failed)', { index, error });
      }
    }
  });
  normalized.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' });
  });
  return normalized.map((entry, index) => ({
    ...entry,
    order: index + 1
  }));
}

function toLegacyVideos(videoItems = []) {
  return Array.isArray(videoItems) ? videoItems.map(entry => entry.url).filter(Boolean) : [];
}

function isPathInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target === root) return true;
  return target.startsWith(`${root}${path.sep}`);
}

async function removeManagedModuleFile(fileUrl) {
  const url = String(fileUrl || '').trim();
  if (!url.startsWith(MODULE_FILE_PUBLIC_PREFIX)) {
    return;
  }
  const relativePart = url.replace(/^\//, '');
  const absolutePath = path.resolve(process.cwd(), relativePart);
  if (!isPathInside(MODULE_FILE_UPLOAD_DIR, absolutePath)) {
    return;
  }
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Suppression fichier module impossible', { path: absolutePath, error });
    }
  }
}

async function loadDistancielFormation(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const formation = await Formation.findById(id).lean();
  if (!formation || formation.type !== 'distanciel') {
    return null;
  }
  return formation;
}

export function buildModulePayload(doc) {
  if (!doc) return null;
  const descriptionEditorial = sanitizeEditorialHtml(String(doc.descriptionEditorial || ''));
  const previewDescription = extractPreviewFromEditorial(descriptionEditorial, doc.description || '');
  const videoItems = normalizeVideoItems(Array.isArray(doc.videos) ? doc.videos : []);
  const files = normalizeFiles(Array.isArray(doc.files) ? doc.files : []);
  return {
    id: doc._id?.toString(),
    formationId: doc.formationId?.toString(),
    title: doc.title,
    description: previewDescription,
    previewDescription,
    descriptionEditorial,
    legacyDescription: doc.description || '',
    videos: toLegacyVideos(videoItems),
    videoItems,
    files,
    order: doc.order,
    createdAt: doc.createdAt
  };
}

async function shiftOrdersOnCreate(formationId, targetOrder) {
  if (targetOrder === null) return;
  await FormationModule.updateMany(
    {
      formationId,
      order: { $gte: targetOrder }
    },
    {
      $inc: { order: 1 }
    }
  );
}

async function shiftOrdersOnUpdate(formationId, moduleId, oldOrder, newOrder) {
  if (newOrder === null || oldOrder === null || newOrder === oldOrder) return;
  if (newOrder < oldOrder) {
    await FormationModule.updateMany(
      {
        formationId,
        _id: { $ne: moduleId },
        order: { $gte: newOrder, $lt: oldOrder }
      },
      {
        $inc: { order: 1 }
      }
    );
  } else if (newOrder > oldOrder) {
    await FormationModule.updateMany(
      {
        formationId,
        _id: { $ne: moduleId },
        order: { $lte: newOrder, $gt: oldOrder }
      },
      {
        $inc: { order: -1 }
      }
    );
  }
}

export async function listModules(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadDistancielFormation(formationId);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    const modules = await FormationModule.find({ formationId: formation._id })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return res.json({ ok: true, modules: modules.map(buildModulePayload) });
  } catch (error) {
    console.error('Impossible de lister les modules', error);
    return res.status(500).json({ ok: false, error: 'Impossible de lire les modules.' });
  }
}

export async function createModule(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadDistancielFormation(formationId);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    const title = String(req.body?.title || '').trim();
    if (!title) {
      return res.status(400).json({ ok: false, error: 'Le titre est requis.' });
    }
    const moduleEditorial = normalizeModuleEditorial(
      req.body?.descriptionEditorial,
      req.body?.description
    );
    const videoItems = normalizeVideoItems(req.body?.videoItems ?? req.body?.videos);
    const files = normalizeFiles(req.body?.files);
    const requestedOrder = parseOrder(req.body?.order);
    const modulesCount = await FormationModule.countDocuments({ formationId: formation._id });
    const desiredOrder =
      requestedOrder !== null ? Math.min(requestedOrder, modulesCount + 1) : modulesCount + 1;
    if (requestedOrder !== null && desiredOrder <= modulesCount) {
      await shiftOrdersOnCreate(formation._id, desiredOrder);
    }
    const module = new FormationModule({
      formationId: formation._id,
      title,
      description: moduleEditorial.previewDescription,
      descriptionEditorial: moduleEditorial.descriptionEditorial,
      videos: videoItems,
      files,
      order: desiredOrder
    });
    await module.save();
    return res.status(201).json({ ok: true, module: buildModulePayload(module.toObject()) });
  } catch (error) {
    console.error('Impossible de creer le module', error);
    return res.status(500).json({ ok: false, error: 'Impossible de creer le module.' });
  }
}

export async function updateModule(req, res) {
  try {
    const moduleId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    }
    const module = await FormationModule.findById(moduleId);
    if (!module) {
      return res.status(404).json({ ok: false, error: 'Module introuvable.' });
    }
    const formation = await loadDistancielFormation(module.formationId?.toString());
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    if (typeof req.body?.title === 'string') {
      const title = req.body.title.trim();
      if (!title) {
        return res.status(400).json({ ok: false, error: 'Le titre est requis.' });
      }
      module.title = title;
    }
    if (req.body?.descriptionEditorial !== undefined || req.body?.description !== undefined) {
      const moduleEditorial = normalizeModuleEditorial(
        req.body?.descriptionEditorial ?? module.descriptionEditorial,
        req.body?.description ?? module.description
      );
      module.descriptionEditorial = moduleEditorial.descriptionEditorial;
      module.description = moduleEditorial.previewDescription;
    }
    if (req.body?.videoItems !== undefined || req.body?.videos !== undefined) {
      module.videos = normalizeVideoItems(req.body?.videoItems ?? req.body?.videos);
    }
    if (req.body?.files !== undefined) {
      module.files = normalizeFiles(req.body.files);
    }
    const requestedOrder = parseOrder(req.body?.order);
    const modulesCount = await FormationModule.countDocuments({ formationId: formation._id });
    if (requestedOrder !== null) {
      const desiredOrder = Math.min(Math.max(MIN_ORDER, requestedOrder), modulesCount);
      await shiftOrdersOnUpdate(
        formation._id,
        module._id,
        module.order,
        desiredOrder
      );
      module.order = desiredOrder;
    }
    await module.save();
    return res.json({ ok: true, module: buildModulePayload(module.toObject()) });
  } catch (error) {
    console.error('Impossible de mettre a jour le module', error);
    if (error?.name === 'ValidationError' || error?.name === 'CastError') {
      return res.status(400).json({
        ok: false,
        error: error.message || 'Payload module invalide.'
      });
    }
    return res.status(500).json({
      ok: false,
      error: 'Impossible de mettre a jour le module.'
    });
  }
}

export async function deleteModule(req, res) {
  try {
    const moduleId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    }
    const module = await FormationModule.findById(moduleId);
    if (!module) {
      return res.status(404).json({ ok: false, error: 'Module introuvable.' });
    }
    const formation = await loadDistancielFormation(module.formationId?.toString());
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    const moduleFiles = normalizeFiles(module.files);
    const deletedOrder = Number.isFinite(Number(module.order)) ? Number(module.order) : null;
    await FormationModule.deleteOne({ _id: module._id });
    if (Number.isFinite(deletedOrder)) {
      await FormationModule.updateMany(
        {
          formationId: module.formationId,
          order: { $gt: deletedOrder }
        },
        {
          $inc: { order: -1 }
        }
      );
    }
    await Promise.all(moduleFiles.map(file => removeManagedModuleFile(file.url)));
    return res.json({ ok: true, id: moduleId });
  } catch (error) {
    console.error('Impossible de supprimer le module', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer le module.' });
  }
}

export async function reorderModules(req, res) {
  try {
    const formationId = String(req.params.id || '').trim();
    const formation = await loadDistancielFormation(formationId);
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    const orderedModuleIds = normalizeOrderedModuleIds(req.body?.orderedModuleIds);
    if (!orderedModuleIds.length) {
      return res.status(400).json({ ok: false, error: 'orderedModuleIds est requis.' });
    }
    const modules = await FormationModule.find({ formationId: formation._id })
      .select('_id')
      .lean();
    if (!modules.length) {
      return res.status(400).json({ ok: false, error: 'Aucun module a reordonner.' });
    }
    if (modules.length !== orderedModuleIds.length) {
      return res.status(400).json({ ok: false, error: 'La liste des modules est incomplete.' });
    }
    const existingIds = new Set(modules.map(entry => entry._id?.toString()));
    const allMatch = orderedModuleIds.every(id => existingIds.has(id));
    if (!allMatch) {
      return res.status(400).json({ ok: false, error: 'Les modules fournis sont invalides.' });
    }
    const operations = orderedModuleIds.map((moduleId, index) => ({
      updateOne: {
        filter: { _id: moduleId, formationId: formation._id },
        update: { $set: { order: index + 1 } }
      }
    }));
    await FormationModule.bulkWrite(operations, { ordered: true });
    const orderedModules = await FormationModule.find({ formationId: formation._id })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return res.json({ ok: true, modules: orderedModules.map(buildModulePayload) });
  } catch (error) {
    console.error('Impossible de sauvegarder l ordre des modules', error);
    return res.status(500).json({ ok: false, error: 'Impossible de sauvegarder l ordre des modules.' });
  }
}

export async function uploadModuleFile(req, res) {
  try {
    const moduleId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ ok: false, error: 'Identifiant de module invalide.' });
    }
    const module = await FormationModule.findById(moduleId);
    if (!module) {
      return res.status(404).json({ ok: false, error: 'Module introuvable.' });
    }
    const formation = await loadDistancielFormation(module.formationId?.toString());
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Fichier manquant.' });
    }
    const labelCandidate = String(req.body?.name || req.file.originalname || '').trim();
    const fileLabel = labelCandidate || req.file.originalname || 'module-file';
    const fileUrl = `${MODULE_FILE_PUBLIC_PREFIX}${req.file.filename}`;
    const files = normalizeFiles(module.files);
    files.push({
      fileId: new mongoose.Types.ObjectId().toString(),
      name: fileLabel,
      title: '',
      url: fileUrl,
      size: Number(req.file.size || 0),
      order: files.length + 1
    });
    module.files = normalizeFiles(files);
    await module.save();
    const latest = normalizeFiles(module.files).find(entry => entry.url === fileUrl) || {
      fileId: '',
      name: fileLabel,
      url: fileUrl,
      size: Number(req.file.size || 0),
      order: files.length
    };
    return res.status(201).json({ ok: true, file: latest });
  } catch (error) {
    console.error("Impossible d'uploader le fichier module", error);
    return res.status(500).json({ ok: false, error: "Impossible d'uploader le fichier." });
  }
}

export async function deleteModuleFile(req, res) {
  try {
    const moduleId = String(req.params.id || '').trim();
    const fileId = String(req.params.fileId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({ ok: false, error: 'Identifiant de module invalide.' });
    }
    if (!fileId) {
      return res.status(400).json({ ok: false, error: 'Identifiant de fichier invalide.' });
    }
    const module = await FormationModule.findById(moduleId);
    if (!module) {
      return res.status(404).json({ ok: false, error: 'Module introuvable.' });
    }
    const formation = await loadDistancielFormation(module.formationId?.toString());
    if (!formation) {
      return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    }
    const files = normalizeFiles(module.files);
    const fileIndex = files.findIndex(entry => entry.fileId === fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ ok: false, error: 'Fichier introuvable.' });
    }
    const [removedFile] = files.splice(fileIndex, 1);
    module.files = normalizeFiles(files);
    await module.save();
    await removeManagedModuleFile(removedFile?.url);
    return res.json({
      ok: true,
      fileId,
      files: normalizeFiles(module.files)
    });
  } catch (error) {
    console.error('Impossible de supprimer le fichier module', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer le fichier.' });
  }
}
