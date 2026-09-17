// RX3 S3 — Tests du builder pur du checkoutState panier + totaux (carte cadeau capée au sous-total).
import { describe, it, expect } from 'vitest';
import { computeCartTotals, buildCartCheckoutState } from './buildCartCheckoutState';
import type { CartItem } from '../cart/cartTypes';
import type { AppliedGiftCard } from '@bs/api-client';
import type { CartLegalPayload } from '../legal/cartLegalRequirements';

const ITEMS: CartItem[] = [
  { lineId: 'l1', kind: 'formation', refId: 'f1', name: 'Distanciel', formationType: 'distanciel', indicativePrice: 120 },
  { lineId: 'l2', kind: 'formation', refId: 'f2', name: 'Présentiel', formationType: 'presentiel', sessionId: 's2', indicativePrice: 80 },
];

const LEGAL: CartLegalPayload = { legal: { acceptedCgv: true }, consumerWaivers: [], refundPolicySnapshots: {} };

describe('computeCartTotals', () => {
  it('somme le sous-total des formations', () => {
    expect(computeCartTotals(ITEMS, []).subtotal).toBe(200);
  });

  it('cape la carte cadeau au sous-total (jamais de rendu monnaie)', () => {
    const gc: AppliedGiftCard[] = [{ code: 'A', amount: 500 }];
    const t = computeCartTotals(ITEMS, gc);
    expect(t.giftCardUsed).toBe(200);
    expect(t.remainingToPay).toBe(0);
  });

  it('carte partielle → reste à payer', () => {
    const t = computeCartTotals(ITEMS, [{ code: 'A', amount: 50 }]);
    expect(t.giftCardUsed).toBe(50);
    expect(t.remainingToPay).toBe(150);
  });
});

describe('buildCartCheckoutState', () => {
  it('produit un checkoutState cart:true avec items formation + origin react_storefront', () => {
    const state = buildCartCheckoutState(ITEMS, [{ code: 'A', amount: 50 }], LEGAL);
    expect(state.cart).toBe(true);
    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({ type: 'formation', id: 'f1', sessionId: null });
    expect(state.items[1]).toMatchObject({ type: 'formation', id: 'f2', sessionId: 's2' });
    expect(state.appliedGiftCards).toEqual([{ code: 'A', amount: 50 }]);
    expect(state.legal.acceptedCgv).toBe(true);
    expect(state.origin?.source).toBe('react_storefront');
    expect(state.totals?.remainingToPay).toBe(150);
  });
});
