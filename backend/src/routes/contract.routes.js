import { Router } from 'express';
import multer from 'multer';
import * as devCtrl from '../controllers/contract.dev.controller.js';
import * as docCtrl from '../controllers/contractDocument.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { uploadContractPdf } from '../middlewares/upload.middleware.js';
import {
  updateDraftSchema, signatureConfigSchema, paymentGracePolicySchema,
} from '../validators/contract.validator.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// --- Documents (DEV + ADMIN, contrôle d'accès fin dans le controller) --------
// Montés EN PREMIER : ces routes doivent rester accessibles à l'ADMIN alors que
// le reste de /contracts est réservé au DEV.
router.get('/:id/documents/original', authenticate, docCtrl.downloadOriginal);
router.get('/:id/documents/signed', authenticate, docCtrl.downloadSigned);
router.get('/:id/documents/certificate', authenticate, docCtrl.downloadCertificate);

// --- Reste du module : DEV UNIQUEMENT ---------------------------------------
router.use(authenticate, authorize(ROLES.DEV));

router.get('/', devCtrl.list);
router.post('/', devCtrl.create);
router.get('/:id', devCtrl.getOne);
router.put('/:id/draft', validate(updateDraftSchema), devCtrl.updateDraft);
// Politique de grâce : volontairement HORS du brouillon — elle ne sert qu'une
// fois l'abonnement en cours, et doit pouvoir être corrigée pendant un impayé.
router.put(
  '/:id/payment-grace-policy',
  validate(paymentGracePolicySchema),
  devCtrl.updatePaymentGracePolicy,
);
router.delete('/:id', devCtrl.remove);

// Upload PDF (multipart) — wrapper pour traduire les erreurs multer (413/400).
router.post('/:id/document', (req, res, next) => {
  uploadContractPdf.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(
        err.code === 'LIMIT_FILE_SIZE'
          ? new ApiError(413, 'PDF trop volumineux (max 20 Mo).')
          : ApiError.badRequest(err.message)
      );
    }
    if (err) return next(err);
    next();
  });
}, devCtrl.uploadDocument);

router.put('/:id/signature-configuration', validate(signatureConfigSchema), devCtrl.updateSignatureConfiguration);
router.post('/:id/validate', devCtrl.validate);
router.post('/:id/start-dev-signature', devCtrl.startDevSignature);
router.post('/:id/restart-signature', devCtrl.restartSignature);
router.get('/:id/timeline', devCtrl.timeline);
router.get('/:id/payments', devCtrl.payments);
router.post('/:id/cancel', devCtrl.cancel);
/**
 * RÉSILIATION IMMÉDIATE — réservée aux DEV, valable en TEST comme en PROD.
 *
 * Le routeur est déjà sous `authorize(ROLES.DEV)` ; le service revérifie la
 * permission, parce qu'une garde qui ne vit que dans la route ne protège que
 * ce qui passe par la route.
 */
router.post('/:id/cancel-immediately', devCtrl.cancelImmediately);
router.post('/:id/reconcile', devCtrl.reconcile);
router.post('/:id/sync', devCtrl.sync);
router.post('/:id/sync-payment', devCtrl.syncPayment);
router.post('/:id/sync-subscription', devCtrl.syncSubscription);
router.post('/:id/sync-invoices', devCtrl.syncInvoices);

// --- Outils de RECETTE — ENV=TEST uniquement --------------------------------
// Le refus en PROD est imposé par le service (assertTestEnvironment), donc
// valable même si ces routes sont appelées directement.
router.post('/:id/test/end-now', devCtrl.endNow);
router.post('/test/reset-recette', devCtrl.resetRecette);

export default router;
