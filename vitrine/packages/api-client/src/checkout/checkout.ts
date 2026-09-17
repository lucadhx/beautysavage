// Paiement : création de session (hosted/free) + finalize-free. AUCUN appel Stripe direct.
import { apiFetch } from '../apiFetch';
import type { CheckoutLine, LegalConsentState } from '../booking/types';
import type {
  ServiceCheckoutState,
  GiftCardCheckoutState,
  CheckoutState,
  CreateCheckoutSessionResponse,
  FinalizeFreeResponse,
} from './types';

/**
 * Construit le `checkoutState` backend (mode prestation) depuis une ligne panier + consentements.
 * NE force AUCUN montant (le serveur recalcule). `waiverText` non fourni (re-dérivé serveur).
 *
 * M11A — entité institut unique : `service.practitionerId` est un champ **legacy** ; le backend
 * l'IGNORE (réservation créée via le calendrier global institut). React ne dépend plus du
 * prestataire — la valeur est transmise telle quelle (ou `null`) uniquement pour compat ascendante.
 */
export function buildServiceCheckoutState(
  line: CheckoutLine,
  legal: LegalConsentState,
): ServiceCheckoutState | null {
  if (line.kind !== 'service' || !line.service) return null;
  return {
    item: { type: 'service', id: line.service.serviceId, name: line.name },
    service: {
      serviceId: line.service.serviceId,
      practitionerId: line.service.practitionerId ?? null, // legacy — ignoré par le backend
      slotStart: line.service.slotStart,
      slotEnd: line.service.slotEnd,
      selectedOptions: line.service.selectedOptions,
    },
    legal: {
      acceptedCgv: Boolean(legal.acceptedCgv),
      waiverAccepted: Boolean(legal.acknowledgedRetractation || legal.acknowledgedDatedService || legal.waiverAccepted),
    },
    origin: { slug: 'checkout' },
  };
}

/**
 * Construit le checkoutState d'ACHAT carte cadeau (single-item). La carte est créée par le backend
 * À LA FINALISATION (jamais avant paiement). Bénéficiaire optionnel persisté (RX3 S4). Montant validé
 * serveur (min/max config). `acceptedCgv` doit être vrai (backend refuse sinon).
 */
export function buildGiftCardCheckoutState(
  amount: number,
  opts: { recipientName?: string; message?: string; acceptedCgv: boolean },
): GiftCardCheckoutState {
  const item = {
    type: 'gift-card' as const,
    id: 'gift-card' as const,
    name: 'Carte cadeau',
    amount,
    recipientName: opts.recipientName?.trim() || undefined,
    message: opts.message?.trim() || undefined,
  };
  return {
    item,
    items: [item],
    legal: { acceptedCgv: Boolean(opts.acceptedCgv) },
    appliedGiftCards: [],
    totals: { subtotal: amount, remainingToPay: amount },
    paymentProvider: 'stripe',
    origin: { source: 'react_storefront', slug: 'gift-card' },
  };
}

/** Clé d'idempotence alphanumérique (8-128) stable pour une tentative free. */
export function buildIdempotencyKey(seed: string): string {
  const clean = seed.replace(/[^a-zA-Z0-9]/g, '').slice(0, 100);
  return `free${clean}`.slice(0, 128);
}

/** POST /api/stripe/create-checkout-session — renvoie hosted | free | elements (flag OFF). */
export async function createCheckoutSession(
  checkoutState: CheckoutState,
  signal?: AbortSignal,
): Promise<CreateCheckoutSessionResponse> {
  const res = await apiFetch<Record<string, unknown>>('/api/stripe/create-checkout-session', {
    method: 'POST',
    body: { checkoutState },
    signal,
  });
  if (res.mode === 'hosted') {
    return { ok: true, mode: 'hosted', url: String(res.url), checkoutId: res.checkoutId as string | undefined };
  }
  if (res.mode === 'free') {
    return { ok: true, mode: 'free', requiresPayment: false, checkoutId: res.checkoutId as string | undefined };
  }
  // Pas de `mode` mais un clientSecret → backend en mode Elements (CHECKOUT_HOSTED=false).
  return {
    ok: true,
    mode: 'elements',
    clientSecret: String(res.clientSecret ?? ''),
    returnUrl: res.returnUrl as string | undefined,
  };
}

/** POST /api/client/checkout/finalize-free — finalise un achat 0 € (idempotent). */
export async function finalizeFreeCheckout(
  checkoutState: CheckoutState,
  idempotencyKey?: string,
  signal?: AbortSignal,
): Promise<FinalizeFreeResponse> {
  return apiFetch<FinalizeFreeResponse>('/api/client/checkout/finalize-free', {
    method: 'POST',
    body: idempotencyKey ? { checkoutState, idempotencyKey } : { checkoutState },
    signal,
  });
}
