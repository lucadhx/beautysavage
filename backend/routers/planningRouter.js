import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  getPlanningOverview,
  getPlanningSessionDetail,
  getSessionAttendees
} from '../controllers/planningController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireDev);

router.get('/planning', getPlanningOverview);
router.get('/planning/:sessionId', getPlanningSessionDetail);
router.get('/sessions/:sessionId/attendees', getSessionAttendees);

export default router;
