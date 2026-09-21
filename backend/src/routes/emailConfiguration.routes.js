import { Router } from 'express';
import * as ctrl from '../controllers/emailConfiguration.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

// Configuration e-mail : DEV UNIQUEMENT. Elle pilote l'identité d'envoi de toute
// la plateforme — l'ADMIN n'y a pas accès.
router.use(authenticate, authorize(ROLES.DEV));

/**
 * ── DEUX ROUTES ONT DISPARU EN R10.5 ───────────────────────────────────────
 *
 * PUT /sender écrivait le From de CE projet. POST /test-send envoyait un
 * e-mail en appelant Brevo DIRECTEMENT, avec une clé locale, sans passer par la
 * capacité email.send_template — donc sans passerelle, sans coffre du Panel,
 * sans politique commerciale et sans registre d'opérations.
 *
 * L'expéditeur du parc est unique et détenu par le Panel, et c'est là que le
 * test d'expédition vit désormais : il y emprunte la chaîne réelle de bout en
 * bout, jusqu'au webhook de livraison.
 *
 * Le limiteur d'envoi part avec elles : plus aucune route de ce module ne
 * provoque un effet extérieur.
 */

router.get('/', ctrl.get);

/**
 * Rétablissement du service. Aucun corps : le mode est résolu côté serveur, comme
 * partout ailleurs — un écran affichant TEST ne doit pas pouvoir agir sur PROD.
 */
router.post('/restore', ctrl.restore);

/** Suivi ciblé du dernier test — lecture seule, charge utile minimale. */
router.get('/test-status', ctrl.testStatus);

export default router;
