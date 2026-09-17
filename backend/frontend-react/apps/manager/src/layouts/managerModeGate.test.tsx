// RX-BLOCKER — ManagerModeGate : bascule idempotente en mode gestion avant de rendre l'espace. Sans mode
// gestion, les /api/gestion/* redirigent → pages KO. Le gate appelle enter-gestion puis rend le contenu.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@bs/auth';
import type { AuthUser } from '@bs/api-client';
import { ManagerModeGate } from './ManagerModeGate';

const calls: { url: string; method: string }[] = [];
function stubFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, method: init?.method || 'GET' });
    const body = url.includes('/api/mode/enter-gestion')
      ? { ok: true, currentMode: 'gestion' }
      : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

function renderGate(user: AuthUser) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider loader={async () => user}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<ManagerModeGate />}>
              <Route index element={<div>ESPACE GESTION</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ManagerModeGate (RX-BLOCKER)', () => {
  it('currentMode=vitrine → appelle enter-gestion puis rend l\'espace', async () => {
    stubFetch();
    renderGate({ id: '1', email: 'dev@b.c', role: 'dev', currentMode: 'vitrine' });
    await waitFor(() => expect(screen.getByText('ESPACE GESTION')).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/api/mode/enter-gestion') && c.method === 'POST')).toBe(true);
  });

  it('currentMode=gestion → rend sans appeler enter-gestion', async () => {
    stubFetch();
    renderGate({ id: '2', email: 'admin@b.c', role: 'admin', currentMode: 'gestion' });
    await waitFor(() => expect(screen.getByText('ESPACE GESTION')).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/api/mode/enter-gestion'))).toBe(false);
  });
});
