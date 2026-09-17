// Lecture du résultat de paiement. GET /api/stripe/payment-result + /api/stripe/session-status.
import { apiFetch } from '../apiFetch';
import type { PaymentResultResponse, CheckoutSessionStatus, PaymentResultStatus } from './types';

export async function getPaymentResult(
  paymentIntentId: string,
  signal?: AbortSignal,
): Promise<PaymentResultResponse> {
  return apiFetch<PaymentResultResponse>('/api/stripe/payment-result', {
    params: { payment_intent_id: paymentIntentId },
    signal,
  });
}

/** Mappe le `payment_status` Stripe → statut UI (jamais "succeeded" sans confirmation Stripe). */
function derivePaymentStatus(paymentStatus: string): PaymentResultStatus | 'unknown' {
  const s = String(paymentStatus || '').toLowerCase();
  if (s === 'succeeded') return 'succeeded';
  if (s === 'canceled') return 'failed';
  if (s === 'processing' || s === 'requires_action' || s === 'requires_confirmation' || s === 'requires_payment_method' || s === 'requires_capture') {
    return 'pending';
  }
  return 'unknown';
}

/** Statut d'une Checkout Session (retour hosted). GET /api/stripe/session-status?session_id=cs_... */
export async function getCheckoutSessionStatus(
  sessionId: string,
  signal?: AbortSignal,
): Promise<CheckoutSessionStatus> {
  const res = await apiFetch<{ ok: boolean; status?: string; payment_status?: string }>(
    '/api/stripe/session-status',
    { params: { session_id: sessionId }, signal },
  );
  const paymentStatus = String(res.payment_status || '');
  return { status: derivePaymentStatus(paymentStatus), paymentStatus };
}
