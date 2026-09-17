// RX2.5 — Intégration timeline : le mouvement commission ouvre le détail (lien « Voir la commission »).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceMovementDrawer } from './index';
import type { FinanceTimelineItem } from '@bs/api-client';

const COMMISSION_ITEM: FinanceTimelineItem = {
  id: 'commission:abc', type: 'commission', direction: 'out', amount: 120, currency: 'EUR',
  title: 'Commission plateforme', subtitle: 'juin 2026', status: 'pending',
  occurredAt: '2026-07-01T00:00:00Z', customer: null,
  source: { model: 'CommissionPayment', id: 'abc' },
  badges: [{ label: 'Plateforme', tone: 'neutral' }, { label: 'À payer', tone: 'warning' }],
  actions: [
    { kind: 'commission_view', enabled: true, to: '/finance/commissions/2026/6' },
    { kind: 'invoice_view', enabled: false, url: null },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('Commission timeline integration (RX2.5)', () => {
  it('le drawer d\'un mouvement commission propose « Voir la commission »', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><FinanceMovementDrawer item={COMMISSION_ITEM} onClose={() => {}} /></MemoryRouter>
      </QueryClientProvider>,
    );
    const drawer = await screen.findByTestId('fin-tl-drawer');
    const link = within(drawer).getByText('Voir la commission');
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('/finance/commissions/2026/6');
  });
});
