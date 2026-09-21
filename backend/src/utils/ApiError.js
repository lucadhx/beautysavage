/**
 * Application error carrying an HTTP status code.
 * Thrown from services/controllers and translated by the error middleware.
 */
export class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(msg = 'Requête invalide', details) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Non authentifié') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'Accès refusé') {
    return new ApiError(403, msg, arguments[1]);
  }
  /**
   * `details` accepté ici aussi : une absence a parfois besoin d'un code stable
   * (« ce document n'existe pas » ≠ « cette route n'existe pas »), sans quoi le
   * client ne peut que deviner en lisant une phrase.
   */
  static notFound(msg = 'Ressource introuvable', details) {
    return new ApiError(404, msg, details);
  }
  /**
   * `details` accepté comme sur `badRequest`/`tooMany` : un conflit a besoin de
   * dire CE QUI entre en conflit (code stable, version courante attendue), sans
   * quoi le client ne peut que réafficher un message et perdre le travail en cours.
   */
  static conflict(msg = 'Conflit', details) {
    return new ApiError(409, msg, details);
  }
  static tooMany(msg = 'Trop de requêtes, réessayez plus tard', details) {
    return new ApiError(429, msg, details);
  }
  /**
   * UNE DÉPENDANCE EXTERNE MANQUE À L'APPEL — pas une faute de l'appelant.
   *
   * Distinct de `conflict` : 503 dit « réessaie plus tard », 409 dit
   * « ta demande est incohérente ». Les confondre enverrait un exploitant
   * corriger sa saisie alors que seul le Panel est momentanément absent.
   */
  static serviceUnavailable(msg = 'Service momentanément indisponible', details) {
    return new ApiError(503, msg, details);
  }
}

export default ApiError;
