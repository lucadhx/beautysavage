import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listGestionCategories,
  createGestionCategory,
  updateGestionCategory,
  deleteGestionCategory,
  updateGestionCategoriesOrder,
  listGestionPages,
  createGestionPage,
  updateGestionPage,
  deleteGestionPage,
  updateGestionPagesOrder
} from '../controllers/gestionPagesController.js';

const router = express.Router();

router.use(
  requireAuth(),
  requireMode('gestion'),
  requireStrictDev
);

router.get('/categories', listGestionCategories);
router.post('/categories', requireStrictDev, createGestionCategory);
router.put('/categories/order', requireStrictDev, updateGestionCategoriesOrder);
router.put('/categories/:id', requireStrictDev, updateGestionCategory);
router.delete('/categories/:id', requireStrictDev, deleteGestionCategory);

router.get('/pages', listGestionPages);
router.post('/pages', requireStrictDev, createGestionPage);
router.put('/pages/:id', requireStrictDev, updateGestionPage);
router.delete('/pages/:id', requireStrictDev, deleteGestionPage);

router.put('/order', requireStrictDev, updateGestionPagesOrder);

export default router;
