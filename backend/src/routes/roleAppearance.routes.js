import { Router } from 'express';
import { roleAppearanceController } from '../controllers/singleton.controllers.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { roleAppearanceUpdateSchema } from '../validators/roleAppearance.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate);

// Lecture : tout compte authentifié (rendu des badges de rôle).
router.get('/', roleAppearanceController.get);
// Modification : DEV uniquement.
router.put('/', authorize(ROLES.DEV), validate(roleAppearanceUpdateSchema), roleAppearanceController.update);

export default router;
