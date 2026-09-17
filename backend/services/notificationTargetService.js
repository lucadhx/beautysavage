// services/notificationTargetService.js
// M3A — Notification Target Engine.
//
// Résout la CIBLE MÉTIER (audience / panel) d'une notification interne :
//   - 'admin' → visible dans le panel Manager/Admin
//   - 'dev'   → visible dans l'espace Dev uniquement
//
// Principe : une notification ne doit jamais être "globale sans cible". Chaque
// notification porte un `targetRole` ∈ {'admin','dev'}. Le mapping ci-dessous est la
// source de vérité ; tout type inconnu retombe sur 'admin' (compat historique : le
// flux historique est 100% métier institut), SAUF si la notification est créée
// explicitement depuis un contexte dev (option/flag).
//
// JAMAIS de cible 'client' ici : les notifications internes ne ciblent que le
// périmètre gestion (admin / dev). Le filtrage par audience est fait dans les
// endpoints (notificationController) ; ce service ne fait que résoudre/valider.

export const NOTIFICATION_TARGET_ROLES = Object.freeze(['admin', 'dev']);
export const DEFAULT_NOTIFICATION_TARGET_ROLE = 'admin';

// Synonymes acceptés en entrée (normalisation tolérante).
const ADMIN_ALIASES = new Set(['admin', 'manager', 'administrateur', 'administrator', 'gestion']);
const DEV_ALIASES = new Set(['dev', 'developer', 'developpeur', 'développeur', 'platform', 'plateforme', 'developer-space']);

// ─── Mapping type → audience ────────────────────────────────────────────────
//
// ADMIN : événements métier opérationnels de l'institut.
const ADMIN_NOTIFICATION_TYPES = new Set([
  'new_sale',                          // nouvelle vente
  'booking_created',                   // réservation prestation créée
  'booking_cancelled',                 // réservation annulée (générique)
  'booking_cancelled_client',          // réservation annulée par le client
  'booking_rescheduled_client',        // réservation décalée par le client
  'no_show_recorded',                  // no-show enregistré
  'refund_requested',                  // remboursement demandé
  'refund_succeeded',                  // remboursement abouti
  'commission_available',             // commission disponible côté institut
  'new_client',                        // nouveau client inscrit
  'formation_session_cancelled',       // session de formation annulée
  'formation_distancielle_purchased',  // achat formation distancielle
  'formation_presentielle_purchased',  // achat formation présentielle
  'formation_participation_cancelled', // annulation participation formation
  'review_received',                   // avis client soumis
  'review_published',                  // avis publié (modération)
  'review_rejected',                   // avis rejeté / masqué (modération)
  'review_manual',                     // avis créé manuellement par l'institut
  'evaluation_submitted',              // évaluation formation soumise
  'evaluation_accepted',               // évaluation validée (diplôme)
  'evaluation_refused'                 // évaluation refusée (recommencer)
]);

// DEV : événements techniques / plateforme / logs.
const DEV_NOTIFICATION_TYPES = new Set([
  'contract_payment_failed',           // échec paiement contrat plateforme
  'webhook_failure',                   // échec de webhook
  'integrated_api_error',              // erreur API intégrée
  'commission_paid_to_platform',       // commission versée à la plateforme
  'job_failed',                        // tâche planifiée en échec
  'system_error',                      // erreur système générique
  'email_identity_verification_failed' // échec vérification identité e-mail (Brevo)
]);

/**
 * Normalise une valeur d'entrée vers 'admin' | 'dev'.
 * Retourne `null` si l'entrée n'est pas reconnue (le caller décide du défaut).
 * @param {*} input
 * @returns {'admin'|'dev'|null}
 */
export function normalizeNotificationTargetRole(input) {
  if (input == null) return null;
  const v = String(input).trim().toLowerCase();
  if (!v) return null;
  if (DEV_ALIASES.has(v)) return 'dev';
  if (ADMIN_ALIASES.has(v)) return 'admin';
  return null;
}

/**
 * Résout l'audience cible d'une notification à partir de son type et de son payload.
 * Priorité :
 *   1. cible explicite dans le payload (`targetRole` / `__targetRole`) si reconnue ;
 *   2. mapping DEV_NOTIFICATION_TYPES → 'dev' ;
 *   3. mapping ADMIN_NOTIFICATION_TYPES → 'admin' ;
 *   4. flag `createdFromDevContext` du payload → 'dev' ;
 *   5. défaut → 'admin'.
 * @param {string} type
 * @param {object} [payload]
 * @returns {'admin'|'dev'}
 */
export function resolveNotificationTargetRole(type, payload = {}) {
  const explicit = normalizeNotificationTargetRole(
    payload?.targetRole ?? payload?.__targetRole
  );
  if (explicit) return explicit;

  const t = String(type || '').trim();
  if (DEV_NOTIFICATION_TYPES.has(t)) return 'dev';
  if (ADMIN_NOTIFICATION_TYPES.has(t)) return 'admin';

  // Type inconnu : dev seulement si créé explicitement depuis un contexte dev.
  if (payload?.createdFromDevContext === true) return 'dev';
  return DEFAULT_NOTIFICATION_TARGET_ROLE;
}

/**
 * Indique si un utilisateur (rôle) peut lire une notification donnée.
 * - client (ou rôle inconnu) : jamais.
 * - notification 'dev' : seul un dev peut lire.
 * - notification 'admin' (ou audience absente/legacy → traitée admin) : admin ou dev.
 * @param {{role?:string}|null} user
 * @param {{targetRole?:string}|null} notification
 * @returns {boolean}
 */
export function canReadNotification(user, notification) {
  const role = String(user?.role || '').trim().toLowerCase();
  if (role !== 'admin' && role !== 'dev') return false;
  const audience = normalizeNotificationTargetRole(notification?.targetRole) || 'admin';
  if (audience === 'dev') return role === 'dev';
  // audience admin (ou legacy) : admin et dev y ont accès (dev via panel manager).
  return true;
}

/**
 * Variante "assert" : retourne true si autorisé, lève sinon (code stable).
 * @throws {Error} avec `.code = 'FORBIDDEN_NOTIFICATION_AUDIENCE'`
 */
export function assertCanReadNotification(user, notification) {
  if (canReadNotification(user, notification)) return true;
  const err = new Error('Accès refusé à cette notification.');
  err.code = 'FORBIDDEN_NOTIFICATION_AUDIENCE';
  err.status = 403;
  throw err;
}

export default {
  NOTIFICATION_TARGET_ROLES,
  DEFAULT_NOTIFICATION_TARGET_ROLE,
  normalizeNotificationTargetRole,
  resolveNotificationTargetRole,
  canReadNotification,
  assertCanReadNotification
};
