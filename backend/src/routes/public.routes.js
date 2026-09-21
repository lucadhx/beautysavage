import { Router } from 'express';
import * as publicController from '../controllers/public.controller.js';
import * as contactController from '../controllers/contact.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { submitContactSchema } from '../validators/contact.validator.js';

// Unauthenticated endpoints consumed by the vitrine.
const router = Router();

router.get('/bootstrap', publicController.bootstrap);
router.get('/network-configuration', publicController.networkConfiguration);
/**
 * LE PLAN DU SITE — servi par l'API, pas par un fichier statique.
 *
 * `robots.txt` le désigne par une adresse ABSOLUE. Un plan de site figé dans
 * `vitrine/public/` aurait vieilli au premier chapitre créé depuis le Manager,
 * et personne ne s'en serait aperçu : une erreur de sitemap ne se voit que
 * dans la console du moteur de recherche.
 *
 * Aucun `rateLimit` : c'est une lecture, sans effet de bord et sans envoi.
 */
router.get('/sitemap.xml', publicController.sitemap);
router.get('/chapters/:slug', publicController.getChapterBySlug);

/**
 * LES DOCUMENTS LÉGAUX — lecture publique, réplique locale.
 *
 * `:type` vaut `LEGAL_NOTICE` ou `PRIVACY_POLICY` ; toute autre valeur
 * répond 404 — le contrôleur ferme l'énumération plutôt que de la déduire.
 *
 * Aucun `rateLimit` : c'est une lecture servie depuis Mongo, sans effet de
 * bord et sans coût d'envoi.
 */
router.get('/legal/:type', publicController.getLegalDocumentByType);
// Le CONTENU d'une page éditoriale — le bootstrap n'en porte que l'entrée.
router.get('/pages/:slug', publicController.getPageBySlug);

/**
 * Dépôt d'une demande de contact — la SEULE écriture publique du dépôt.
 *
 * `rateLimit` est le mécanisme du projet (déjà utilisé par `auth` et
 * `email-configuration`) : on le réutilise plutôt que d'en écrire un second.
 * 5 par quart d'heure et par IP — un visiteur légitime en dépose une, deux s'il
 * se ravise ; cinq relèvent déjà du harcèlement de formulaire.
 *
 * ⚠️ LIMITE CONNUE, HÉRITÉE : ce middleware **se désactive hors production**
 * (`config.isTest`, qui vaut `!isProd`). Il ne protège donc rien en
 * développement, et la suite de tests ne peut pas l'exercer. C'est le
 * comportement de TOUTES les routes limitées du dépôt, pas une exception
 * introduite ici. Les règles anti-abus qui doivent être *vérifiables* vivent
 * dans `services/contact/contactAbuse.js` — module pur, actif partout, testé.
 *
 * Le message est NEUTRE : il ne dit ni le quota, ni la fenêtre, ni ce qui a
 * déclenché la limite.
 */
router.post(
  '/contact',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Trop de demandes envoyées. Réessayez dans quelques minutes.' }),
  validate(submitContactSchema),
  contactController.submitContact
);

export default router;
