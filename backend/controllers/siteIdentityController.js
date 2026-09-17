import fs from 'node:fs/promises';
import path from 'node:path';

import SiteIdentity from '../models/SiteIdentity.js';

const DEFAULT_SITE_NAME = 'Beauty Savage';
const SITE_IDENTITY_KEY = 'global';
const SITE_UPLOAD_PUBLIC_PREFIX = '/uploads/site';
const SITE_UPLOAD_TEMP_PUBLIC_PREFIX = '/uploads/site/tmp';
const SITE_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'site');
const SITE_UPLOAD_TEMP_ROOT = path.resolve(SITE_UPLOAD_ROOT, 'tmp');
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function normalizeSiteName(value) {
  const candidate = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  return candidate || '';
}

function normalizeLogoType(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim().toLowerCase();
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

function sanitizePublicUploadPath(value, { allowTemp = false, requireTemp = false } = {}) {
  const normalized = normalizePublicPath(value);
  if (!normalized) return null;
  if (!normalized.startsWith(`${SITE_UPLOAD_PUBLIC_PREFIX}/`)) return null;
  const isTempPath = normalized.startsWith(`${SITE_UPLOAD_TEMP_PUBLIC_PREFIX}/`);
  if (requireTemp && !isTempPath) return null;
  if (!allowTemp && isTempPath) return null;
  return normalized;
}

function sanitizeLogoUrl(value) {
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

function resolveLogoUrl(doc) {
  if (!doc) return null;
  if (doc.logoType === 'url') {
    return sanitizeLogoUrl(doc.logoUrl);
  }
  if (doc.logoType === 'upload') {
    return sanitizePublicUploadPath(doc.logoPath, { allowTemp: false });
  }
  return null;
}

function buildGestionPayload(doc) {
  const siteName = normalizeSiteName(doc?.siteName) || DEFAULT_SITE_NAME;
  const logoType = normalizeLogoType(doc?.logoType) ?? null;
  const logoUrl = sanitizeLogoUrl(doc?.logoUrl);
  const logoPath = sanitizePublicUploadPath(doc?.logoPath, { allowTemp: false });
  return {
    siteName,
    logoType,
    logoUrl,
    logoPath,
    logoUrlResolved: resolveLogoUrl(doc),
    updatedAt: doc?.updatedAt || null
  };
}

function buildPublicPayload(doc) {
  const siteName = normalizeSiteName(doc?.siteName) || DEFAULT_SITE_NAME;
  return {
    siteName,
    logoUrlResolved: resolveLogoUrl(doc)
  };
}

async function ensureIdentityDocument() {
  return SiteIdentity.findOneAndUpdate(
    { key: SITE_IDENTITY_KEY },
    {
      $setOnInsert: {
        key: SITE_IDENTITY_KEY,
        siteName: DEFAULT_SITE_NAME,
        logoType: null,
        logoUrl: null,
        logoPath: null
      }
    },
    { new: true, upsert: true }
  ).lean();
}

function toAbsoluteManagedUploadPath(publicPath, { allowTemp = false, requireTemp = false } = {}) {
  const normalizedPublicPath = sanitizePublicUploadPath(publicPath, { allowTemp, requireTemp });
  if (!normalizedPublicPath) return null;
  const relative = normalizedPublicPath.replace(/^\/+/, '');
  const absolutePath = path.resolve(process.cwd(), relative);
  if (
    absolutePath !== SITE_UPLOAD_ROOT &&
    !absolutePath.startsWith(`${SITE_UPLOAD_ROOT}${path.sep}`)
  ) {
    return null;
  }
  const isTempPath =
    absolutePath === SITE_UPLOAD_TEMP_ROOT ||
    absolutePath.startsWith(`${SITE_UPLOAD_TEMP_ROOT}${path.sep}`);
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
      console.warn('Suppression logo upload impossible', { path: absolutePath, error });
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
      console.warn('Suppression fichier temporaire impossible', { path: uploadedPath, error });
    }
  }
}

function getTempLogoRef(payload = {}) {
  const rawRef =
    payload?.pendingLogo?.tempLogoId ??
    payload?.pendingLogo?.tempLogoPath ??
    payload?.tempLogoId ??
    payload?.tempLogoPath ??
    null;
  if (rawRef === null || rawRef === undefined) {
    return { raw: null, value: null };
  }
  const raw = String(rawRef || '').trim();
  if (!raw) {
    return { raw: null, value: null };
  }
  return {
    raw,
    value: sanitizePublicUploadPath(raw, { allowTemp: true, requireTemp: true })
  };
}

async function moveTempLogoToOfficial(tempPublicPath) {
  const tempAbsolutePath = toAbsoluteManagedUploadPath(tempPublicPath, {
    allowTemp: true,
    requireTemp: true
  });
  if (!tempAbsolutePath) {
    throw new Error('INVALID_TEMP_LOGO');
  }
  const originalName = path.basename(tempAbsolutePath);
  const originalExt = path.extname(originalName).toLowerCase();
  const safeExt = ALLOWED_LOGO_EXTENSIONS.has(originalExt) ? originalExt : '.png';
  const base = path
    .basename(originalName, originalExt)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'site-logo';
  const targetFilename = `${Date.now()}-${base}${safeExt}`;
  const targetAbsolutePath = path.resolve(SITE_UPLOAD_ROOT, targetFilename);

  try {
    await fs.rename(tempAbsolutePath, targetAbsolutePath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await fs.copyFile(tempAbsolutePath, targetAbsolutePath);
    await fs.unlink(tempAbsolutePath);
  }

  return sanitizePublicUploadPath(`${SITE_UPLOAD_PUBLIC_PREFIX}/${targetFilename}`, {
    allowTemp: false
  });
}

export async function getSiteIdentity(_req, res) {
  try {
    const identity = await ensureIdentityDocument();
    return res.json({ ok: true, identity: buildGestionPayload(identity) });
  } catch (error) {
    console.error('Impossible de recuperer l identite du site (gestion)', error);
    return res.status(500).json({ ok: false, error: "Impossible de recuperer l'identite du site." });
  }
}

export async function getSiteIdentityPublic(_req, res) {
  try {
    const identity = await ensureIdentityDocument();
    return res.json(buildPublicPayload(identity));
  } catch (error) {
    console.error('Impossible de recuperer l identite du site (vitrine)', error);
    return res.status(500).json({ ok: false, error: "Impossible de recuperer l'identite du site." });
  }
}

export async function uploadTempSiteLogo(req, res) {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Le fichier logo est requis.' });
  }
  const tempLogoPath = sanitizePublicUploadPath(
    `${SITE_UPLOAD_TEMP_PUBLIC_PREFIX}/${req.file.filename}`,
    { allowTemp: true, requireTemp: true }
  );
  if (!tempLogoPath) {
    await cleanupUnexpectedUpload(req.file);
    return res.status(400).json({ ok: false, error: 'Le fichier temporaire est invalide.' });
  }
  return res.json({
    ok: true,
    tempLogoId: tempLogoPath,
    tempLogoUrl: tempLogoPath
  });
}

export async function discardTempSiteLogo(req, res) {
  const tempRef = getTempLogoRef(req.body);
  if (tempRef.raw && !tempRef.value) {
    return res.status(400).json({ ok: false, error: 'Le logo temporaire est invalide.' });
  }
  if (!tempRef.value) {
    return res.status(400).json({ ok: false, error: 'Le logo temporaire est requis.' });
  }
  try {
    await removeManagedUpload(tempRef.value, { allowTemp: true, requireTemp: true });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Impossible de supprimer le logo temporaire', error);
    return res.status(500).json({ ok: false, error: 'Impossible de supprimer le logo temporaire.' });
  }
}

export async function updateSiteIdentity(req, res) {
  const siteName = normalizeSiteName(req.body?.siteName);
  const logoType = normalizeLogoType(req.body?.logoType);
  const tempRef = getTempLogoRef(req.body);
  const pendingTempLogoId = tempRef.value;
  let committedLogoPath = null;
  if (!siteName) {
    await cleanupUnexpectedUpload(req.file);
    return res.status(400).json({ ok: false, error: 'Le nom du site est requis.' });
  }
  if (logoType === undefined) {
    await cleanupUnexpectedUpload(req.file);
    return res.status(400).json({ ok: false, error: 'Le type de logo est invalide.' });
  }
  if (tempRef.raw && !pendingTempLogoId) {
    await cleanupUnexpectedUpload(req.file);
    return res.status(400).json({ ok: false, error: 'Le logo temporaire est invalide.' });
  }
  try {
    const current = await ensureIdentityDocument();
    const updates = {
      siteName
    };
    let uploadToDelete = null;

    if (logoType === 'url') {
      const logoUrl = sanitizeLogoUrl(req.body?.logoUrl);
      if (!logoUrl) {
        await cleanupUnexpectedUpload(req.file);
        return res.status(400).json({ ok: false, error: 'Veuillez fournir une URL de logo valide.' });
      }
      updates.logoType = 'url';
      updates.logoUrl = logoUrl;
      updates.logoPath = null;
      if (current?.logoType === 'upload') {
        uploadToDelete = current.logoPath;
      }
      if (pendingTempLogoId) {
        await removeManagedUpload(pendingTempLogoId, { allowTemp: true, requireTemp: true });
      }
      await cleanupUnexpectedUpload(req.file);
    } else if (logoType === 'upload') {
      const uploadedLogoPath = req.file
        ? sanitizePublicUploadPath(`${SITE_UPLOAD_PUBLIC_PREFIX}/${req.file.filename}`, {
          allowTemp: false
        })
        : null;
      if (req.file && !uploadedLogoPath) {
        await cleanupUnexpectedUpload(req.file);
        return res.status(400).json({ ok: false, error: 'Le fichier logo est invalide.' });
      }
      if (pendingTempLogoId) {
        committedLogoPath = await moveTempLogoToOfficial(pendingTempLogoId);
        await cleanupUnexpectedUpload(req.file);
      } else if (uploadedLogoPath) {
        committedLogoPath = uploadedLogoPath;
      }
      const nextLogoPath = committedLogoPath || sanitizePublicUploadPath(current?.logoPath, { allowTemp: false });
      if (!nextLogoPath) {
        await cleanupUnexpectedUpload(req.file);
        return res.status(400).json({ ok: false, error: 'Le fichier logo est requis.' });
      }
      updates.logoType = 'upload';
      updates.logoUrl = null;
      updates.logoPath = nextLogoPath;
      const currentLogoPath = sanitizePublicUploadPath(current?.logoPath, { allowTemp: false });
      if (current?.logoType === 'upload' && currentLogoPath && currentLogoPath !== nextLogoPath) {
        uploadToDelete = currentLogoPath;
      }
    } else {
      updates.logoType = null;
      updates.logoUrl = null;
      updates.logoPath = null;
      if (current?.logoType === 'upload') {
        uploadToDelete = current.logoPath;
      }
      if (pendingTempLogoId) {
        await removeManagedUpload(pendingTempLogoId, { allowTemp: true, requireTemp: true });
      }
      await cleanupUnexpectedUpload(req.file);
    }

    const identity = await SiteIdentity.findOneAndUpdate(
      { key: SITE_IDENTITY_KEY },
      {
        $set: updates,
        $setOnInsert: {
          key: SITE_IDENTITY_KEY
        }
      },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    if (uploadToDelete) {
      await removeManagedUpload(uploadToDelete);
    }

    return res.json({ ok: true, identity: buildGestionPayload(identity) });
  } catch (error) {
    await cleanupUnexpectedUpload(req.file);
    if (committedLogoPath) {
      await removeManagedUpload(committedLogoPath);
    }
    const uploadedLogoPath = req.file
      ? sanitizePublicUploadPath(`${SITE_UPLOAD_PUBLIC_PREFIX}/${req.file.filename}`, {
        allowTemp: false
      })
      : null;
    if (uploadedLogoPath) {
      await removeManagedUpload(uploadedLogoPath);
    }
    console.error('Impossible de mettre a jour l identite du site', error);
    return res.status(500).json({ ok: false, error: "Impossible de mettre a jour l'identite du site." });
  }
}
