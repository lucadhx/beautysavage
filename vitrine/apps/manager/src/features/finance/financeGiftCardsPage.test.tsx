// RX2.6 — Gift Card Finance liste : summary, cards, filtres, code masqué, pas de table.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceGiftCardsPage } from './index';

const PAYLOAD = {
  ok: true,
  summary: { activeBalanceAmount: 120, issuedAmount: 150, usedAmount: 30, manualDebitAmount: 10, count: 2 },
  cards: [
    { id: 'GC1', maskedCode: '••••1234', amount: 100, balance: 70, status: 'active', creationMode: 'manual_institute', paymentMode: 'on_site', paymentLabel: 'Paiement sur place', purchaserName: 'Bob', recipientName: 'Alice', purchasedAt: '2026-06-01T00:00:00Z' },
    { id: 'GC2', maskedCode: '••••9999', amount: 50, balance: 50, status: 'active', creationMode: 'online', paymentMode: 'stripe', paymentLabel: 'Stripe', purchaserName: null, recipientName: null, purchasedAt: '2026-06-02T00:00:00Z' },
  ],
};
const calls: string[] = [];
function installFetch(payload: unknown) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }); }));
}
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/finance/cartes-cadeaux']}><FinanceGiftCardsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Finance Gift Cards page (RX2.6)', () => {
  it('affiche summary + cards (code masqué), pas de table', async () => {
    installFetch(PAYLOAD);
    const { container } = renderPage();
    expect(await screen.findByTestId('fin-gc-summary')).toBeInTheDocument();
    expect(screen.getByText('••••1234')).toBeInTheDocument();
    expect(screen.getAllByTestId('fin-gc-card').length).toBe(2);
    expect(screen.getByText('Paiement sur place')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('filtre circuit refetch', async () => {
    installFetch(PAYLOAD);
    renderPage();
    await screen.findByTestId('fin-gc-summary');
    fireEvent.click(screen.getByRole('tab', { name: 'Sur place' }));
    await waitFor(() => expect(calls.some((u) => u.includes('creationMode=manual_institute'))).toBe(true));
  });
});
