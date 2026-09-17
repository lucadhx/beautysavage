// routers/evaluationManagerRouter.js
// FORMATION-EVALUATION — Routes INSTITUT (dev/admin). Monté /api/gestion/evaluation.
import express from 'express';
import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireDev } from '../middlewares/requireDev.js';
import {
  getManagerDefinition,
  putManagerDefinition,
  listResults,
  getResult,
  acceptResult,
  refuseResult,
  downloadManagerCertificate
} from '../controllers/evaluationManagerController.js';

const router = express.Router();
router.use(requireAuth(), requireMode('gestion'), requireDev);

// Définition d'évaluation d'une formation
router.get('/formations/:formationId/definition', getManagerDefinition);
router.put('/formations/:formationId/definition', putManagerDefinition);

// Console « Résultats »
router.get('/results', listResults);
router.get('/results/:attemptId', getResult);
router.post('/results/:attemptId/accept', acceptResult);
router.post('/results/:attemptId/refuse', refuseResult);

// Diplôme
router.get('/certificates/:id', downloadManagerCertificate);

export default router;
