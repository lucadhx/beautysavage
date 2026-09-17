import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  discardTempSiteLogo,
  getSiteIdentity,
  updateSiteIdentity,
  uploadTempSiteLogo
} from '../controllers/siteIdentityController.js';

const LOGO_FIELD = 'logo';
const LOGO_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'site');
const LOGO_UPLOAD_TEMP_DIR = path.join(LOGO_UPLOAD_DIR, 'tmp');
const MAX_LOGO_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
]);

fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(LOGO_UPLOAD_TEMP_DIR, { recursive: true });

function buildStorage(destinationPath, namePrefix = '') {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, destinationPath);
    },
    filename(_req, file, cb) {
      const original = String(file.originalname || 'site-logo');
      const ext = path.extname(original).toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
      const base = path
        .basename(original, ext)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'site-logo';
      const prefix = String(namePrefix || '').trim();
      const leading = prefix ? `${prefix}-` : '';
      cb(null, `${Date.now()}-${leading}${base}${safeExt}`);
    }
  });
}

function buildUploader(storage) {
  return multer({
    storage,
    limits: { fileSize: MAX_LOGO_SIZE },
    fileFilter(_req, file, cb) {
      if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
        return cb(new Error('unsupported-media-type'), false);
      }
      cb(null, true);
    }
  });
}

const uploadOfficialLogo = buildUploader(buildStorage(LOGO_UPLOAD_DIR));
const uploadTempLogo = buildUploader(buildStorage(LOGO_UPLOAD_TEMP_DIR, 'tmp'));

function handleUploadError(res, err, contextLabel) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Fichier trop volumineux (max 2 Mo).'
        : 'Erreur lors du traitement du fichier.';
    return res.status(400).json({ ok: false, error: message });
  }
  if (err.message === 'unsupported-media-type') {
    return res.status(400).json({ ok: false, error: 'Type de fichier non supporte (png/jpg/jpeg/webp).' });
  }
  console.error(contextLabel, err);
  return res.status(500).json({ ok: false, error: "Impossible d'uploader le logo." });
}

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/', getSiteIdentity);
router.post('/temp-logo', (req, res) => {
  uploadTempLogo.single(LOGO_FIELD)(req, res, err => {
    if (err) {
      return handleUploadError(res, err, 'Erreur upload logo temporaire site');
    }
    return uploadTempSiteLogo(req, res);
  });
});
router.delete('/temp-logo', discardTempSiteLogo);
router.put('/', (req, res) => {
  uploadOfficialLogo.single(LOGO_FIELD)(req, res, err => {
    if (err) {
      return handleUploadError(res, err, 'Erreur upload logo site');
    }
    return updateSiteIdentity(req, res);
  });
});

export default router;
