// M13 — Client API Réservation manuelle (gestion, admin/dev). Calendrier global institut, paiement
// SUR PLACE (aucun Stripe). Flow : choix prestation → date → créneau (hold temporaire 5 min) →
// confirmation (booking `confirmed`, solde dû sur place). Réutilise la disponibilité publique.
import { apiGet, apiPost } from '../apiFetch';

export interface BookableServiceOption {
  id: string;
  name: string;
  description?: string;
  price: number;
}

export interface BookableService {
  id: string;
  name: string;
  duration: number;
  price: number;
  effectivePrice?: number;
  hasPromo?: boolean;
  isBookable: boolean;
  bookingLeadDays?: number;
  options: BookableServiceOption[];
}

export interface ManualBookingSlot {
  start: string;
  end: string;
  practitionerId?: string;
}

export interface SlotHold {
  holdToken: string;
  expiresAt: string;
  slotStartAt: string;
  slotEndAt: string;
}

export interface ManualBooking {
  id?: string;
  bookingId: string;
  serviceName?: string;
  startAt: string | null;
  endAt?: string | null;
  status?: string;
  totalPrice?: number;
  depositAmount?: number;
  balanceDueAmount?: number;
}

export interface CreateManualBookingInput {
  clientId: string;
  serviceId: string;
  startAt: string;
  selectedOptions?: { optionId: string }[];
  depositAmount?: number;
  note?: string;
  holdToken?: string;
}

const GESTION = '/api/gestion';

/** GET /api/gestion/services — prestations (filtrées sur réservables côté UI). */
export async function listBookableServices(): Promise<BookableService[]> {
  const res = await apiGet<{ ok: boolean; services: BookableService[] }>(`${GESTION}/services`);
  return (res.services ?? []).filter((s) => s.isBookable);
}

/** GET /api/vitrine/availability/slots — créneaux disponibles (global institut). */
export async function getAvailabilitySlots(serviceId: string, date: string): Promise<ManualBookingSlot[]> {
  const res = await apiGet<{ ok: boolean; slots: ManualBookingSlot[] }>('/api/vitrine/availability/slots', {
    serviceId,
    date,
  });
  return res.slots ?? [];
}

/** GET /api/vitrine/availability/days — jours réservables d'un mois. */
export async function getAvailabilityDays(serviceId: string, month: number, year: number): Promise<string[]> {
  const res = await apiGet<{ ok: boolean; availableDays: string[] }>('/api/vitrine/availability/days', {
    serviceId,
    month,
    year,
  });
  return res.availableDays ?? [];
}

/** POST /api/gestion/bookings/hold — verrou temporaire (5 min) sur le créneau sélectionné. */
export async function holdBookingSlot(serviceId: string, startAt: string, endAt?: string): Promise<SlotHold> {
  const res = await apiPost<{ ok: boolean; hold: SlotHold }>(`${GESTION}/bookings/hold`, { serviceId, startAt, endAt });
  return res.hold;
}

/** POST /api/gestion/bookings/hold/release — libère un hold (idempotent). */
export async function releaseBookingSlot(holdToken: string): Promise<number> {
  const res = await apiPost<{ ok: boolean; released: number }>(`${GESTION}/bookings/hold/release`, { holdToken });
  return res.released ?? 0;
}

/** POST /api/gestion/bookings/manual — crée la réservation manuelle (paiement sur place). */
export async function createManualBooking(
  input: CreateManualBookingInput,
): Promise<{ booking: ManualBooking; paymentMode: string; balanceDueAmount: number }> {
  const res = await apiPost<{ ok: boolean; booking: ManualBooking; paymentMode: string; balanceDueAmount: number }>(
    `${GESTION}/bookings/manual`,
    input,
  );
  return { booking: res.booking, paymentMode: res.paymentMode, balanceDueAmount: res.balanceDueAmount };
}
