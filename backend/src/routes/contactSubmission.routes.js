import { Router } from 'express';
import * as ctrl from '../controllers/contactSubmission.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  submissionIdSchema,
  listSubmissionsSchema,
} from '../validators/contact.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

/**
 * Demandes de contact — ADMIN **et** DEV.
 *
 * L'ADMIN est le destinataire naturel : ce sont ses clients qui écrivent. Le DEV
 * y accède aussi, parce qu'il est le seul à pouvoir diagnostiquer une
 * notification en échec (l'état des livraisons est exposé ici, l'événement
 * système reste sur `/dev/domain-events`).
 *
 * Le RBAC vit ICI, une fois, au montage. Aucun composant Manager ne le rejoue :
 * un contrôle dupliqué dans une vue finit par diverger, et n'a de toute façon
 * jamais protégé quoi que ce soit — l'autorité est le serveur.
 */
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.DEV));

router.get('/', validate(listSubmissionsSchema), ctrl.list);
// AVANT `/:submissionId`, sinon « unread-count » serait pris pour un identifiant.
router.get('/unread-count', ctrl.getUnreadCount);
router.get('/:submissionId', validate(submissionIdSchema), ctrl.getOne);

// Cycle de vie SIMPLE — actions serveur dédiées, idempotentes. Le client ne
// modifie jamais un statut arbitraire : il LIT (à l'ouverture) et RÉSOUT.
router.patch('/:submissionId/read', validate(submissionIdSchema), ctrl.patchRead);
router.patch('/:submissionId/resolve', validate(submissionIdSchema), ctrl.patchResolve);
router.patch('/:submissionId/reopen', validate(submissionIdSchema), ctrl.patchReopen);

export default router;
