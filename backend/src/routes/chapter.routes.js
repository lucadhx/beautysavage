import { Router } from 'express';
import { chapterController } from '../controllers/chapter.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { chapterSchema, reorderSchema } from '../validators/content.validator.js';
import { idParam } from '../validators/common.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate);

router.get('/', chapterController.list);
router.get('/:id', validate(idParam), chapterController.getOne);
router.post('/', authorize(ROLES.ADMIN), validate(chapterSchema), chapterController.create);
router.patch('/reorder', authorize(ROLES.ADMIN), validate(reorderSchema), chapterController.reorder);
router.put('/:id', authorize(ROLES.ADMIN), validate(chapterSchema), chapterController.update);
router.delete('/:id', authorize(ROLES.ADMIN), validate(idParam), chapterController.remove);

export default router;
