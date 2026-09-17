import express from 'express';

import { requireAdminOrDev } from '../middlewares/requireDev.js';
import {
  listIdentitiesHandler,
  createCommercialeHandler,
  requestVerificationHandler,
  confirmVerificationHandler,
  setActiveHandler,
  refreshHandler
} from '../controllers/communicationIdentityController.js';

// M1 — Identités de communication COMMERCIALE (scope institute). ADMIN ou DEV.
// Les identités SUPPORT ne sont gérables que par le dev (contrôlé dans le controller).
// Monté sur /api/gestion/communication-identities (sous requireGestionRole global).
const router = express.Router();
router.use(requireAdminOrDev);

router.get('/', listIdentitiesHandler);
router.post('/commerciale', createCommercialeHandler);
router.post('/:id/request-verification', requestVerificationHandler);
router.post('/:id/confirm-verification', confirmVerificationHandler);
router.post('/:id/set-active', setActiveHandler);
router.post('/:id/refresh', refreshHandler);

export default router;
