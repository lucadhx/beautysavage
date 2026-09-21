import { Router } from 'express';
import * as accountController from '../controllers/account.controller.js';
import * as externalPrincipalController from '../controllers/externalPrincipal.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { accountCreateSchema, accountUpdateSchema, idParam } from '../validators/common.validator.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

router.use(authenticate, authorize(ROLES.DEV)); // DEV only

router.get('/', accountController.list);

/**
 * LES ACCÈS L.Y SOLUTION (L12.B-UI) — montée AVANT `/:id`.
 *
 * Sans cet ordre, `external` serait lu comme un identifiant de compte et
 * partirait chercher un `User` qui n'existe pas. Même règle que partout : les
 * routes littérales passent avant les paramétrées.
 *
 * En LECTURE SEULE, et il n'y aura jamais d'écriture ici : ce projet n'est pas
 * propriétaire de ces identités. Créer, renommer ou supprimer l'une d'elles
 * depuis un projet n'aurait aucun effet au Panel — cela produirait seulement
 * une divergence silencieuse entre ce qu'un écran montre et ce qui fait
 * autorité.
 */
router.get('/external', externalPrincipalController.listExternalPrincipals);
/**
 * LA LISTE FUSIONNÉE — la même que celle servie au Panel par le pont.
 * Montée AVANT `/:id`, comme toutes les routes littérales.
 */
router.get('/all', accountController.listAll);
router.post('/', validate(accountCreateSchema), accountController.create);
router.put('/:id', validate(accountUpdateSchema), accountController.update);
router.delete('/:id', validate(idParam), accountController.remove);

export default router;
