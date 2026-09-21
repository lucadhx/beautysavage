/**
 * Erreurs typées de l'intégration Hostinger.
 *
 * Les codes correspondent aux comportements RÉELS documentés dans
 * docs/hostinger/api-1.json (401 Unauthenticated, 403, 404, 422 validation,
 * 429 rate limit, 5xx). Aucun secret n'est jamais placé dans un message ; le
 * `correlationId` (request ID renvoyé par l'API) est conservé pour le rapport.
 */
export class HostingerError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'HostingerError';
    this.code = code;
    this.httpStatus = meta.httpStatus ?? null;
    this.correlationId = meta.correlationId ?? null;
    this.details = meta.details ?? null;
    this.retryable = Boolean(meta.retryable);
  }
}

/** Traduit un statut HTTP + corps en erreur typée. */
export function errorFromResponse(status, body, meta = {}) {
  const message = (body && body.message) || `Hostinger a répondu ${status}.`;
  const correlationId = (body && body.correlation_id) || meta.correlationId || null;
  const base = { httpStatus: status, correlationId, details: body?.errors || null };
  switch (status) {
    case 401:
      return new HostingerError('HOSTINGER_AUTH_FAILED', 'Clé API Hostinger invalide ou expirée.', base);
    case 403:
      return new HostingerError('HOSTINGER_PERMISSION_DENIED', 'Permissions insuffisantes pour cette opération (scope DNS ?).', base);
    case 404:
      return new HostingerError('HOSTINGER_ZONE_NOT_FOUND', 'Domaine ou zone DNS introuvable sur ce compte.', base);
    case 409:
      return new HostingerError('HOSTINGER_RECORD_CONFLICT', 'Conflit sur l’enregistrement DNS.', base);
    case 422:
      return new HostingerError('HOSTINGER_INVALID_RESPONSE', message, base);
    case 429:
      return new HostingerError('HOSTINGER_RATE_LIMITED', 'Trop de requêtes vers l’API Hostinger.', { ...base, retryable: true });
    default:
      if (status >= 500) return new HostingerError('HOSTINGER_API_UNAVAILABLE', 'API Hostinger momentanément indisponible.', { ...base, retryable: true });
      return new HostingerError('HOSTINGER_INVALID_RESPONSE', message, base);
  }
}

export const HOSTINGER_ERROR_CODES = [
  'HOSTINGER_AUTH_FAILED',
  'HOSTINGER_PERMISSION_DENIED',
  'HOSTINGER_RATE_LIMITED',
  'HOSTINGER_ZONE_NOT_FOUND',
  'HOSTINGER_RECORD_CONFLICT',
  'HOSTINGER_RECORD_CREATE_FAILED',
  'HOSTINGER_RECORD_UPDATE_FAILED',
  'HOSTINGER_TIMEOUT',
  'HOSTINGER_API_UNAVAILABLE',
  'HOSTINGER_INVALID_RESPONSE',
];

export default HostingerError;
