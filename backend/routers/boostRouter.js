import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import { listBoosts, setBoost } from '../controllers/boostController.js';

const router = express.Router();

router.use(requireAuth(), requireDev);

router.get('/', listBoosts);
router.put('/', setBoost);

export default router;
