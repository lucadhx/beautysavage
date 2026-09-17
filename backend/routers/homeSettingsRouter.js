import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireDev } from '../middlewares/requireDev.js';
import {
  discardTempHomeAsset,
  getHomeSettingsGestion,
  updateHomeSettings,
  uploadTempHomeAsset
} from '../controllers/homeSettingsController.js';

const ASSET_FIELD = 'asset';
const HOME_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'home');
const HOME_UPLOAD_TEMP_DIR = path.join(HOME_UPLOAD_DIR, 'tmp');
const MAX_ASSET_SIZE = 6 * 1024 * 1024;
const ALLOWED_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
]);

fs.mkdirSync(HOME_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(HOME_UPLOAD_TEMP_DIR, { recursive: true });

const tempStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, HOME_UPLOAD_TEMP_DIR);
  },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'home-asset');
    const ext = path.extname(original).toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
    const base =
      path
        .basename(original, ext)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'home-asset';
    cb(null, `${Date.now()}-tmp-${base}${safeExt}`);
  }
});

const tempUpload = multer({
  storage: tempStorage,
  limits: { fileSize: MAX_ASSET_SIZE },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error('unsupported-media-type'), false);
    }
    cb(null, true);
  }
});

function handleUploadError(res, err) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Fichier trop volumineux (max 6 Mo).'
        : 'Erreur lors du traitement du fichier.';
    return res.status(400).json({ ok: false, error: message });
  }
  if (err?.message === 'unsupported-media-type') {
    return res.status(400).json({
      ok: false,
      error: 'Type de fichier non supporte (png/jpg/jpeg/webp).'
    });
  }
  console.error('Erreur upload asset home', err);
  return res.status(500).json({ ok: false, error: "Impossible d'uploader l'image." });
}

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/', getHomeSettingsGestion);
router.post('/temp-asset', (req, res) => {
  tempUpload.single(ASSET_FIELD)(req, res, err => {
    if (err) {
      return handleUploadError(res, err);
    }
    return uploadTempHomeAsset(req, res);
  });
});
router.delete('/temp-asset', discardTempHomeAsset);
router.put('/', updateHomeSettings);

export default router;
