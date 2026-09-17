import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { App } from '../../App';
import { CommercialeIdentityPage } from './pages';

const admin: AuthUser = { id: '1', email: 'admin@b.c', role: 'admin' };
const dev: AuthUser = { id: '2', email: 'dev@b.c', role: 'dev' };

const STATS = { roleView: 'admin', total: 3, byStatus: { sent: 2 }, byTemplate: {}, byEvent: {}, last24h: 1, failuresLast24h: 0, shadowCount: 0, activeCount: 3 };
const DELIVERIES = [
  { id: 'd1', eventName: 'refund.succeeded', templateKey: 'refund_confirmed', mode: 'active', status: 'sent', fromRole: 'commerciale', toRole: 'client', contextType: 'refund_request', contextId: 'R1', targetAudience: 'admin', attempts: 1, lastErrorCode: null, lastErrorMessageSafe: '', createdAt: '2026-06-20T10:00:00Z', updatedAt: null, sendLogId: null, provider: null, providerMessageId: null, recipientHash: null, senderRole: 'commerciale', recipientRole: 'client' },
];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function installFetch(captured?: { calls: { url: string; method: string; body?: string }[] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      captured?.calls.push({ url: u, method: init?.method || 'GET', body: init?.body ? String(init.body) : undefined });
      if (u.includes('/communication-identities')) return json({ ok: true, identities: [], identity: { id: 'i1', role: 'commerciale', scope: 'institute', email: 'com@beauty.fr', displayName: 'C', status: 'unverified', active: false, dnsRecords: [] } });
      if (u.includes('/mail-deliveries/stats')) return json({ ok: true, stats: STATS });
      if (u.includes('/mail-deliveries')) return json({ ok: true, items: DELIVERIES });
      if (u.includes('/send-logs/stats')) return json({ ok: true, stats: { roleView: 'admin', total: 0, byStatus: {}, byTemplate: {}, last24h: 0, failuresLast24h: 0 } });
      if (u.includes('/send-logs')) return json({ ok: true, items: [] });
      return json({ ok: true });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

function renderApp(path: string, user: AuthUser | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider loader={async () => user}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Communication Center (M4)', () => {
  it('admin : /communication affiche le tableau de bord communication', async () => {
    installFetch();
    renderApp('/communication', admin);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Communication' })).toBeInTheDocument());
    // Aucune identité → message de configuration
    await waitFor(() => expect(screen.getByText(/Aucune identité commerciale/i)).toBeInTheDocument());
  });

  it('admin : /dev/communication est bloqué (redirige hors espace dev)', async () => {
    installFetch();
    renderApp('/dev/communication', admin);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tableau de bord' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Communication (Dev)' })).not.toBeInTheDocument();
  });

  it('dev : /dev/communication affiche le centre dev', async () => {
    installFetch();
    renderApp('/dev/communication', dev);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Communication (Dev)' })).toBeInTheDocument());
  });

  it('admin : journal des mails rend des CARTES (mobile-first), pas de table', async () => {
    installFetch();
    const { container } = renderApp('/communication/mails', admin);
    await waitFor(() => expect(container.querySelectorAll('.cc-item').length).toBeGreaterThan(0));
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('refund.succeeded')).toBeInTheDocument();
  });

  it('formulaire identité commerciale : création → POST /commerciale', async () => {
    const captured = { calls: [] as { url: string; method: string; body?: string }[] };
    installFetch(captured);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CommercialeIdentityPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const email = await screen.findByLabelText(/Adresse e-mail expéditeur/i);
    const name = screen.getByLabelText(/Nom affiché/i);
    fireEvent.change(email, { target: { value: 'commercial@beautysavage.fr' } });
    fireEvent.change(name, { target: { value: 'Beauty Savage Commercial' } });
    fireEvent.click(screen.getByRole('button', { name: /Créer l'identité Commerciale/i }));
    await waitFor(() => {
      const post = captured.calls.find((c) => c.method === 'POST' && c.url.includes('/communication-identities/commerciale'));
      expect(post).toBeTruthy();
      expect(post?.body).toContain('commercial@beautysavage.fr');
    });
  });

  it('ne divulgue aucune adresse e-mail client dans le journal (recipientHash uniquement)', async () => {
    installFetch();
    const { container } = renderApp('/communication/mails', admin);
    await waitFor(() => expect(container.querySelectorAll('.cc-item').length).toBeGreaterThan(0));
    expect(container.innerHTML).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});
