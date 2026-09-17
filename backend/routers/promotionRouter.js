import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireDev } from '../middlewares/requireDev.js';
import { listPromotions, createPromotion } from '../controllers/promotionController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/', listPromotions);
router.post('/', createPromotion);

export default router;
