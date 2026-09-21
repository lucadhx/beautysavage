import type { DomainEventView, EventExecutionView, EventDispatchStatus, ExecutionStatus } from '@/types';

/**
 * Logique de l'écran « Événements système » (module PUR, sans React).
 *
 * Comme les autres modules de `lib/` : tout ce qui décide vit ici, le composant
 * affiche. C'est ce qui rend ces règles testables — le Manager n'a pas de rendu de
 * composants sous test.
 *
 * Ce module ne déduit AUCUN statut : il projette ce que le backend a calculé.
 */

/* --- Statuts --------------------------------------------------------------- */

export const DISPATCH_STATUS_META: Record<EventDispatchStatus, { label: string; cls: string }> = {
  PENDING: { label: 'En attente', cls: 'bg-slate-100 text-slate-600' },
  DISPATCHING: { label: 'En cours', cls: 'bg-blue-100 text-blue-700' },
  DISPATCHED: { label: 'Traité', cls: 'bg-emerald-100 text-emerald-700' },
  PARTIAL_FAILURE: { label: 'Succès partiel', cls: 'bg-orange-100 text-orange-700' },
  FAILED: { label: 'Échec', cls: 'bg-red-100 text-red-700' },
};

export function dispatchStatusMeta(status: EventDispatchStatus | undefined) {
  return DISPATCH_STATUS_META[status as EventDispatchStatus] ?? DISPATCH_STATUS_META.PENDING;
}

export const EXECUTION_STATUS_META: Record<ExecutionStatus, { label: string; cls: string }> = {
  PENDING: { label: 'En attente', cls: 'bg-slate-100 text-slate-600' },
  PROCESSING: { label: 'En cours', cls: 'bg-blue-100 text-blue-700' },
  SUCCEEDED: { label: 'Réussie', cls: 'bg-emerald-100 text-emerald-700' },
  FAILED: { label: 'Échec — nouvelle tentative prévue', cls: 'bg-amber-100 text-amber-700' },
  SKIPPED: { label: 'Ignorée', cls: 'bg-slate-100 text-slate-600' },
  DEAD_LETTER: { label: 'Abandonnée', cls: 'bg-red-100 text-red-700' },
};

export function executionStatusMeta(status: ExecutionStatus | undefined) {
  return EXECUTION_STATUS_META[status as ExecutionStatus] ?? EXECUTION_STATUS_META.PENDING;
}

/* --- Libellés -------------------------------------------------------------- */

/**
 * Libellés FR des types connus. Un type inconnu garde sa clé technique : mieux
 * vaut afficher `contract.foo` que « Événement » — le premier se cherche.
 */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  'email.sender.verification_requested': 'Code de vérification demandé',
  'email.sender.verified': 'Adresse expéditrice vérifiée',
  'email.sender.verification_failed': 'Échec de vérification de l’adresse',
  'email.domain.configuration_requested': 'Domaine configuré chez Brevo',
  'email.domain.pending_dns': 'Domaine en attente des DNS',
  'email.domain.authenticated': 'Domaine authentifié',
  'email.domain.authentication_failed': 'Échec d’authentification du domaine',
  'contact.submitted': 'Demande de contact soumise',
  'contract.cancel_requested': 'Résiliation demandée',
  'contract.cancel_at_period_end': 'Résiliation à échéance',
  'contract.ended': 'Contrat terminé',
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

export const ACTOR_LABELS: Record<string, string> = {
  user: 'Utilisateur',
  system: 'Système',
  webhook: 'Webhook',
  scheduler: 'Planificateur',
};

export function actorLabel(actor: DomainEventView['actor'] | undefined): string {
  if (!actor) return '—';
  const base = ACTOR_LABELS[actor.type] ?? actor.type;
  return actor.role ? `${base} (${actor.role})` : base;
}

/* --- Résumé des actions ---------------------------------------------------- */

/**
 * Résumé lisible des actions d'un événement. « Aucune action » est un état NORMAL
 * (les événements d'audit n'en ont pas) et doit se lire comme tel, pas comme un
 * manque.
 */
export function actionsSummary(actions: DomainEventView['actions'] | undefined): string {
  if (!actions || actions.total === 0) return 'Aucune action';
  const parts = [`${actions.total} action${actions.total > 1 ? 's' : ''}`];
  if (actions.succeeded > 0) parts.push(`${actions.succeeded} ok`);
  if (actions.failed > 0) parts.push(`${actions.failed} en échec`);
  return parts.join(' · ');
}

/* --- Retry ----------------------------------------------------------------- */

/**
 * Le retry n'est proposé que s'il y a réellement quelque chose à rejouer.
 *
 * Un succès n'est JAMAIS rejouable : le backend refuse déjà (il ne reprend que les
 * FAILED/DEAD_LETTER), et proposer le bouton laisserait croire l'inverse.
 */
export function canRetryEvent(event: DomainEventView | null): boolean {
  if (!event) return false;
  return event.dispatchStatus === 'FAILED' || event.dispatchStatus === 'PARTIAL_FAILURE';
}

export function canRetryExecution(execution: EventExecutionView): boolean {
  return execution.status === 'FAILED' || execution.status === 'DEAD_LETTER';
}

/* --- Prochaine tentative --------------------------------------------------- */

/**
 * Date de prochaine tentative, uniquement quand elle a un sens : une exécution
 * terminée n'en a pas, et une échéance passée signifie « au prochain passage »,
 * pas une date future trompeuse.
 */
export function nextAttemptAt(execution: EventExecutionView, now: number): string | null {
  if (execution.status !== 'FAILED') return null;
  const at = new Date(execution.availableAt).getTime();
  if (!Number.isFinite(at)) return null;
  return at > now ? execution.availableAt : null;
}

export function attemptsLabel(execution: EventExecutionView): string {
  return `${execution.attempts}/${execution.maxAttempts}`;
}

/* --- Payload --------------------------------------------------------------- */

/**
 * Clés jamais affichées, même si elles arrivaient malgré tout.
 *
 * Le backend refuse déjà ces clés à l'émission : ceci est une SECONDE barrière,
 * pas la première. Une donnée sensible qui aurait franchi la première ne doit pas
 * s'afficher pour autant.
 */
const NEVER_DISPLAY = ['apikey', 'secret', 'password', 'token', 'otp', 'authorization', 'cookie', 'html', 'rawpayload'];

function isHiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return NEVER_DISPLAY.some((k) => normalized.includes(k));
}

/** Aplatit un payload en lignes affichables, en écartant toute clé interdite. */
export function payloadRows(payload: Record<string, unknown> | undefined, prefix = ''): Array<[string, string]> {
  if (!payload || typeof payload !== 'object') return [];
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(payload)) {
    if (isHiddenKey(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      rows.push(...payloadRows(value as Record<string, unknown>, path));
    } else if (Array.isArray(value)) {
      rows.push([path, value.join(', ')]);
    } else {
      rows.push([path, String(value)]);
    }
  }
  return rows;
}

/* --- Filtres --------------------------------------------------------------- */

export interface EventFilters {
  type?: string;
  dispatchStatus?: string;
  entityType?: string;
}

/**
 * Query string des filtres. Les valeurs vides sont OMISES : envoyer `type=` ferait
 * échouer la validation stricte du backend.
 */
export function buildEventQuery(filters: EventFilters, cursor?: string | null, limit?: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function hasActiveFilters(filters: EventFilters): boolean {
  return Object.values(filters).some(Boolean);
}
