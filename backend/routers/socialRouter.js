import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireDev } from '../middlewares/requireDev.js';
import {
  listSocialLinks,
  createSocialLink,
  updateSocialLink,
  deleteSocialLink
} from '../controllers/socialController.js';

const router = express.Router();

router.use(requireAuth(), requireDev);

router.get('/', listSocialLinks);
router.post('/', createSocialLink);
router.put('/:id', updateSocialLink);
router.delete('/:id', deleteSocialLink);

export default router;
