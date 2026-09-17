// RX4 S2 — Mon profil : préremplissage depuis GET /api/client/profile + enregistrement (PUT).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyProfilePage } from './MyProfilePage';

vi.mock('@bs/auth', () => ({
  useAuth: () => ({ user: { id: '1', email: 'julie@test.fr', role: 'client' }, status: 'authenticated', refresh: async () => {}, signOut: async () => {} }),
}));

const calls: { url: string; method: string }[] = [];
function stubFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, method: init?.method || 'GET' });
    let body: unknown = { ok: true };
    if (url.includes('/api/client/profile') && (init?.method || 'GET') === 'GET') {
      body = { ok: true, user: { firstName: 'Julie', lastName: 'Martin', email: 'julie@test.fr' } };
    } else if (url.includes('/api/client/profile')) {
      body = { ok: true, user: { firstName: 'Juliette', lastName: 'Martin', email: 'julie@test.fr' } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mon-compte/profil']}>
        <MyProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('MyProfilePage (RX4 S2)', () => {
  it('préremplit depuis GET /api/client/profile', async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByDisplayValue('Julie')).toBeInTheDocument();
    expect(screen.getByDisplayValue('julie@test.fr')).toBeInTheDocument();
  });

  it('enregistre via PUT', async () => {
    stubFetch();
    renderPage();
    await screen.findByDisplayValue('Julie');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/client/profile') && c.method === 'PUT')).toBe(true));
    expect(await screen.findByText(/Enregistré/)).toBeInTheDocument();
  });
});
