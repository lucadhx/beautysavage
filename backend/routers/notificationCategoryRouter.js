// routers/notificationCategoryRouter.js
// M7 — Catégories de notification (dev-only). Monté sur /api/gestion/dev/notification-categories.
import { Router } from 'express';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listCategoriesHandler,
  createCategoryHandler,
  updateCategoryHandler,
  deleteCategoryHandler,
} from '../controllers/notificationCategoryController.js';

const router = Router();
router.use(requireStrictDev);

router.get('/', listCategoriesHandler);
router.post('/', createCategoryHandler);
router.put('/:id', updateCategoryHandler);
router.delete('/:id', deleteCategoryHandler);

export default router;
