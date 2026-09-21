import { Router } from 'express';
import * as ctrl from '../controllers/emailDeliveryDev.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { listDeliveriesSchema, deliveryIdSchema } from '../validators/emailDeliveryDev.validator.js';
import { ROLES } from '../utils/constants.js';

/**
 * Suivi des livraisons e-mail — DEV UNIQUEMENT, LECTURE SEULE. Aucune adresse en
 * clair, aucun secret. Le renvoi manuel n'est PAS exposé ici (hors périmètre).
 */
const router = Router();
router.use(authenticate, authorize(ROLES.DEV));

router.get('/', validate(listDeliveriesSchema), ctrl.listDeliveries);
router.get('/:deliveryId', validate(deliveryIdSchema), ctrl.getDelivery);
router.get('/:deliveryId/events', validate(deliveryIdSchema), ctrl.listDeliveryEvents);

export default router;
