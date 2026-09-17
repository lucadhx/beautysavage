import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireStrictDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { getUIConfig, updateUIConfig } from '../controllers/uiConfigController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireStrictDev);

router.get('/', getUIConfig);
router.put('/', updateUIConfig);

export default router;
