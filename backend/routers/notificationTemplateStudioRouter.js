// routers/notificationTemplateStudioRouter.js
// M7 — Studio templates de notification (dev-only). Monté sur /api/gestion/dev/notification-templates.
import { Router } from 'express';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listTemplatesHandler,
  getTemplateHandler,
  createTemplateHandler,
  listVersionsHandler,
  createDraftHandler,
  publishDraftHandler,
  archiveTemplateHandler,
  rollbackHandler,
} from '../controllers/notificationTemplateController.js';

const router = Router();
router.use(requireStrictDev);

router.get('/', listTemplatesHandler);
router.get('/:templateKey/versions', listVersionsHandler);
router.get('/:templateKey', getTemplateHandler);
router.post('/:templateKey', createTemplateHandler);
router.post('/:templateKey/draft', createDraftHandler);
router.post('/:templateKey/rollback/:version', rollbackHandler);
router.post('/drafts/:id/publish', publishDraftHandler);
router.post('/drafts/:id/archive', archiveTemplateHandler);

export default router;
