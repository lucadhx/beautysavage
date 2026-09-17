// M9 — Cloche de notifications (orchestrateur). Scope admin|dev (le backend reste l'autorité).
// Badge non-lus + shake quand les non-lus augmentent + bandeau "+X" + drawer responsive.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MotionTokens } from '@bs/ui';
import type { NotificationScope } from '@bs/api-client';
import {
  NotificationBadge,
  NotificationFilterBar,
  NotificationList,
  useNotificationMotion,
  type NotificationFilterValue,
} from './components';
import { NotificationDrawer, NotificationPulseBanner } from './NotificationDrawer';
import { useNotifications, PULSE_VISIBLE_MS, pulseBannerText } from './useNotifications';
import './notificationCenter.css';

export function NotificationBell({ scope }: { scope: NotificationScope }) {
  const navigate = useNavigate();
  const { reducedMotion } = useNotificationMotion();
  const {
    notifications,
    unreadCount,
    isLoading,
    pulseDelta,
    pulseTick,
    markRead,
    markAllRead,
    remove,
  } = useNotifications(scope);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilterValue>('all');
  const [shaking, setShaking] = useState(false);
  const [bannerText, setBannerText] = useState<string | null>(null);
  const firstTick = useRef(true);

  // Shake + bandeau uniquement quand les non-lus augmentent (pulseTick change), jamais à chaque render.
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false;
      return;
    }
    if (pulseTick === 0) return;
    const text = pulseBannerText(pulseDelta);
    if (text) setBannerText(text);
    if (!reducedMotion) {
      setShaking(true);
      const t1 = setTimeout(() => setShaking(false), MotionTokens.slowMs + 60);
      const t2 = setTimeout(() => setBannerText(null), PULSE_VISIBLE_MS);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    const t = setTimeout(() => setBannerText(null), PULSE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [pulseTick, pulseDelta, reducedMotion]);

  const visible = filter === 'unread' ? notifications.filter((n) => !n.isRead) : notifications;

  const onNavigate = (route: string) => {
    setOpen(false);
    navigate(route);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={`nc-bell${shaking ? ' nc-bell--shake' : ''}`}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} non lues` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="nc-bell"
      >
        <i className="bi-bell" aria-hidden="true" />
        <NotificationBadge count={unreadCount} />
      </button>

      <NotificationPulseBanner text={bannerText} />

      <NotificationDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        headerActions={
          unreadCount > 0 ? (
            <button type="button" className="nc-linkbtn" onClick={() => markAllRead()}>
              Tout marquer lu
            </button>
          ) : null
        }
      >
        <NotificationFilterBar value={filter} onChange={setFilter} unreadCount={unreadCount} />
        {isLoading ? (
          <div aria-hidden="true">
            <div className="nc-skeleton" />
            <div className="nc-skeleton" />
            <div className="nc-skeleton" />
          </div>
        ) : (
          <NotificationList
            notifications={visible}
            onMarkRead={markRead}
            onDelete={remove}
            onNavigate={onNavigate}
          />
        )}
      </NotificationDrawer>
    </div>
  );
}
