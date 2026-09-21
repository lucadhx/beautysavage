import { Router } from 'express';
import { companyController } from '../controllers/singleton.controllers.js';
import * as contactRecipients from '../controllers/contactNotificationRecipients.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { companyUpdateSchema } from '../validators/company.validator.js';
import { updateRecipientsSchema } from '../validators/contactNotificationRecipients.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate);
router.get('/', companyController.get);
router.put('/', authorize(ROLES.ADMIN), validate(companyUpdateSchema), companyController.update);

// Destinataires des nouvelles demandes de contact — route DÉDIÉE (un champ, une
// intention) plutôt que le PUT « document entier ». ADMIN : c'est un choix métier.
router.get('/contact-notification-recipients', contactRecipients.get);
router.put(
  '/contact-notification-recipients',
  authorize(ROLES.ADMIN),
  validate(updateRecipientsSchema),
  contactRecipients.update
);

export default router;
