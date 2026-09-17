// routers/evaluationClientRouter.js
// FORMATION-EVALUATION — Routes CLIENT. Monté /api/client/evaluation.
// Upload photos/vidéos via multer (disque → uploads/evaluations, servi par /uploads).
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { requireAuth } from '../utils/session.js';
import {
  getClientEvaluation,
  createOrGetAttempt,
  saveAnswers,
  uploadDeliverable,
  submitAttempt,
  downloadClientCertificate
} from '../controllers/evaluationClientController.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'evaluations');
const MAX_SIZE = 60 * 1024 * 1024; // 60 Mo (couvre les vidéos courtes de rendu)
const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'
]);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* ignore */ }
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    const base = path.basename(file.originalname || 'file', ext).replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase();
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter(_req, file, cb) {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    return cb(new Error('unsupported-media-type'));
  }
});

const router = express.Router();
router.use(requireAuth());

router.get('/formations/:formationId', getClientEvaluation);
router.post('/formations/:formationId/attempt', createOrGetAttempt);
router.put('/attempts/:attemptId/answers', saveAnswers);
router.post('/attempts/:attemptId/deliverables', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ ok: false, error: 'Fichier trop volumineux (max 60 Mo).' });
      }
      if (err.message === 'unsupported-media-type') {
        return res.status(400).json({ ok: false, error: 'Format de fichier non supporté.' });
      }
      return res.status(400).json({ ok: false, error: 'Upload impossible.' });
    }
    return uploadDeliverable(req, res);
  });
});
router.post('/attempts/:attemptId/submit', submitAttempt);
router.get('/certificates/:id', downloadClientCertificate);

export default router;
