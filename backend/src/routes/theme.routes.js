import { Router } from 'express';
import { themeController, managerThemeController } from '../controllers/singleton.controllers.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate);

// Vitrine theme — editable by ADMIN.
router.get('/vitrine', themeController.get);
router.put('/vitrine', authorize(ROLES.ADMIN), themeController.update);

// Manager theme — DEV only.
router.get('/manager', managerThemeController.get);
router.put('/manager', authorize(ROLES.DEV), managerThemeController.update);

export default router;
