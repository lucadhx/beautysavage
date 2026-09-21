// LE VÉRIFICATEUR D'ASSERTION — écrit du point de vue de celui qui DOUTE (L12.B).
//
// docs/auth/PANEL_FEDERATED_DEV_IDENTITY_IMPLEMENTATION.md §« ASSERTION VERIFICATION ».
//
// ── LA POSTURE ──────────────────────────────────────────────────────────────
//
// Ce module reçoit une chaîne fournie par un navigateur. Rien n'y est vrai
// avant d'avoir été prouvé. L'ordre des opérations n'est donc pas une question
// de style : chaque étape ne fait confiance qu'à ce que la précédente a établi.
//
//   1. la forme            un JWT, avec un en-tête lisible
//   2. le `kid`            présent — sinon on ne saurait pas quoi essayer
//   3. la clé publique     obtenue du Panel, jamais du jeton
//   4. la SIGNATURE        avec l'algorithme IMPOSÉ
//   5. iss / aud / exp     vérifiés par la bibliothèque, pas à la main
//   6. le contrat métier   principalType, role, panelUserId, tokenVersion, jti
//
// ── LES TROIS PIÈGES DU FORMAT, ET COMMENT ILS SONT FERMÉS ──────────────────
//
//   `alg: none`            l'algorithme est imposé (`algorithms: ['RS256']`),
//                          jamais lu du jeton.
//   confusion HMAC         même garde : un jeton HS256 présenté avec la clé
//                          publique comme secret n'est pas dans la liste.
//   `decode` puis confiance  `jwt.decode` n'est appelé QUE pour lire le `kid`,
//                          et sa sortie ne sert à rien d'autre. Toute donnée
//                          métier vient de `jwt.verify`.
//
// ── L'AUDIENCE VIENT DE L'APPAIRAGE ─────────────────────────────────────────
//
// Le `projectId` attendu n'est pas configuré à la main : c'est celui que le
// Panel nous a donné à l'appairage. Une assertion émise pour un autre projet
// est donc refusée sans qu'aucune décision humaine n'intervienne.
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

import { publicJwkFor } from './panelJwks.client.js';

/** L'émetteur attendu. Une URN : l'adresse publique du Panel peut changer. */
export const EXPECTED_ISSUER = 'urn:ly-solution:panel';

/** IMPOSÉ. Ne jamais dériver l'algorithme du jeton qu'on vérifie. */
export const EXPECTED_ALGORITHM = 'RS256';

/** Le seul type de principal qu'une assertion puisse porter aujourd'hui. */
export const EXPECTED_PRINCIPAL_TYPE = 'PANEL_USER';

/** Le seul rôle qui ouvre un accès développeur. */
export const EXPECTED_ROLE = 'DEV';

/**
 * Tolérance d'horloge. Deux machines qui ne sont pas à la même seconde ne
 * doivent pas produire un refus ; le Panel applique la même valeur.
 */
export const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * `iat` NE DOIT PAS ÊTRE DANS LE FUTUR — au-delà de la tolérance.
 *
 * Un jeton daté de demain passerait la vérification d'expiration tout en
 * restant valable très longtemps. La bibliothèque ne contrôle pas ce sens-là :
 * on le fait ici.
 */
const MAX_FUTURE_IAT_SECONDS = CLOCK_TOLERANCE_SECONDS;

export const VERIFICATION_ERRORS = Object.freeze({
  MALFORMED: 'FEDERATED_ASSERTION_MALFORMED',
  UNKNOWN_KEY: 'FEDERATED_ASSERTION_UNKNOWN_KEY',
  INVALID_SIGNATURE: 'FEDERATED_ASSERTION_INVALID_SIGNATURE',
  EXPIRED: 'FEDERATED_ASSERTION_EXPIRED',
  WRONG_AUDIENCE: 'FEDERATED_ASSERTION_WRONG_AUDIENCE',
  WRONG_ISSUER: 'FEDERATED_ASSERTION_WRONG_ISSUER',
  CONTRACT_VIOLATION: 'FEDERATED_ASSERTION_CONTRACT_VIOLATION',
  ENVIRONMENT_MISMATCH: 'FEDERATED_ASSERTION_ENVIRONMENT_MISMATCH',
});

/** L'empreinte d'un `jti` — c'est elle qu'on persiste, jamais le `jti`. */
export function hashJti(jti) {
  return crypto.createHash('sha256').update(String(jti), 'utf8').digest('hex');
}

/**
 * VÉRIFIE une assertion pour CE projet.
 *
 * @param {string} token
 * @param {object} options
 * @param {string} options.audience     projectId issu de l'appairage
 * @param {string} [options.environment] monde servi par ce projet
 * @param {number} [options.now]         horloge injectable (recettes)
 * @returns {Promise<{valid: boolean, reasonCode?: string, claims?: object}>}
 */
export async function verifyPanelAssertion(token, { audience, environment = null, now = null } = {}) {
  const fail = (reasonCode) => ({ valid: false, reasonCode });

  if (typeof token !== 'string' || token.length === 0) return fail(VERIFICATION_ERRORS.MALFORMED);
  if (!audience) return fail(VERIFICATION_ERRORS.WRONG_AUDIENCE);

  // ── 1-2. LA FORME, ET LE `kid` ────────────────────────────────────────────
  // `decode` ne prouve rien. Sa sortie ne sert QU'À choisir une clé.
  let entete;
  try {
    entete = jwt.decode(token, { complete: true })?.header ?? null;
  } catch {
    return fail(VERIFICATION_ERRORS.MALFORMED);
  }
  if (!entete || !entete.kid) return fail(VERIFICATION_ERRORS.MALFORMED);

  // ── 3. LA CLÉ PUBLIQUE — demandée au Panel ────────────────────────────────
  let jwk;
  try {
    jwk = await publicJwkFor(String(entete.kid));
  } catch {
    // Panel injoignable : on ne peut pas conclure. Refuser est le bon choix —
    // ouvrir une session sur une clé qu'on n'a pas pu obtenir serait pire.
    return fail(VERIFICATION_ERRORS.UNKNOWN_KEY);
  }
  if (!jwk) return fail(VERIFICATION_ERRORS.UNKNOWN_KEY);

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });

  // ── 4-5. LA SIGNATURE, PUIS LES CLAIMS STANDARD ───────────────────────────
  let claims;
  try {
    claims = jwt.verify(token, publicKey, {
      algorithms: [EXPECTED_ALGORITHM],
      issuer: EXPECTED_ISSUER,
      audience: String(audience),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      ...(now ? { clockTimestamp: Math.floor(now / 1000) } : {}),
    });
  } catch (error) {
    if (error?.name === 'TokenExpiredError') return fail(VERIFICATION_ERRORS.EXPIRED);
    if (String(error?.message ?? '').includes('audience')) return fail(VERIFICATION_ERRORS.WRONG_AUDIENCE);
    if (String(error?.message ?? '').includes('issuer')) return fail(VERIFICATION_ERRORS.WRONG_ISSUER);
    return fail(VERIFICATION_ERRORS.INVALID_SIGNATURE);
  }

  // ── 6. LE CONTRAT MÉTIER ──────────────────────────────────────────────────
  /**
   * Une signature valide prouve que le PANEL a émis — pas qu'il a émis ce
   * qu'on croit lire. Le jour où la même clé signera autre chose, ces
   * contrôles empêcheront de le prendre pour une assertion d'accès.
   */
  if (claims.principalType !== EXPECTED_PRINCIPAL_TYPE) return fail(VERIFICATION_ERRORS.CONTRACT_VIOLATION);
  if (claims.role !== EXPECTED_ROLE) return fail(VERIFICATION_ERRORS.CONTRACT_VIOLATION);
  if (!claims.panelUserId || claims.panelUserId !== claims.sub) return fail(VERIFICATION_ERRORS.CONTRACT_VIOLATION);
  if (!Number.isInteger(claims.tokenVersion)) return fail(VERIFICATION_ERRORS.CONTRACT_VIOLATION);
  if (!claims.jti) return fail(VERIFICATION_ERRORS.CONTRACT_VIOLATION);

  // `iat` dans le futur : voir MAX_FUTURE_IAT_SECONDS.
  const maintenant = Math.floor((now ?? Date.now()) / 1000);
  if (Number.isInteger(claims.iat) && claims.iat > maintenant + MAX_FUTURE_IAT_SECONDS) {
    return fail(VERIFICATION_ERRORS.CONTRACT_VIOLATION);
  }

  /**
   * LE MONDE — refusé seulement s'il DIVERGE.
   *
   * Un projet dont l'environnement n'est pas encore connu ne doit pas refuser
   * une assertion : c'est une absence, pas un désaccord. Même règle que la
   * passerelle de capacités du Panel.
   */
  if (environment && claims.environment && claims.environment !== environment) {
    return fail(VERIFICATION_ERRORS.ENVIRONMENT_MISMATCH);
  }

  return { valid: true, claims };
}

export default {
  CLOCK_TOLERANCE_SECONDS,
  EXPECTED_ALGORITHM,
  EXPECTED_ISSUER,
  EXPECTED_PRINCIPAL_TYPE,
  EXPECTED_ROLE,
  VERIFICATION_ERRORS,
  hashJti,
  verifyPanelAssertion,
};
