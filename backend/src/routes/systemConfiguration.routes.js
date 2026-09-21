import { Router } from 'express';
import * as ctrl from '../controllers/systemConfiguration.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { networkUpdateSchema, networkTestSchema } from '../validators/systemConfiguration.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Configuration système : DEV UNIQUEMENT (lecture, modification, test).
router.use(authenticate, authorize(ROLES.DEV));

router.get('/network', ctrl.getNetwork);
router.put('/network', validate(networkUpdateSchema), ctrl.updateNetwork);
router.post('/network/test', validate(networkTestSchema), ctrl.testNetwork);

export default router;
