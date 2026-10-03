import { Router } from 'express';
import { seoSettingsController } from '../controllers/singleton.controllers.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { seoSettingsUpdateSchema } from '../validators/seoSettings.validator.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { seoDiagnostic, productSeoPreview } from '../services/seo/seo.service.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../utils/constants.js';

/**
 * LE RÉFÉRENCEMENT — lecture authentifiée, écriture ADMIN, comme le contenu
 * de l'accueil : c'est le client qui connaît son adresse et ses profils.
 *
 * `/diagnostic` dit, à partir des données RÉELLES du site, ce qui manque pour
 * être bien compris des moteurs et des assistants IA.
 */
const router = Router();

router.use(authenticate);
router.get('/', seoSettingsController.get);
router.get('/diagnostic', asyncHandler(async (req, res) => ok(res, await seoDiagnostic())));
router.get('/product/:id', asyncHandler(async (req, res) => {
  const preview = await productSeoPreview(req.params.id).catch(() => null);
  if (!preview) throw ApiError.notFound('Fiche introuvable');
  return ok(res, preview);
}));
router.put('/', authorize(ROLES.ADMIN), validate(seoSettingsUpdateSchema), seoSettingsController.update);

export default router;
