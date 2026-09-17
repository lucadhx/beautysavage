// RX2.1 — Finance Dashboard React : héros revenu, ventilation chips, cartes d'action, période, erreur.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceDashboardPage } from './index';

const DASH = {
  ok: true,
  range: 'today',
  rangeLabel: "Aujourd'hui",
  periodStart: '2026-06-30T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  generatedAt: '2026-06-30T12:00:00.000Z',
  today: {
    salesCount: 32,
    revenue: 2480,
    breakdown: { prestations: 5, formations: 2, giftCards: 1, products: 0 },
    giftCardConsumption: 60,
  },
  actions: {
    balancesToCollect: { count: 3, total: 240 },
    refundsToProcess: { count: 2, total: 80 },
    unpaidInvoices: { count: 1, total: 120 },
  },
};

const calls: string[] = [];
function installFetch(payload: unknown, status = 200) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/finance']}>
        <Routes>
          <Route path="/finance" element={<FinanceDashboardPage />} />
          <Route path="/planning" element={<div>Planning</div>} />
          <Route path="/finance/timeline" element={<div>Page timeline finance</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Finance Dashboard (RX2.1)', () => {
  it('affiche le revenu signé, le nombre de ventes et la ventilation', async () => {
    installFetch(DASH);
    renderPage();
    expect(await screen.findByText('+2480,00 €')).toBeInTheDocument();
    expect(screen.getByText('32 ventes')).toBeInTheDocument();
    expect(screen.getByText('prestations')).toBeInTheDocument();
    expect(screen.getByText('formations')).toBeInTheDocument();
    // produits = 0 → chip absent
    expect(screen.queryByText('produits')).not.toBeInTheDocument();
    expect(calls[0]).toContain('/api/gestion/finance/dashboard');
    expect(calls[0]).toContain('range=today');
  });

  it('affiche les cartes d\'action avec compte et total', async () => {
    installFetch(DASH);
    renderPage();
    expect(await screen.findByText('3 soldes')).toBeInTheDocument();
    expect(screen.getByText('2 remboursements')).toBeInTheDocument();
    expect(screen.getByText('1 facture')).toBeInTheDocument();
  });

  it('navigue vers la timeline refund au clic sur la carte remboursements', async () => {
    installFetch(DASH);
    renderPage();
    const card = await screen.findByText('2 remboursements');
    fireEvent.click(card);
    expect(await screen.findByText('Page timeline finance')).toBeInTheDocument();
  });

  it('changer de période refetch avec le bon range', async () => {
    installFetch(DASH);
    renderPage();
    await screen.findByText('+2480,00 €');
    fireEvent.click(screen.getByRole('tab', { name: '7 jours' }));
    await waitFor(() => expect(calls.some((u) => u.includes('range=7d'))).toBe(true));
  });

  it('affiche un état d\'erreur récupérable', async () => {
    installFetch({ ok: false, error: 'boom' }, 500);
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
