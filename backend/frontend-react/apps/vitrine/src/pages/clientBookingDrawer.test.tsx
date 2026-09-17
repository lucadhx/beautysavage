// RX4 S2 — Drawer détail réservation + parcours d'annulation (éligibilité → confirmation → succès).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BookingDetailDrawer } from '../features/account';
import type { ClientBooking } from '@bs/api-client';

function booking(over: Partial<ClientBooking> = {}): ClientBooking {
  return {
    id: 'b1', bookingId: 'BKG-1', serviceId: 's1', serviceName: 'Soin visage', practitionerName: '', practitionerPhoto: null,
    startAt: '2099-06-01T14:00:00Z', endAt: '2099-06-01T15:00:00Z', totalPrice: 90, depositAmount: 30,
    paymentType: 'deposit', paymentStatus: 'deposit_paid', status: 'confirmed', cancelledAt: null, cancelledBy: null,
    selectedOptions: [], saleId: 'SALE-1', createdAt: null, ...over,
  };
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    let body: unknown = { ok: true };
    if (url.includes('/refund-eligibility')) body = { ok: true, eligibleRefund: true, reason: 'retractation', waiverSigned: false, refundAmount: 90, daysBeforeService: 5, cancellationDays: 7 };
    else if (url.includes('/cancel') && init?.method === 'POST') body = { ok: true, eligibleRefund: true, reason: 'retractation', refundAmount: 90 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

function renderDrawer(b: ClientBooking) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BookingDetailDrawer booking={b} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('BookingDetailDrawer (RX4 S2)', () => {
  it('affiche le détail + action Annuler pour un RDV à venir', () => {
    stubFetch();
    renderDrawer(booking());
    expect(screen.getByText('Soin visage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('parcours annulation : éligibilité → confirmation → succès', async () => {
    stubFetch();
    renderDrawer(booking());
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    // Éligibilité chargée : remboursement estimé affiché.
    expect(await screen.findByText(/Remboursement estimé/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer l'annulation/ }));
    expect(await screen.findByText(/bien été annulé/)).toBeInTheDocument();
  });

  it('pas d\'action Annuler pour un RDV passé', () => {
    stubFetch();
    renderDrawer(booking({ startAt: '2000-01-01T10:00:00Z', endAt: '2000-01-01T11:00:00Z', status: 'completed' }));
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });
});
