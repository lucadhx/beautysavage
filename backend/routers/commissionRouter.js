import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  getCommissionStats,
  listCommissionTransactions,
  createCommissionConfig,
  getCommissionConfigHistory,
  getCommissionConfigStats,
  deleteActiveCommissionConfig
} from '../controllers/commissionController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireStrictDev);

router.get('/commissions/stats', getCommissionStats);
router.get('/commissions', listCommissionTransactions);
router.post('/commissions/config', createCommissionConfig);
router.get('/commissions/config/stats', getCommissionConfigStats);
router.get('/commissions/config/history', getCommissionConfigHistory);
router.delete('/commissions/config/active', deleteActiveCommissionConfig);

export default router;
