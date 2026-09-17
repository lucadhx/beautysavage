import express from 'express';
import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import * as ctrl from '../controllers/availabilityController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'));

router.get('/schedule/me', ctrl.getMySchedule);
router.get('/schedule/:practitionerId', ctrl.getSchedule);
router.put('/schedule/:practitionerId', ctrl.saveSchedule);

router.get('/exceptions/:practitionerId', ctrl.getExceptions);
router.post('/exceptions/batch', ctrl.batchUpsertExceptions);
router.post('/exceptions', ctrl.createException);
router.put('/exceptions/:id', ctrl.updateException);
router.delete('/exceptions/:id', ctrl.deleteException);

router.get('/calendar-events', ctrl.getCalendarEvents);

export default router;
