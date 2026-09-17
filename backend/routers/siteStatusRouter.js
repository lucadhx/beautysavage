import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  getPublicSiteStatus,
  getGestionSiteStatus,
  getSiteStatusHistory,
  suspendSite,
  startSiteMaintenance,
  endSiteMaintenance,
  reactivateSite
} from '../controllers/siteStatusController.js';

const publicRouter = express.Router();
publicRouter.get('/', getPublicSiteStatus);

const gestionRouter = express.Router();
gestionRouter.use(requireAuth(), requireMode('gestion'), requireStrictDev);
gestionRouter.get('/', getGestionSiteStatus);
gestionRouter.get('/history', getSiteStatusHistory);
gestionRouter.post('/suspend', suspendSite);
gestionRouter.post('/maintenance/start', startSiteMaintenance);
gestionRouter.post('/maintenance/end', endSiteMaintenance);
gestionRouter.post('/reactivate', reactivateSite);

export { publicRouter as siteStatusPublicRouter, gestionRouter as siteStatusGestionRouter };
