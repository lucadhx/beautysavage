import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireDev } from '../middlewares/requireDev.js';
import {
  getGiftCardConfig,
  updateGiftCardConfig,
  uploadGiftCardConfigImage,
  listGiftCards,
  getGiftCardDetailForGestion,
  lookupGiftCardForGestion,
  verifyGiftCardPasswordForGestion,
  manualDebitGiftCardForGestion,
  generateMissingGiftCardPasswords,
  createManualGiftCard,
  lookupGiftCardByQr,
  manualDebitGiftCardById,
  resetGiftCardPinAndResend
} from '../controllers/giftCardController.js';
import {
  listLibraryHandler,
  getActiveTemplateHandler,
  activateTemplateHandler,
  previewLibraryTemplateHandler
} from '../controllers/giftCardTemplateController.js';

const IMAGE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'giftcards');
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml'
]);

fs.mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });

const imageStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, IMAGE_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'image');
    const ext = path.extname(original).toLowerCase() || '.jpg';
    const base = path
      .basename(original, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'image';
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error('unsupported-media-type'), false);
    }
    cb(null, true);
  }
});

function handleImageUpload(req, res, next) {
  imageUpload.single('image')(req, res, err => {
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
      console.error('Erreur upload image carte cadeau', err);
      return res.status(500).json({ ok: false, error: "Impossible d'uploader l'image." });
    }
    next();
  });
}

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/config', getGiftCardConfig);
router.put('/config', updateGiftCardConfig);
router.post('/config/upload-image', handleImageUpload, uploadGiftCardConfigImage);
router.post('/generate-missing-passwords', generateMissingGiftCardPasswords);

// M13 — librairie de templates (admin : lecture + sélection de l'actif uniquement).
router.get('/templates', listLibraryHandler);
router.get('/templates/active', getActiveTemplateHandler);
router.get('/templates/:id/preview', previewLibraryTemplateHandler);
router.post('/templates/:id/activate', activateTemplateHandler);

// M13 — création manuelle (paiement sur place) + lookups + débit manuel par id.
router.post('/manual', createManualGiftCard);
router.get('/lookup', lookupGiftCardForGestion); // GET ?code=
router.post('/lookup', lookupGiftCardForGestion);
router.post('/lookup-qr', lookupGiftCardByQr);
router.post('/verify-password', verifyGiftCardPasswordForGestion);
router.post('/manual-debit', manualDebitGiftCardForGestion); // legacy (par code + mot de passe)
router.post('/:id/manual-debit', manualDebitGiftCardById); // M13 (par id + motif)
router.post('/:id/reset-pin', resetGiftCardPinAndResend); // LOT2 §4 — reset PIN + renvoi
router.get('/', listGiftCards);
router.get('/:id', getGiftCardDetailForGestion);

export default router;
