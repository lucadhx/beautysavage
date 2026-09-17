import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { requireAuth } from '../utils/session.js';
import {
  getContractStatus,
  getStripeDevConfig,
  getPendingInfo,
  downloadContractFile,
  createLaunchIntent,
  createMonthlySetup,
  activateFreeContract,
  cancelImmediate,
  createContract,
  deleteContract,
  updateGracePeriod,
  updatePendingMessage,
  getContractHistory,
  getActiveContract,
  checkPaymentStatus,
  verifyLaunchPayment,
  verifyMonthlySetup,
  activateContract,
  uploadTempFile,
  deleteTempFile,
  getCurrentContract,
  cancelContract
} from '../controllers/contractController.js';

const CONTRACT_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'contracts');
const CONTRACT_TEMP_DIR = path.join(CONTRACT_UPLOAD_DIR, 'temp');
const MAX_CONTRACT_FILE_SIZE = 12 * 1024 * 1024;
const CONTRACT_FILE_FIELD = 'contractFile';

fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(CONTRACT_TEMP_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, CONTRACT_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'contrat');
    const ext = path.extname(original).toLowerCase();
    const allowedExts = new Set(['.pdf', '.doc', '.docx']);
    const safeExt = allowedExts.has(ext) ? ext : '.pdf';
    const base = path
      .basename(original, path.extname(original))
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'contrat';
    cb(null, `${Date.now()}-${base}${safeExt}`);
  }
});

function contractFileFilter(_req, file, cb) {
  const mimeType = String(file?.mimetype || '').trim().toLowerCase();
  const ext = path.extname(String(file?.originalname || '')).toLowerCase();
  const allowedMimes = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]);
  const allowedExts = new Set(['.pdf', '.doc', '.docx']);
  if (!allowedMimes.has(mimeType) && !allowedExts.has(ext)) {
    return cb(new Error('unsupported-contract-file-type'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_CONTRACT_FILE_SIZE },
  fileFilter: contractFileFilter
});

const tempStorage = multer.diskStorage({
  destination(_req, _file, cb) { cb(null, CONTRACT_TEMP_DIR); },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'contrat');
    const ext = path.extname(original).toLowerCase();
    const allowedExts = new Set(['.pdf', '.doc', '.docx']);
    const safeExt = allowedExts.has(ext) ? ext : '.pdf';
    const base = path
      .basename(original, path.extname(original))
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'contrat';
    cb(null, `tmp-${Date.now()}-${base}${safeExt}`);
  }
});

const uploadTemp = multer({
  storage: tempStorage,
  limits: { fileSize: MAX_CONTRACT_FILE_SIZE },
  fileFilter: contractFileFilter
});

function handleUploadError(res, error) {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Le contrat dépasse la taille maximale autorisée (12 Mo).'
        : 'Erreur lors du traitement du fichier.';
    return res.status(400).json({ ok: false, code: 'UPLOAD_ERROR', error: message });
  }
  if (error?.message === 'unsupported-contract-file-type') {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_FILE_TYPE',
      error: 'Seuls les fichiers PDF et Word sont autorisés.'
    });
  }
  console.error('[ContractRouter:UploadError]', error);
  return res.status(500).json({ ok: false, code: 'UPLOAD_ERROR', error: "Impossible d'uploader le contrat." });
}

function requireDevOnly(req, res, next) {
  const role = String(req.sessionUser?.role || '').trim().toLowerCase();
  if (role !== 'dev') {
    return res.status(403).json({ ok: false, error: 'Accès réservé au développeur.' });
  }
  return next();
}

function requireAdminRole(req, res, next) {
  const role = String(req.sessionUser?.role || '').trim().toLowerCase();
  if (role !== 'admin' && role !== 'dev') {
    return res.status(403).json({ ok: false, error: 'Accès réservé à l\'administrateur.' });
  }
  return next();
}

const router = express.Router();

// ---------------------------------------------------------------------------
// Public routes (no auth required)
// ---------------------------------------------------------------------------
router.get('/status', getContractStatus);
router.get('/stripe-dev-config', getStripeDevConfig);

// ---------------------------------------------------------------------------
// Shared routes (admin + dev, auth required)
// ---------------------------------------------------------------------------
router.get('/active', requireAuth(), getActiveContract);
router.get('/current', requireAuth(), getCurrentContract);
router.post('/cancel', requireAuth(), requireAdminRole, cancelContract);
router.get('/pending-info', requireAuth(), getPendingInfo);
router.get('/check-payment-status', requireAuth(), checkPaymentStatus);
router.post('/download-file', requireAuth(), downloadContractFile);
router.post('/create-launch-intent', requireAuth(), createLaunchIntent);
router.post('/create-monthly-setup', requireAuth(), createMonthlySetup);
router.post('/verify-launch-payment', requireAuth(), verifyLaunchPayment);
router.post('/verify-monthly-setup', requireAuth(), verifyMonthlySetup);
router.post('/activate', requireAuth(), activateContract);

// ---------------------------------------------------------------------------
// Developer-only routes
// ---------------------------------------------------------------------------
router.post('/cancel-immediate', requireAuth(), requireDevOnly, cancelImmediate);
router.post('/activate-free', requireAuth(), requireDevOnly, activateFreeContract);
router.post('/upload-temp', requireAuth(), requireDevOnly, (req, res) => {
  uploadTemp.single(CONTRACT_FILE_FIELD)(req, res, error => {
    if (error) return handleUploadError(res, error);
    return uploadTempFile(req, res);
  });
});
router.delete('/upload-temp/:id', requireAuth(), requireDevOnly, deleteTempFile);
router.post('/', requireAuth(), requireDevOnly, (req, res) => {
  // Multer parse toujours le multipart body (pour req.body.tempFileId ou req.file)
  upload.single(CONTRACT_FILE_FIELD)(req, res, error => {
    if (error) return handleUploadError(res, error);
    return createContract(req, res);
  });
});
router.delete('/:id', requireAuth(), requireDevOnly, deleteContract);
router.patch('/:id/grace-period', requireAuth(), requireDevOnly, updateGracePeriod);
router.patch('/:id/pending-message', requireAuth(), requireDevOnly, updatePendingMessage);
router.get('/history', requireAuth(), requireDevOnly, getContractHistory);

export default router;
