import fs from 'node:fs/promises';
import path from 'node:path';

import HomePageSettings from '../models/HomePageSettings.js';
import { sanitizeEditorialHtml } from '../services/editableContentService.js';
import { sanitizeFaqInput, serializeFaq } from '../services/faq/faqSanitizer.js';

const HOME_SETTINGS_KEY = 'global';
const HOME_UPLOAD_PUBLIC_PREFIX = '/uploads/home';
const HOME_UPLOAD_TEMP_PUBLIC_PREFIX = '/uploads/home/tmp';
const HOME_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'home');
const HOME_UPLOAD_TEMP_ROOT = path.resolve(HOME_UPLOAD_ROOT, 'tmp');
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const EMPTY_ASSET = Object.freeze({
  type: null,
  url: null,
  filePath: null,
  updatedAt: null
});

function normalizeAssetType(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'null') return null;
  if (normalized === 'url' || normalized === 'upload') return normalized;
  return undefined;
}

function normalizePublicPath(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return null;
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  if (normalized.includes('..')) return null;
  return normalized;
}

function sanitizeManagedUploadPath(value, { allowTemp = false, requireTemp = false } = {}) {
  const normalized = normalizePublicPath(value);
  if (!normalized) return null;
  if (!normalized.startsWith(`${HOME_UPLOAD_PUBLIC_PREFIX}/`)) return null;
  const isTemp = normalized.startsWith(`${HOME_UPLOAD_TEMP_PUBLIC_PREFIX}/`);
  if (requireTemp && !isTemp) return null;
  if (!allowTemp && isTemp) return null;
  return normalized;
}

function sanitizeExternalUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeSlogan(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function coerceAsset(asset) {
  const type = normalizeAssetType(asset?.type) ?? null;
  if (type === 'url') {
    return {
      type: 'url',
      url: sanitizeExternalUrl(asset?.url),
      filePath: null,
      updatedAt: asset?.updatedAt ? new Date(asset.updatedAt) : null
    };
  }
  if (type === 'upload') {
    return {
      type: 'upload',
      url: null,
      filePath: sanitizeManagedUploadPath(asset?.filePath, { allowTemp: false }),
      updatedAt: asset?.updatedAt ? new Date(asset.updatedAt) : null
    };
  }
  return { ...EMPTY_ASSET };
}

function resolveAssetUrl(asset) {
  if (!asset) return null;
  if (asset.type === 'url') return sanitizeExternalUrl(asset.url);
  if (asset.type === 'upload') {
    return sanitizeManagedUploadPath(asset.filePath, { allowTemp: false });
  }
  return null;
}

function buildAssetPayload(asset) {
  const normalized = coerceAsset(asset);
  return {
    type: normalized.type,
    url: normalized.url,
    filePath: normalized.filePath,
    urlResolved: resolveAssetUrl(normalized),
    updatedAt: normalized.updatedAt || null
  };
}

function buildPayload(doc) {
  const banner = buildAssetPayload(doc?.banner);
  const aboutPhoto = buildAssetPayload(doc?.about?.photo);
  return {
    banner,
    slogan: normalizeSlogan(doc?.slogan),
    hookEditorialHtml: String(doc?.hookEditorialHtml || ''),
    about: {
      photo: aboutPhoto,
      editorialHtml: String(doc?.about?.editorialHtml || '')
    },
    faq: serializeFaq(doc?.faq),
    updatedAt: doc?.updatedAt || null
  };
}

async function ensureHomeSettingsDocument() {
  return HomePageSettings.findOneAndUpdate(
    { key: HOME_SETTINGS_KEY },
    {
      $setOnInsert: {
        key: HOME_SETTINGS_KEY,
        slogan: '',
        hookEditorialHtml: '',
        banner: { ...EMPTY_ASSET },
        about: {
          photo: { ...EMPTY_ASSET },
          editorialHtml: ''
        }
      }
    },
    { new: true, upsert: true }
  ).lean();
}

function toAbsoluteManagedUploadPath(
  publicPath,
  { allowTemp = false, requireTemp = false } = {}
) {
  const normalizedPublicPath = sanitizeManagedUploadPath(publicPath, {
    allowTemp,
    requireTemp
  });
  if (!normalizedPublicPath) return null;
  const relative = normalizedPublicPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(process.cwd(), relative);
  if (absolutePath !== HOME_UPLOAD_ROOT && !absolutePath.startsWith(`${HOME_UPLOAD_ROOT}${path.sep}`)) {
    return null;
  }
  const isTempPath =
    absolutePath === HOME_UPLOAD_TEMP_ROOT ||
    absolutePath.startsWith(`${HOME_UPLOAD_TEMP_ROOT}${path.sep}`);
  if (requireTemp && !isTempPath) return null;
  if (!allowTemp && isTempPath) return null;
  return absolutePath;
}

async function removeManagedUpload(publicPath, options = {}) {
  const absolutePath = toAbsoluteManagedUploadPath(publicPath, options);
  if (!absolutePath) return;
  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Suppression fichier home impossible', {
        path: absolutePath,
        error
      });
    }
  }
}

async function cleanupUnexpectedUpload(file) {
  const uploadedPath = String(file?.path || '').trim();
  if (!uploadedPath) return;
  try {
    await fs.unlink(uploadedPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Suppression fichier temporaire home impossible', {
        path: uploadedPath,
        error
      });
    }
  }
}

function isSameAsset(current, next) {
  const currentAsset = coerceAsset(current);
  const nextAsset = coerceAsset(next);
  return (
    currentAsset.type === nextAsset.type &&
    String(currentAsset.url || '') === String(nextAsset.url || '') &&
    String(currentAsset.filePath || '') === String(nextAsset.filePath || '')
  );
}

function withAssetUpdatedAt(current, next) {
  const nextAsset = coerceAsset(next);
  const currentAsset = coerceAsset(current);
  return {
    ...nextAsset,
    updatedAt: isSameAsset(currentAsset, nextAsset)
      ? currentAsset.updatedAt || null
      : new Date()
  };
}

async function moveTempAssetToOfficial(tempPublicPath) {
  const tempAbsolutePath = toAbsoluteManagedUploadPath(tempPublicPath, {
    allowTemp: true,
    requireTemp: true
  });
  if (!tempAbsolutePath) {
    throw new Error('ASSET_TEMP_INVALID');
  }
  const originalName = path.basename(tempAbsolutePath);
  const originalExt = path.extname(originalName).toLowerCase();
  const safeExt = ALLOWED_IMAGE_EXTENSIONS.has(originalExt) ? originalExt : '.png';
  const baseName =
    path
      .basename(originalName, originalExt)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'home-asset';
  const targetFilename = `${Date.now()}-${baseName}${safeExt}`;
  const targetAbsolutePath = path.resolve(HOME_UPLOAD_ROOT, targetFilename);

  try {
    await fs.rename(tempAbsolutePath, targetAbsolutePath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await fs.copyFile(tempAbsolutePath, targetAbsolutePath);
    await fs.unlink(tempAbsolutePath);
  }

  return sanitizeManagedUploadPath(`${HOME_UPLOAD_PUBLIC_PREFIX}/${targetFilename}`, {
    allowTemp: false
  });
}

function normalizeAssetInput(rawAsset) {
  const source = rawAsset && typeof rawAsset === 'object' ? rawAsset : {};
  const type = normalizeAssetType(source.type);
  const rawPathValue =
    source.filePath ?? source.tempAssetId ?? source.pendingTempAssetId ?? null;
  const rawPathString = String(rawPathValue ?? '').trim();
  const hasPathInput = rawPathString.length > 0;
  const normalizedRawPath = normalizePublicPath(rawPathString);
  const sanitizedPath = sanitizeManagedUploadPath(normalizedRawPath, { allowTemp: true });
  return {
    type,
    url: sanitizeExternalUrl(source.url),
    hasRawPath: Boolean(normalizedRawPath),
    hasInvalidRawPath: hasPathInput && !normalizedRawPath,
    rawPath: normalizedRawPath,
    sanitizedPath
  };
}

async function resolveNextAsset(currentAsset, rawAsset) {
  const current = coerceAsset(currentAsset);
  if (!rawAsset || typeof rawAsset !== 'object') {
    return {
      nextAsset: withAssetUpdatedAt(current, current),
      uploadedToDelete: [],
      tempToDelete: [],
      createdOfficialPaths: []
    };
  }
  const input = normalizeAssetInput(rawAsset);
  if (input.type === undefined) {
    throw new Error('ASSET_TYPE_INVALID');
  }
  if (input.hasInvalidRawPath || (input.hasRawPath && (!input.rawPath || !input.sanitizedPath))) {
    throw new Error('ASSET_PATH_INVALID');
  }
  const uploadedToDelete = [];
  const tempToDelete = [];
  const createdOfficialPaths = [];

  if (input.type === null) {
    if (current.type === 'upload' && current.filePath) {
      uploadedToDelete.push(current.filePath);
    }
    if (
      input.sanitizedPath &&
      sanitizeManagedUploadPath(input.sanitizedPath, { allowTemp: true, requireTemp: true })
    ) {
      tempToDelete.push(input.sanitizedPath);
    }
    return {
      nextAsset: withAssetUpdatedAt(current, { ...EMPTY_ASSET }),
      uploadedToDelete,
      tempToDelete,
      createdOfficialPaths
    };
  }

  if (input.type === 'url') {
    if (!input.url) {
      throw new Error('ASSET_URL_INVALID');
    }
    if (current.type === 'upload' && current.filePath) {
      uploadedToDelete.push(current.filePath);
    }
    if (
      input.sanitizedPath &&
      sanitizeManagedUploadPath(input.sanitizedPath, { allowTemp: true, requireTemp: true })
    ) {
      tempToDelete.push(input.sanitizedPath);
    }
    return {
      nextAsset: withAssetUpdatedAt(current, {
        type: 'url',
        url: input.url,
        filePath: null
      }),
      uploadedToDelete,
      tempToDelete,
      createdOfficialPaths
    };
  }

  let nextUploadPath = null;
  if (input.sanitizedPath) {
    const tempPath = sanitizeManagedUploadPath(input.sanitizedPath, {
      allowTemp: true,
      requireTemp: true
    });
    if (tempPath) {
      nextUploadPath = await moveTempAssetToOfficial(tempPath);
      createdOfficialPaths.push(nextUploadPath);
    } else {
      nextUploadPath = sanitizeManagedUploadPath(input.sanitizedPath, { allowTemp: false });
    }
  } else if (current.type === 'upload' && current.filePath) {
    nextUploadPath = current.filePath;
  }

  if (!nextUploadPath) {
    throw new Error('ASSET_UPLOAD_REQUIRED');
  }

  if (
    current.type === 'upload' &&
    current.filePath &&
    current.filePath !== nextUploadPath
  ) {
    uploadedToDelete.push(current.filePath);
  }

  return {
    nextAsset: withAssetUpdatedAt(current, {
      type: 'upload',
      url: null,
      filePath: nextUploadPath
    }),
    uploadedToDelete,
    tempToDelete,
    createdOfficialPaths
  };
}

export async function getHomeSettingsGestion(_req, res) {
  try {
    const settings = await ensureHomeSettingsDocument();
    return res.json({ ok: true, settings: buildPayload(settings) });
  } catch (error) {
    console.error('Impossible de recuperer les settings home (gestion)', error);
    return res.status(500).json({ ok: false, error: 'Impossible de recuperer les settings.' });
  }
}

export async function getHomeSettingsPublic(_req, res) {
  try {
    const settings = await ensureHomeSettingsDocument();
    return res.json({ ok: true, settings: buildPayload(settings) });
  } catch (error) {
    console.error('Impossible de recuperer les settings home (vitrine)', error);
    return res.status(500).json({ ok: false, error: 'Impossible de recuperer les settings.' });
  }
}

export async function uploadTempHomeAsset(req, res) {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Le fichier image est requis.' });
  }
  const tempAssetPath = sanitizeManagedUploadPath(
    `${HOME_UPLOAD_TEMP_PUBLIC_PREFIX}/${req.file.filename}`,
    { allowTemp: true, requireTemp: true }
  );
  if (!tempAssetPath) {
    await cleanupUnexpectedUpload(req.file);
    return res.status(400).json({ ok: false, error: 'Le fichier temporaire est invalide.' });
  }
  return res.json({
    ok: true,
    tempAssetId: tempAssetPath,
    tempAssetUrl: tempAssetPath
  });
}

export async function discardTempHomeAsset(req, res) {
  const rawRef = String(req.body?.tempAssetId || req.body?.tempAssetPath || '').trim();
  const tempAssetId = sanitizeManagedUploadPath(rawRef, {
    allowTemp: true,
    requireTemp: true
  });
  if (!tempAssetId) {
    return res.status(400).json({ ok: false, error: "L'asset temporaire est invalide." });
  }
  try {
    await removeManagedUpload(tempAssetId, { allowTemp: true, requireTemp: true });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Impossible de supprimer asset temporaire home', error);
    return res.status(500).json({ ok: false, error: "Impossible de supprimer l'asset temporaire." });
  }
}

export async function updateHomeSettings(req, res) {
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const hasSloganInput = Object.prototype.hasOwnProperty.call(payload, 'slogan');
  const hasHookInput = Object.prototype.hasOwnProperty.call(payload, 'hookEditorialHtml');
  const hasFaqInput = Object.prototype.hasOwnProperty.call(payload, 'faq');
  const hasAboutEditorialInput = Object.prototype.hasOwnProperty.call(
    payload?.about || {},
    'editorialHtml'
  );

  const createdOfficialPaths = [];
  const uploadsToDelete = [];
  const tempToDelete = [];
  try {
    const current = await ensureHomeSettingsDocument();
    const slogan = hasSloganInput
      ? normalizeSlogan(payload.slogan)
      : normalizeSlogan(current?.slogan || '');
    const hookEditorialHtml = hasHookInput
      ? sanitizeEditorialHtml(payload.hookEditorialHtml || '')
      : String(current?.hookEditorialHtml || '');
    const aboutEditorialHtml = hasAboutEditorialInput
      ? sanitizeEditorialHtml(payload?.about?.editorialHtml || '')
      : String(current?.about?.editorialHtml || '');
    const faq = hasFaqInput ? sanitizeFaqInput(payload.faq) : serializeFaq(current?.faq);
    const bannerResult = await resolveNextAsset(current?.banner, payload.banner);
    const aboutPhotoResult = await resolveNextAsset(current?.about?.photo, payload?.about?.photo);

    createdOfficialPaths.push(
      ...bannerResult.createdOfficialPaths,
      ...aboutPhotoResult.createdOfficialPaths
    );
    uploadsToDelete.push(...bannerResult.uploadedToDelete, ...aboutPhotoResult.uploadedToDelete);
    tempToDelete.push(...bannerResult.tempToDelete, ...aboutPhotoResult.tempToDelete);

    const settings = await HomePageSettings.findOneAndUpdate(
      { key: HOME_SETTINGS_KEY },
      {
        $set: {
          slogan,
          hookEditorialHtml,
          banner: {
            type: bannerResult.nextAsset.type,
            url: bannerResult.nextAsset.url,
            filePath: bannerResult.nextAsset.filePath,
            updatedAt: bannerResult.nextAsset.updatedAt
          },
          about: {
            photo: {
              type: aboutPhotoResult.nextAsset.type,
              url: aboutPhotoResult.nextAsset.url,
              filePath: aboutPhotoResult.nextAsset.filePath,
              updatedAt: aboutPhotoResult.nextAsset.updatedAt
            },
            editorialHtml: aboutEditorialHtml
          },
          faq,
          updatedBy: req.sessionUserId || null
        },
        $setOnInsert: {
          key: HOME_SETTINGS_KEY
        }
      },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    for (const pathToDelete of new Set(uploadsToDelete.filter(Boolean))) {
      await removeManagedUpload(pathToDelete, { allowTemp: false });
    }
    for (const tempPath of new Set(tempToDelete.filter(Boolean))) {
      await removeManagedUpload(tempPath, { allowTemp: true, requireTemp: true });
    }

    return res.json({ ok: true, settings: buildPayload(settings) });
  } catch (error) {
    for (const createdPath of new Set(createdOfficialPaths.filter(Boolean))) {
      await removeManagedUpload(createdPath, { allowTemp: false });
    }
    const errorMessage = String(error?.message || '').trim();
    if (
      errorMessage === 'ASSET_TYPE_INVALID' ||
      errorMessage === 'ASSET_PATH_INVALID' ||
      errorMessage === 'ASSET_URL_INVALID' ||
      errorMessage === 'ASSET_UPLOAD_REQUIRED' ||
      errorMessage === 'ASSET_TEMP_INVALID'
    ) {
      const labels = {
        ASSET_TYPE_INVALID: 'Type d asset invalide.',
        ASSET_PATH_INVALID: "Reference d'asset invalide.",
        ASSET_URL_INVALID: 'URL d image invalide.',
        ASSET_UPLOAD_REQUIRED: 'Une image upload est requise.',
        ASSET_TEMP_INVALID: 'Asset temporaire introuvable.'
      };
      return res.status(400).json({ ok: false, error: labels[errorMessage] || 'Payload invalide.' });
    }
    console.error('Impossible de mettre a jour les settings home', error);
    return res.status(500).json({ ok: false, error: 'Impossible de mettre a jour les settings.' });
  }
}
