/**
 * Constantes du système d'événements métier.
 *
 * Tout est CODE-FIRST : aucun type d'événement, aucune action, aucune règle ne
 * vient de la base ni du Manager. La base ne stocke QUE des faits (ce qui s'est
 * réellement passé) et l'état de leur traitement.
 */

/** Qui a provoqué l'événement. */
export const EVENT_ACTOR_TYPE = Object.freeze({
  USER: 'user',
  SYSTEM: 'system',
  WEBHOOK: 'webhook',
  SCHEDULER: 'scheduler',
});
export const EVENT_ACTOR_TYPE_VALUES = Object.values(EVENT_ACTOR_TYPE);

/** État global du dispatch d'un événement (dérivé de ses exécutions). */
export const EVENT_DISPATCH_STATUS = Object.freeze({
  PENDING: 'PENDING',
  DISPATCHING: 'DISPATCHING',
  /** Toutes les actions ont réussi ou ont été ignorées (zéro action inclus). */
  DISPATCHED: 'DISPATCHED',
  /** Au moins une réussite ET au moins un échec TERMINAL. */
  PARTIAL_FAILURE: 'PARTIAL_FAILURE',
  /** Toutes les actions sont en échec TERMINAL. */
  FAILED: 'FAILED',
});
export const EVENT_DISPATCH_STATUS_VALUES = Object.values(EVENT_DISPATCH_STATUS);

/** État d'une exécution d'action. */
export const EXECUTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  /** Échec RETRYABLE : une nouvelle tentative est prévue (`availableAt`). */
  FAILED: 'FAILED',
  /** Action volontairement non exécutée (désactivée, sans objet). */
  SKIPPED: 'SKIPPED',
  /** Échec TERMINAL : non retryable, ou tentatives épuisées. */
  DEAD_LETTER: 'DEAD_LETTER',
  /**
   * LE MESSAGE N'A PLUS LIEU D'ÊTRE — et ce n'est ni un succès ni un échec.
   *
   * ══ LE CAS QUI L'A RENDU NÉCESSAIRE ═══════════════════════════════════════
   *
   * Une relance d'impayé part, le fournisseur d'envoi est momentanément
   * injoignable, une nouvelle tentative est programmée dans deux minutes. Entre
   * les deux, le client paie. Le worker se réveille et envoie « nous n'avons
   * toujours pas reçu votre règlement » à quelqu'un qui vient de régler.
   *
   * `SUCCEEDED` mentirait — rien n'est parti. `DEAD_LETTER` accuserait une
   * panne qui n'a pas eu lieu, et ferait chercher un incident inexistant.
   * `SKIPPED` dit « désactivée, sans objet dès le départ », ce qui est faux :
   * l'action ÉTAIT justifiée quand elle a été créée.
   *
   * `OBSOLETE` dit la seule chose vraie : la condition métier qui la justifiait
   * a cessé d'être vraie avant qu'elle ne parte.
   */
  OBSOLETE: 'OBSOLETE',
});
export const EXECUTION_STATUS_VALUES = Object.values(EXECUTION_STATUS);

/** États depuis lesquels une exécution peut être prise par un worker. */
export const CLAIMABLE_STATUSES = Object.freeze([EXECUTION_STATUS.PENDING, EXECUTION_STATUS.FAILED]);

/** États terminaux (plus aucune tentative automatique). */
export const TERMINAL_STATUSES = Object.freeze([
  EXECUTION_STATUS.SUCCEEDED,
  EXECUTION_STATUS.SKIPPED,
  EXECUTION_STATUS.DEAD_LETTER,
  /** Plus aucune tentative : la raison d'envoyer a disparu, pas la capacité. */
  EXECUTION_STATUS.OBSOLETE,
]);

/**
 * Classes de rétention. Portées par l'événement pour qu'une purge future soit
 * triviale à écrire.
 *
 * ⚠️ AUCUN index TTL n'est posé : un TTL aveugle supprimerait des événements
 * d'audit qu'on doit conserver. La purge sera un script explicite, par classe.
 */
export const RETENTION_CLASS = Object.freeze({
  /** Trace de conformité / sécurité. Conservation longue (≈ 3 ans recommandé). */
  AUDIT: 'AUDIT',
  /** Exploitation courante, diagnostic (≈ 12 mois recommandé). */
  OPERATIONAL: 'OPERATIONAL',
  /** Bruit technique, purge rapide (≈ 30 jours recommandé). */
  TRANSIENT: 'TRANSIENT',
});
export const RETENTION_CLASS_VALUES = Object.values(RETENTION_CLASS);

/** Durées de rétention RECOMMANDÉES (jours). Documentation, pas encore appliquées. */
export const RETENTION_DAYS = Object.freeze({
  AUDIT: 1095,
  OPERATIONAL: 365,
  TRANSIENT: 30,
});

/** Types d'action reconnus. Un handler doit exister pour chacun. */
export const ACTION_TYPE = Object.freeze({
  NO_OP: 'NO_OP',
  SEND_EMAIL: 'SEND_EMAIL',
  /**
   * L12.1 — RAPPORTER UN FAIT AU CONTROL PLANE, sans décider de sa suite.
   *
   * ── POURQUOI UN TYPE À PART, ET PAS UN `SEND_EMAIL` DE PLUS ───────────────
   *
   * `SEND_EMAIL` dit : « ce projet envoie ce message, avec ce modèle, à ces
   * destinataires ». Trois décisions que le projet n'a pas à prendre pour une
   * alerte technique — le modèle appartient à L.Y Solution, et c'est elle qui
   * choisit qui prévenir.
   *
   * L'alerte d'incident était pourtant branchée en `SEND_EMAIL`, sur un modèle
   * de portée PANEL. Elle ne pouvait structurellement pas aboutir, et échouait
   * en silence depuis toujours. Le type manquait ; on l'ajoute plutôt que de
   * tordre celui qui existait.
   *
   * Ce type ne transporte donc AUCUN `templateId` : il pousse des faits.
   */
  REPORT_INCIDENT: 'REPORT_INCIDENT',
});
export const ACTION_TYPE_VALUES = Object.values(ACTION_TYPE);

/** Codes d'erreur stables du système d'événements. */
export const EVENT_ERROR_CODES = Object.freeze({
  UNKNOWN_EVENT_TYPE: 'UNKNOWN_EVENT_TYPE',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  PAYLOAD_TOO_DEEP: 'PAYLOAD_TOO_DEEP',
  SENSITIVE_KEY: 'SENSITIVE_KEY',
  UNKNOWN_ACTION_TYPE: 'UNKNOWN_ACTION_TYPE',
  ACTION_HANDLER_NOT_IMPLEMENTED: 'ACTION_HANDLER_NOT_IMPLEMENTED',
  HANDLER_ERROR: 'HANDLER_ERROR',
  LOCK_LOST: 'LOCK_LOST',
});

/**
 * Sentinelle de `recipientKey` pour une action sans destinataire.
 *
 * L'index unique porte sur (eventId, actionId, recipientKey) : sans valeur par
 * défaut, deux exécutions sans destinataire seraient considérées distinctes par
 * MongoDB (null ≠ null n'est pas vrai, mais un champ absent casse l'unicité
 * attendue). Une sentinelle explicite rend l'intention lisible.
 */
export const SINGLE_RECIPIENT_KEY = '_single';

/**
 * Politique de retry, PAR TYPE D'ACTION. Déterministe : le délai ne dépend que du
 * numéro de tentative, jamais d'un aléa — deux workers calculent la même chose.
 *
 * `backoffMs[i]` = délai avant la tentative i+2 (la 1re est immédiate).
 * Au-delà de `maxAttempts`, l'exécution part en DEAD_LETTER.
 */
export const RETRY_POLICY = Object.freeze({
  NO_OP: { maxAttempts: 1, backoffMs: [] },
  SEND_EMAIL: { maxAttempts: 4, backoffMs: [30_000, 120_000, 600_000] },
});
export const DEFAULT_RETRY_POLICY = Object.freeze({ maxAttempts: 3, backoffMs: [30_000, 120_000] });

export function retryPolicy(actionType) {
  return RETRY_POLICY[actionType] || DEFAULT_RETRY_POLICY;
}

/**
 * Délai avant la prochaine tentative. `attempts` = nombre de tentatives DÉJÀ
 * faites. Plafonné au dernier palier : jamais de croissance infinie.
 */
export function nextBackoffMs(actionType, attempts) {
  const { backoffMs } = retryPolicy(actionType);
  if (backoffMs.length === 0) return 0;
  const index = Math.min(Math.max(attempts - 1, 0), backoffMs.length - 1);
  return backoffMs[index];
}

/**
 * Durée d'un verrou de traitement. Au-delà, l'exécution est considérée abandonnée
 * (processus tué, crash) et peut être reprise par un autre passage.
 */
export const LOCK_TTL_MS = 60_000;
