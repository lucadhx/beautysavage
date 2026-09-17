import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  duplicateService,
  uploadServicePhoto,
  deleteServicePhoto,
  patchServiceBoost,
  patchServicePromotion
} from '../controllers/serviceController.js';

const PHOTO_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'services');
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml'
]);

fs.mkdirSync(PHOTO_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, PHOTO_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'photo');
    const ext = path.extname(original).toLowerCase() || '.jpg';
    const base = path
      .basename(original, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'photo';
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_SIZE },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error('unsupported-media-type'), false);
    }
    cb(null, true);
  }
});

function handleUpload(req, res, next) {
  upload.single('photo')(req, res, err => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Fichier trop volumineux (max 5 Mo).'
            : 'Erreur lors du traitement du fichier.';
        return res.status(400).json({ ok: false, error: message });
      }
      if (err.message === 'unsupported-media-type') {
        return res.status(400).json({ ok: false, error: 'Type de fichier non supporté.' });
      }
      console.error('Erreur upload photo service', err);
      return res.status(500).json({ ok: false, error: "Impossible d'uploader la photo." });
    }
    next();
  });
}

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'));

router.get('/', listServices);
router.post('/', createService);
router.get('/:id', getService);
router.put('/:id', updateService);
router.delete('/:id', deleteService);
router.post('/:id/duplicate', duplicateService);
router.post('/:id/upload-photo', handleUpload, uploadServicePhoto);
router.delete('/:id/photos/:photoIndex', deleteServicePhoto);
router.patch('/:id/boost', patchServiceBoost);
router.patch('/:id/promotion', patchServicePromotion);

export default router;
