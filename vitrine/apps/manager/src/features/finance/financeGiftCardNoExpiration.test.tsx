// RX2.6 — RÈGLE PRODUIT : l'UI carte cadeau ne mentionne JAMAIS l'expiration (ni « expire »).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GiftCardFinanceDetailPage, FinanceGiftCardsPage } from './index';
import { GIFT_CARD_DETAIL } from './financeGiftCardDetail.fixture';

const LIST = {
  ok: true,
  summary: { activeBalanceAmount: 70, issuedAmount: 100, usedAmount: 30, manualDebitAmount: 0, count: 1 },
  cards: [{ id: 'GC1', maskedCode: '••••1234', amount: 100, balance: 70, status: 'active', creationMode: 'manual_institute', paymentMode: 'on_site', paymentLabel: 'Paiement sur place', purchaserName: 'Bob', recipientName: 'Alice', purchasedAt: '2026-06-01T00:00:00Z' }],
};

function installFetch(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}
afterEach(() => vi.unstubAllGlobals());

describe('Gift Card UI — aucune mention d\'expiration (RX2.6)', () => {
  it('la page détail ne contient ni « expir » ni « expire »', async () => {
    installFetch(GIFT_CARD_DETAIL);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/finance/cartes-cadeaux/GC1']}>
          <Routes><Route path="/finance/cartes-cadeaux/:giftCardId" element={<GiftCardFinanceDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('gift-card-detail');
    expect((document.body.textContent || '').toLowerCase()).not.toContain('expir');
  });

  it('la page liste ne contient ni « expir » ni « expire »', async () => {
    installFetch(LIST);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/finance/cartes-cadeaux']}><FinanceGiftCardsPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('finance-gift-cards');
    expect((document.body.textContent || '').toLowerCase()).not.toContain('expir');
  });
});
