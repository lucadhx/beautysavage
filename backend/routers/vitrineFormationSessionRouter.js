import express from 'express';

import { listSessionsForVitrine } from '../controllers/formationSessionController.js';
import { getFormationSessionOptions } from '../controllers/vitrineShopController.js';

const router = express.Router();

router.get('/:id/sessions', listSessionsForVitrine);
router.get('/:id/sessions/:sessionId/options', getFormationSessionOptions);

export default router;
