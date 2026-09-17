import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listPractitioners,
  getMyPractitionerProfile,
  activateMyPractitionerProfile,
  deactivateMyPractitionerProfile,
  updateMyPractitionerProfile
} from '../controllers/practitionerController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'));

router.get('/', listPractitioners);
router.get('/me', getMyPractitionerProfile);
router.post('/me/activate', activateMyPractitionerProfile);
router.post('/me/deactivate', deactivateMyPractitionerProfile);
router.put('/me', updateMyPractitionerProfile);

export default router;
