// routers/giftCardTemplateStudioRouter.js
// M13 — Gift Card Template Studio (dev-only). Monté sur /api/gestion/dev/gift-card-templates.
import { Router } from 'express';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  listTemplatesHandler,
  getTemplateHandler,
  listVersionsHandler,
  createTemplateHandler,
  createDraftHandler,
  updateDraftHandler,
  publishDraftHandler,
  archiveTemplateHandler,
  rollbackHandler,
  previewTemplateHandler
} from '../controllers/giftCardTemplateController.js';

const router = Router();
router.use(requireStrictDev);

router.get('/', listTemplatesHandler);
router.post('/', createTemplateHandler);
router.post('/preview', previewTemplateHandler);
router.get('/:slug/versions', listVersionsHandler);
router.get('/:slug', getTemplateHandler);
router.post('/:slug/draft', createDraftHandler);
router.post('/:slug/rollback/:version', rollbackHandler);
router.patch('/drafts/:id', updateDraftHandler);
router.post('/drafts/:id/publish', publishDraftHandler);
router.post('/drafts/:id/archive', archiveTemplateHandler);

export default router;
