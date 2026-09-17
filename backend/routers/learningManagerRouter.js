// C2 — Learning Studio + présence (manager, admin/dev). Monté sur /api/gestion/learning, AVANT les
// broad-mounts dev-only (commissionRouter requireStrictDev) — sinon shadow 403 admin (cf. C1/M3A).
import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireDev } from '../middlewares/requireDev.js';
import {
  listLearningTree,
  createChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  listSessionParticipants,
  markAttendance,
  scanAttendance,
  getAttestationTemplate,
  updateAttestationTemplate,
  previewAttestation,
  getManagerAttestation
} from '../controllers/learningController.js';
import {
  listReviewsForModeration,
  moderateReview,
  createManualReview
} from '../controllers/reviewModerationController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

// Chapitres / leçons
router.get('/formations/:id/tree', listLearningTree);
router.post('/formations/:id/chapters', createChapter);
router.put('/formations/:id/chapters/reorder', reorderChapters);
router.put('/chapters/:chapterId', updateChapter);
router.delete('/chapters/:chapterId', deleteChapter);
router.post('/formations/:id/lessons', createLesson);
router.put('/formations/:id/lessons/reorder', reorderLessons);
router.put('/lessons/:lessonId', updateLesson);
router.delete('/lessons/:lessonId', deleteLesson);

// Présence présentiel
router.get('/sessions/:sessionId/participants', listSessionParticipants);
router.post('/sessions/:sessionId/attendance', markAttendance);
router.post('/sessions/:sessionId/scan', scanAttendance);

// Attestation : template (preview studio) + génération PDF par client (C3)
router.get('/attestation-template', getAttestationTemplate);
router.put('/attestation-template', updateAttestationTemplate);
router.post('/attestation-template/preview', previewAttestation);
router.get('/customers/:customerId/formations/:formationId/attestation', getManagerAttestation);

// Modération des avis
router.get('/reviews', listReviewsForModeration);
router.post('/reviews/manual', createManualReview);
router.patch('/reviews/:reviewId', moderateReview);

export default router;
