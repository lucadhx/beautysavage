// RX2.5 — Commission Overview : card du mois, badge retard, historique, settled zero, paiement. Pas de table.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommissionOverviewPage, CommissionPaymentAction } from './index';
import type { CommissionPaymentView } from '@bs/api-client';

function view(over: Partial<CommissionPaymentView> = {}): CommissionPaymentView {
  return {
    id: 'PAY-1', month: 6, year: 2026, label: 'juillet 2026',
    grossCommission: 1500, refundDeduction: 120, carryOverIn: 40, netAmountDue: 1340, negativeCarryOver: 0,
    status: 'pending', settledReason: null,
    availabilityAt: '2026-08-01T00:00:00Z', dueAt: '2099-08-16T00:00:00Z', graceEndsAt: '2099-08-21T00:00:00Z',
    lateStatus: 'due', periodStart: '2026-07-01T00:00:00Z', periodEnd: '2026-08-01T00:00:00Z', paidAt: null,
    lines: [
      { label: 'Formations vendues', amount: 1500, kind: 'income' },
      { label: 'Remboursements', amount: -120, kind: 'refund' },
      { label: 'Report précédent', amount: -40, kind: 'carryover' },
      { label: 'À payer', amount: 1340, kind: 'net' },
    ],
    invoice: { pdfUrl: null, invoiceId: null },
    payment: { id: 'PAY-1', status: 'pending', paymentInProgress: false },
    actions: [{ kind: 'commission_pay', enabled: true, paymentId: 'PAY-1' }, { kind: 'invoice_view', enabled: false, url: null }],
    ...over,
  };
}
const TERMS = { paymentDueDays: 15, gracePeriodDays: 5, blockingMode: 'none', suspensionWarningAfterDays: 0 };

function installFetch(overview: unknown, history: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = String(url).includes('/history') ? history : overview;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/finance/commissions']}><CommissionOverviewPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Commission Overview (RX2.5)', () => {
  it('affiche la card du mois, le badge, les règles et l\'historique', async () => {
    installFetch(
      { ok: true, hasContract: true, terms: TERMS, current: view() },
      { ok: true, hasContract: true, terms: TERMS, items: [view({ id: 'PAY-0', label: 'juin 2026', status: 'paid', lateStatus: 'paid', netAmountDue: 900 })] },
    );
    const { container } = renderPage();
    expect(await screen.findByTestId('fin-comm-current')).toBeInTheDocument();
    expect(screen.getByText('1340,00 €')).toBeInTheDocument();
    expect(screen.getAllByText('À payer').length).toBeGreaterThan(0);
    expect(screen.getByTestId('fin-comm-settings')).toBeInTheDocument();
    expect(await screen.findByTestId('fin-comm-history')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('settled zero → message « Aucune commission à payer »', async () => {
    installFetch(
      { ok: true, hasContract: true, terms: TERMS, current: view({ status: 'settled_zero', lateStatus: 'settled_zero', netAmountDue: 0, settledReason: 'settled_zero', actions: [{ kind: 'commission_pay', enabled: false }] }) },
      { ok: true, hasContract: true, terms: TERMS, items: [] },
    );
    renderPage();
    expect(await screen.findByTestId('fin-comm-settled')).toBeInTheDocument();
  });

  it('sans contrat → état vide', async () => {
    installFetch({ ok: true, hasContract: false, terms: TERMS, current: null }, { ok: true, hasContract: false, terms: TERMS, items: [] });
    renderPage();
    expect(await screen.findByText(/Aucun contrat actif/)).toBeInTheDocument();
  });

  it('CommissionPaymentAction : payer → POST create-intent + redirection hébergée', async () => {
    const redirect = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, mode: 'hosted', url: 'https://pay.stripe' }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><CommissionPaymentAction payment={view()} onRedirect={redirect} /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Payer la commission/ }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://pay.stripe'));
  });
});
