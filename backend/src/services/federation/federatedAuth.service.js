// LA CONNEXION FÉDÉRÉE — du départ vers le Panel à la session projet (L12.B).
//
// docs/auth/PANEL_FEDERATED_DEV_IDENTITY_IMPLEMENTATION.md §« LOT 2B ».
//
// ── LE PARCOURS, ET CE QUE CHAQUE ÉTAPE PROUVE ──────────────────────────────
//
//   startFederatedLogin()   nous créons un `state` — il prouvera que le retour
//                           répond à un départ que NOUS avons initié.
//   (le navigateur va au Panel, s'y authentifie, en revient avec une assertion)
//   completeFederatedLogin()
//     1. `state`            le voyage est le nôtre        anti-CSRF
//     2. l'assertion        signée par le Panel, pour NOUS  anti-forge
//     3. le `jti`           jamais consommé                anti-rejeu
//     4. l'introspection    le compte vaut ENCORE           anti-péremption
//     5. la projection      l'identité devient visible ici
//     6. la session         courte, marquée PANEL
//
// Les quatre premières sont des refus possibles. Aucune n'est redondante :
// elles ferment quatre attaques différentes, et retirer l'une n'est jamais
// compensé par les autres.
//
// ── CE QUI N'ARRIVE JAMAIS ICI ──────────────────────────────────────────────
//
// Aucun mot de passe du Panel n'entre dans ce fichier, ni dans cette base.
// Aucun `User` local n'est créé, modifié, ni rapproché par adresse e-mail.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { ExternalPrincipal, EXTERNAL_PROVIDERS } from '../../models/ExternalPrincipal.model.js';
import { FederatedAssertionConsumption } from '../../models/FederatedAssertionConsumption.model.js';
import { FederatedLoginState } from '../../models/FederatedLoginState.model.js';
import {
  introspectFederatedPrincipal,
  panelFrontendUrlForFederation,
  panelUrlForFederation,
  projectIdForFederation,
} from '../panelBridge/capabilityClient.js';
import { PANEL_FRONTEND_SOURCE, resolvePanelFrontendUrl } from './panelFrontendUrl.js';
import { hashJti, verifyPanelAssertion } from './assertionVerifier.js';

/**
 * DURÉE DE LA SESSION FÉDÉRÉE — 30 minutes, contre 7 jours en local.
 *
 * ── POURQUOI BIEN PLUS COURTE QUE LA SESSION LOCALE ────────────────────────
 *
 * Une session locale repose sur un compte de CETTE base : le couper, c'est un
 * geste local, immédiat. Une session fédérée repose sur un compte que nous ne
 * possédons pas — et notre seul moyen d'apprendre qu'il a été fermé est de
 * REDEMANDER au Panel.
 *
 * La durée de session est donc la borne haute du délai de révocation dans le
 * pire cas : Panel injoignable, aucune revalidation possible. Trente minutes
 * est un compromis assumé — assez long pour ne pas interrompre un travail,
 * assez court pour qu'un accès retiré ne survive pas à une pause déjeuner.
 */
export const FEDERATED_SESSION_TTL_SECONDS = 30 * 60;

/**
 * INTERVALLE DE REVALIDATION — 5 minutes.
 *
 * Le cas nominal, quand le Panel répond. Interroger à CHAQUE requête coûterait
 * un aller-retour par clic et ferait dépendre chaque page de la disponibilité
 * du Panel ; ne jamais interroger rendrait la session aveugle pendant trente
 * minutes. Cinq minutes borne la fenêtre réelle de révocation.
 */
export const REVALIDATION_INTERVAL_SECONDS = 5 * 60;

/** Validité du `state`. Le temps de saisir un mot de passe, pas la journée. */
const STATE_TTL_SECONDS = 10 * 60;

export const FEDERATION_ERRORS = Object.freeze({
  NOT_PAIRED: 'FEDERATION_PANEL_NOT_PAIRED',
  STATE_INVALID: 'FEDERATED_STATE_INVALID',
  REPLAY: 'FEDERATED_ASSERTION_REPLAY',
  PRINCIPAL_INACTIVE: 'FEDERATED_PRINCIPAL_INACTIVE',
  PANEL_UNREACHABLE: 'FEDERATED_PANEL_UNREACHABLE',
});

/* -------------------------------------------------------------------------- */
/*  1. DÉPART                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * OUVRE un parcours de connexion fédérée.
 *
 * Rend l'URL du Panel à visiter et le `state` qui devra revenir. Aucune
 * décision d'identité n'est prise ici : à ce stade, on ne sait pas encore qui
 * demande, et c'est normal — c'est le Panel qui le déterminera.
 */
export async function startFederatedLogin({ redirectPath = '/', returnUrl = null } = {}) {
  const panelUrl = panelUrlForFederation();
  const projectId = projectIdForFederation();
  if (!panelUrl || !projectId) {
    throw ApiError.conflict(
      'Ce projet n’est relié à aucun Panel : la connexion L.Y Solution est indisponible.',
      { code: FEDERATION_ERRORS.NOT_PAIRED },
    );
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1000);

  await FederatedLoginState.create({
    state,
    /**
     * LA DESTINATION EST VALIDÉE À L'ÉMISSION, PAS AU RETOUR.
     *
     * Un chemin relatif, jamais une URL : accepter `https://…` ferait de ce
     * champ une redirection ouverte, et le parcours de connexion deviendrait
     * un tremplin vers n'importe quel site.
     */
    redirectPath: sanitizeRedirect(redirectPath),
    expiresAt,
  });

  logger.info('[federation] parcours de connexion fédérée ouvert.');

  /**
   * L'ADRESSE COMPLÈTE, COMPOSÉE PAR LE SERVEUR.
   *
   * ── POURQUOI PAS PAR LE NAVIGATEUR ────────────────────────────────────────
   *
   * Le Manager pourrait assembler `panelUrl + /federation/authorize + params`.
   * Il ne doit pas : `projectId` deviendrait alors une valeur que la page
   * connaît et pourrait modifier, et le `state` un paramètre qu'elle recopie.
   * Composer ici garde l'adresse ENTIÈRE du côté qui fait autorité, et laisse
   * au navigateur un seul geste : y aller.
   *
   * `returnUrl` sera de toute façon revalidé par le PANEL contre les origines
   * qu'il connaît pour ce projet. C'est une double garde volontaire : nous
   * proposons, le Panel dispose — et lui seul sait quelles origines sont
   * légitimes.
   *
   * ══ ET ELLE EST COMPOSÉE CONTRE L'ORIGINE *HUMAINE* DU PANEL ══════════════
   *
   * Elle l'était contre `panelUrl` — l'adresse que le PONT appelle. Les deux
   * coïncidaient sur le projet historique, et divergeaient sur le premier
   * projet dupliqué : `/federation/authorize` est un écran du frontal du
   * Panel, absent de son hôte d'API, qui répondait donc « Route inconnue ».
   *
   * La règle et son ordre d'autorité vivent dans `panelFrontendUrl.js` ; ici,
   * on se contente de l'appliquer — et de dire d'où vient l'adresse retenue,
   * parce qu'une déduction doit se lire dans un journal.
   */
  const frontal = resolvePanelFrontendUrl({
    declared: panelFrontendUrlForFederation(),
    panelUrl,
  });
  if (frontal.source !== PANEL_FRONTEND_SOURCE.DECLARED) {
    logger.info(
      `[federation] adresse publique du Panel DÉDUITE (${frontal.url}) : ce Panel ne la déclare pas encore à l’appairage.`,
    );
  }
  const authorizeUrl = new URL('/federation/authorize', frontal.url);
  authorizeUrl.searchParams.set('projectId', projectId);
  authorizeUrl.searchParams.set('state', state);
  if (returnUrl) authorizeUrl.searchParams.set('returnUrl', String(returnUrl));

  return {
    state,
    panelUrl,
    projectId,
    /** Ce que le navigateur doit ouvrir. Rien à recomposer côté écran. */
    authorizeUrl: authorizeUrl.toString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/** Un chemin RELATIF, borné. Jamais une URL absolue, jamais un `//host`. */
function sanitizeRedirect(candidate) {
  const value = String(candidate ?? '/').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value.slice(0, 512);
}

/* -------------------------------------------------------------------------- */
/*  2. RETOUR                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * CONSOMME un retour de parcours et ouvre la session.
 *
 * @param {object} input
 * @param {string} input.assertion  le jeton signé par le Panel
 * @param {string} input.state      le `state` que nous avions émis
 */
export async function completeFederatedLogin({ assertion, state }) {
  // ── 1. LE VOYAGE EST-IL LE NÔTRE ? ────────────────────────────────────────
  /**
   * Consommation ATOMIQUE : la condition `consumedAt: null` est dans la
   * requête, pas dans une lecture préalable. Deux retours simultanés portant
   * le même `state` ne peuvent pas passer tous les deux — le second ne trouve
   * rien à mettre à jour.
   */
  const now = new Date();
  const consumedState = await FederatedLoginState.findOneAndUpdate(
    { state: String(state ?? ''), consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { new: true },
  ).lean();

  if (!consumedState) {
    throw new ApiError(401, 'Parcours de connexion invalide ou expiré.', {
      code: FEDERATION_ERRORS.STATE_INVALID,
    });
  }

  // ── 2. L'ASSERTION EST-ELLE AUTHENTIQUE, ET POUR NOUS ? ───────────────────
  const projectId = currentProjectId();
  const verdict = await verifyPanelAssertion(assertion, {
    audience: projectId,
    environment: config.isTest ? 'TEST' : 'PROD',
  });
  if (!verdict.valid) {
    logger.warn(`[federation] assertion refusée — ${verdict.reasonCode}.`);
    /**
     * LE MOTIF EXACT NE DESCEND PAS AU NAVIGATEUR.
     *
     * « mauvaise audience » apprendrait au porteur pour quel projet son jeton
     * est valable. Le journal du serveur, lui, le nomme.
     */
    throw new ApiError(401, 'Accès L.Y Solution refusé.', { code: verdict.reasonCode });
  }

  const claims = verdict.claims;

  // ── 3. CETTE ASSERTION A-T-ELLE DÉJÀ SERVI ? ─────────────────────────────
  /**
   * L'index unique arbitre. Deux callbacks simultanés portant la même
   * assertion passeraient tous deux une lecture préalable ; seule l'insertion
   * en refuse un — et c'est CE refus qui prouve qu'une seule session s'ouvre.
   */
  try {
    await FederatedAssertionConsumption.create({
      jtiHash: hashJti(claims.jti),
      panelUserId: claims.panelUserId,
      issuedAt: claims.iat ? new Date(claims.iat * 1000) : null,
      expiresAt: new Date(claims.exp * 1000),
      consumedAt: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) {
      logger.warn('[federation] REJEU d’assertion refusé.');
      throw new ApiError(401, 'Cette autorisation a déjà été utilisée.', {
        code: FEDERATION_ERRORS.REPLAY,
      });
    }
    throw error;
  }

  // ── 4. LE COMPTE VAUT-IL ENCORE, À CET INSTANT ? ─────────────────────────
  /**
   * L'assertion a trois minutes ; elle peut avoir été émise avant une
   * désactivation. On redemande donc au Panel AVANT d'ouvrir la session — le
   * seul moment où l'on est certain de ne pas travailler sur une photo.
   */
  const introspection = await introspectOrThrow({
    panelUserId: claims.panelUserId,
    tokenVersion: claims.tokenVersion,
  });

  // ── 5. LA PROJECTION — l'identité devient visible dans ce projet ─────────
  const principal = await upsertExternalPrincipal({
    externalUserId: claims.panelUserId,
    role: claims.role,
    displayName: introspection.principal?.displayName ?? '',
    email: introspection.principal?.email ?? '',
  });

  // ── 6. LA SESSION ────────────────────────────────────────────────────────
  const token = issueFederatedSession({
    panelUserId: claims.panelUserId,
    role: claims.role,
    projectId,
    panelTokenVersion: claims.tokenVersion,
  });

  logger.info(`[federation] session développeur ouverte pour ${claims.panelUserId}.`);

  return {
    token,
    redirectPath: consumedState.redirectPath ?? '/',
    user: serializePrincipal(principal),
  };
}

/* -------------------------------------------------------------------------- */
/*  SESSION                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * LE JETON DE SESSION FÉDÉRÉE.
 *
 * ── POURQUOI IL NE RESSEMBLE PAS À UN JETON LOCAL ──────────────────────────
 *
 * Un jeton local porte `sub` = identifiant Mongo d'un `User`. Celui-ci porte
 * `principalType: 'PANEL'` et un `panelUserId` — et surtout PAS de `sub`
 * exploitable comme identifiant local. Le middleware distingue donc les deux
 * par leur CONTENU, sans avoir à deviner : un jeton fédéré ne peut pas être
 * confondu avec un jeton local, ni l'inverse.
 *
 * Il est signé avec le secret DU PROJET : c'est notre session, pas celle du
 * Panel. Le Panel a affirmé une identité ; ce qu'on en fait nous appartient.
 */
function issueFederatedSession({ panelUserId, role, projectId, panelTokenVersion }) {
  return jwt.sign(
    {
      principalType: 'PANEL',
      panelUserId,
      role,
      projectId,
      source: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
      panelTokenVersion,
      /** Dernière revalidation réussie — en secondes epoch. */
      revalidatedAt: Math.floor(Date.now() / 1000),
    },
    config.jwt.secret,
    { expiresIn: FEDERATED_SESSION_TTL_SECONDS, algorithm: 'HS256' },
  );
}

/**
 * REVALIDE une session fédérée si l'intervalle est écoulé.
 *
 * ── LE COMPROMIS, ÉCRIT NOIR SUR BLANC ─────────────────────────────────────
 *
 * On n'interroge pas le Panel à chaque requête : ce serait un aller-retour par
 * clic, et chaque page du Manager dépendrait de la disponibilité du Panel.
 * On l'interroge au plus toutes les cinq minutes.
 *
 * Conséquence assumée : un accès retiré peut survivre jusqu'à cinq minutes.
 * C'est la fenêtre, elle est bornée, et elle est documentée. En regard, la
 * session entière expire en trente minutes même si le Panel reste muet.
 *
 * ── PANEL INJOIGNABLE : ON NE FERME PAS, MAIS ON N'ÉTEND PAS ───────────────
 *
 * Refuser sur une panne réseau ferait d'une coupure Panel une coupure de tout
 * le parc. On laisse donc vivre la session en cours — bornée par son
 * expiration — sans repousser sa date de revalidation : dès que le Panel
 * répond, la question est reposée.
 */
export async function revalidateFederatedSession(payload) {
  const age = Math.floor(Date.now() / 1000) - (payload.revalidatedAt ?? 0);
  if (age < REVALIDATION_INTERVAL_SECONDS) {
    return { active: true, refreshed: false };
  }

  let verdict;
  try {
    verdict = await introspectFederatedPrincipal({
      panelUserId: payload.panelUserId,
      tokenVersion: payload.panelTokenVersion ?? null,
    });
  } catch (error) {
    logger.warn(`[federation] revalidation impossible (${error?.code ?? error?.message}) — session conservée jusqu’à son expiration.`);
    return { active: true, refreshed: false, degraded: true };
  }

  if (!verdict?.active) {
    logger.info(`[federation] accès révoqué pour ${payload.panelUserId} — session fermée.`);
    await ExternalPrincipal.updateOne(
      { provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL, externalUserId: payload.panelUserId },
      { $set: { enabled: false, lastSyncedAt: new Date() } },
    ).catch(() => {});
    return { active: false };
  }

  await ExternalPrincipal.updateOne(
    { provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL, externalUserId: payload.panelUserId },
    {
      $set: {
        enabled: true,
        lastSyncedAt: new Date(),
        ...(verdict.principal?.displayName ? { displayName: verdict.principal.displayName } : {}),
        ...(verdict.principal?.email ? { email: verdict.principal.email } : {}),
      },
    },
  ).catch(() => {});

  return { active: true, refreshed: true, principal: verdict.principal ?? null };
}

/* -------------------------------------------------------------------------- */
/*  PROJECTION                                                                */
/* -------------------------------------------------------------------------- */

/**
 * POSE ou RAFRAÎCHIT la projection.
 *
 * ── CE QU'ELLE NE FAIT SURTOUT PAS ─────────────────────────────────────────
 *
 * Elle ne cherche AUCUN `User` local portant la même adresse, et n'en modifie
 * aucun. Deux identités qui partagent une adresse e-mail restent deux
 * identités : rapprocher sur l'adresse ferait qu'un compte local homonyme
 * hériterait silencieusement des droits d'un développeur du Panel — ou
 * l'inverse. La clé est `externalUserId`, et elle seule.
 */
async function upsertExternalPrincipal({ externalUserId, role, displayName, email }) {
  const now = new Date();
  return ExternalPrincipal.findOneAndUpdate(
    { provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL, externalUserId },
    {
      $set: {
        role,
        enabled: true,
        lastSyncedAt: now,
        lastSeenAt: now,
        ...(displayName ? { displayName } : {}),
        ...(email ? { email } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
}

/** La vue rendue au Manager. Duck-typée avec un `User` pour l'écran existant. */
export function serializePrincipal(principal) {
  return {
    _id: null,
    principalType: 'PANEL',
    panelUserId: principal?.externalUserId ?? null,
    name: principal?.displayName || principal?.email || 'Développeur L.Y Solution',
    email: principal?.email ?? '',
    role: principal?.role ?? 'DEV',
    source: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
  };
}

/* -------------------------------------------------------------------------- */
/*  OUTILS                                                                    */
/* -------------------------------------------------------------------------- */

async function introspectOrThrow({ panelUserId, tokenVersion }) {
  let verdict;
  try {
    verdict = await introspectFederatedPrincipal({ panelUserId, tokenVersion });
  } catch (error) {
    /**
     * À L'OUVERTURE, une panne du Panel EST bloquante — contrairement à la
     * revalidation d'une session déjà ouverte. Ouvrir un accès qu'on n'a pas
     * pu confirmer serait accorder sur une assertion seule, alors qu'elle a
     * pu être émise avant une désactivation.
     */
    logger.warn(`[federation] introspection impossible à l’ouverture (${error?.code ?? error?.message}).`);
    throw new ApiError(401, 'Accès L.Y Solution indisponible : le Panel n’a pas répondu.', {
      code: FEDERATION_ERRORS.PANEL_UNREACHABLE,
    });
  }

  if (!verdict?.active) {
    throw new ApiError(401, 'Accès L.Y Solution refusé.', {
      code: FEDERATION_ERRORS.PRINCIPAL_INACTIVE,
    });
  }
  return verdict;
}

/**
 * NOTRE IDENTITÉ D'AUDIENCE — celle que l'appairage a enregistrée.
 *
 * Elle n'est ni configurée, ni devinée, ni lue d'une variable d'environnement :
 * c'est le `projectId` que le Panel nous a attribué au bootstrap. Une assertion
 * émise pour un autre projet est donc refusée sans qu'aucune décision humaine
 * n'intervienne — et un projet dupliqué, qui recevra son propre identifiant,
 * refusera les assertions de son modèle sans qu'on ait rien à reconfigurer.
 */
function currentProjectId() {
  return projectIdForFederation();
}

export default {
  FEDERATED_SESSION_TTL_SECONDS,
  FEDERATION_ERRORS,
  REVALIDATION_INTERVAL_SECONDS,
  completeFederatedLogin,
  revalidateFederatedSession,
  serializePrincipal,
  startFederatedLogin,
};
