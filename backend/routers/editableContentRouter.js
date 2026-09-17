import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireAdminOrDev } from '../middlewares/requireDev.js';
import { requireMode } from '../middlewares/modeGuard.js';
import {
  listEditableContent,
  saveEditableContent,
  getEditableContentForVitrine
} from '../controllers/editableContentController.js';

const gestionRouter = express.Router();
gestionRouter.use(requireAuth(), requireMode('gestion'), requireAdminOrDev);
gestionRouter.get('/', listEditableContent);
gestionRouter.post('/', saveEditableContent);

const vitrineRouter = express.Router();
vitrineRouter.get('/', getEditableContentForVitrine);

export { gestionRouter, vitrineRouter };
