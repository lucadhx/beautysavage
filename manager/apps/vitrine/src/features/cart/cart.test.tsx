import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CartProvider, useCart } from './CartProvider';
import { loadCart, saveCart } from './cartStorage';
import { CART_STORAGE_KEY } from './cartTypes';

beforeEach(() => localStorage.clear());

describe('cartStorage', () => {
  it('renvoie [] si vide, roundtrip save/load', () => {
    expect(loadCart()).toEqual([]);
    saveCart([{ lineId: 'l1', kind: 'service', refId: 's1', name: 'Soin' }]);
    expect(loadCart()).toHaveLength(1);
  });

  it('version incompatible → reset propre', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 999, items: [{ lineId: 'x' }] }));
    expect(loadCart()).toEqual([]);
  });
});

let api: ReturnType<typeof useCart>;
function Probe() {
  api = useCart();
  return <div>count:{api.summary.count} total:{api.summary.indicativeTotal}</div>;
}

describe('CartProvider', () => {
  it('addService / removeItem / persistance / résumé indicatif', () => {
    render(
      <CartProvider initialItems={[]}>
        <Probe />
      </CartProvider>,
    );
    expect(screen.getByText('count:0 total:0')).toBeInTheDocument();

    let lineId = '';
    act(() => {
      lineId = api.addService({
        refId: 's1',
        slug: 'soin',
        name: 'Soin',
        indicativePrice: 50,
        selectedSlot: { slotStart: '2026-07-01T14:00', slotEnd: '2026-07-01T14:30', practitionerId: 'p1' },
      });
    });
    expect(screen.getByText('count:1 total:50')).toBeInTheDocument();
    // persistance localStorage
    expect(loadCart()).toHaveLength(1);

    act(() => api.removeItem(lineId));
    expect(screen.getByText('count:0 total:0')).toBeInTheDocument();
  });
});
