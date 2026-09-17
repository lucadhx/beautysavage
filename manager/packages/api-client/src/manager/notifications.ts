// M8/M9 — Client API du centre de notifications (panel Manager/Admin + Dev).
// Le moteur (M8) consomme les NotificationTemplate publiés (M7) : une notification porte une
// catégorie (snapshot icône/couleur), une priorité, un flag persistent et une action MÉTIER.
// La cible (`targetRole` admin|dev) est choisie par le moteur (M3A), JAMAIS par le template.
//
// Scope → endpoint (le BACKEND reste l'autorité de l'isolation admin/dev) :
//   admin → /api/gestion/notifications        (admin + dev y ont accès, audience != dev)
//   dev   → /api/gestion/dev/notifications     (requireStrictDev, audience == dev)
import { apiFetch, apiGet } from '../apiFetch';
import type { NotificationPriority } from './notificationTemplates';

export type { NotificationPriority } from './notificationTemplates';

export type NotificationScope = 'admin' | 'dev';
export type NotificationTargetRole = 'admin' | 'dev';
export type NotificationTargetType = 'all' | 'role' | 'user';

// Provenance « template runtime » (cf. backend Notification.templateRuntimeStatus).
export type NotificationRuntimeStatus =
  | 'template'
  | 'fallback_template_missing'
  | 'legacy_runtime_disabled'
  | null;

// Snapshot SAFE de la catégorie au moment de l'envoi (source des icône/couleur du centre).
export interface NotificationCategorySnapshot {
  name: string | null;
  slug: string | null;
  icon: string | null;
  color: string | null;
}

// Résumé d'une notification (liste). Détail = même forme (pas d'endpoint détail séparé).
export interface NotificationSummary {
  id: string;
  notificationId: string;
  title: string;
  message: string;
  category: string | null;
  targetRole: NotificationTargetRole;
  targetType: NotificationTargetType;
  link: string | null;
  linkLabel: string | null;
  eventType: string | null;
  eventName: string | null;
  contextType: string | null;
  contextId: string | null;
  categoryId: string | null;
  categorySnapshot: NotificationCategorySnapshot | null;
  priority: NotificationPriority;
  persistent: boolean;
  action: string | null;
  templateKey: string | null;
  templateVersion: number | null;
  isRead: boolean;
  createdAt: string | null;
  expiresAt: string | null;
}

export type NotificationDetail = NotificationSummary;

// Conservé pour compat (types-only M8). Alias du résumé runtime.
export type RuntimeNotification = NotificationSummary;

export interface NotificationListResponse {
  ok: boolean;
  notifications: NotificationSummary[];
  unreadCount: number;
}

export interface NotificationFilters {
  unreadOnly?: boolean;
  limit?: number;
}

export interface NotificationStats {
  total: number;
  unread: number;
  byCategory: Record<string, number>;
  byPriority: Record<NotificationPriority, number>;
}

// ─── Action MÉTIER → route panel (jamais une URL stockée) ────────────────────
export type NotificationAction = string;

export interface ResolvedNotificationAction {
  /** Route React cible (ou null si pas de route prête). */
  route: string | null;
  /** false → bouton désactivé « Bientôt disponible » (on n'invente pas de route fragile). */
  available: boolean;
  label: string;
}

// Routes EXISTANTES dans l'app manager (cf. App.tsx). Les actions sans route prête restent
// `available:false` (désactivées) plutôt que de pointer vers une route fragile.
const ACTION_ROUTES: Record<string, { route: string | null; label: string }> = {
  none: { route: null, label: 'Aucune action' },
  booking_details: { route: '/reservations', label: 'Voir la réservation' },
  refund_details: { route: '/remboursements', label: 'Voir le remboursement' },
  commission_details: { route: '/commissions', label: 'Voir les commissions' },
  contract_details: { route: '/dev/contrats', label: 'Voir le contrat' },
  formation_details: { route: '/formations', label: 'Voir la formation' },
  product_details: { route: '/produits', label: 'Voir le produit' },
  service_details: { route: '/prestations', label: 'Voir la prestation' },
  client_details: { route: null, label: 'Voir le client' },
  communication_identity: { route: '/communication', label: 'Communication' },
  theme_studio: { route: '/dev/theme-studio', label: 'Theme Studio' },
  mail_template: { route: '/dev/email-templates', label: 'Mail Template Studio' },
  notification_template: { route: '/dev/notification-templates', label: 'Notification Studio' },
};

/**
 * Mappe une action MÉTIER (jamais une URL) vers une route panel. Une notif peut porter un
 * `link` direct (legacy) ; sinon on résout via l'action. Pas de route prête → `available:false`.
 */
export function resolveNotificationAction(
  action: NotificationAction | null | undefined,
  context?: { link?: string | null; linkLabel?: string | null },
): ResolvedNotificationAction {
  if (context?.link) {
    return { route: context.link, available: true, label: context.linkLabel || 'Ouvrir' };
  }
  const key = String(action || '').trim().toLowerCase();
  if (!key || key === 'none') return { route: null, available: false, label: 'Aucune action' };
  const entry = ACTION_ROUTES[key];
  if (!entry || !entry.route) {
    return { route: null, available: false, label: entry?.label || 'Bientôt disponible' };
  }
  return { route: entry.route, available: true, label: entry.label };
}

function basePath(scope: NotificationScope): string {
  return scope === 'dev' ? '/api/gestion/dev/notifications' : '/api/gestion/notifications';
}

export async function listNotifications(
  scope: NotificationScope,
  filters: NotificationFilters = {},
): Promise<NotificationListResponse> {
  const res = await apiGet<NotificationListResponse>(basePath(scope), {
    limit: filters.limit ?? 50,
    unreadOnly: filters.unreadOnly ? 'true' : undefined,
  });
  return { ok: res.ok, notifications: res.notifications ?? [], unreadCount: res.unreadCount ?? 0 };
}

/**
 * Stats dérivées côté front (pas d'endpoint backend dédié) : total/unread + répartitions.
 */
export async function getNotificationStats(scope: NotificationScope): Promise<NotificationStats> {
  const { notifications, unreadCount } = await listNotifications(scope, { limit: 200 });
  const byCategory: Record<string, number> = {};
  const byPriority: Record<NotificationPriority, number> = { low: 0, normal: 0, high: 0, critical: 0 };
  for (const n of notifications) {
    const cat = n.categorySnapshot?.slug || n.category || 'autre';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byPriority[n.priority] = (byPriority[n.priority] ?? 0) + 1;
  }
  return { total: notifications.length, unread: unreadCount, byCategory, byPriority };
}

export async function markNotificationRead(scope: NotificationScope, id: string): Promise<void> {
  await apiFetch(`${basePath(scope)}/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(scope: NotificationScope): Promise<void> {
  await apiFetch(`${basePath(scope)}/read-all`, { method: 'PATCH' });
}

/** Suppression définitive (scopée audience côté backend). Pas d'endpoint d'archivage. */
export async function deleteNotification(scope: NotificationScope, id: string): Promise<void> {
  await apiFetch(`${basePath(scope)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Couleur d'affichage : la couleur de la catégorie (snapshot) est la SOURCE unique.
 * Renvoie `null` si absente → le composant applique son token `--bs-*`.
 */
export function notificationDisplayColor(n: Pick<NotificationSummary, 'categorySnapshot'>): string | null {
  const color = n.categorySnapshot?.color;
  return color && color.trim() ? color : null;
}

/** Icône d'affichage : icône de la catégorie (snapshot), défaut `bi-bell`. */
export function notificationDisplayIcon(n: Pick<NotificationSummary, 'categorySnapshot'>): string {
  const icon = n.categorySnapshot?.icon;
  return icon && icon.trim() ? icon : 'bi-bell';
}
