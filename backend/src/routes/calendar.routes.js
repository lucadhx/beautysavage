import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/apiResponse.js';
import { ROLES } from '../utils/constants.js';
import * as calendar from '../services/calendar.service.js';

const router = Router();
router.use(authenticate);

router.get('/schedule', asyncHandler(async (_req, res) => ok(res, await calendar.getSchedule())));
router.put('/schedule', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await calendar.saveSchedule(req.body))));
router.get('/availability', asyncHandler(async (req, res) => ok(res, await calendar.listAvailability(req.query))));

router.get('/events', asyncHandler(async (req, res) => ok(res, await calendar.listEvents(req.query))));
router.post('/events', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => created(res, await calendar.createEvent(req.body))));
router.put('/events/:id', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await calendar.updateEvent(req.params.id, req.body))));
router.post('/events/:id/cancel', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await calendar.cancelEvent(req.params.id, req.body))));
router.post('/events/:id/balance-payment', authorize(ROLES.ADMIN, ROLES.DEV), asyncHandler(async (req, res) => ok(res, await calendar.recordBalancePayment(req.params.id, req.body))));

export default router;
