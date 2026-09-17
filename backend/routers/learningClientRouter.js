// C2 — Expérience apprenant (client, requireAuth). Monté sur /api/client/learning. Accès gated via
// Purchase (contrôlé dans le controller). Lecture parcours + complétion leçon + token de présence.
import express from 'express';

import { requireAuth } from '../utils/session.js';
import {
  listMyLearningFormations,
  getMyLearningFormation,
  completeLesson,
  getMyAttendanceToken,
  getClientAttestation
} from '../controllers/learningController.js';

const router = express.Router();

router.use(requireAuth());

router.get('/formations', listMyLearningFormations);
router.get('/formations/:id', getMyLearningFormation);
router.post('/lessons/:lessonId/complete', completeLesson);
router.get('/formations/:formationId/attestation', getClientAttestation);
router.get('/sessions/:sessionId/attendance-token', getMyAttendanceToken);

export default router;
