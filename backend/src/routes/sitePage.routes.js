import { Router } from 'express';
import { sitePageController } from '../controllers/sitePage.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { sitePageSchema, reorderSchema } from '../validators/content.validator.js';
import { idParam } from '../validators/common.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate);

router.get('/', sitePageController.list);
router.get('/:id', validate(idParam), sitePageController.getOne);
router.post('/', authorize(ROLES.ADMIN), validate(sitePageSchema), sitePageController.create);
router.patch('/reorder', authorize(ROLES.ADMIN), validate(reorderSchema), sitePageController.reorder);
router.put('/:id', authorize(ROLES.ADMIN), validate(sitePageSchema), sitePageController.update);
router.delete('/:id', authorize(ROLES.ADMIN), validate(idParam), sitePageController.remove);

export default router;
