import { Router } from 'express';
import * as ctrl from '../controllers/contactDiagnostics.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../utils/constants.js';

/**
 * Diagnostics DEV des soumissions de contact — DEV UNIQUEMENT, LECTURE SEULE.
 * Expose la décision anti-abus (ACCEPTED / DUPLICATE / REJECTED_AS_SPAM), sans
 * message ni adresse en clair.
 */
const router = Router();
router.use(authenticate, authorize(ROLES.DEV));
router.get('/', ctrl.getContactDiagnostics);

export default router;
