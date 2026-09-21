import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.model.js';
import { ROLES } from '../utils/constants.js';
import {
  revalidateFederatedSession,
  serializePrincipal,
} from '../services/federation/federatedAuth.service.js';
import { ExternalPrincipal, EXTERNAL_PROVIDERS } from '../models/ExternalPrincipal.model.js';

/**
 * DEUX POPULATIONS, UN SEUL POINT D'ENTRÉE (L12.B).
 *
 * ── POURQUOI LES DEUX MÉCANISMES NE SONT PAS FUSIONNÉS ─────────────────────
 *
 * Un compte LOCAL appartient à ce projet : son mot de passe est ici, le couper
 * est un geste local. Une identité PANEL ne nous appartient pas : nous n'avons
 * ni son mot de passe, ni le droit de le changer, et notre seul moyen
 * d'apprendre qu'elle est révoquée est de REDEMANDER au Panel.
 *
 * Les fondre en un seul modèle obligerait à inventer un mot de passe pour la
 * seconde, ou à faire semblant que la première peut être révoquée à distance.
 * On les distingue donc par le CONTENU du jeton — `principalType: 'PANEL'` —
 * et non par une devinette.
 *
 * ── CE QUI NE CHANGE PAS POUR LE CODE EXISTANT ─────────────────────────────
 *
 * `req.user` reste renseigné dans les deux cas, avec la même forme : `_id`,
 * `email`, `name`, `role`. Les trente contrôleurs qui le lisent continuent de
 * fonctionner sans être touchés. `_id` vaut `null` pour une identité fédérée —
 * elle n'a pas de document local, et les champs `updatedBy` qui la reçoivent
 * sont tous `default: null`.
 *
 * `req.principal` porte, lui, la vérité typée : c'est ce que le nouveau code
 * doit lire.
 */
export const PRINCIPAL_TYPES = Object.freeze({
  LOCAL_USER: 'LOCAL_USER',
  PANEL_USER: 'PANEL_USER',
});

export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) throw ApiError.unauthorized('Token manquant');

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    throw ApiError.unauthorized('Token invalide ou expiré');
  }

  /**
   * LE JETON DIT LUI-MÊME CE QU'IL EST.
   *
   * Un jeton fédéré porte `principalType: 'PANEL'` et aucun `sub` exploitable
   * localement ; un jeton local porte `sub` et aucun `principalType`. Ils ne
   * peuvent donc pas être confondus, dans aucun sens.
   */
  if (payload?.principalType === 'PANEL') {
    return authenticateFederated(req, payload, next);
  }

  const user = await User.findById(payload.sub).select('-password');
  if (!user) throw ApiError.unauthorized('Compte introuvable');

  req.user = user;
  req.principal = {
    type: PRINCIPAL_TYPES.LOCAL_USER,
    id: String(user._id),
    role: user.role,
    source: 'LOCAL',
    email: user.email,
    displayName: user.name || user.email,
  };
  return next();
});

/**
 * UNE SESSION FÉDÉRÉE — revalidée auprès du Panel, pas seulement décodée.
 *
 * ── LE POINT QUI FAIT TOUT LE LOT ──────────────────────────────────────────
 *
 * Un jeton signé et non expiré ne suffit PAS. Entre son émission et
 * maintenant, le compte a pu être désactivé, son accès retiré, l'appairage
 * révoqué. On redemande donc au Panel — au plus toutes les cinq minutes, pour
 * ne pas faire dépendre chaque clic d'un aller-retour réseau.
 *
 * Conséquence assumée et bornée : un accès retiré peut survivre jusqu'à cinq
 * minutes, et la session entière expire de toute façon en trente.
 */
async function authenticateFederated(req, payload, next) {
  const verdict = await revalidateFederatedSession(payload);
  if (!verdict.active) {
    throw ApiError.unauthorized('Votre accès L.Y Solution n’est plus valide.');
  }

  const projection = await ExternalPrincipal.findOne({
    provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
    externalUserId: payload.panelUserId,
  }).lean();

  const vue = serializePrincipal(projection ?? {
    externalUserId: payload.panelUserId,
    role: payload.role,
  });

  /**
   * `req.user` DUCK-TYPÉ — pour que les contrôleurs existants ne changent pas.
   *
   * `_id: null` est délibéré : cette identité n'a AUCUN document local, et
   * inventer un identifiant ferait écrire dans des champs `ref: 'User'` une
   * valeur qui ne désigne rien. Tous ces champs sont `default: null`.
   */
  req.user = vue;
  req.principal = {
    type: PRINCIPAL_TYPES.PANEL_USER,
    id: payload.panelUserId,
    role: payload.role,
    source: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
    email: vue.email,
    displayName: vue.name,
    panelTokenVersion: payload.panelTokenVersion ?? null,
  };
  return next();
}

/**
 * Restrict a route to specific roles. DEV has access to everything anyway.
 * Usage: authorize(ROLES.DEV) or authorize(ROLES.ADMIN, ROLES.DEV)
 */
export const authorize =
  (...allowed) =>
  (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    // DEV is a superset: always allowed.
    if (req.user.role === ROLES.DEV) return next();
    if (!allowed.includes(req.user.role)) {
      return next(ApiError.forbidden("Vous n'avez pas accès à cette ressource"));
    }
    next();
  };

/** Shortcut: DEV-only routes. */
export const devOnly = [authorize(ROLES.DEV)];

/**
 * DEV, QUELLE QUE SOIT LA PROVENANCE (L12.B).
 *
 * ── POURQUOI UNE PRIMITIVE, ET PAS DEUX SYSTÈMES ───────────────────────────
 *
 * Pendant la transition, deux populations peuvent être DEV : le compte local
 * historique, et une identité fédérée du Panel. Écrire le test aux quarante
 * endroits qui protègent une route DEV produirait quarante occasions de se
 * tromper — et le jour où le local disparaîtra (LOT 2C), quarante retouches.
 *
 * `authorize(ROLES.DEV)` continue de fonctionner pour les deux, puisque les
 * deux principals portent `role`. Cette primitive-ci existe pour le code qui
 * doit savoir explicitement qu'il accepte les deux sources.
 */
export const requireDevPrincipal = (req, _res, next) => {
  if (!req.principal) return next(ApiError.unauthorized());
  if (req.principal.role !== ROLES.DEV) {
    return next(ApiError.forbidden("Vous n'avez pas accès à cette ressource"));
  }
  return next();
};

/**
 * RÉSERVÉ AUX COMPTES LOCAUX.
 *
 * Pour les gestes qui n'ont aucun sens sur une identité fédérée : changer son
 * mot de passe local, modifier son profil local. Une identité du Panel n'en a
 * pas — les lui offrir créerait un compte local fantôme, ou une erreur
 * incompréhensible au clic.
 */
export const requireLocalPrincipal = (req, _res, next) => {
  if (req.principal?.type !== PRINCIPAL_TYPES.LOCAL_USER) {
    return next(ApiError.forbidden(
      'Cette action concerne les comptes de ce projet. Votre identité est administrée depuis le Panel L.Y Solution.',
    ));
  }
  return next();
};
