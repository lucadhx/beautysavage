import express from 'express';

import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  getSystemConfigurationHandler,
  updateSystemConfigurationHandler
} from '../controllers/systemConfigurationController.js';

// S1 — Paramètres Système (SystemConfiguration). DEV uniquement.
// Monté sur /api/gestion/dev/system-configuration (sous requireGestionRole global),
// AVANT le router /api/gestion/dev générique.
const router = express.Router();
router.use(requireStrictDev);

router.get('/', getSystemConfigurationHandler);
router.put('/', updateSystemConfigurationHandler);

export default router;
