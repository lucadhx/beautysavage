import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listSessions,
  listCanceledSessions,
  createSession,
  updateSession,
  deleteSession,
  generateSessionQr,
  getSessionConflicts,
  getConflictsReport
} from '../controllers/formationSessionController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/sessions/conflicts', getSessionConflicts);
router.get('/sessions/conflicts-report', getConflictsReport);

router.get('/formations/:id/sessions', listSessions);
router.get('/formations/:id/canceled-sessions', listCanceledSessions);
router.post('/formations/:id/sessions', createSession);
router.put('/formations/:id/sessions/:sessionId', updateSession);
router.post('/formations/:id/sessions/:sessionId/qr', generateSessionQr);
router.delete('/formations/:id/sessions/:sessionId', deleteSession);

export default router;
