import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireStrictDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  getPages,
  createPage,
  updatePage,
  updatePagesOrder,
  deletePage,
  getMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem
} from '../controllers/vitrineGestionController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireStrictDev);
router.get('/pages', getPages);
router.post('/pages', createPage);
router.put('/pages/order', updatePagesOrder);
router.put('/pages/:id', updatePage);
router.delete('/pages/:id', deletePage);

router.get('/menu', getMenuItems);
router.post('/menu', createMenuItem);
router.put('/menu/:id', updateMenuItem);
router.delete('/menu/:id', deleteMenuItem);

export default router;
