/**
 * Erreurs du pont Panel ↔ Projet — catalogue FERMÉ, aligné mot pour mot sur
 * les enums `ErrorResponse.code` des deux specs OpenAPI
 * (docs/panelXvitrine/spec/). Les clients routent sur `code`, jamais sur le
 * libellé français.
 *
 * Une BridgeError porte un `statusCode` HTTP : le middleware d'erreurs
 * existant (backend/src/middlewares/error.middleware.js) la sérialise donc
 * nativement en `{ success:false, code, message, details? }` — le `code`
 * racine étant lu depuis `details.code` (objet), on le pose systématiquement.
 */

/** Codes du CONTRAT (présents dans les fichiers OpenAPI). */
export const BRIDGE_ERROR_CODES = Object.freeze({
  UNAUTHORIZED: 'BRIDGE_UNAUTHORIZED',
  /**
   * L'ENVIRONNEMENT DÉCLARÉ NE CORRESPOND PAS À CELUI DE L'INSTANCE VISÉE.
   *
   * ── POURQUOI CE CODE VIT ICI, ET PAS SEULEMENT CHEZ LE PANEL ────────────
   * C'est le Panel qui refuse — un projet qui se déclare en `PROD` sur une
   * instance servant `TEST` n'obtient pas de jeton. Mais c'est CE côté-ci qui
   * reçoit la réponse : le catalogue est FERMÉ, et un code absent du
   * catalogue ne se voit attribuer aucun statut. L'appairage échouait donc
   * avec la bonne raison sur le fil et une erreur mal typée à l'arrivée.
   *
   * Une URL choisit l'instance physique ; l'environnement déclaré valide
   * qu'on parle bien du même monde. Jamais de déduction par nom d'hôte.
   */
  ENVIRONMENT_MISMATCH: 'BRIDGE_ENVIRONMENT_MISMATCH',
  PAIRING_CODE_INVALID: 'BRIDGE_PAIRING_CODE_INVALID',
  ALREADY_PAIRED: 'BRIDGE_ALREADY_PAIRED',
  NOT_PAIRED: 'BRIDGE_NOT_PAIRED',
  CONTRACT_VERSION_UNSUPPORTED: 'BRIDGE_CONTRACT_VERSION_UNSUPPORTED',
  INVALID_PAYLOAD: 'BRIDGE_INVALID_PAYLOAD',
  ENTITY_TYPE_UNSUPPORTED: 'BRIDGE_ENTITY_TYPE_UNSUPPORTED',
  OPERATION_UNKNOWN: 'BRIDGE_OPERATION_UNKNOWN',
  OPERATION_FAILED: 'BRIDGE_OPERATION_FAILED',
  RATE_LIMITED: 'BRIDGE_RATE_LIMITED',
  INTERNAL: 'BRIDGE_INTERNAL',
});

/**
 * Codes LOCAUX au client (jamais sur le fil, absents des specs) : conditions
 * de transport côté projet, pas des réponses du Panel.
 */
export const BRIDGE_LOCAL_ERROR_CODES = Object.freeze({
  PANEL_UNREACHABLE: 'BRIDGE_PANEL_UNREACHABLE',
});

/** Statut HTTP canonique de chaque code du contrat (specs OpenAPI). */
const STATUS_BY_CODE = Object.freeze({
  [BRIDGE_ERROR_CODES.UNAUTHORIZED]: 401,
  // Même statut que côté Panel : un conflit d'état, pas un refus d'identité.
  [BRIDGE_ERROR_CODES.ENVIRONMENT_MISMATCH]: 409,
  [BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID]: 401,
  [BRIDGE_ERROR_CODES.ALREADY_PAIRED]: 409,
  [BRIDGE_ERROR_CODES.NOT_PAIRED]: 503,
  [BRIDGE_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED]: 409,
  [BRIDGE_ERROR_CODES.INVALID_PAYLOAD]: 400,
  [BRIDGE_ERROR_CODES.ENTITY_TYPE_UNSUPPORTED]: 422,
  [BRIDGE_ERROR_CODES.OPERATION_UNKNOWN]: 404,
  [BRIDGE_ERROR_CODES.OPERATION_FAILED]: 422,
  [BRIDGE_ERROR_CODES.RATE_LIMITED]: 429,
  [BRIDGE_ERROR_CODES.INTERNAL]: 500,
  [BRIDGE_LOCAL_ERROR_CODES.PANEL_UNREACHABLE]: 503,
});

/**
 * ── LE STATUT D’UN REFUS DE CAPACITÉ ────────────────────────────────────────
 *
 * ══ LE DÉFAUT QUE CETTE TABLE FERME ════════════════════════════════════════
 *
 * Les codes `CAPABILITY_*` n’étaient dans AUCUNE table. Ils retombaient donc
 * sur le défaut — `500` — et le gestionnaire d’erreurs masquait au passage
 * leur message, puisqu’un 500 non intentionnel ne doit rien divulguer.
 *
 * Concrètement : un client dont l’entreprise est incomplète cliquait
 * « Payer » et recevait « Erreur serveur ». Le Panel avait pourtant répondu
 * un 409 parfaitement motivé — il était perdu à la traversée.
 *
 * Un refus ATTENDU n’est pas une panne. La distinction n’est pas cosmétique :
 * elle décide si l’on montre un message au client, si l’on journalise une
 * alerte, et si l’appelant a le droit de réessayer.
 *
 * ══ LA CLASSIFICATION, PAR NATURE DE REFUS ═════════════════════════════════
 *
 *   409  l’état courant interdit l’action — dossier incomplet, acte déjà en
 *        cours, monde incohérent. Rien à corriger dans la requête : c’est la
 *        SITUATION qu’il faut changer.
 *   403  la ressource n’appartient pas à ce projet.
 *   422  la charge utile est un JSON valide mais viole le contrat métier du
 *        Panel. C’est un défaut de CE projet, pas du client.
 *   503  le fournisseur ou le plan de contrôle n’a pas répondu. Temporaire,
 *        donc réessayable — et à ne surtout pas confondre avec un refus.
 *   502  le Panel ne sert pas la capacité demandée : les deux côtés ne sont
 *        pas de la même version. Ni notre faute, ni celle du client.
 */
const CAPABILITY_STATUS = Object.freeze({
  CAPABILITY_NOT_AVAILABLE: 409,
  CAPABILITY_ENVIRONMENT_MISMATCH: 409,
  CAPABILITY_CREDENTIALS_MISSING: 409,
  CAPABILITY_OPERATION_IN_FLIGHT: 409,
  CAPABILITY_OPERATION_UNRESOLVED: 409,
  CAPABILITY_RESOURCE_NOT_OWNED: 403,
  CAPABILITY_PROJECT_SCOPE_MISMATCH: 403,
  CAPABILITY_INPUT_INVALID: 422,
  CAPABILITY_PROVIDER_UNAVAILABLE: 503,
  CAPABILITY_TIMEOUT: 503,
  CAPABILITY_UNKNOWN: 502,
});

export class BridgeError extends Error {
  /**
   * @param {string} code    Code du catalogue (BRIDGE_*).
   * @param {string} message Libellé humain (français, non contractuel).
   * @param {object} [extra] Contexte additionnel fusionné dans `details`.
   */
  constructor(code, message, extra = undefined) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    /**
     * L’ordre compte : le catalogue du pont d’abord, la table des capacités
     * ensuite, et `500` en tout dernier recours — c’est-à-dire seulement pour
     * un code qu’aucune des deux n’a prévu, ce qui est bien un défaut interne.
     */
    this.statusCode = STATUS_BY_CODE[code] ?? CAPABILITY_STATUS[code] ?? 500;
    // `details.code` = code racine pour le middleware d'erreurs existant.
    this.details = { code, ...(extra || {}) };
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Fabrique courte : `throw bridgeError(CODES.NOT_PAIRED)`. */
export function bridgeError(code, message = undefined, extra = undefined) {
  const fallback = {
    [BRIDGE_ERROR_CODES.UNAUTHORIZED]: 'Credentials de pont invalides ou révoqués.',
    [BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID]: "Code d'appairage invalide ou expiré.",
    [BRIDGE_ERROR_CODES.ALREADY_PAIRED]: 'Ce projet est déjà appairé.',
    [BRIDGE_ERROR_CODES.NOT_PAIRED]: "Ce projet n'est appairé à aucun Panel.",
    [BRIDGE_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED]:
      'Version majeure du contrat non supportée.',
    [BRIDGE_ERROR_CODES.INVALID_PAYLOAD]: 'Payload non conforme au contrat.',
    [BRIDGE_ERROR_CODES.ENTITY_TYPE_UNSUPPORTED]:
      "Type d'entité non synchronisé par cette version du projet.",
    [BRIDGE_ERROR_CODES.OPERATION_UNKNOWN]: 'Opération inconnue du catalogue.',
    [BRIDGE_ERROR_CODES.OPERATION_FAILED]:
      "L'opération a été refusée par le moteur local.",
    [BRIDGE_ERROR_CODES.RATE_LIMITED]: 'Trop de requêtes, réessayez plus tard.',
    [BRIDGE_ERROR_CODES.INTERNAL]: 'Erreur interne du pont.',
    [BRIDGE_LOCAL_ERROR_CODES.PANEL_UNREACHABLE]: 'Panel injoignable.',
  }[code];
  return new BridgeError(code, message || fallback || 'Erreur du pont.', extra);
}

export default BridgeError;
