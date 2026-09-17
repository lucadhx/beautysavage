import express from 'express';

import { requireAuth } from '../utils/session.js';
import { requireMode } from '../middlewares/modeGuard.js';
import { requireStrictDev } from '../middlewares/requireDev.js';
import {
  getTemplate,
  saveTemplateController,
  simulateSale,
  listCategories,
  listTemplates,
  updateTemplateCategory,
  listVersionsController,
  createDraftController,
  publishDraftController,
  archiveTemplateController,
  rollbackController,
  getVariableCatalog,
  testSendTemplate,
  previewTemplate,
  getTriggerMatrix
} from '../controllers/mailTemplateController.js';

const router = express.Router();

router.use(requireAuth(), requireMode('gestion'), requireStrictDev);

router.get('/templates', listTemplates);
router.get('/categories', listCategories);
router.get('/template', getTemplate);
router.post('/template', saveTemplateController);
router.patch('/templates/:functionName/category', updateTemplateCategory);
router.post('/simulate-sale', simulateSale);

// P1-3 — catalogue canonique des variables (backend = source d'autorité).
router.get('/variables', getVariableCatalog);
// P1-2 — envoi de test (données d'exemple, [TEST], aucun event métier, aucun token réel).
router.post('/templates/:functionName/test-send', testSendTemplate);
// LOT2 §2 — aperçu = production (même renderer backend que l'envoi réel).
router.post('/templates/:functionName/preview', previewTemplate);
// LOT2 §3 — matrice des déclencheurs (lecture seule).
router.get('/triggers', getTriggerMatrix);

// Versioning (Phase 5A — backend only, no UI)
router.get('/templates/:functionName/versions', listVersionsController);
router.post('/templates/:functionName/draft', createDraftController);
router.post('/drafts/:id/publish', publishDraftController);
router.post('/drafts/:id/archive', archiveTemplateController);
router.post('/templates/:functionName/rollback/:version', rollbackController);

export default router;
