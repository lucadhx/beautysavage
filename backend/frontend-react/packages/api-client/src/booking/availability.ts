// Disponibilités prestation (lecture). GET /api/vitrine/availability/{days,slots}.
import { apiFetch } from '../apiFetch';
import { asRaw, str, strArr, type Raw } from '../catalog/raw';
import type { AvailabilitySlot } from './types';

function mapSlot(r: Raw): AvailabilitySlot {
  return {
    start: str(r.start),
    end: str(r.end),
    practitionerId: r.practitionerId ? str(r.practitionerId) : null,
  };
}

/** Jours disponibles d'un mois (1-12). Renvoie ["YYYY-MM-DD"]. */
export async function getServiceAvailableDays(
  params: { serviceId: string; year: number; month: number },
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await apiFetch<{ ok: boolean; availableDays?: unknown }>('/api/vitrine/availability/days', {
    params: { serviceId: params.serviceId, year: params.year, month: params.month },
    signal,
  });
  return strArr(res.availableDays);
}

/**
 * Créneaux d'un jour (YYYY-MM-DD). M11A — entité institut unique : `practitionerId` est un
 * paramètre LEGACY toléré mais SANS EFFET côté serveur (disponibilité calculée globalement).
 */
export async function getServiceAvailableSlots(
  params: { serviceId: string; date: string; practitionerId?: string | null },
  signal?: AbortSignal,
): Promise<AvailabilitySlot[]> {
  const res = await apiFetch<{ ok: boolean; slots?: unknown }>('/api/vitrine/availability/slots', {
    params: {
      serviceId: params.serviceId,
      date: params.date,
      practitionerId: params.practitionerId ?? undefined,
    },
    signal,
  });
  return (Array.isArray(res.slots) ? res.slots : []).map((s) => mapSlot(asRaw(s)));
}
