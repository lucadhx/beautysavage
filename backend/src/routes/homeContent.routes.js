import { Router } from 'express';
import { homeContentController } from '../controllers/singleton.controllers.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { homeContentUpdateSchema } from '../validators/homeContent.validator.js';
import { ROLES } from '../utils/constants.js';

/**
 * LE CONTENU DE LA PAGE D'ACCUEIL — lecture authentifiée, écriture ADMIN.
 *
 * Même découpage que le thème du site, et pour la même raison : c'est du
 * CONTENU du client. Le réserver au DEV obligerait le propriétaire à demander
 * une intervention pour changer un appel à l'action — soit précisément ce que
 * ce site reproche aux agences.
 *
 * La vitrine, elle, ne passe jamais par ici : elle reçoit ce contenu dans le
 * bootstrap public, déjà projeté. Une route publique de plus serait un
 * aller-retour de plus au premier rendu, pour une donnée que la page d'accueil
 * a de toute façon besoin d'avoir avant de peindre quoi que ce soit.
 */
const router = Router();

router.use(authenticate);
router.get('/', homeContentController.get);
/**
 * L'ÉCRITURE EST VALIDÉE — elle ne l'était pas.
 *
 * Les cardinalités de cet écran (quatre rassurances, quatre entrées de menu,
 * trois tuiles, trois résultats, quatre engagements) n'existaient QUE dans les
 * props d'un composant React. Une requête ne passant pas par l'écran posait ce
 * qu'elle voulait, et la vitrine coupait le surplus en silence. Voir
 * `validators/homeContent.validator.js`.
 */
router.put('/', authorize(ROLES.ADMIN), validate(homeContentUpdateSchema), homeContentController.update);

export default router;
