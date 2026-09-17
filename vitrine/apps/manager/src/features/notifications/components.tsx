// M9 — Composants présentiels du centre de notifications (mobile-first, animés, accessibles).
// Aucune couleur hex en dur : les couleurs de catégorie viennent du snapshot (DONNÉE inline).
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from '@bs/ui';
import {
  resolveNotificationAction,
  notificationDisplayColor,
  notificationDisplayIcon,
  type NotificationSummary,
  type NotificationPriority,
  type NotificationCategorySnapshot,
} from '@bs/api-client';

// ── Motion provider ───────────────────────────────────────────────────────────
interface MotionContextValue { reducedMotion: boolean }
const MotionContext = createContext<MotionContextValue>({ reducedMotion: false });

export function NotificationMotionProvider({ children }: { children: ReactNode }) {
  const value = useMemo<MotionContextValue>(() => ({ reducedMotion: prefersReducedMotion() }), []);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}
export function useNotificationMotion(): MotionContextValue {
  return useContext(MotionContext);
}

// ── Badge (compteur) ──────────────────────────────────────────────────────────
export function NotificationBadge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span className="nc-badge" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ── Chip catégorie (couleur = snapshot, inline) ───────────────────────────────
export function NotificationCategoryChip({
  snapshot,
  fallback,
}: {
  snapshot: NotificationCategorySnapshot | null;
  fallback?: string | null;
}) {
  const label = snapshot?.name || fallback || 'Général';
  const color = snapshot?.color && snapshot.color.trim() ? snapshot.color : null;
  const icon = snapshot?.icon && snapshot.icon.trim() ? snapshot.icon : null;
  const style = color ? { borderColor: color, color } : undefined;
  return (
    <span className="nc-chip" style={style} data-testid="nc-category-chip">
      {icon ? <i className={icon} aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

// ── Badge priorité ────────────────────────────────────────────────────────────
const PRIORITY_LABEL: Record<NotificationPriority, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
  critical: 'Critique',
};
export function NotificationPriorityBadge({ priority }: { priority: NotificationPriority }) {
  // On n'affiche le badge que pour high/critical (réduit le bruit ; normal/low = implicite).
  if (priority !== 'high' && priority !== 'critical') return null;
  return (
    <span className={`nc-prio nc-prio--${priority}`} data-testid="nc-priority-badge">
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

// ── Badge persistent ──────────────────────────────────────────────────────────
export function NotificationPersistentBadge({ persistent }: { persistent: boolean }) {
  if (!persistent) return null;
  return (
    <span className="nc-persistent" data-testid="nc-persistent-badge" title="À traiter (persistante)">
      <i className="bi-pin-angle" aria-hidden="true" /> Persistante
    </span>
  );
}

// ── Bouton d'action métier ────────────────────────────────────────────────────
export function NotificationActionButton({
  action,
  link,
  linkLabel,
  onNavigate,
}: {
  action: string | null;
  link: string | null;
  linkLabel: string | null;
  onNavigate: (route: string) => void;
}) {
  const resolved = resolveNotificationAction(action, { link, linkLabel });
  if (!resolved.label || (!resolved.available && (!action || action === 'none'))) return null;
  return (
    <button
      type="button"
      className="nc-actionbtn"
      disabled={!resolved.available}
      title={resolved.available ? resolved.label : 'Bientôt disponible'}
      onClick={() => resolved.route && onNavigate(resolved.route)}
    >
      <i className="bi-box-arrow-up-right" aria-hidden="true" />
      {resolved.available ? resolved.label : 'Bientôt disponible'}
    </button>
  );
}

// ── État vide ─────────────────────────────────────────────────────────────────
export function NotificationEmptyState({ label = 'Aucune notification' }: { label?: string }) {
  return (
    <div className="nc-empty" role="status">
      <div className="nc-empty__icon" aria-hidden="true"><i className="bi-bell-slash" /></div>
      <p>{label}</p>
    </div>
  );
}

// ── Panneau de détail (replié dans la carte) ──────────────────────────────────
export function NotificationDetailPanel({ notification }: { notification: NotificationSummary }) {
  const rows = ([
    ['Événement', notification.eventName || notification.eventType],
    ['Contexte', notification.contextType ? `${notification.contextType}${notification.contextId ? ` · ${notification.contextId}` : ''}` : null],
    ['Modèle', notification.templateKey ? `${notification.templateKey}${notification.templateVersion ? ` v${notification.templateVersion}` : ''}` : null],
  ] as Array<[string, string | null]>).filter(([, v]) => Boolean(v));
  if (!rows.length) return null;
  return (
    <dl className="nc-card__meta" data-testid="nc-detail-panel" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
      {rows.map(([k, v]) => (
        <div key={k}><strong>{k} :</strong> {v}</div>
      ))}
    </dl>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── Carte ─────────────────────────────────────────────────────────────────────
export function NotificationCard({
  notification,
  onMarkRead,
  onDelete,
  onNavigate,
}: {
  notification: NotificationSummary;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (route: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = notificationDisplayColor(notification);
  const icon = notificationDisplayIcon(notification);
  return (
    <article
      className={`nc-card${notification.isRead ? '' : ' nc-card--unread'}`}
      style={color ? { borderLeftColor: color } : undefined}
      data-testid="nc-card"
    >
      <span className="nc-card__icon" style={color ? { color } : undefined} aria-hidden="true">
        <i className={icon} />
      </span>
      <div className="nc-card__main">
        <div className="nc-card__title">
          {notification.isRead ? null : <span className="nc-dot" aria-label="non lue" />}
          {notification.title}
          <NotificationPriorityBadge priority={notification.priority} />
          <NotificationPersistentBadge persistent={notification.persistent} />
        </div>
        <p className="nc-card__msg">{notification.message}</p>
        <div className="nc-card__meta">
          <NotificationCategoryChip snapshot={notification.categorySnapshot} fallback={notification.category} />
          <span>{formatTime(notification.createdAt)}</span>
        </div>
        {expanded ? <NotificationDetailPanel notification={notification} /> : null}
        <div className="nc-card__actions">
          <NotificationActionButton
            action={notification.action}
            link={notification.link}
            linkLabel={notification.linkLabel}
            onNavigate={onNavigate}
          />
          {notification.isRead ? null : (
            <button type="button" className="nc-linkbtn" onClick={() => onMarkRead(notification.id)}>
              Marquer lue
            </button>
          )}
          <button type="button" className="nc-linkbtn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Réduire' : 'Détails'}
          </button>
          <button type="button" className="nc-linkbtn" onClick={() => onDelete(notification.id)}>
            Supprimer
          </button>
        </div>
      </div>
    </article>
  );
}

// ── Barre de filtres ──────────────────────────────────────────────────────────
export type NotificationFilterValue = 'all' | 'unread';
export function NotificationFilterBar({
  value,
  onChange,
  unreadCount,
}: {
  value: NotificationFilterValue;
  onChange: (v: NotificationFilterValue) => void;
  unreadCount: number;
}) {
  return (
    <div className="nc-filterbar" role="tablist" aria-label="Filtres de notifications">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'all'}
        className={`nc-filter${value === 'all' ? ' nc-filter--active' : ''}`}
        onClick={() => onChange('all')}
      >
        Toutes
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'unread'}
        className={`nc-filter${value === 'unread' ? ' nc-filter--active' : ''}`}
        onClick={() => onChange('unread')}
      >
        Non lues{unreadCount > 0 ? ` (${unreadCount})` : ''}
      </button>
    </div>
  );
}

// ── Liste ─────────────────────────────────────────────────────────────────────
export function NotificationList({
  notifications,
  onMarkRead,
  onDelete,
  onNavigate,
}: {
  notifications: NotificationSummary[];
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (route: string) => void;
}) {
  if (!notifications.length) return <NotificationEmptyState />;
  return (
    <div className="nc-list">
      {notifications.map((n) => (
        <NotificationCard
          key={n.id}
          notification={n}
          onMarkRead={onMarkRead}
          onDelete={onDelete}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
