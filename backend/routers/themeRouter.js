import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listThemes,
  createTheme,
  updateTheme,
  activateTheme
} from '../controllers/themeController.js';

const router = express.Router();

// Thème gérable par admin + dev (requireDev = admin+dev) : les admins pilotent le thème vitrine
// depuis l'espace Paramètres du manager. Le contrôleur reste l'autorité.
router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/', listThemes);
router.post('/', createTheme);
router.put('/:id', updateTheme);
router.post('/:id/activate', activateTheme);

export default router;
