// M10 — Client API du calendrier GLOBAL de l'institut (manager). Une seule entité = l'institut :
// aucun notion de prestataire. Le backend reste l'autorité (admin/dev, jamais client).
import { apiGet, apiPost } from '../apiFetch';

export type CalendarItemType = 'service_booking' | 'formation_session' | 'blocked_slot';
export type CalendarItemStatus =
  | 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'pending_payment'
  | 'active' | 'canceled' | 'canceled_by_institute' | 'blocked' | string;

export interface CalendarItemActionLinks {
  detail: boolean;
  cancel: boolean;
  markBalancePaid: boolean;
  reschedule: boolean;
}

export interface CalendarItem {
  id: string;
  type: CalendarItemType;
  title: string;
  startAt: string;
  endAt: string;
  status: CalendarItemStatus;
  client: { name: string | null } | null;
  participant: { reservedCount: number; maxClients: number; placesLeft: number } | null;
  paymentStatus: string | null;
  paymentType: string | null;
  refundStatus: string | null;
  totalAmount: number | null;
  depositAmount: number | null;
  amountPaidOnline: number | null;
  balanceDueAmount: number | null;
  balanceSettlementMode: string | null;
  actionLinks: CalendarItemActionLinks;
  sourceModel: string;
  sourceId: string;
}

export interface CalendarFilters {
  startDate: string; // ISO
  endDate: string; // ISO
  type?: CalendarItemType | null;
  status?: string | null;
}

const BASE = '/api/gestion/calendar';
const BOOKINGS = '/api/gestion/bookings';

// M11B — le report/décalage admin GLOBAL est désormais disponible côté backend.
export const RESCHEDULE_SUPPORTED = true;

export async function listCalendarItems(filters: CalendarFilters): Promise<CalendarItem[]> {
  const res = await apiGet<{ ok: boolean; items: CalendarItem[] }>(`${BASE}/items`, {
    startDate: filters.startDate,
    endDate: filters.endDate,
    type: filters.type ?? undefined,
    status: filters.status ?? undefined,
  });
  return res.items ?? [];
}

/**
 * Ventilation du prix réellement vendu (promotions/remises) et du paiement (carte cadeau,
 * en ligne, sur place) d'une réservation prestation. Montants en euros. SAFE.
 */
export interface BookingPricingBreakdown {
  catalogAmount: number | null;
  promotionApplied: boolean;
  promotionDiscountAmount: number | null;
  soldAmount: number | null;
  giftCardAmount: number | null;
  paidOnlineAmount: number | null;
  paidOnSiteAmount: number | null;
  balanceDueAmount: number | null;
  totalPaidAmount: number | null;
  currency?: string;
}

export interface BookingParticipant {
  name: string | null;
  email: string | null;
}

export interface BookingDetailResponse {
  ok: boolean;
  booking: Record<string, unknown> | null;
  refundEligibility?: { eligibleRefund?: boolean; reason?: string; waiverSigned?: boolean } | null;
  pricing?: BookingPricingBreakdown | null;
  participant?: BookingParticipant | null;
}

export async function getBookingDetail(bookingId: string): Promise<BookingDetailResponse> {
  return apiGet<BookingDetailResponse>(`${BOOKINGS}/${encodeURIComponent(bookingId)}/detail`);
}

/** Annulation admin — déclenche le flow de remboursement tokenisé côté backend. */
export async function cancelBooking(bookingId: string, reason?: string): Promise<{ ok: boolean; flowCreated?: boolean }> {
  return apiPost(`${BOOKINGS}/${encodeURIComponent(bookingId)}/cancel`, reason ? { reason } : {});
}

/** Marque le solde d'acompte réglé sur place (paymentType deposit + pay_on_site uniquement). */
export async function markBalancePaid(bookingId: string): Promise<{ ok: boolean; balanceDueAmount?: number }> {
  return apiPost(`${BOOKINGS}/${encodeURIComponent(bookingId)}/balance-paid`, {});
}

export interface RescheduleBookingPayload {
  /** Nouveau début ISO ("YYYY-MM-DDTHH:mm" ou ISO complet). */
  newStartAt: string;
  /** Nouvelle fin ISO. */
  newEndAt: string;
  reason?: string;
}

export interface RescheduleBookingResponse {
  ok: boolean;
  booking?: { bookingId: string; startAt: string; endAt: string; status: string };
}

/**
 * M11B — Report/décalage GLOBAL d'un créneau (déplacement EN PLACE du même booking, sans
 * remboursement). POST /api/gestion/bookings/:id/reschedule. Admin/dev (backend).
 */
export async function rescheduleBooking(
  bookingId: string,
  payload: RescheduleBookingPayload,
): Promise<RescheduleBookingResponse> {
  return apiPost(`${BOOKINGS}/${encodeURIComponent(bookingId)}/reschedule`, {
    newStartAt: payload.newStartAt,
    newEndAt: payload.newEndAt,
    ...(payload.reason ? { reason: payload.reason } : {}),
  });
}
