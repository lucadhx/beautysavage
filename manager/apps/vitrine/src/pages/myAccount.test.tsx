// RX4 — Dashboard client (Client Hub) : accueil + agrégat + déconnexion (zéro table, mobile-first).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyAccountPage } from './MyAccountPage';

const authState: { user: unknown; status: string; signOut: ReturnType<typeof vi.fn> } = {
  user: { id: '1', email: 'julie.martin@test.fr', role: 'client' },
  status: 'authenticated',
  signOut: vi.fn(async () => {}),
};

vi.mock('@bs/auth', () => ({
  useAuth: () => ({ ...authState, refresh: async () => {} }),
}));

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      let body: unknown = { ok: true };
      if (url.includes('/bookings')) body = { ok: true, bookings: [] };
      else if (url.includes('/gift-cards')) body = { ok: true, cards: [] };
      else if (url.includes('/sales')) body = { ok: true, sales: [] };
      else if (url.includes('/learning/formations')) body = { ok: true, formations: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mon-compte']}>
        <MyAccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MyAccountPage — dashboard (RX4)', () => {
  beforeEach(() => {
    authState.user = { id: '1', email: 'julie.martin@test.fr', role: 'client' };
    authState.status = 'authenticated';
    authState.signOut = vi.fn(async () => {});
    try { localStorage.clear(); } catch { /* noop */ }
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('authentifié : accueil + email + accès rapide + déconnexion (pas de table)', () => {
    const { container } = renderPage();
    expect(screen.getByText('julie.martin@test.fr')).toBeInTheDocument();
    // Greeting déduit de la partie locale de l'e-mail (audit §0.1).
    expect(screen.getByText(/Bonjour/)).toBeInTheDocument();
    expect(screen.getByText('Déconnexion')).toBeInTheDocument();
    expect(screen.getByText('Formations')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('déconnexion appelle signOut', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Déconnexion'));
    await waitFor(() => expect(authState.signOut).toHaveBeenCalled());
  });

  it('non authentifié : invite à se connecter', () => {
    authState.user = null;
    authState.status = 'unauthenticated';
    renderPage();
    expect(screen.getByText('Se connecter')).toBeInTheDocument();
  });
});
