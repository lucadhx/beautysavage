// RX-BLOCKER-2 — Gestion des comptes manager (admin/dev) par invitation. DEV-ONLY (V1 : un admin ne gère pas
// les comptes manager → pas d'escalade). Monté sous /api/gestion/manager-users (hérite requireGestionRole du
// broad-mount, puis narrows à dev + mode gestion).
import express from 'express';
import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listManagerUsers,
  createManagerUser,
  resendManagerInvitation,
  disableManagerUser,
  enableManagerUser
} from '../controllers/managerUsersController.js';

const router = express.Router();
router.use(requireAuth(), requireMode('gestion'), requireStrictDev);

router.get('/', listManagerUsers);
router.post('/', createManagerUser);
router.post('/:id/send-invitation', resendManagerInvitation);
router.post('/:id/disable', disableManagerUser);
router.post('/:id/enable', enableManagerUser);

export default router;
