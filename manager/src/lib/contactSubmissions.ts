import type {
  ContactState,
  ContactReason,
  ContactNotificationSummary,
  ContactNotificationStatus,
  ContactSubmissionFilters,
} from '@/types';

/**
 * Logique des demandes de contact côté Manager — module PUR (aucun React, aucun
 * DOM), donc testable directement sous Node.
 *
 * ─── LE SERVEUR DÉCIDE, LE MANAGER TRADUIT ───────────────────────────────────
 *
 * Les transitions autorisées viennent du serveur (`allowedTransitions` du
 * détail) : ce module ne les recalcule pas. Recopier la table ici la ferait
 * diverger le jour où elle change — et le backend refuserait alors une action que
 * l'interface propose.
 *
 * Ce qui vit ici : des libellés, des tons, un résumé lisible. Rien qui décide.
 */

// --- Motifs ------------------------------------------------------------------

/** Miroir d'affichage de `backend/src/utils/contactConstants.js`. */
export const REASON_LABEL: Record<ContactReason, string> = {
  INFORMATION: "Demande d'information",
  QUOTE: 'Demande de devis',
  WEBSITE_ISSUE: 'Problème avec le site',
  SERVICE_QUESTION: 'Question sur un service',
  OTHER: 'Autre',
};

export const REASON_OPTIONS = (Object.keys(REASON_LABEL) as ContactReason[]).map((value) => ({
  value,
  label: REASON_LABEL[value],
}));

/** Un code inconnu s'affiche brut plutôt que vide : mieux vaut « X » que rien. */
export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason as ContactReason] || reason;
}

// --- État (non lue / lue / résolue) ------------------------------------------

export type Tone = 'new' | 'progress' | 'success' | 'muted';

export const STATE_LABEL: Record<ContactState, string> = {
  UNREAD: 'Non lu',
  READ: 'Lu',
  RESOLVED: 'Résolu',
};

export function stateLabel(state: string): string {
  return STATE_LABEL[state as ContactState] || state;
}

/** `UNREAD` est mis en avant : c'est le seul état qui appelle une action. */
export const STATE_TONE: Record<ContactState, Tone> = {
  UNREAD: 'new',
  READ: 'muted',
  RESOLVED: 'success',
};

export function stateTone(state: string): Tone {
  return STATE_TONE[state as ContactState] || 'muted';
}

// --- Notification ------------------------------------------------------------

/**
 * Libellés de l'état de notification.
 *
 * ⚠️ `SENT` ne dit PAS « reçue ». Écrire « envoyée » laisserait croire que
 * l'administrateur a le message dans sa boîte, alors que le fournisseur n'a fait
 * qu'accepter la demande — d'où « En attente de confirmation », le mot du
 * vocabulaire commun (`emailStates.ts`).
 *
 * L'ancien libellé, « Acceptée par Brevo », disait la bonne nuance mais nommait
 * le fournisseur, dont l'administrateur n'a que faire, et donnait un troisième
 * nom à un fait qui en avait déjà deux ailleurs.
 */
export const NOTIFICATION_LABEL: Record<ContactNotificationStatus, string> = {
  NONE: 'Aucune notification',
  PENDING: 'Envoi en cours',
  SENT: 'En attente de confirmation',
  PARTIAL: 'Partiellement envoyée',
  FAILED: 'Échec',
  SKIPPED: 'Non envoyée',
};

/** Repli neutre : jamais la constante backend — un code brut n'informe personne. */
const UNKNOWN_NOTIFICATION_LABEL = 'État inconnu';

export function notificationLabel(status: string): string {
  return NOTIFICATION_LABEL[status as ContactNotificationStatus] ?? UNKNOWN_NOTIFICATION_LABEL;
}

/**
 * Ton d'un état de notification.
 *
 * `SENT` était VERT ici, au motif que la question de cet écran serait « est-ce
 * parti ? ». L'argument ne tient plus une fois le libellé aligné : « En attente
 * de confirmation » en vert est une contradiction dans les termes. Le vert reste
 * réservé à un fait constaté — règle posée dans `emailStates.ts`, et qui vaut
 * pour tous les écrans, sans quoi elle ne vaut nulle part.
 */
export function notificationTone(status: string): 'success' | 'danger' | 'warning' | 'pending' | 'muted' {
  if (status === 'SENT') return 'pending';
  if (status === 'FAILED') return 'danger';
  if (status === 'PARTIAL' || status === 'NONE') return 'warning';
  if (status === 'PENDING') return 'pending';
  return 'muted';
}

/**
 * Résumé chiffré, en français lisible.
 *
 * « 2 acceptées par Brevo, 1 en échec » plutôt qu'un statut unique : avec
 * plusieurs administrateurs, un statut global cache l'essentiel — qui n'a pas reçu.
 */
export function notificationSummaryText(notification: ContactNotificationSummary | null): string {
  if (!notification || notification.total === 0) {
    return "Aucune notification n'a été déclenchée.";
  }
  const { sent, failed, pending, skipped } = notification.counts;
  const parts: string[] = [];
  if (sent > 0) parts.push(`${sent} acceptée${sent > 1 ? 's' : ''} par Brevo`);
  if (failed > 0) parts.push(`${failed} en échec`);
  if (pending > 0) parts.push(`${pending} en cours`);
  if (skipped > 0) parts.push(`${skipped} ignorée${skipped > 1 ? 's' : ''}`);
  return parts.join(', ') || 'État inconnu';
}

/**
 * L'état mérite-t-il l'attention d'un humain ?
 *
 * `NONE` en fait partie : aucune notification déclenchée signifie que l'émission
 * de l'événement a échoué (fenêtre de crash). C'est un silence, pas un succès —
 * et le silence est précisément ce qu'on ne veut pas laisser passer.
 */
export function notificationNeedsAttention(notification: ContactNotificationSummary | null): boolean {
  if (!notification) return false;
  return ['FAILED', 'PARTIAL', 'NONE'].includes(notification.status);
}

/** Traduction des codes d'erreur de notification. */
export const NOTIFICATION_ERROR_LABEL: Record<string, string> = {
  EMAIL_RECIPIENTS_NOT_FOUND: 'Aucun administrateur avec une adresse valide',
  SENDER_NOT_CONFIGURED: 'Expéditeur non configuré',
  EMAIL_SENDER_NOT_VERIFIED: 'Expéditeur non vérifié',
  PROVIDER_NOT_CONFIGURED: 'Brevo non configuré',
  PROVIDER_KEY_MISSING: 'Clé API Brevo manquante',
  PROVIDER_NOT_VERIFIED: 'Clé Brevo jamais testée',
  TEMPLATE_DISABLED: 'Template désactivé',
  TEMPLATE_INVALID: 'Template invalide',
  RATE_LIMITED: 'Brevo limite le débit',
  UNKNOWN_RESOLVER: 'Variables non résolues',
  RENDER_FAILED: 'Rendu du template impossible',
  SEND_INTERRUPTED: 'Envoi interrompu (renvoi manuel requis)',
  ACTION_DISABLED: 'Action désactivée',
};

export function notificationErrorLabel(code: string): string {
  return NOTIFICATION_ERROR_LABEL[code] || code;
}

/**
 * Message CLIENT (non-DEV) en cas d'échec de notification.
 *
 * Volontairement OPAQUE : aucun code technique (DEAD_LETTER, SENDER_NOT_CONFIGURED,
 * détail Brevo, retry, payload). Le client n'a pas à diagnostiquer l'infrastructure
 * — cela vit dans DEV → Événements système. On dit seulement qu'un problème
 * technique a empêché l'envoi. En cas de succès (ou d'envoi en cours), rien
 * d'alarmant n'est affiché.
 */
export const NOTIFICATION_FAILURE_CLIENT_TEXT =
  "La notification par email n'a pas pu être envoyée en raison d'un problème technique.";

export function notificationClientMessage(notification: ContactNotificationSummary | null): string | null {
  if (!notification) return null;
  if (['FAILED', 'PARTIAL', 'NONE'].includes(notification.status)) return NOTIFICATION_FAILURE_CLIENT_TEXT;
  return null;
}

// --- Filtres -----------------------------------------------------------------

export const EMPTY_FILTERS: ContactSubmissionFilters = {
  resolved: false,
  reason: '',
  search: '',
};

/** Un filtre « secondaire » est-il actif (hors onglet résolues/actives) ? */
export function hasActiveFilters(filters: ContactSubmissionFilters): boolean {
  return Boolean(filters.reason || filters.search.trim());
}

/**
 * Construit la query de liste. Valeurs vides OMISES (`.strict()` côté backend).
 * `resolved=true` bascule sur l'onglet « Résolues » (sinon : demandes actives).
 */
export function buildListQuery(
  filters: ContactSubmissionFilters,
  options: { cursor?: string | null; limit?: number } = {}
): string {
  const params = new URLSearchParams();
  if (filters.resolved) params.set('resolved', 'true');
  if (filters.reason) params.set('reason', filters.reason);
  const search = filters.search.trim();
  if (search) params.set('search', search);
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// --- Divers ------------------------------------------------------------------

/** Une demande jamais ouverte se repère d'un coup d'œil (ligne en gras + badge). */
export function isUnread(submission: { state: ContactState }): boolean {
  return submission.state === 'UNREAD';
}

/**
 * Extrait affiché en liste. Le serveur en envoie déjà un (120 caractères) ; on
 * le raccourcit encore si la colonne est étroite, sans jamais couper un mot en
 * plein milieu.
 */
export function truncate(text: string, max = 90): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`;
}

/** `mailto:` pré-rempli — répondre est l'action la plus fréquente. */
export function replyHref(email: string, reason: string): string {
  const subject = `Votre demande — ${reasonLabel(reason)}`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
