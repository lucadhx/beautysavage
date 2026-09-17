// routers/calendarRouter.js
// M10 — Calendrier global institut (manager). Monté sous /api/gestion (requireGestionRole)
// → admin/dev uniquement, jamais client.
import { Router } from 'express';
import { getCalendarItems } from '../controllers/calendarController.js';

const router = Router();

router.get('/items', getCalendarItems);

export default router;
