import express from 'express';

import { getActiveThemeByScope } from '../controllers/themeController.js';

// Lecture publique du thème actif par scope (vitrine|manager). Couleurs non secrètes.
// Monté sur /api/theme → GET /api/theme/:scope. `/api/vitrine/theme` reste l'endpoint historique.
const router = express.Router();

router.get('/:scope', getActiveThemeByScope);

export default router;
