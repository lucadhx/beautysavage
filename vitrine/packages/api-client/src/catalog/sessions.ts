// RX3 — Sessions présentielles publiques d'une formation. GET /api/vitrine/formations/:id/sessions.
// Le backend renvoie aussi un objet `qr {token,...}` orienté admin et `instructorName` : on ne mappe
// QUE les champs sûrs d'affichage (jamais le token QR ni l'instructeur). Lecture seule.
import { apiFetch } from '../apiFetch';
import type { DateIso } from '../types';

export interface FormationSessionSlotDay {
  dayIndex: number;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
}

export interface PublicFormationSession {
  id: string;
  startDate: DateIso | null;
  durationDays: number;
  durationLabel: string; // ex. "1 jour", "3 jours"
  schedule: FormationSessionSlotDay[];
  maxClients: number;
  placesRemaining: number;
  isAvailable: boolean;
  isCanceled: boolean;
}

interface RawSession {
  id?: string;
  startDate?: string;
  durationDays?: number;
  durationLabel?: string;
  schedule?: Array<{ dayIndex?: number; startTime?: string; endTime?: string }>;
  maxClients?: number;
  placesRemaining?: number;
  isAvailable?: boolean;
  isCanceled?: boolean;
}

function mapSession(raw: RawSession): PublicFormationSession {
  return {
    id: String(raw.id ?? ''),
    startDate: raw.startDate ?? null,
    durationDays: Number(raw.durationDays) || 1,
    durationLabel: raw.durationLabel ?? '',
    schedule: (raw.schedule ?? []).map((s) => ({
      dayIndex: Number(s.dayIndex) || 0,
      startTime: s.startTime ?? '',
      endTime: s.endTime ?? '',
    })),
    maxClients: Number(raw.maxClients) || 0,
    placesRemaining: Math.max(0, Number(raw.placesRemaining) || 0),
    isAvailable: Boolean(raw.isAvailable),
    isCanceled: Boolean(raw.isCanceled),
  };
}

/** Sessions à venir d'une formation présentielle (champs d'affichage sûrs uniquement). */
export async function getFormationSessions(
  formationId: string,
  signal?: AbortSignal,
): Promise<PublicFormationSession[]> {
  const res = await apiFetch<{ ok?: boolean; sessions?: RawSession[] }>(
    `/api/vitrine/formations/${encodeURIComponent(formationId)}/sessions`,
    { signal },
  );
  return (res.sessions ?? []).map(mapSession);
}
