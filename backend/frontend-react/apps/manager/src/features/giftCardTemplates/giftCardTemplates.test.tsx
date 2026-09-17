// M13 — Gift Card Template Studio (dev-only) : liste, éditeur + preview live (iframe), gating admin.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from '../../App';

const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev' };
const admin: AuthUser = { id: '2', email: 'admin@b.c', role: 'admin' };

const TPL = { id: 't1', name: 'Default', slug: 'default', html: '<p>{{code}}</p>', css: '', variables: ['code'], previewData: null, visible: true, active: true, version: 1, status: 'published', isSystemDefault: true, createdBy: '', updatedBy: '' };
const LIST = { ok: true, templates: [TPL], variables: ['recipientName', 'amount', 'code'] };
const VERSIONS = { ok: true, versions: [TPL] };

function json(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function installFetch(captured?: { calls: { url: string; method: string }[] }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    captured?.calls.push({ url: u, method: init?.method || 'GET' });
    if (u.includes('/gift-card-templates/preview')) return json({ ok: true, html: '<html>PREVIEW</html>' });
    if (u.includes('/versions')) return json(VERSIONS);
    if (u.match(/\/gift-card-templates\/[^/]+$/) && !u.endsWith('/gift-card-templates')) return json({ ok: true, template: TPL });
    if (u.includes('/gift-card-templates')) return json(LIST);
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

describe('Gift Card Template Studio (M13)', () => {
  it('dev : liste les templates en cards', async () => {
    installFetch();
    const { container } = renderApp('/dev/gift-card-templates', dev);
    await waitFor(() => expect(container.querySelectorAll('.gct-item').length).toBeGreaterThan(0));
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('Default');
  });

  it('admin : Studio bloqué (dev-only)', async () => {
    installFetch();
    renderApp('/dev/gift-card-templates', admin);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Templates carte cadeau' })).not.toBeInTheDocument();
  });

  it('éditeur : appelle /preview et affiche l’iframe d’aperçu', async () => {
    const captured = { calls: [] as { url: string; method: string }[] };
    installFetch(captured);
    renderApp('/dev/gift-card-templates/default', dev);
    await waitFor(() => expect(screen.getByTestId('gct-preview-frame')).toBeInTheDocument());
    await waitFor(() => expect(captured.calls.some((c) => c.method === 'POST' && c.url.includes('/gift-card-templates/preview'))).toBe(true));
    const frame = screen.getByTestId('gct-preview-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('srcdoc') || '').toContain('PREVIEW'));
    expect(frame.getAttribute('sandbox')).toBe('');
  });
});
