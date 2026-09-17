// RX3 S3 — Construction PURE du checkoutState panier (cart:true) à partir des lignes formation + cartes
// cadeaux appliquées + fragments légaux. Aucun montant autoritaire : le backend recalcule. Les totaux
// indicatifs servent seulement à choisir le chemin (0 € → finalize-free ; > 0 € → Stripe hosted).
import type { AppliedGiftCard, CartCheckoutItem, CartCheckoutState } from '@bs/api-client';
import type { CartItem } from '../cart/cartTypes';
import { isFormationItem } from '../cart/cartTypes';
import type { CartLegalPayload } from '../legal/cartLegalRequirements';

export interface CartTotals {
  subtotal: number;
  giftCardUsed: number;
  remainingToPay: number;
}

/** Total indicatif des lignes panier (formations). */
export function cartSubtotal(items: CartItem[]): number {
  return items.filter(isFormationItem).reduce((sum, it) => sum + (it.indicativePrice ?? 0), 0);
}

/** Total des cartes cadeaux appliquées, capé au sous-total (jamais de « rendu monnaie »). */
export function giftCardApplied(appliedGiftCards: AppliedGiftCard[], subtotal: number): number {
  const raw = appliedGiftCards.reduce((sum, gc) => sum + Math.max(0, gc.amount || 0), 0);
  return Math.min(raw, subtotal);
}

export function computeCartTotals(items: CartItem[], appliedGiftCards: AppliedGiftCard[]): CartTotals {
  const subtotal = cartSubtotal(items);
  const giftCardUsed = giftCardApplied(appliedGiftCards, subtotal);
  return { subtotal, giftCardUsed, remainingToPay: Math.max(0, subtotal - giftCardUsed) };
}

export function buildCartCheckoutState(
  items: CartItem[],
  appliedGiftCards: AppliedGiftCard[],
  legalPayload: CartLegalPayload,
): CartCheckoutState {
  const formationItems: CartCheckoutItem[] = items.filter(isFormationItem).map((f) => ({
    type: 'formation',
    id: f.refId,
    name: f.name,
    sessionId: f.formationType === 'presentiel' ? f.sessionId ?? null : null,
    selectedOptions: f.selectedOptions,
  }));
  const totals = computeCartTotals(items, appliedGiftCards);

  return {
    cart: true,
    items: formationItems,
    consumerWaivers: legalPayload.consumerWaivers,
    refundPolicySnapshots: legalPayload.refundPolicySnapshots,
    appliedGiftCards,
    legal: legalPayload.legal,
    totals,
    paymentProvider: 'stripe',
    origin: { source: 'react_storefront', slug: 'checkout' },
  };
}
