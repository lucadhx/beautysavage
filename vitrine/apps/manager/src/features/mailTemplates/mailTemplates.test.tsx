import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from '../../App';

const dev: AuthUser = { id: '1', email: 'dev@b.c', role: 'dev' };
const admin: AuthUser = { id: '2', email: 'admin@b.c', role: 'admin' };

const GROUPS = { ok: true, groups: [{ templates: [
  { functionName: 'vente', recipient: 'client', isMetadataOnly: false, updatedAt: null, categoryId: null },
  { functionName: 'refund_confirmed', recipient: 'client', isMetadataOnly: false, updatedAt: null, categoryId: null },
] }] };
const TEMPLATE = { ok: true, template: { functionName: 'refund_confirmed', subject: 'Bonjour {{firstname}}', bodyHtml: 'Bonjour', fullHtml: '<p>{{servicename}} {{weirdvar}}</p>', mode: 'html', updatedAt: null } };
const VERSIONS = { ok: true, functionName: 'refund_confirmed', versions: [{ functionName: 'refund_confirmed', version: 1, status: 'published', publishedAt: '2026-06-01T10:00:00Z', archivedAt: null, publishedBy: 'dev', createdFromVersion: null, isSystemDefault: false, subject: 'Bonjour', mode: 'html', updatedAt: null, createdAt: null, _id: 'v1' }] };

function json(p: unknown, s = 200) { return new Response(JSON.stringify(p), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function installFetch(captured?: { calls: { url: string; method: string }[] }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    captured?.calls.push({ url: u, method: init?.method || 'GET' });
    if (u.includes('/mails/templates') && u.includes('/draft')) return json({ ok: true, draft: { _id: 'd1', functionName: 'refund_confirmed', version: 2, status: 'draft' } });
    if (u.includes('/mails/drafts/d1/publish')) return json({ ok: true, published: { _id: 'd1', functionName: 'refund_confirmed', version: 2, status: 'published' } });
    if (u.includes('/versions')) return json(VERSIONS);
    if (u.includes('/mails/template?') || u.includes('/mails/template&') || (u.includes('/mails/template') && u.includes('functionName'))) return json(TEMPLATE);
    if (u.includes('/mails/templates')) return json(GROUPS);
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
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe('Mail Template Studio (M6)', () => {
  it('dev : liste en cards avec rôles from/to (sans e-mail)', async () => {
    installFetch();
    const { container } = renderApp('/dev/email-templates', dev);
    await waitFor(() => expect(container.querySelectorAll('.mt-item').length).toBeGreaterThan(0));
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('commerciale → client');
    expect(EMAIL_RE.test(container.innerHTML)).toBe(false);
  });

  it('admin : Template Studio bloqué (dev-only)', async () => {
    installFetch();
    renderApp('/dev/email-templates', admin);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Templates e-mail' })).not.toBeInTheDocument();
  });

  it('éditeur : charge le template + warning variable inconnue + preview device toggle', async () => {
    installFetch();
    const { container } = renderApp('/dev/email-templates/refund_confirmed', dev);
    await waitFor(() => expect((container.querySelector('#mt-subject') as HTMLInputElement)?.value).toBe('Bonjour {{firstname}}'));
    // variable inconnue détectée (weirdvar)
    await waitFor(() => expect(screen.getByText(/Variables inconnues/i)).toBeInTheDocument());
    // role binding sans e-mail
    expect(container.textContent).toContain('refund.succeeded');
    expect(EMAIL_RE.test(container.innerHTML)).toBe(false);
    // device toggle
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(container.querySelector('.mt-preview__frame--mobile')).toBeNull();
  });

  it('éditeur : enregistrer crée un draft (POST), publier appelle l’API', async () => {
    const captured = { calls: [] as { url: string; method: string }[] };
    installFetch(captured);
    const { container } = renderApp('/dev/email-templates/refund_confirmed', dev);
    await waitFor(() => expect((container.querySelector('#mt-subject') as HTMLInputElement)?.value).toBe('Bonjour {{firstname}}'));
    fireEvent.click(screen.getAllByRole('button', { name: /Enregistrer le brouillon/i })[0]);
    await waitFor(() => expect(captured.calls.some((c) => c.method === 'POST' && c.url.includes('/mails/templates/refund_confirmed/draft'))).toBe(true));
    // après save, le bouton publier apparaît
    await waitFor(() => expect(screen.getByRole('button', { name: /Publier le brouillon/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Publier le brouillon/i }));
    await waitFor(() => expect(captured.calls.some((c) => c.method === 'POST' && c.url.includes('/mails/drafts/d1/publish'))).toBe(true));
  });

  it('page versions : liste + rollback appelle l’API', async () => {
    const captured = { calls: [] as { url: string; method: string }[] };
    installFetch(captured);
    const { container } = renderApp('/dev/email-templates/refund_confirmed/versions', dev);
    await waitFor(() => expect(container.querySelectorAll('.mt-item').length).toBeGreaterThan(0));
    expect(screen.getByText(/Versions — refund_confirmed/i)).toBeInTheDocument();
  });
});
