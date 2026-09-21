/**
 * Constantes du suivi réel des livraisons (webhooks transactionnels Brevo).
 *
 * Codes STABLES : le Manager et les tests s'appuient dessus, jamais sur un texte.
 */

/** Cycle de vie d'un événement webhook reçu, du POST à son rapprochement. */
export const WEBHOOK_PROCESSING_STATUS = Object.freeze({
  /** Reçu et persisté, pas encore traité. */
  RECEIVED: 'RECEIVED',
  /** Rapproché d'une livraison et appliqué. */
  PROCESSED: 'PROCESSED',
  /** Authentique mais aucune livraison correspondante (à réconcilier plus tard). */
  UNMATCHED: 'UNMATCHED',
  /** Structurellement valide mais type non suivi (ex. SMS) : consigné, sans effet. */
  IGNORED: 'IGNORED',
  /** Le traitement a échoué (persistance/rapprochement) — repris possible. */
  FAILED: 'FAILED',
});
export const WEBHOOK_PROCESSING_STATUS_VALUES = Object.values(WEBHOOK_PROCESSING_STATUS);

/** État de la configuration du webhook côté Manager (par mode). */
export const WEBHOOK_CONFIG_STATUS = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONFIGURED: 'CONFIGURED',
  OUT_OF_SYNC: 'OUT_OF_SYNC',
  ERROR: 'ERROR',
});

/** Erreurs normalisées (§28 du CDC). Réponses publiques toujours neutres. */
export const BREVO_WEBHOOK_ERROR_CODES = Object.freeze({
  BREVO_WEBHOOK_NOT_CONFIGURED: 'BREVO_WEBHOOK_NOT_CONFIGURED',
  BREVO_WEBHOOK_AUTH_REQUIRED: 'BREVO_WEBHOOK_AUTH_REQUIRED',
  BREVO_WEBHOOK_AUTH_INVALID: 'BREVO_WEBHOOK_AUTH_INVALID',
  BREVO_WEBHOOK_PAYLOAD_INVALID: 'BREVO_WEBHOOK_PAYLOAD_INVALID',
  BREVO_WEBHOOK_EVENT_UNSUPPORTED: 'BREVO_WEBHOOK_EVENT_UNSUPPORTED',
  BREVO_WEBHOOK_DELIVERY_NOT_FOUND: 'BREVO_WEBHOOK_DELIVERY_NOT_FOUND',
  BREVO_WEBHOOK_OUT_OF_SYNC: 'BREVO_WEBHOOK_OUT_OF_SYNC',
  BREVO_WEBHOOK_LIMIT_REACHED: 'BREVO_WEBHOOK_LIMIT_REACHED',
  BREVO_WEBHOOK_REMOTE_NOT_FOUND: 'BREVO_WEBHOOK_REMOTE_NOT_FOUND',
  BREVO_WEBHOOK_SECRET_ROTATION_FAILED: 'BREVO_WEBHOOK_SECRET_ROTATION_FAILED',
  BREVO_WEBHOOK_RECONCILIATION_FAILED: 'BREVO_WEBHOOK_RECONCILIATION_FAILED',
  // Codes granulaires du parcours de (première) configuration.
  BACKEND_URL_NOT_CONFIGURED: 'BACKEND_URL_NOT_CONFIGURED',
  URL_NOT_PUBLIC: 'URL_NOT_PUBLIC',
  BREVO_API_KEY_MISSING: 'BREVO_API_KEY_MISSING',
  BREVO_API_UNAUTHORIZED: 'BREVO_API_UNAUTHORIZED',
  BREVO_REMOTE_ERROR: 'BREVO_REMOTE_ERROR',
  WEBHOOK_CONFIGURATION_CONFLICT: 'WEBHOOK_CONFIGURATION_CONFLICT',
  // Joignabilité réelle : le webhook existe chez Brevo mais son URL ne répond pas
  // (tunnel de développement fermé, backend arrêté, DNS cassé).
  WEBHOOK_URL_UNREACHABLE: 'WEBHOOK_URL_UNREACHABLE',
  // La preuve de joignabilité a expiré et n'a pas pu être renouvelée.
  WEBHOOK_HEALTH_EXPIRED: 'WEBHOOK_HEALTH_EXPIRED',
});

/**
 * Erreur métier UNIQUE renvoyée quand un envoi est refusé faute de suivi
 * opérationnel. Distincte des codes ci-dessus : ceux-ci diagnostiquent le
 * webhook, celui-là s'adresse à l'appelant d'un envoi.
 */
export const BREVO_TRACKING_REQUIRED = 'BREVO_TRACKING_REQUIRED';
export const BREVO_TRACKING_REQUIRED_MESSAGE =
  "L'envoi est temporairement indisponible car le suivi de livraison Brevo n'est pas opérationnel. Configurez ou réparez le webhook avant d'envoyer.";

/**
 * Depuis le LOT « états séparés » : un envoi n'est refusé QUE pour une cause
 * d'ENVOI (fournisseur désactivé, clé API absente, expéditeur non renseigné).
 * Un webhook absent/cassé DÉGRADE le suivi mais ne bloque plus l'envoi —
 * le webhook sert à constater le résultat APRÈS envoi.
 */
export const EMAIL_DELIVERY_BLOCKED = 'EMAIL_DELIVERY_BLOCKED';
export const EMAIL_DELIVERY_BLOCKED_MESSAGE =
  "L'envoi d'e-mails est indisponible : service désactivé, clé API absente ou expéditeur non renseigné.";

/** Modes de route acceptés (minuscule) → mode fournisseur (majuscule). */
export const WEBHOOK_ROUTE_MODES = Object.freeze({ test: 'TEST', prod: 'PROD' });
