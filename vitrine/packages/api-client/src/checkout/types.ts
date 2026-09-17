// Types paiement (R2B). AUCUNE logique Stripe ; le backend reste source de vérité.
import type { MoneyAmount, DateIso } from '../types';
import type { SelectedServiceOption } from '../booking/types';

/** checkoutState envoyé DIRECTEMENT à create-checkout-session (mirroir du Vanilla). */
export interface ServiceCheckoutState {
  item: { type: 'service'; id: string; name?: string };
  service: {
    serviceId: string;
    /** M11A — legacy : entité institut unique, ignoré par le backend (calendrier global). */
    practitionerId: string | null;
    slotStart: string;
    slotEnd: string;
    selectedOptions?: SelectedServiceOption[];
  };
  legal: {
    acceptedCgv: boolean;
    waiverAccepted?: boolean;
    waiverText?: string;
  };
  origin?: { slug: string; query?: Record<string, unknown> };
}

/** Carte cadeau appliquée comme MOYEN DE PAIEMENT (jamais une remise). amount = montant utilisé. */
export interface AppliedGiftCard {
  giftCardId?: string;
  code: string;
  password?: string;
  amount: number;
}

/** Ligne de panier envoyée au backend (formation/produit). Le service reste single-item (hors panier). */
export interface CartCheckoutItem {
  type: 'formation' | 'product';
  id: string;
  name?: string;
  sessionId?: string | null;
  selectedOptions?: SelectedServiceOption[];
}

/** checkoutState PANIER (cart:true) — mirroir du Vanilla, accepté par le backend multi-item. */
export interface CartCheckoutState {
  cart: true;
  items: CartCheckoutItem[];
  consumerWaivers?: Array<{ type?: 'legal' | 'institut'; text: string; accepted: boolean; formationIds?: string[] }>;
  refundPolicySnapshots?: Record<string, { waiverType: 'legal' | 'institut' | null; waiverText: string; acceptedAt: string | null }>;
  appliedGiftCards?: AppliedGiftCard[];
  legal: { acceptedCgv: boolean };
  totals?: { subtotal?: number; giftCardUsed?: number; remainingToPay?: number };
  paymentProvider?: 'stripe';
  origin?: { source?: string; slug?: string; query?: Record<string, unknown> };
}

/** checkoutState ACHAT CARTE CADEAU (single-item). Le backend crée la carte à la finalisation. */
export interface GiftCardCheckoutState {
  item: {
    type: 'gift-card';
    id: 'gift-card';
    name: string;
    amount: number;
    /** Bénéficiaire (persisté par le backend, RX3 S4). */
    recipientName?: string;
    message?: string;
  };
  items?: unknown[];
  legal: { acceptedCgv: boolean };
  appliedGiftCards?: AppliedGiftCard[];
  totals?: { subtotal?: number; remainingToPay?: number };
  paymentProvider?: 'stripe';
  origin?: { source?: string; slug?: string; query?: Record<string, unknown> };
}

/** Union des états de checkout postés à create-checkout-session / finalize-free. */
export type CheckoutState = ServiceCheckoutState | CartCheckoutState | GiftCardCheckoutState;

/** Carte cadeau validée (avant application) — solde disponible réel. */
export interface GiftCardValidation {
  id: string;
  code: string;
  availableBalance: number;
  status: string;
  hasPassword: boolean;
}

/** Réponse create-checkout-session selon le flag backend CHECKOUT_HOSTED. */
export type CreateCheckoutSessionResponse =
  | { ok: true; mode: 'hosted'; url: string; checkoutId?: string }
  | { ok: true; mode: 'free'; checkoutId?: string; requiresPayment: false }
  // flag OFF (Elements) — non consommé par React (pas de Stripe.js) ; détecté pour message clair.
  | { ok: true; mode: 'elements'; clientSecret: string; returnUrl?: string };

export interface FinalizeFreeResponse {
  ok: true;
  saleId: string;
  idempotent?: boolean;
}

export type PaymentResultStatus = 'succeeded' | 'pending' | 'failed';

export interface PaymentResultPurchase {
  saleId?: string;
  paymentIntentId?: string;
  itemTitle?: string;
  type?: string;
  totalAmount?: MoneyAmount;
  purchasedAt?: DateIso | null;
}

export interface PaymentResultResponse {
  ok: true;
  status: PaymentResultStatus;
  purchase?: PaymentResultPurchase;
  errorMessage?: string;
  origin?: { slug: string; query?: Record<string, unknown> } | null;
}

/** Réponse brute de session-status (backend) + statut paiement dérivé pour l'UI. */
export interface CheckoutSessionStatus {
  /** Statut normalisé pour l'UI (dérivé de payment_status). */
  status: PaymentResultStatus | 'unknown';
  /** Statut Stripe PaymentIntent brut (succeeded/processing/canceled/...). */
  paymentStatus: string;
}
