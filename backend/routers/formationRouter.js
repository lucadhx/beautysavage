import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listFormations,
  getFormation,
  createFormation,
  updateFormation,
  deleteFormation,
  duplicateFormation,
  listDeletedFormationHistory,
  uploadFormationCover,
  listFormationReviewsForGestion
} from '../controllers/formationGestionController.js';
import {
  listOptions,
  createOption,
  updateOption,
  deleteOptionImage,
  deleteOption
} from '../controllers/formationOptionController.js';

const COVER_FIELD = 'coverImage';
const COVER_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'formations');
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml'
]);

fs.mkdirSync(COVER_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, COVER_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'cover');
    const ext = path.extname(original).toLowerCase() || '.jpg';
    const base = path
      .basename(original, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'cover';
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_COVER_SIZE },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error('unsupported-media-type'), false);
    }
    cb(null, true);
  }
});

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/', listFormations);
router.get('/deleted-history', listDeletedFormationHistory);
router.get('/:id/reviews', listFormationReviewsForGestion);
router.get('/:id', getFormation);
router.post('/', createFormation);
router.post('/:id/duplicate', duplicateFormation);
router.put('/:id', updateFormation);
router.delete('/:id', deleteFormation);
router.post('/upload-cover', (req, res) => {
  upload.single(COVER_FIELD)(req, res, err => {
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
      console.error('Erreur upload couverture', err);
      return res.status(500).json({ ok: false, error: "Impossible d'uploader la couverture." });
    }
    return uploadFormationCover(req, res);
  });
});

// Option image upload
const OPTION_IMAGE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'formation-options');
fs.mkdirSync(OPTION_IMAGE_UPLOAD_DIR, { recursive: true });

const optionImageStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, OPTION_IMAGE_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'option-image');
    const ext = path.extname(original).toLowerCase() || '.jpg';
    const base = path
      .basename(original, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'option-image';
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const optionImageUpload = multer({
  storage: optionImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error('unsupported-media-type'), false);
    }
    cb(null, true);
  }
});

function handleOptionImageUpload(req, res, next) {
  optionImageUpload.single('image')(req, res, err => {
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
      console.error('Erreur upload image option', err);
      return res.status(500).json({ ok: false, error: "Impossible d'uploader l'image." });
    }
    next();
  });
}

router.get('/:formationId/options', listOptions);
router.post('/:formationId/options', handleOptionImageUpload, createOption);
router.put('/:formationId/options/:optionId', handleOptionImageUpload, updateOption);
router.delete('/:formationId/options/:optionId/image', deleteOptionImage);
router.delete('/:formationId/options/:optionId', deleteOption);

export default router;
