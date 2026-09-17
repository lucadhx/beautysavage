// M9 — Notification Center : badge, scopes admin/dev, drawer + cartes, badges catégorie/
// priorité/persistent, mark-read, bandeau "+X" + shake, pas de table.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationScope, NotificationSummary } from '@bs/api-client';
import { NotificationBell } from './NotificationBell';
import { NotificationMotionProvider } from './components';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

const CARDS: NotificationSummary[] = [
  { id: 'a', notificationId: 'N1', title: 'Nouvelle vente', message: 'Montant 120', category: 'ventes', targetRole: 'admin', targetType: 'all', link: null, linkLabel: null, eventType: 'new_sale', eventName: 'sale.finalized', contextType: 'sale', contextId: 'S1', categoryId: 'c1', categorySnapshot: { name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: 'rgb(10, 20, 30)' }, priority: 'high', persistent: true, action: 'refund_details', templateKey: 'new_sale', templateVersion: 1, isRead: false, createdAt: '2026-06-20T10:00:00Z', expiresAt: null },
  { id: 'b', notificationId: 'N2', title: 'Erreur système', message: 'détail', category: 'système', targetRole: 'admin', targetType: 'all', link: null, linkLabel: null, eventType: 'system_error', eventName: null, contextType: null, contextId: null, categoryId: null, categorySnapshot: null, priority: 'normal', persistent: false, action: null, templateKey: null, templateVersion: null, isRead: true, createdAt: '2026-06-20T09:00:00Z', expiresAt: null },
];

const calls: { url: string; method: string }[] = [];
function installFetch(opts: { notifications?: NotificationSummary[]; unreadCount?: number } = {}) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    return json({ ok: true, notifications: opts.notifications ?? CARDS, unreadCount: opts.unreadCount ?? 1 });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderBell(scope: NotificationScope, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationMotionProvider>
          <NotificationBell scope={scope} />
        </NotificationMotionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe('Notification Center (M9)', () => {
  it('affiche le badge du nombre de non-lus', async () => {
    installFetch({ unreadCount: 3 });
    renderBell('admin');
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('scope admin appelle l’endpoint admin', async () => {
    installFetch();
    renderBell('admin');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].url).toContain('/api/gestion/notifications');
    expect(calls[0].url).not.toContain('/dev/');
  });

  it('scope dev appelle l’endpoint dev', async () => {
    installFetch();
    renderBell('dev');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].url).toContain('/api/gestion/dev/notifications');
  });

  it('ouvre le drawer et rend les cartes (pas de table)', async () => {
    installFetch();
    renderBell('admin');
    await waitFor(() => expect(screen.getByTestId('nc-bell')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('nc-bell'));
    await waitFor(() => expect(screen.getByTestId('nc-drawer')).toBeInTheDocument());
    expect(screen.getByText('Nouvelle vente')).toBeInTheDocument();
    expect(screen.getAllByTestId('nc-card').length).toBe(2);
    expect(document.querySelector('table')).toBeNull(); // mobile-first : pas de table
  });

  it('utilise la couleur et l’icône du snapshot de catégorie', async () => {
    installFetch();
    renderBell('admin');
    fireEvent.click(await screen.findByTestId('nc-bell'));
    await waitFor(() => expect(screen.getByText('Nouvelle vente')).toBeInTheDocument());
    const card = screen.getAllByTestId('nc-card')[0];
    expect(card.getAttribute('style')).toContain('rgb(10, 20, 30)');
    expect(card.querySelector('.bi-cash')).not.toBeNull();
  });

  it('affiche les badges priorité (high) et persistant', async () => {
    installFetch();
    renderBell('admin');
    fireEvent.click(await screen.findByTestId('nc-bell'));
    await waitFor(() => expect(screen.getByTestId('nc-priority-badge')).toBeInTheDocument());
    expect(screen.getByTestId('nc-persistent-badge')).toBeInTheDocument();
  });

  it('marquer lue appelle l’API (PATCH .../read)', async () => {
    installFetch();
    renderBell('admin');
    fireEvent.click(await screen.findByTestId('nc-bell'));
    const btn = await screen.findByText('Marquer lue');
    fireEvent.click(btn);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/a/read'))).toBe(true));
  });

  it('état vide quand aucune notification', async () => {
    installFetch({ notifications: [], unreadCount: 0 });
    renderBell('admin');
    fireEvent.click(await screen.findByTestId('nc-bell'));
    await waitFor(() => expect(screen.getByText('Aucune notification')).toBeInTheDocument());
  });

  it('bandeau "+X notifications" + shake quand les non-lus augmentent', async () => {
    installFetch({ unreadCount: 2 });
    const { qc } = renderBell('admin');
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    act(() => {
      qc.setQueryData(['notifications', 'admin'], { ok: true, notifications: CARDS, unreadCount: 5 });
    });
    await waitFor(() => expect(screen.getByTestId('nc-pulse-banner')).toHaveTextContent('+3 notifications'));
    expect(screen.getByTestId('nc-bell').className).toContain('nc-bell--shake');
  });
});
