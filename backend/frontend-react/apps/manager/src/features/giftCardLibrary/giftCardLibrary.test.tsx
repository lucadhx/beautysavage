// M13 — Librairie de templates carte cadeau (admin) : liste + badge actif + confirmation → activate.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from '../../App';

const admin: AuthUser = { id: '2', email: 'admin@b.c', role: 'admin' };

const A = { id: 'a', name: 'Modèle A', slug: 'a', html: '', css: '', variables: [], previewData: null, visible: true, active: true, version: 1, status: 'published', isSystemDefault: true, createdBy: '', updatedBy: '' };
const B = { id: 'b', name: 'Modèle B', slug: 'b', html: '', css: '', variables: [], previewData: null, visible: true, active: false, version: 1, status: 'published', isSystemDefault: false, createdBy: '', updatedBy: '' };

function json(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function installFetch(captured?: { calls: { url: string; method: string }[] }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    captured?.calls.push({ url: u, method: init?.method || 'GET' });
    if (u.includes('/activate')) return json({ ok: true, template: { ...B, active: true } });
    if (u.includes('/preview')) return json({ ok: true, html: '<html>card</html>' });
    if (u.includes('/gift-cards/templates')) return json({ ok: true, templates: [A, B] });
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

describe('Gift Card Library (M13)', () => {
  it('admin : liste les modèles avec badge Actif et aucune table', async () => {
    installFetch();
    const { container } = renderApp('/cartes-cadeaux/templates', admin);
    await waitFor(() => expect(screen.getAllByTestId('gcl-card').length).toBe(2));
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByTestId('gcl-active-badge')).toBeInTheDocument();
  });

  it('choisir un template ouvre la confirmation puis appelle activate', async () => {
    const captured = { calls: [] as { url: string; method: string }[] };
    installFetch(captured);
    renderApp('/cartes-cadeaux/templates', admin);
    await waitFor(() => expect(screen.getAllByTestId('gcl-card').length).toBe(2));
    // Le modèle B (non actif) propose "Choisir ce template".
    fireEvent.click(screen.getByTestId('gcl-choose'));
    expect(await screen.findByTestId('gcl-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('gcl-confirm-btn'));
    await waitFor(() => expect(captured.calls.some((c) => c.method === 'POST' && c.url.includes('/templates/b/activate'))).toBe(true));
  });
});
