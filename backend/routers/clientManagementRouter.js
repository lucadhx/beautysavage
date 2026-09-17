import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireAdminOrDev } from '../middlewares/requireDev.js';
import { listClients, getClientDetails, toggleClientSuspension, getClientStats } from '../controllers/clientManagementController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireAdminOrDev);

router.get('/', listClients);
router.get('/stats', getClientStats); // AVANT /:clientId pour éviter le conflit
router.get('/:clientId', getClientDetails);
router.patch('/:id/suspension', toggleClientSuspension);

export default router;
