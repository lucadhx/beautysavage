import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import * as federatedAuthController from '../controllers/federatedAuth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { authenticate, requireLocalPrincipal } from '../middlewares/auth.middleware.js';
import { rateLimit } from '../middlewares/rateLimit.js';
import { authRateLimit } from '../middlewares/authRateLimit.js';
import {
  loginSchema,
  devLoginSchema,
  changePasswordSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  activateAccountSchema,
  resendActivationSchema,
} from '../validators/auth.validator.js';

const router = Router();

/**
 * ── ANTI-FORÇAGE : DEUX SEAUX, DURABLES, ET ACTIFS EN TEST ────────────────
 *
 * L'ancien limiteur était en mémoire, par IP seule, et — surtout — DÉSACTIVÉ
 * dès que `config.isTest` était vrai. Or `isTest` vaut `!isProd` : sur
 * l'environnement TEST DÉPLOYÉ, la protection n'existait que dans le code.
 *
 * Le nouveau compte EN BASE, par IP ET par identité, et il vaut dans tous les
 * mondes. Les suites de tests, elles, tournent sur une base éphémère : leurs
 * seaux naissent et meurent avec elles, sans que personne ait à les désarmer.
 */
const authLimiter = authRateLimit({ scope: 'project-login' });

/**
 * ══ UNE IDENTITÉ NE SE MET PAS EN CACHE ═════════════════════════════════════
 *
 * Express pose un `ETag` sur toute réponse JSON. `/auth/me` était donc
 * revalidé par le navigateur et rendait des `304 Not Modified` — visibles dans
 * les journaux d'exploitation.
 *
 * Le serveur authentifie AVANT de répondre, donc un 304 ne peut pas rendre
 * l'identité de quelqu'un d'autre : le corps est recalculé pour le porteur du
 * jeton, et l'empreinte ne coïncide que si c'est le même. Ce n'est donc pas une
 * faille — mais une réponse d'identité n'a aucune raison de séjourner dans le
 * cache disque d'un navigateur, ni d'y survivre à une déconnexion.
 *
 * `no-store` est la doctrine déjà appliquée aux sondes de disponibilité. On
 * l'étend à l'authentification, où elle vaut au moins autant.
 */
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.post('/login', authLimiter, validate(loginSchema), authController.login);
// Mot de passe oublié — PUBLIC, réponse toujours générique (pas d'énumération),
// limité plus sévèrement que la connexion.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Trop de demandes. Réessayez dans quelques minutes.',
});
router.post('/forgot-password', resetLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', resetLimiter, validate(resetPasswordSchema), authController.resetPassword);
/**
 * ACTIVATION DU PREMIER ACCÈS (LOT 2C) — publiques, limitées comme les resets.
 *
 * ── POURQUOI LA MÊME LIMITE QUE LA RÉINITIALISATION, ET NON CELLE DU LOGIN ──
 *
 * Ces routes déclenchent un ENVOI D'E-MAIL vers une adresse fournie par
 * l'appelant. Le risque n'est donc pas seulement d'ouvrir une session : c'est
 * d'inonder une boîte tierce et de consommer le quota d'envoi de la
 * plateforme. Le service ajoute par-dessus un délai d'attente par compte —
 * la limite d'IP seule ne protégerait pas la boîte visée.
 */
router.get('/activation', resetLimiter, authController.describeActivation);
router.post('/activate-account', resetLimiter, validate(activateAccountSchema), authController.activateAccount);
router.post('/activation/resend', resetLimiter, validate(resendActivationSchema), authController.resendActivation);
// Connexion rapide (TEST uniquement) — la garde se fait côté service via config.isTest.
router.get('/test-accounts', authController.testAccounts);
router.post('/dev-login', authLimiter, validate(devLoginSchema), authController.devLogin);
/**
 * CONNEXION L.Y SOLUTION (L12.B) — publique, et séparée du login local.
 *
 * ── POURQUOI UNE SURFACE À PART, ET NON UN CHAMP DE PLUS SUR `/login` ──────
 *
 * Les deux populations n'ont rien en commun. Un compte local prouve son
 * identité par un mot de passe que ce projet détient ; une identité L.Y
 * Solution la prouve par une assertion signée que ce projet ne peut pas
 * fabriquer. Les faire entrer par la même porte obligerait cette porte à
 * savoir laquelle des deux elle regarde — et c'est exactement le genre de
 * branchement qui finit par accepter la mauvaise preuve.
 *
 * Limitées comme le login : ces routes ouvrent une session, donc elles
 * intéressent quiconque essaie d'en ouvrir une qui ne lui appartient pas.
 */
router.get('/federated/panel', federatedAuthController.describeFederation);
/**
 * ── LE PARCOURS FÉDÉRÉ — LIMITÉ PAR IP, ET DANS SA PROPRE PORTÉE ────────
 *
 * Aucune identité n'est soumise ici : les identifiants sont vérifiés PAR LE
 * PANEL, qui porte son propre seau d’identité. Ces deux routes protègent
 * donc contre l'ABUS du canal — rejeu, martèlement — pas contre la devinette
 * d’un mot de passe.
 *
 * Portée SÉPARÉE de la connexion native, et c’est délibéré : un seul login
 * fédéré légitime traverse les DEUX routes. Les compter dans le même seau
 * que la connexion locale ferait consommer deux tentatives pour un geste.
 */
const federeLimiter = authRateLimit({ scope: 'project-federated', identityFrom: () => null });

router.post('/federated/panel/start', federeLimiter, federatedAuthController.startFederated);
router.post('/federated/panel/callback', federeLimiter, federatedAuthController.completeFederated);

router.get('/me', authenticate, authController.me);
/**
 * PROFIL ET MOT DE PASSE — COMPTES LOCAUX UNIQUEMENT (L12.B).
 *
 * Une identité L.Y Solution n'a pas de mot de passe ici, et son nom appartient
 * au Panel. Sans cette garde, un développeur fédéré cliquant « changer mon mot
 * de passe » déclencherait une erreur incompréhensible — ou pire, créerait un
 * mot de passe local pour une identité que ce projet ne possède pas.
 */
router.patch(
  '/profile',
  authenticate,
  requireLocalPrincipal,
  validate(updateProfileSchema),
  authController.updateProfile
);
router.patch(
  '/password',
  authenticate,
  requireLocalPrincipal,
  validate(changePasswordSchema),
  authController.changePassword
);

export default router;
