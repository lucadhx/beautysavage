import { Router } from 'express';
import * as ctrl from '../controllers/deploymentControlPlane.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Plan de contrôle des déploiements : DEV UNIQUEMENT (infrastructure sensible).
router.use(authenticate, authorize(ROLES.DEV));

router.get('/targets', ctrl.listTargets);
router.get('/targets/:targetId', ctrl.getTarget);
router.patch('/targets/:targetId', ctrl.patchTarget);
router.get('/targets/:targetId/releases', ctrl.listReleases);
router.get('/targets/:targetId/runs', ctrl.listRuns);
router.get('/targets/:targetId/health', ctrl.getHealth);
router.post('/targets/:targetId/check-health', ctrl.checkHealth);

// Préparées pour P3 (erreur métier explicite, aucun faux succès).
router.post('/targets/:targetId/update', ctrl.updateTarget);
router.post('/targets/:targetId/rollback', ctrl.rollbackTarget);

export default router;
