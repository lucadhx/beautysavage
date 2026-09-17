import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listModules,
  createModule,
  updateModule,
  deleteModule,
  reorderModules,
  uploadModuleFile,
  deleteModuleFile
} from '../controllers/formationModuleController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/formations/:id/modules', listModules);
router.post('/formations/:id/modules', createModule);
router.put('/formations/:id/modules/order', reorderModules);
router.put('/modules/:id', updateModule);
router.delete('/modules/:id', deleteModule);

const MODULE_FILE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'module-files');
fs.mkdirSync(MODULE_FILE_UPLOAD_DIR, { recursive: true });

const moduleFileStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, MODULE_FILE_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const original = String(file.originalname || 'module-file');
    const ext = path.extname(original).toLowerCase() || '.bin';
    const base = path
      .basename(original, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'module-file';
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const moduleFileUpload = multer({
  storage: moduleFileStorage,
  limits: { fileSize: 20 * 1024 * 1024 }
}).single('moduleFile');

router.post('/modules/:id/files', moduleFileUpload, uploadModuleFile);
router.delete('/modules/:id/files/:fileId', deleteModuleFile);

export default router;
