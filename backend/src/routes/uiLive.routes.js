/**
 * FLUX D'INVALIDATION D'INTERFACE — réservé aux sessions authentifiées.
 *
 * `authenticate` s'applique comme partout ailleurs : le flux n'expose aucune
 * donnée métier, mais ouvrir une connexion longue à un anonyme permettrait de
 * les accumuler sans limite. La même barrière que le reste de l'API suffit —
 * on n'en invente pas une seconde.
 */
import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { liveEvents } from '../controllers/uiLive.controller.js';

const router = Router();
router.use(authenticate);
router.get('/events', liveEvents);

export default router;
