// C2 — Présence (manager) : rendu participants + marquage (zéro table).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionPresencePage } from './SessionPresencePage';

const calls: { url: string; method: string }[] = [];
function installFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    const u = String(url);
    if (u.includes('/attendance') && init?.method === 'POST') {
      return new Response(JSON.stringify({ ok: true, status: 'present', userId: 'u1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, participants: [{ userId: 'u1', name: 'Camille M.', status: 'pending', method: null, checkedInAt: null }], summary: { total: 1, present: 0, remaining: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  installFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/catalogue/formations/f1/sessions/s1/presence']}>
        <Routes>
          <Route path="/catalogue/formations/:id/sessions/:sessionId/presence" element={<SessionPresencePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SessionPresencePage', () => {
  it('liste les participants et permet de marquer présent', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Camille M.')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
    fireEvent.click(screen.getByText('Présent'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/attendance') && c.method === 'POST')).toBe(true));
  });
});
