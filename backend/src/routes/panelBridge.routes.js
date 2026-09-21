// Connexion au Panel (surface d'administration du projet) — Phase 4.
//
// À ne pas confondre avec `projectBridge.routes.js` :
//   · projectBridge = ce que le PANEL appelle sur le projet (auth bridgeToken) ;
//   · panelBridge   = ce que l'OPÉRATEUR du projet pilote depuis son Manager.
//
// DEV uniquement, comme les IntegratedAPI : appairer confie au Panel
// l'identité publique du site et en fait descendre des identifiants d'accès à
// des services tiers.
import { Router } from 'express';
import * as ctrl from '../controllers/panelBridge.controller.js';
import { authenticate, authorize } from '../middlewares/auth.middleware.js';
import { ROLES } from '../utils/constants.js';

const router = Router();

/**
 * L'ENTREPRISE QUI OPÈRE CE PROJET — lisible par TOUTE personne connectée.
 *
 * ══ LE DÉFAUT QUE CETTE ROUTE FERME ═════════════════════════════════════════
 *
 * La page « Aide » du Manager est proposée à tous les rôles, mais sa seule
 * source était `/status`, réservée aux comptes DEV. Un client qui ouvrait
 * « Aide » recevait donc un 403, et l'écran en concluait « Ce projet n'est
 * relié à aucun Panel » — précisément là où il venait chercher le numéro de
 * téléphone de son agence.
 *
 * Cette route ne sert QUE la copie d'entreprise déjà synchronisée : ni URL du
 * Panel, ni identifiant d'appairage, ni inventaire d'API, ni ordonnanceur.
 * Ce sont des coordonnées destinées à être lues — les cacher n'a jamais
 * protégé personne.
 *
 * Elle est déclarée AVANT la garde DEV : l'ordre est ce qui la rend
 * accessible, et le commentaire ci-dessus ce qui l'autorise.
 */
router.get('/company', authenticate, ctrl.company);

router.use(authenticate, authorize(ROLES.DEV));

router.get('/status', ctrl.status);
router.post('/pair', ctrl.pair);
router.post('/unpair', ctrl.unpair);
router.post('/sync-now', ctrl.syncNow);

export default router;
