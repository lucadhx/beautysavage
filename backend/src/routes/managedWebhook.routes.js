import { Router } from 'express';
import * as ctrl from '../controllers/managedWebhook.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../utils/constants.js';

/**
 * Webhooks gérés (vue générique multi-providers) — DEV UNIQUEMENT.
 * Le Manager n'appelle QUE ces routes : aucun endpoint par fournisseur.
 */
const router = Router();
router.use(authenticate, authorize(ROLES.DEV));

router.get('/:mode', ctrl.list);
router.post('/:provider/:mode/sync', ctrl.sync);
router.post('/:provider/:mode/repair', ctrl.repair);
router.post('/:provider/:mode/health', ctrl.health);
router.post('/:provider/:mode/test', ctrl.test);

export default router;
