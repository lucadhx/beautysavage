// Construction PURE du payload de préparation checkout (R2A). AUCUN réseau, AUCUN Stripe.
// Mirroir partiel de checkoutState backend ; sera envoyé seulement en R2B.
import type {
  CheckoutLine,
  LegalConsentState,
  CheckoutPreparationPayload,
  CartItemKind,
} from './types';

export const CHECKOUT_PREPARATION_VERSION = 1;

function deriveItemType(lines: CheckoutLine[]): CartItemKind | 'cart' {
  if (lines.length === 1) return lines[0].kind;
  return 'cart';
}

/**
 * Assemble le payload de préparation depuis les lignes + l'état de consentement.
 * `preparedAt` est injecté par l'appelant (pas d'horloge ici → testable/déterministe).
 */
export function buildCheckoutPreparationPayload(args: {
  lines: CheckoutLine[];
  legal: LegalConsentState;
  preparedAt: string;
}): CheckoutPreparationPayload {
  const { lines, legal, preparedAt } = args;
  const serviceLine = lines.find((l) => l.kind === 'service' && l.service);
  return {
    version: CHECKOUT_PREPARATION_VERSION,
    preparedAt,
    itemType: deriveItemType(lines),
    service: serviceLine?.service,
    legal: {
      acceptedCgv: Boolean(legal.acceptedCgv),
      waiverAccepted: Boolean(legal.waiverAccepted),
      waiverType: legal.waiverType || 'none',
      waiverAcceptedAt: legal.acceptedAt ?? null,
    },
    lines,
  };
}
