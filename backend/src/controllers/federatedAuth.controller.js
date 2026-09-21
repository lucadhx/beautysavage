// LA CONNEXION L.Y SOLUTION — surface HTTP (L12.B).
//
// ── DEUX ROUTES PUBLIQUES, ET RIEN D'AUTRE ──────────────────────────────────
//
//   POST /api/auth/federated/panel/start     ouvre un parcours (émet un state)
//   POST /api/auth/federated/panel/callback  le referme (assertion + state)
//
// Publiques par nécessité : personne n'est encore authentifié quand elles sont
// appelées. C'est l'assertion signée du Panel qui fait autorité, pas une
// session préalable.
//
// ── CE QUE LE CALLBACK N'ACCEPTE PAS ────────────────────────────────────────
//
// Ni `panelUserId`, ni `role`, ni `projectId`, ni `tokenVersion`, ni `email`.
// Tout cela vit dans l'assertion, signée. Les accepter en parallèle donnerait
// deux sources pour la même information — et un jour quelqu'un lirait la
// mauvaise.
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  completeFederatedLogin,
  startFederatedLogin,
} from '../services/federation/federatedAuth.service.js';
import {
  panelUrlForFederation,
  projectIdForFederation,
} from '../services/panelBridge/capabilityClient.js';

/**
 * `GET /api/auth/federated/panel` — la fédération est-elle disponible ici ?
 *
 * L'écran de connexion l'appelle pour savoir s'il doit AFFICHER le bloc
 * « Accès L.Y Solution ». Montrer un bouton qui échouera à coup sûr, sur un
 * projet non appairé, est pire que de ne rien montrer.
 *
 * Ne révèle rien : l'adresse du Panel est déjà affichée dans l'écran « Aide ».
 */
export const describeFederation = asyncHandler(async (_req, res) => {
  const panelUrl = panelUrlForFederation();
  const projectId = projectIdForFederation();

  /**
   * `available` EST UNE PRÉCONDITION LOCALE, PAS UN PING.
   *
   * On répond « la fédération est-elle possible depuis ici ? » — appairage
   * présent, adresse du Panel connue, identité de projet connue. On n'appelle
   * PAS le Panel : l'écran de connexion s'affiche à chaque visite, et le faire
   * dépendre d'un aller-retour réseau rendrait le login local tributaire de la
   * disponibilité du Panel. C'est exactement ce que ce lot interdit.
   *
   * Un Panel momentanément injoignable laisse donc le bouton visible, et
   * l'échec survient au clic — avec un message clair. C'est le bon arbitrage :
   * masquer le bouton ferait croire à un DEV que son accès a été retiré.
   */
  return ok(res, {
    available: Boolean(panelUrl && projectId),
    provider: 'LY_SOLUTION_PANEL',
    label: 'L.Y Solution',
  });
});

/** `POST /api/auth/federated/panel/start` */
export const startFederated = asyncHandler(async (req, res) => {
  const result = await startFederatedLogin({
    redirectPath: req.body?.redirectPath ?? '/',
    /**
     * L'ADRESSE DE RETOUR — PROPOSÉE par l'écran, VALIDÉE par le Panel.
     *
     * Le Manager sait où il vit ; le serveur du projet, derrière un reverse
     * proxy, ne le sait pas toujours. On accepte donc sa proposition, mais
     * elle ne fait autorité nulle part : le Panel la confrontera aux origines
     * qu'il connaît pour ce projet et refusera tout le reste.
     */
    returnUrl: req.body?.returnUrl ?? null,
  });
  return ok(res, result);
});

/** Les champs qu'un callback ne peut PAS prétendre porter. */
const FORBIDDEN_CALLBACK_FIELDS = Object.freeze([
  'panelUserId', 'role', 'projectId', 'tokenVersion', 'email', 'principalType',
]);

/** `POST /api/auth/federated/panel/callback` */
export const completeFederated = asyncHandler(async (req, res) => {
  const intrus = FORBIDDEN_CALLBACK_FIELDS
    .filter((champ) => Object.prototype.hasOwnProperty.call(req.body ?? {}, champ));
  if (intrus.length) {
    throw ApiError.badRequest(
      'L’identité vient de l’assertion signée, jamais du corps de la requête.',
      { code: 'FEDERATED_IDENTITY_IN_BODY', fields: intrus },
    );
  }

  const result = await completeFederatedLogin({
    assertion: req.body?.assertion,
    state: req.body?.state,
  });
  return ok(res, result);
});

export default { completeFederated, describeFederation, startFederated };
