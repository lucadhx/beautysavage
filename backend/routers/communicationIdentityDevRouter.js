import express from 'express';

import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listIdentitiesHandler,
  createSupportHandler,
  requestVerificationHandler,
  confirmVerificationHandler,
  setActiveHandler,
  refreshHandler
} from '../controllers/communicationIdentityController.js';

// M1 — Identités de communication SUPPORT (scope platform). DEV uniquement.
// Monté sur /api/gestion/dev/communication-identities (sous requireGestionRole global).
const router = express.Router();
router.use(requireStrictDev);

router.get('/', listIdentitiesHandler);
router.post('/support', createSupportHandler);
router.post('/:id/request-verification', requestVerificationHandler);
router.post('/:id/confirm-verification', confirmVerificationHandler);
router.post('/:id/set-active', setActiveHandler);
router.post('/:id/refresh', refreshHandler);

export default router;
