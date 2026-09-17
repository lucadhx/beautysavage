// M12 — Customer 360 React : recherche/navigation, hero, KPIs, quick actions, timeline, onglets,
// accordions, finances, aucune table.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientsListPage, Customer360Page } from './index';

const C360 = {
  ok: true,
  customer: { id: 'c1', firstName: 'Jane', lastName: 'Doe', displayName: 'Jane Doe', email: 'jane@test.local', phone: null, photo: null, createdAt: '2026-01-01', lastLogin: null, isActive: true, bookingSuspended: false },
  summary: {
    customerId: 'c1', displayName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.local', phone: null, photo: null,
    createdAt: '2026-01-01', status: 'active',
    kpis: { salesCount: 2, totalSpent: 200, totalHT: 200, servicesCount: 1, formationsCount: 1, productsCount: 1, giftCardsCount: 1, refundsCount: 1, upcomingBookingsCount: 1 },
    nextBooking: { bookingId: 'B1', serviceName: 'Soin', startAt: '2026-07-01T10:00:00' }, lastActivity: '2026-06-01',
  },
  timeline: [
    { id: 't1', date: '2026-06-01', type: 'achat', icon: 'bi-bag-check', title: 'Achat 80,00 €', subtitle: '1 article', action: 'view_sale', refId: 'S1' },
    { id: 't2', date: '2026-05-01', type: 'reservation', icon: 'bi-calendar-check', title: 'Soin', subtitle: 'confirmed', action: 'view_booking', refId: 'B1' },
  ],
  sales: [{ id: 'S1', saleId: 'S1', createdAt: '2026-06-01', totalAmount: 80, itemCount: 1, refundStatus: null, refundAmount: 0, items: [{ type: 'service', itemId: 'x', name: 'Soin', finalPrice: 80, promotionApplied: false }], giftCardUsage: [] }],
  bookings: [{ id: 'B1', bookingId: 'B1', serviceName: 'Soin', startAt: '2026-07-01T10:00:00', endAt: '2026-07-01T11:00:00', status: 'confirmed', paymentType: 'full', paymentStatus: 'paid', totalPrice: 80, depositAmount: 0, balanceDueAmount: 0, balanceSettlementMode: null, isDeposit: false, saleId: 'S1', cancelledAt: null, cancelledBy: null }],
  formations: [{ id: 'F1', formationId: 'f1', name: 'Formation X', type: 'presentiel', sessionId: null, participationStatus: 'active', acquiredAt: '2026-04-01' }],
  products: [{ id: 'P1', productId: 'p1', name: 'Produit Y', acquiredAt: '2026-03-01' }],
  giftCards: [{ id: 'G1', code: 'GC1', amount: 100, balance: 100, status: 'active', purchasedAt: '2026-02-01' }],
  refunds: [{ id: 'R1', refundId: 'R1', saleId: 'S1', itemType: 'service', amount: 30, status: 'succeeded', eligibleRefund: true, requestedAt: '2026-05-15', refundedAt: '2026-05-16', hasCreditNote: false }],
  documents: [{ id: 'd1', kind: 'invoice_official', label: 'Facture INV-1', date: '2026-06-01', url: 'https://x/inv.pdf', amount: 80 }],
  communications: [{ id: 'm1', channel: 'email', templateKey: 'booking_confirmed', subject: 'Confirmation', status: 'sent', sentAt: '2026-06-01', contextType: 'sale' }],
  notifications: [{ id: 'n1', title: 'Nouvelle réservation', category: 'prestations', icon: null, priority: 'normal', eventName: null, createdAt: '2026-06-01' }],
  financial: { totalSpent: 200, depositsPaid: 0, balanceDue: 0, pendingBalances: [], giftCardsBalance: 100, giftCardsCount: 1, refundsTotal: 30, refundsCount: 1, lastInvoice: { id: 'i1', invoiceId: 'INV-1', saleId: 'S1', status: 'paid', official: true, documentKind: 'stripe_official', totalAmount: 80, invoiceDate: '2026-06-01', pdfUrl: 'https://x/inv.pdf' }, unpaidInvoicesCount: 0, unpaidInvoices: [] },
};

const SEARCH = { ok: true, customers: [{ id: 'c1', displayName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.local', createdAt: '2026-01-01', bookingSuspended: false, salesCount: 2, totalSpent: 200, lastVisitAt: '2026-06-01', nextBookingAt: '2026-07-01T10:00:00' }] };

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const body = u.includes('/360') ? C360 : SEARCH;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clients" element={<ClientsListPage />} />
          <Route path="/clients/:id" element={<Customer360Page />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Customer 360 (M12)', () => {
  it('liste clients : recherche + carte + navigation vers la fiche', async () => {
    installFetch();
    renderAt('/clients');
    expect(await screen.findByTestId('c3-clientcard')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('c3-clientcard'));
    // navigation → fiche : le hero apparaît
    await waitFor(() => expect(screen.getByTestId('c3-hero')).toBeInTheDocument());
  });

  it('fiche : hero + KPIs + quick actions + timeline par défaut', async () => {
    installFetch();
    renderAt('/clients/c1');
    expect(await screen.findByTestId('c3-hero')).toBeInTheDocument();
    expect(screen.getByTestId('c3-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('c3-quick')).toBeInTheDocument();
    expect(screen.getByTestId('c3-timeline')).toBeInTheDocument();
    expect(screen.getAllByTestId('c3-tl-item').length).toBe(2);
  });

  it('onglets : Détails affiche les accordions, Finances le financier', async () => {
    installFetch();
    renderAt('/clients/c1');
    await screen.findByTestId('c3-hero');
    fireEvent.click(screen.getByRole('tab', { name: /Détails/i }));
    expect(await screen.findByTestId('c3-acc-bookings')).toBeInTheDocument();
    // accordion repliable : ouvrir Achats
    fireEvent.click(screen.getByTestId('c3-acc-formations').querySelector('button')!);
    expect(screen.getByText('Formation X')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Finances/i }));
    expect(await screen.findByTestId('c3-financial')).toBeInTheDocument();
    expect(screen.getByTestId('c3-unpaid')).toHaveTextContent('0');
  });

  it('aucune <table> dans la fiche', async () => {
    installFetch();
    const { container } = renderAt('/clients/c1');
    await screen.findByTestId('c3-hero');
    expect(container.querySelector('table')).toBeNull();
  });

  it('drawer : tap timeline ouvre le drawer détail', async () => {
    installFetch();
    renderAt('/clients/c1');
    await screen.findByTestId('c3-timeline');
    fireEvent.click(screen.getAllByTestId('c3-tl-item')[0]);
    expect(await screen.findByTestId('c3-drawer')).toBeInTheDocument();
  });
});
