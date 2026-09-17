import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireAdminOrDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listGestionUsers,
  createGestionUser,
  updateGestionUser
} from '../controllers/gestionUsersController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireAdminOrDev);

router.get('/', listGestionUsers);
router.post('/', createGestionUser);
router.put('/:id', updateGestionUser);

export default router;
