// LES MODÈLES D'E-MAIL — CINQ LECTURES ET UN TEST. AUCUNE ÉCRITURE (L12.1).
//
// `PUT /:templateId` et `POST /:templateId/versions/:version/restore` ont été
// retirés, ainsi que l'historique local : ils écrivaient dans une base de
// modèles propre au projet que rien n'expédiait. Il n'existe plus, dans tout ce
// service, un seul chemin permettant de modifier le contenu d'un e-mail — c'est
// la propriété que ce lot établit, et elle se vérifie ici en une lecture.

import { Router } from 'express';
import * as ctrl from '../controllers/emailTemplate.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { templateIdSchema, testSendSchema } from '../validators/emailTemplate.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate, authorize(ROLES.DEV));

router.get('/', ctrl.list);
router.get('/usage', ctrl.usage);
router.get('/:templateId', validate(templateIdSchema), ctrl.getOne);
router.post('/:templateId/preview', validate(templateIdSchema), ctrl.preview);
router.post('/:templateId/test-send', validate(testSendSchema), ctrl.testSend);
router.get('/:templateId/readiness', validate(templateIdSchema), ctrl.readiness);
router.get('/:templateId/deliveries', validate(templateIdSchema), ctrl.deliveries);

export default router;
