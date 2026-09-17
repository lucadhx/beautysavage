// RX2.6 — Gift Card Finance détail : solde, cycle de vie, refund splitté, QR masqué, pas de table.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GiftCardFinanceDetailPage } from './index';
import { GIFT_CARD_DETAIL } from './financeGiftCardDetail.fixture';

function installFetch(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}
afterEach(() => vi.unstubAllGlobals());

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/finance/cartes-cadeaux/GC1']}>
        <Routes><Route path="/finance/cartes-cadeaux/:giftCardId" element={<GiftCardFinanceDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Gift Card Finance detail (RX2.6)', () => {
  it('solde, cycle de vie, refund splitté, QR masqué', async () => {
    installFetch(GIFT_CARD_DETAIL);
    const { container } = renderDetail();
    const balance = await screen.findByTestId('fin-gc-balance');
    expect(within(balance).getAllByText('70,00 €').length).toBeGreaterThan(0);
    expect(screen.getByTestId('fin-gc-lifecycle')).toBeInTheDocument();
    expect(screen.getByText('Carte cadeau créée (paiement sur place)')).toBeInTheDocument();
    // refund splitté : parts Stripe + recrédit
    const refunds = screen.getByTestId('fin-gc-refunds');
    expect(within(refunds).getByText('Part Stripe')).toBeInTheDocument();
    expect(within(refunds).getByText('Recrédit carte cadeau')).toBeInTheDocument();
    // QR masqué
    expect(within(screen.getByTestId('fin-gc-qr')).getByText('••••')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });
});
