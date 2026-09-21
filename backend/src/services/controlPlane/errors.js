/**
 * Taxonomie d'erreurs MÉTIER du plan de contrôle (P2.14).
 *
 * Chaque échec attendu est une erreur métier CONNUE (jamais une « exception non
 * prévue »). `ControlPlaneError` porte un code stable + un statut HTTP suggéré ;
 * la conversion en réponse se fait dans la couche route.
 */
export const CONTROL_PLANE_CODES = {
  CONTROL_DB_UNAVAILABLE: 503,
  DEPLOYMENT_TARGET_NOT_FOUND: 404,
  DEPLOYMENT_TARGET_INVALID: 400,
  DEPLOYMENT_TARGET_CONFLICT: 409,
  DEPLOYMENT_TARGET_URL_MISMATCH: 409,
  DEPLOYMENT_TARGET_PERSIST_FAILED: 500,

  DEPLOYMENT_RELEASE_CREATE_FAILED: 500,
  DEPLOYMENT_RELEASE_INVALID: 400,
  DEPLOYMENT_RELEASE_ACTIVATION_FAILED: 500,
  DEPLOYMENT_RELEASE_ALREADY_ACTIVE: 409,
  DEPLOYMENT_RELEASE_PATH_INVALID: 400,

  API_HOSTNAME_INVALID: 400,
  API_DNS_CREATE_FAILED: 502,
  API_DNS_MISMATCH: 409,
  API_DNS_VERIFY_FAILED: 502,
  API_NGINX_CONFIG_FAILED: 500,
  API_NGINX_TEST_FAILED: 500,
  API_CERTIFICATE_FAILED: 502,
  API_HTTPS_UNAVAILABLE: 502,
  API_HEALTHCHECK_FAILED: 502,
  API_PROXY_FAILED: 502,
  API_ENVIRONMENT_MISMATCH: 409,

  CONTROL_PLANE_MIGRATION_INCOMPLETE: 422,

  DEPLOYMENT_UPDATE_NOT_AVAILABLE: 501,
  DEPLOYMENT_ROLLBACK_NOT_AVAILABLE: 501,
};

export class ControlPlaneError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ControlPlaneError';
    this.code = code;
    this.statusCode = CONTROL_PLANE_CODES[code] || 400;
    this.details = details;
  }
}

export function cpError(code, message, details) {
  return new ControlPlaneError(code, message, details);
}

export default { ControlPlaneError, cpError, CONTROL_PLANE_CODES };
