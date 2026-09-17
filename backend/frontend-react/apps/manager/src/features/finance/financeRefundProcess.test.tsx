// RX2.3 — Remboursement 1-clic depuis le drawer : footer → panneau → accepter → confirmer → POST.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceMovementDrawer } from './index';
import type { FinanceTimelineItem } from '@bs/api-client';

const REFUND_ITEM: FinanceTimelineItem = {
  id: 'refund:REF-1', type: 'refund', direction: 'out', amount: 30, currency: 'EUR',
  title: 'Remboursement en attente', subtitle: 'service · Jane', status: 'pending',
  occurredAt: '2026-06-29T10:00:00Z', customer: { id: 'c1', name: 'Jane' },
  source: { model: 'RefundRequest', id: 'REF-1' },
  badges: [{ label: 'En attente', tone: 'warning' }],
  actions: [
    { kind: 'refund_process', enabled: true, to: '/remboursements' },
    { kind: 'customer_view', enabled: true, to: '/clients/c1' },
  ],
};
const DETAIL = { ok: true, movement: REFUND_ITEM, paymentBreakdown: { paidAmount: 0, stripePaidAmount: 0, giftCardPaidAmount: 0, onSitePaidAmount: 0, refundAmount: 30, stripeFeesAmount: 0, stripeFeesStatus: 'not_applicable', devCommissionAmount: 0, netProfitAmount: 0, netProfitStatus: 'not_applicable' }, lines: [{ label: 'Remboursé', amount: -30, kind: 'refund' }], actions: REFUND_ITEM.actions };

const calls: { url: string; method: string; body: string | null }[] = [];
function installFetch() {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET';
    calls.push({ url: String(url), method, body: (init?.body as string) ?? null });
    if (String(url).includes('/refunds/')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(DETAIL), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><FinanceMovementDrawer item={REFUND_ITEM} onClose={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Remboursement 1-clic (RX2.3)', () => {
  it('ouvre le panneau, accepte, confirme → POST status succeeded + succès', async () => {
    installFetch();
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Traiter le remboursement' }));
    expect(await screen.findByTestId('fin-md-refund-panel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer le remboursement' }));
    expect(await screen.findByTestId('fin-md-refund-success')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/api/gestion/refunds/REF-1/status');
    expect(post?.body).toContain('succeeded');
  });

  it('refuser → POST status canceled', async () => {
    installFetch();
    renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: 'Traiter le remboursement' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Refuser' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer le refus' }));
    await screen.findByTestId('fin-md-refund-success');
    expect(calls.find((c) => c.method === 'POST')?.body).toContain('canceled');
  });
});
