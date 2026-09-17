import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import type { PublicService } from '@bs/api-client';
import { renderWithProviders, stubFetch, jsonResponse } from '../test/utils';
import { CartPage } from './CartPage';
import { ServiceBookingPanel } from '../features/booking/ServiceBookingPanel';
import { useCart } from '../features/cart/CartProvider';
import type { ServiceCartItem } from '../features/cart/cartTypes';

afterEach(() => vi.unstubAllGlobals());

const serviceItem: ServiceCartItem = {
  lineId: 'l1',
  kind: 'service',
  refId: 's1',
  slug: 'soin',
  name: 'Soin visage',
  indicativePrice: 50,
  selectedSlot: { slotStart: '2026-07-01T14:00', slotEnd: '2026-07-01T14:30', practitionerId: 'p1' },
};

const svc: PublicService = { id: 's1', slug: 'soin', name: 'Soin visage', price: 50 };

function CartCount() {
  const { summary } = useCart();
  return <div>cartcount:{summary.count}</div>;
}

describe('CartPage', () => {
  it('panier vide → EmptyState', () => {
    renderWithProviders(<CartPage />, '/panier', []);
    expect(screen.getByText('Votre panier est vide.')).toBeInTheDocument();
  });

  it('panier avec prestation + créneau → item + retrait', () => {
    renderWithProviders(<CartPage />, '/panier', [serviceItem]);
    expect(screen.getByText('Soin visage')).toBeInTheDocument();
    expect(screen.getByText(/01\/07\/2026 à 14:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retirer'));
    expect(screen.getByText('Votre panier est vide.')).toBeInTheDocument();
  });
});

describe('ServiceBookingPanel (sélection créneau → panier)', () => {
  it('choisir un jour puis un créneau et ajouter au panier', async () => {
    stubFetch((url) => {
      const u = new URL(url, 'http://x');
      if (u.pathname.endsWith('/availability/days')) {
        const y = u.searchParams.get('year');
        const m = String(u.searchParams.get('month')).padStart(2, '0');
        return jsonResponse({ ok: true, availableDays: [`${y}-${m}-15`] });
      }
      if (u.pathname.endsWith('/availability/slots')) {
        const date = u.searchParams.get('date');
        return jsonResponse({ ok: true, slots: [{ start: `${date}T14:00`, end: `${date}T14:30`, practitionerId: 'p1' }] });
      }
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<><ServiceBookingPanel service={svc} /><CartCount /></>, '/');

    fireEvent.click(screen.getByRole('button', { name: 'Choisir un créneau' }));
    const day = await screen.findByRole('button', { name: '15' });
    fireEvent.click(day);
    const slot = await screen.findByRole('button', { name: '14:00' });
    fireEvent.click(slot);
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter au panier' }));
    await waitFor(() => expect(screen.getByText('cartcount:1')).toBeInTheDocument());
  });

  it('jour sans créneau → empty state', async () => {
    stubFetch((url) => {
      const u = new URL(url, 'http://x');
      if (u.pathname.endsWith('/availability/days')) {
        const y = u.searchParams.get('year');
        const m = String(u.searchParams.get('month')).padStart(2, '0');
        return jsonResponse({ ok: true, availableDays: [`${y}-${m}-15`] });
      }
      if (u.pathname.endsWith('/availability/slots')) return jsonResponse({ ok: true, slots: [] });
      return jsonResponse({ ok: true }, 404);
    });
    renderWithProviders(<ServiceBookingPanel service={svc} />, '/');
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un créneau' }));
    fireEvent.click(await screen.findByRole('button', { name: '15' }));
    await waitFor(() => expect(screen.getByText('Aucun créneau disponible ce jour.')).toBeInTheDocument());
  });
});
