// RX2.2 - Financial Timeline React: sticky summary, period/type chips, cards, drawer, no table.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceTimelinePage } from './index';

const ITEMS = [
  {
    id: 'sale:S1', type: 'sale', direction: 'in', amount: 80, currency: 'EUR',
    title: 'Paiement reçu', subtitle: 'Prestation · Jane', status: 'paid',
    occurredAt: '2026-06-30T10:00:00Z', customer: { id: 'c1', name: 'Jane' },
    source: { model: 'Sale', id: 'S1' },
    badges: [{ label: 'Stripe', tone: 'success' }],
    actions: [
      { kind: 'customer_view', enabled: true, to: '/clients/c1' },
      { kind: 'invoice_view', enabled: false, url: null },
    ],
  },
  {
    id: 'refund:R1', type: 'refund', direction: 'out', amount: 30, currency: 'EUR',
    title: 'Remboursement en attente', subtitle: 'service · Jane', status: 'pending',
    occurredAt: '2026-06-29T10:00:00Z', customer: { id: 'c1', name: 'Jane' },
    source: { model: 'RefundRequest', id: 'R1' },
    badges: [{ label: 'En attente', tone: 'warning' }],
    actions: [{ kind: 'refund_process', enabled: true, to: '/remboursements' }],
  },
];

const PAYLOAD = {
  ok: true, period: 'month', type: 'all', status: null,
  summary: { netAmount: 50, grossIn: 80, grossOut: 30, count: 2, refundCount: 1, balanceDueAmount: 0 },
  items: ITEMS,
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

function renderPage(path = '/finance/timeline') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/finance/timeline" element={<FinanceTimelinePage />} />
          <Route path="/clients/:id" element={<div>Fiche client</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Financial Timeline (RX2.2)', () => {
  it('renders summary, filter chips and cards without any table', async () => {
    installFetch(PAYLOAD);
    const { container } = renderPage();
    expect(await screen.findByTestId('fin-tl-summary')).toBeInTheDocument();
    expect(screen.getByTestId('fin-tl-periods')).toBeInTheDocument();
    expect(screen.getByTestId('fin-tl-types')).toBeInTheDocument();
    expect(screen.getAllByTestId('fin-tl-card').length).toBe(2);
    expect(screen.getByText('Paiement reçu')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
    expect(calls[0]).toContain('/api/gestion/finance/timeline');
  });

  it('reads the initial type filter from the URL', async () => {
    installFetch(PAYLOAD);
    renderPage('/finance/timeline?type=sale');
    await screen.findByTestId('fin-tl-summary');
    expect(calls.some((url) => url.includes('type=sale'))).toBe(true);
  });

  it('opens the drawer and shows amount plus actions', async () => {
    installFetch(PAYLOAD);
    renderPage();
    fireEvent.click(await screen.findByText('Paiement reçu'));
    const drawer = await screen.findByTestId('fin-tl-drawer');
    expect(within(drawer).getByText('+80,00 €')).toBeInTheDocument();
    expect(within(drawer).getByText('Voir la facture')).toBeDisabled();
    expect(within(drawer).getByText('Voir le client')).toBeInTheDocument();
  });

  it('changing the period refetches with the right query param', async () => {
    installFetch(PAYLOAD);
    renderPage();
    await screen.findByTestId('fin-tl-summary');
    fireEvent.click(screen.getByRole('tab', { name: "Aujourd'hui" }));
    await waitFor(() => expect(calls.some((url) => url.includes('period=today'))).toBe(true));
  });

  it('changing the type refetches with the right query param', async () => {
    installFetch(PAYLOAD);
    renderPage();
    await screen.findByTestId('fin-tl-summary');
    fireEvent.click(screen.getByRole('tab', { name: /Remboursements/ }));
    await waitFor(() => expect(calls.some((url) => url.includes('type=refund'))).toBe(true));
  });

  it('shows the empty state', async () => {
    installFetch({ ...PAYLOAD, items: [], summary: { netAmount: 0, grossIn: 0, grossOut: 0, count: 0, refundCount: 0, balanceDueAmount: 0 } });
    renderPage();
    expect(await screen.findByTestId('fin-tl-empty')).toBeInTheDocument();
  });

  it('shows a recoverable error state', async () => {
    installFetch({ ok: false }, 500);
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
