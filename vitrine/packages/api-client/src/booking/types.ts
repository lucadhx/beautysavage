// Types réservation / préparation checkout (R2A). Le BACKEND fait foi (prix, dispo, lock) ;
// le front ne fait que collecter le choix utilisateur. Aucun paiement déclenché en R2A.
import type { DateIso, MoneyAmount } from '../types';

/** Créneau de disponibilité — GET /api/vitrine/availability/slots. start/end = "YYYY-MM-DDTHH:mm". */
export interface AvailabilitySlot {
  start: string;
  end: string;
  practitionerId: string | null;
}

/** Réponse créneaux. */
export interface BookingAvailabilityResponse {
  slots: AvailabilitySlot[];
}

/** Créneau prestation sélectionné (mappé sur checkoutState.service côté backend). */
export interface SelectedServiceSlot {
  slotStart: string; // "YYYY-MM-DDTHH:mm"
  slotEnd: string;
  practitionerId: string | null;
}

/** Option de prestation choisie (indicatif). */
export interface SelectedServiceOption {
  optionId: string;
  name: string;
  price?: MoneyAmount;
}

export type CartItemKind = 'service' | 'formation' | 'product' | 'gift_card';

/** État des consentements légaux (UX ; backend = autorité). */
export interface LegalConsentState {
  acceptedCgv: boolean;
  acknowledgedRetractation: boolean;
  acknowledgedDatedService: boolean;
  waiverAccepted?: boolean;
  waiverType?: string;
  acceptedAt?: DateIso | null;
}

/** Ligne de checkout (préparation). Pas de prix autoritaire. */
export interface CheckoutLine {
  kind: CartItemKind;
  refId: string; // serviceId / formationId / productId
  slug?: string;
  name: string;
  indicativePrice?: MoneyAmount;
  service?: {
    serviceId: string;
    slotStart: string;
    slotEnd: string;
    practitionerId: string | null;
    selectedOptions: SelectedServiceOption[];
  };
}

/** Brouillon de checkout = lignes + consentements (état local). */
export interface CheckoutDraft {
  lines: CheckoutLine[];
  legal: LegalConsentState;
}

/**
 * Payload de préparation checkout (mirroir partiel de checkoutState backend) — NON envoyé en R2A.
 * En R2B il alimentera create-checkout-session.
 */
export interface CheckoutPreparationPayload {
  version: number;
  preparedAt: DateIso;
  itemType: CartItemKind | 'cart';
  service?: {
    serviceId: string;
    slotStart: string;
    slotEnd: string;
    practitionerId: string | null;
    selectedOptions: SelectedServiceOption[];
  };
  legal: {
    acceptedCgv: boolean;
    waiverAccepted: boolean;
    waiverType: string;
    waiverAcceptedAt: DateIso | null;
  };
  lines: CheckoutLine[];
}
