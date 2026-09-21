import { Router } from 'express';
import * as ctrl from '../controllers/domainEvent.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { listEventsSchema, eventIdSchema } from '../validators/domainEvent.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Observation des événements : DEV UNIQUEMENT. Les payloads sont sûrs par
// construction, mais l'ADMIN n'a aucune raison de voir la mécanique interne.
router.use(authenticate, authorize(ROLES.DEV));

router.get('/', validate(listEventsSchema), ctrl.list);
// Avant `/:eventId`, sinon « registry » serait pris pour un identifiant.
router.get('/registry', ctrl.registry);
router.get('/:eventId', validate(eventIdSchema), ctrl.getOne);
router.get('/:eventId/actions', validate(eventIdSchema), ctrl.listActions);
// Seule mutation autorisée : relancer ce qui a échoué. Ni création, ni édition —
// un fait ne se fabrique pas et ne se réécrit pas.
router.post('/:eventId/retry', validate(eventIdSchema), ctrl.retry);

export default router;
