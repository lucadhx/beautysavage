// RX4 — Réservations de prestations (client). S1 lecture ; S2 annulation + éligibilité remboursement.
// Le backend est l'autorité : éligibilité et exécution du remboursement sont calculées côté serveur.
import { API_BASE_URL } from '@bs/config';
import { apiGet, apiPost } from '../apiFetch';
import type { ClientBooking, BookingRefundEligibility, BookingCancelResult } from './types';

const BASE = '/api/client';

/** GET /api/client/bookings → liste des réservations, triées par date décroissante (backend). */
export async function listMyBookings(signal?: AbortSignal): Promise<ClientBooking[]> {
  const res = await apiGet<{ ok: boolean; bookings: ClientBooking[] }>(`${BASE}/bookings`, undefined);
  void signal;
  return res.bookings ?? [];
}

/** GET /api/client/bookings/:bookingId/refund-eligibility → éligibilité + montant estimé (serveur = autorité). */
export async function getBookingRefundEligibility(bookingId: string): Promise<BookingRefundEligibility> {
  const res = await apiGet<{ ok: boolean } & BookingRefundEligibility>(
    `${BASE}/bookings/${encodeURIComponent(bookingId)}/refund-eligibility`,
  );
  return {
    eligibleRefund: Boolean(res.eligibleRefund),
    reason: res.reason ?? 'none',
    waiverSigned: Boolean(res.waiverSigned),
    refundAmount: Number(res.refundAmount || 0),
    daysBeforeService: Number(res.daysBeforeService || 0),
    cancellationDays: Number(res.cancellationDays || 0),
  };
}

/** POST /api/client/bookings/:bookingId/cancel → annule + déclenche le remboursement si éligible (serveur). */
export async function cancelMyBooking(bookingId: string): Promise<BookingCancelResult> {
  const res = await apiPost<{ ok: boolean } & BookingCancelResult>(
    `${BASE}/bookings/${encodeURIComponent(bookingId)}/cancel`,
  );
  return {
    eligibleRefund: Boolean(res.eligibleRefund),
    reason: res.reason ?? 'none',
    refundAmount: Number(res.refundAmount || 0),
  };
}

/** URL de téléchargement de la facture d'une réservation (authentifiée par cookie same-origin). */
export function bookingInvoiceUrl(bookingId: string): string {
  return `${API_BASE_URL || ''}${BASE}/bookings/${encodeURIComponent(bookingId)}/invoice`;
}
