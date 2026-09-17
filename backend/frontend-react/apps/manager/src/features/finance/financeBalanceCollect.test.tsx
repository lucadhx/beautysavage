// RX2.3 — Encaissement solde sur place depuis le drawer : footer → panneau → moyen → confirmer → POST.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceMovementDrawer } from './index';
import type { FinanceTimelineItem } from '@bs/api-client';

const BALANCE_ITEM: FinanceTimelineItem = {
  id: 'balance_due:BKG-1', type: 'balance_due', direction: 'neutral', amount: 50, currency: 'EUR',
  title: 'Solde à encaisser', subtitle: 'Soin · Jane', status: 'balance_due',
  occurredAt: '2026-06-28T10:00:00Z', customer: { id: 'c1', name: 'Jane' },
  source: { model: 'ServiceBooking', id: 'BKG-1' },
  badges: [{ label: 'À encaisser', tone: 'warning' }],
  actions: [
    { kind: 'balance_collect', enabled: true, to: '/reservations' },
    { kind: 'customer_view', enabled: true, to: '/clients/c1' },
  ],
};
const DETAIL = { ok: true, movement: BALANCE_ITEM, paymentBreakdown: { paidAmount: 0, stripePaidAmount: 0, giftCardPaidAmount: 0, onSitePaidAmount: 0, refundAmount: 0, stripeFeesAmount: 0, stripeFeesStatus: 'not_applicable', devCommissionAmount: 0, netProfitAmount: 0, netProfitStatus: 'not_applicable' }, lines: [{ label: 'Solde à encaisser', amount: 50, kind: 'balance' }], actions: BALANCE_ITEM.actions };

const calls: { url: string; method: string; body: string | null }[] = [];
function installFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    calls.push({ url: String(url), method, body: (init?.body as string) ?? null });
    if (String(url).includes('/balance-paid')) return new Response(JSON.stringify({ ok: true, balanceDueAmount: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(DETAIL), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><FinanceMovementDrawer item={BALANCE_ITEM} onClose={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Encaissement solde sur place (RX2.3)', () => {
  it('ouvre le panneau, choisit Espèces, confirme → POST balance-paid cash + succès', async () => {
    installFetch();
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Encaisser sur place' }));
    expect(await screen.findByTestId('fin-md-balance-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Espèces' }));
    fireEvent.click(screen.getByRole('button', { name: "Confirmer l'encaissement" }));
    fireEvent.click(await screen.findByRole('button', { name: /Encaisser 50,00/ }));
    expect(await screen.findByTestId('fin-md-balance-success')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/api/gestion/bookings/BKG-1/balance-paid');
    expect(post?.body).toContain('cash');
  });

  it('RX2.4 — prestation full on-site : wording « Encaisser le paiement sur place »', async () => {
    installFetch();
    const fullItem = { ...BALANCE_ITEM, title: 'Paiement sur place à encaisser' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><FinanceMovementDrawer item={fullItem} onClose={() => {}} /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Encaisser sur place' }));
    expect(await screen.findByText('Encaisser le paiement sur place')).toBeInTheDocument();
  });
});
