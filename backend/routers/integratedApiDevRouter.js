import express from 'express';

import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listIntegrationsHandler,
  getIntegrationHandler,
  updateCredentialsHandler,
  deleteRuntimeHandler,
  testIntegrationHandler,
  setModeHandler
} from '../controllers/integratedApiController.js';

// Surface de gestion des intégrations chiffrées (Stripe institut/dev, Brevo). DEV uniquement.
// Monté sur /api/gestion/dev/integrated-api (sous requireGestionRole global),
// AVANT le router /api/gestion/dev générique.
const router = express.Router();
router.use(requireStrictDev);

router.get('/', listIntegrationsHandler);
router.get('/:slug', getIntegrationHandler);
router.put('/:slug/credentials', updateCredentialsHandler);
router.delete('/:slug/credentials', deleteRuntimeHandler);
router.post('/:slug/test', testIntegrationHandler);
router.post('/:slug/mode', setModeHandler);

export default router;
