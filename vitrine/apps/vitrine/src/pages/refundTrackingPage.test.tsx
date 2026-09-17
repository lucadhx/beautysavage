// RX4 S3 — Suivi remboursement tokenisé : montant, statut, split, timeline, états.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RefundTrackingPage } from './RefundTrackingPage';

function stub(payload: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })));
}
function renderAt(token: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/refund-tracking/${token}`]}>
        <Routes><Route path="refund-tracking/:token" element={<RefundTrackingPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('RefundTrackingPage (RX4 S3)', () => {
  it('affiche montant, statut et split Stripe/carte cadeau', async () => {
    stub({ ok: true, refund: { status: 'pending', amount: 60, itemTitle: 'Soin', isSplitRefund: true, stripeRefundAmount: 20, stripeRefundStatus: 'pending', giftCardRefundAmount: 40, giftCardRefundStatus: 'succeeded', giftCard: { code: 'GC-1', balance: 40, recipientName: 'Alice' } } });
    renderAt('tok');
    expect(await screen.findByText('Soin')).toBeInTheDocument();
    expect(screen.getByText('En cours de traitement')).toBeInTheDocument();
    expect(screen.getByText('Remboursement bancaire')).toBeInTheDocument();
    expect(screen.getByText('Recrédit carte cadeau')).toBeInTheDocument();
    expect(screen.getByText(/GC-1/)).toBeInTheDocument();
  });

  it('statut succeeded → timeline complétée', async () => {
    stub({ ok: true, refund: { status: 'succeeded', amount: 30, itemTitle: 'Formation', refundedAt: '2026-06-10T10:00:00Z', stripeRefundStatus: 'not_applicable', giftCardRefundStatus: 'not_applicable' } });
    renderAt('tok');
    // « Remboursement effectué » = libellé de statut + étape de timeline (2 occurrences attendues).
    expect((await screen.findAllByText('Remboursement effectué')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Formation')).toBeInTheDocument();
  });

  it('token invalide (404) → état invalide', async () => {
    stub({ ok: false, error: 'not found' }, 404);
    renderAt('tok');
    expect(await screen.findByText(/n’est plus valide/)).toBeInTheDocument();
  });
});
