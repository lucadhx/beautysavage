import { Router } from 'express';
import * as siteStatusController from '../controllers/siteStatus.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { suspendSchema, contractProtectionSchema } from '../validators/common.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate);

router.get('/', siteStatusController.get);
router.post('/suspend', authorize(ROLES.DEV), validate(suspendSchema), siteStatusController.suspend);
router.post('/reactivate', authorize(ROLES.DEV), siteStatusController.reactivate);
router.post('/reconcile', authorize(ROLES.DEV), siteStatusController.reconcile);

/**
 * PROTECTION CONTRACTUELLE — réservée au DEV, comme les autres leviers de ce
 * routeur. L'autorisation est portée par le backend : un bouton masqué côté
 * écran n'est pas une permission. L'ADMIN (le client) peut LIRE le statut via
 * `GET /`, il ne peut pas décider si son propre contrat le protège.
 */
router.post(
  '/contract-protection',
  authorize(ROLES.DEV),
  validate(contractProtectionSchema),
  siteStatusController.setProtection,
);

export default router;
