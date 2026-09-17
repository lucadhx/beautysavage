import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from '../../App';

const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev' };
const admin: AuthUser = { id: '2', email: 'admin@b.c', role: 'admin' };

const CATS = { ok: true, categories: [{ id: 'c1', name: 'Business', slug: 'business', icon: 'bi-graph-up', color: '#5f4ff7', description: '', sortOrder: 10, active: true, createdAt: null, updatedAt: null }] };
const TEMPLATES = { ok: true, templates: [{ id: 't1', templateKey: 'new_sale', title: 'Vente {{amount}}', body: 'Vente {{saleid}}', categoryId: 'c1', variables: ['amount', 'saleid'], priority: 'high', persistent: true, action: 'commission_details', version: 1, status: 'published', publishedAt: null, archivedAt: null, publishedBy: 'dev', createdFromVersion: null, isSystemDefault: false, updatedAt: null, createdAt: null }] };
const TEMPLATE = { ok: true, template: TEMPLATES.templates[0] };
const VERSIONS = { ok: true, templateKey: 'new_sale', versions: [TEMPLATES.templates[0]] };

function json(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function installFetch(captured?: { calls: { url: string; method: string; body?: string }[] }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url); const method = init?.method || 'GET';
    captured?.calls.push({ url: u, method, body: init?.body ? String(init.body) : undefined });
    if (u.includes('/notification-categories')) {
      if (method === 'POST') return json({ ok: true, category: { id: 'c2', name: 'Paiement', slug: 'paiement', icon: 'bi-bell', color: '', description: '', sortOrder: 0, active: true, createdAt: null, updatedAt: null } });
      return json(CATS);
    }
    if (u.includes('/notification-templates') && u.includes('/draft')) return json({ ok: true, draft: { ...TEMPLATES.templates[0], id: 'd1', version: 2, status: 'draft' } });
    if (u.includes('/notification-templates/drafts/d1/publish')) return json({ ok: true, published: { ...TEMPLATES.templates[0], id: 'd1', version: 2, status: 'published' } });
    if (u.includes('/versions')) return json(VERSIONS);
    if (u.includes('/notification-templates/new_sale')) return json(TEMPLATE);
    if (u.includes('/notification-templates')) return json(TEMPLATES);
    return json({ ok: true });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderApp(path: string, user: AuthUser | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider loader={async () => user}>
        <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}
const TARGETROLE_RE = /targetRole|"scope"\s*:\s*"(admin|dev|both)"/;

describe('Notification Studio (M7)', () => {
  it('dev : liste des templates en cards (priorité/catégorie)', async () => {
    installFetch();
    const { container } = renderApp('/dev/notification-templates', dev);
    await waitFor(() => expect(container.querySelectorAll('.ns-item').length).toBeGreaterThan(0));
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('new_sale');
  });

  it('admin : Notification Studio bloqué (dev-only)', async () => {
    installFetch();
    renderApp('/dev/notification-templates', admin);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('catégories : page CRUD, création POST', async () => {
    const captured = { calls: [] as { url: string; method: string; body?: string }[] };
    installFetch(captured);
    const { container } = renderApp('/dev/notification-categories', dev);
    await waitFor(() => expect(container.querySelector('#ns-cat-name')).toBeTruthy());
    fireEvent.change(container.querySelector('#ns-cat-name') as HTMLInputElement, { target: { value: 'Paiement' } });
    fireEvent.click(screen.getByRole('button', { name: /^Créer$/i }));
    await waitFor(() => expect(captured.calls.some((c) => c.method === 'POST' && c.url.includes('/notification-categories'))).toBe(true));
  });

  it('éditeur : charge, sélecteurs priorité/persistent/action, preview, save→draft (sans targetRole)', async () => {
    const captured = { calls: [] as { url: string; method: string; body?: string }[] };
    installFetch(captured);
    const { container } = renderApp('/dev/notification-templates/new_sale', dev);
    await waitFor(() => expect((container.querySelector('#ns-title') as HTMLInputElement)?.value).toBe('Vente {{amount}}'));
    // sélecteurs présents
    expect(container.querySelector('#ns-priority')).toBeTruthy();
    expect(container.querySelector('#ns-action')).toBeTruthy();
    // preview (toast/centre) rendue
    expect(screen.getAllByText(/Aperçu/i).length).toBeGreaterThan(0);
    // save → draft
    fireEvent.click(screen.getAllByRole('button', { name: /Enregistrer le brouillon/i })[0]);
    await waitFor(() => {
      const post = captured.calls.find((c) => c.method === 'POST' && c.url.includes('/notification-templates/new_sale/draft'));
      expect(post).toBeTruthy();
      expect(TARGETROLE_RE.test(post?.body || '')).toBe(false); // jamais de scope/targetRole
    });
  });

  it('aucun e-mail / aucune vraie notification créée (preview only)', async () => {
    installFetch();
    const { container } = renderApp('/dev/notification-templates/new_sale', dev);
    await waitFor(() => expect(container.querySelector('#ns-title')).toBeTruthy());
    expect(container.innerHTML).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});
