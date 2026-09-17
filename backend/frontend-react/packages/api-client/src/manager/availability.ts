import { apiDelete, apiGet, apiPost, apiPut } from '../apiFetch';

export interface PlanningTimeSlot {
  startTime: string;
  endTime: string;
}

export interface PlanningWeekdaySchedule {
  dayOfWeek: number;
  isWorking: boolean;
  slots: PlanningTimeSlot[];
}

export interface PlanningLunchBreak {
  isActive: boolean;
  startTime: string;
  endTime: string;
}

export interface PlanningSchedule {
  _id?: string;
  practitionerId: string;
  weeklySchedule: PlanningWeekdaySchedule[];
  lunchBreak?: PlanningLunchBreak | null;
  updatedAt?: string | null;
}

export type PlanningExceptionType = 'block' | 'add' | 'modify';

export interface PlanningException {
  _id: string;
  practitionerId: string;
  date: string;
  type: PlanningExceptionType;
  isFullDay: boolean;
  startTime: string | null;
  endTime: string | null;
  slots: PlanningTimeSlot[];
  reason: string;
  createdAt?: string | null;
}

export interface PlanningConflict {
  bookingId: string;
  startAt: string;
  endAt: string;
  status: string;
}

export interface PlanningExceptionInput {
  practitionerId: string;
  date: string;
  type: PlanningExceptionType;
  isFullDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  slots?: PlanningTimeSlot[];
  reason?: string;
}

const BASE = '/api/gestion/availability';

export async function getMyPlanningAvailability(): Promise<{
  practitionerId: string | null;
  schedule: PlanningSchedule | null;
}> {
  const res = await apiGet<{ ok: boolean; practitionerId?: string | null; schedule?: PlanningSchedule | null }>(`${BASE}/schedule/me`);
  return {
    practitionerId: res.practitionerId ?? null,
    schedule: res.schedule ?? null,
  };
}

export async function savePlanningSchedule(
  practitionerId: string,
  input: { weeklySchedule: PlanningWeekdaySchedule[]; lunchBreak?: PlanningLunchBreak | null },
): Promise<PlanningSchedule> {
  const res = await apiPut<{ ok: boolean; schedule: PlanningSchedule }>(
    `${BASE}/schedule/${encodeURIComponent(practitionerId)}`,
    input,
  );
  return res.schedule;
}

export async function listPlanningExceptions(
  practitionerId: string,
  range?: { from?: string; to?: string },
): Promise<PlanningException[]> {
  const res = await apiGet<{ ok: boolean; exceptions?: PlanningException[] }>(
    `${BASE}/exceptions/${encodeURIComponent(practitionerId)}`,
    {
      from: range?.from,
      to: range?.to,
    },
  );
  return res.exceptions ?? [];
}

export async function createPlanningException(input: PlanningExceptionInput): Promise<PlanningException> {
  const res = await apiPost<{ ok: boolean; exception: PlanningException }>(`${BASE}/exceptions`, input);
  return res.exception;
}

export async function updatePlanningException(id: string, input: Partial<PlanningExceptionInput>): Promise<PlanningException> {
  const res = await apiPut<{ ok: boolean; exception: PlanningException }>(
    `${BASE}/exceptions/${encodeURIComponent(id)}`,
    input,
  );
  return res.exception;
}

export async function deletePlanningException(id: string): Promise<void> {
  await apiDelete(`${BASE}/exceptions/${encodeURIComponent(id)}`);
}
