// M9 — Client API du centre de notifications : scope→endpoint, mark/delete, stats dérivées,
// mapper d'action métier.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  listNotifications,
  getNotificationStats,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  resolveNotificationAction,
  type NotificationSummary,
} from './notifications';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

const SAMPLE: NotificationSummary[] = [
  { id: 'a', notificationId: 'N1', title: 'Vente', message: 'm', category: 'ventes', targetRole: 'admin', targetType: 'all', link: null, linkLabel: null, eventType: 'new_sale', eventName: 'sale.finalized', contextType: 'sale', contextId: 'S1', categoryId: 'c1', categorySnapshot: { name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#abc' }, priority: 'high', persistent: true, action: 'refund_details', templateKey: 'new_sale', templateVersion: 1, isRead: false, createdAt: null, expiresAt: null },
  { id: 'b', notificationId: 'N2', title: 'Erreur', message: 'm', category: 'système', targetRole: 'admin', targetType: 'all', link: null, linkLabel: null, eventType: 'system_error', eventName: null, contextType: null, contextId: null, categoryId: null, categorySnapshot: null, priority: 'normal', persistent: false, action: null, templateKey: null, templateVersion: null, isRead: true, createdAt: null, expiresAt: null },
];

const calls: { url: string; method: string }[] = [];
function installFetch(unreadCount = 1) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    return json({ ok: true, notifications: SAMPLE, unreadCount });
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe('notifications api-client (M9)', () => {
  it('admin scope appelle /api/gestion/notifications', async () => {
    installFetch(2);
    const res = await listNotifications('admin');
    expect(res.unreadCount).toBe(2);
    expect(calls[0].url).toContain('/api/gestion/notifications');
    expect(calls[0].url).not.toContain('/dev/');
  });

  it('dev scope appelle /api/gestion/dev/notifications', async () => {
    installFetch();
    await listNotifications('dev');
    expect(calls[0].url).toContain('/api/gestion/dev/notifications');
  });

  it('markRead / markAllRead / delete utilisent PATCH/DELETE sur le bon scope', async () => {
    installFetch();
    await markNotificationRead('admin', 'a');
    await markAllNotificationsRead('dev');
    await deleteNotification('admin', 'a');
    expect(calls[0]).toMatchObject({ method: 'PATCH' });
    expect(calls[0].url).toContain('/api/gestion/notifications/a/read');
    expect(calls[1]).toMatchObject({ method: 'PATCH' });
    expect(calls[1].url).toContain('/api/gestion/dev/notifications/read-all');
    expect(calls[2]).toMatchObject({ method: 'DELETE' });
    expect(calls[2].url).toContain('/api/gestion/notifications/a');
  });

  it('getNotificationStats dérive total/unread/byCategory/byPriority', async () => {
    installFetch(1);
    const stats = await getNotificationStats('admin');
    expect(stats.total).toBe(2);
    expect(stats.unread).toBe(1);
    expect(stats.byCategory.ventes).toBe(1);
    expect(stats.byPriority.high).toBe(1);
    expect(stats.byPriority.normal).toBe(1);
  });

  it('resolveNotificationAction mappe action métier → route, ou disabled', () => {
    expect(resolveNotificationAction('refund_details')).toMatchObject({ route: '/remboursements', available: true });
    expect(resolveNotificationAction('none')).toMatchObject({ route: null, available: false });
    expect(resolveNotificationAction('client_details')).toMatchObject({ available: false }); // pas de route prête
    expect(resolveNotificationAction(null, { link: '/x', linkLabel: 'L' })).toMatchObject({ route: '/x', available: true });
  });
});
