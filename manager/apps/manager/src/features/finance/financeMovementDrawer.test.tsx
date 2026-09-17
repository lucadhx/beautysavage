// RX2.3 — FinanceMovementDrawer : détail paiement + profit net (complete/partial), pas de table, pas d'hex.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceMovementDrawer } from './index';
import type { FinanceTimelineItem } from '@bs/api-client';

const SALE_ITEM: FinanceTimelineItem = {
  id: 'sale:S1', type: 'sale', direction: 'in', amount: 210, currency: 'EUR',
  title: 'Paiement reçu', subtitle: 'Prestation · Jane', status: 'paid',
  occurredAt: '2026-06-30T10:00:00Z', customer: { id: 'c1', name: 'Jane' },
  source: { model: 'Sale', id: 'S1' },
  badges: [{ label: 'Stripe', tone: 'success' }],
  actions: [{ kind: 'customer_view', enabled: true, to: '/clients/c1' }, { kind: 'invoice_view', enabled: false, url: null }],
};

function detail(netStatus: 'complete' | 'partial') {
  return {
    ok: true,
    movement: SALE_ITEM,
    paymentBreakdown: {
      paidAmount: 210, stripePaidAmount: 202.92, giftCardPaidAmount: 0, onSitePaidAmount: 0,
      refundAmount: 0, stripeFeesAmount: netStatus === 'complete' ? 7.08 : 0,
      stripeFeesStatus: netStatus === 'complete' ? 'available' : 'pending',
      devCommissionAmount: 0, netProfitAmount: netStatus === 'complete' ? 202.92 : 210, netProfitStatus: netStatus,
    },
    lines: [
      { label: 'Montant payé', amount: 210, kind: 'income' },
      netStatus === 'complete'
        ? { label: 'Frais Stripe', amount: -7.08, kind: 'fee' }
        : { label: 'Frais Stripe', amount: null, kind: 'fee', status: 'pending', note: 'en attente de synchronisation' },
      { label: 'Profit net estimé', amount: netStatus === 'complete' ? 202.92 : 210, kind: 'net', status: netStatus },
    ],
    actions: SALE_ITEM.actions,
  };
}

function installFetch(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}
afterEach(() => vi.unstubAllGlobals());

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><FinanceMovementDrawer item={SALE_ITEM} onClose={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FinanceMovementDrawer (RX2.3)', () => {
  it('charge le détail : breakdown + profit net complete', async () => {
    installFetch(detail('complete'));
    const { container } = renderDrawer();
    expect(await screen.findByTestId('fin-md-breakdown')).toBeInTheDocument();
    expect(screen.getByText('Détail du paiement')).toBeInTheDocument();
    expect(screen.getByText('Frais Stripe')).toBeInTheDocument();
    const net = screen.getByTestId('fin-md-net');
    expect(within(net).getByText('+202,92 €')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('profit net partiel → message « Données partielles »', async () => {
    installFetch(detail('partial'));
    renderDrawer();
    const net = await screen.findByTestId('fin-md-net');
    expect(within(net).getByText(/Données partielles/)).toBeInTheDocument();
  });

  it('rend le montant et les actions depuis l\'item même sans détail', async () => {
    installFetch({ ok: true }); // pas de paymentBreakdown
    renderDrawer();
    expect(await screen.findByTestId('fin-tl-drawer')).toBeInTheDocument();
    expect(screen.getByText('+210,00 €')).toBeInTheDocument();
    expect(screen.getByText('Voir le client')).toBeInTheDocument();
    expect(screen.getByText('Voir la facture')).toBeDisabled();
  });
});
