import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getFormations,
  createFormation,
  updateFormation,
  deleteFormation
} from '../controllers/businessController.js';

const router = express.Router();

router.use(requireAuth(), requireDev);

router.get('/products', getProducts);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

router.get('/formations', getFormations);
router.post('/formations', createFormation);
router.put('/formations/:id', updateFormation);
router.delete('/formations/:id', deleteFormation);

export default router;
