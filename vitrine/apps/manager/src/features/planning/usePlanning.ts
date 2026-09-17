import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCalendarItems,
  cancelBooking,
  markBalancePaid,
  rescheduleBooking,
  getBookingDetail,
  getMyPlanningAvailability,
  savePlanningSchedule,
  listPlanningExceptions,
  createPlanningException,
  updatePlanningException,
  deletePlanningException,
  type CalendarItem,
  type CalendarItemType,
  type RescheduleBookingPayload,
  type PlanningSchedule,
  type PlanningException,
  type PlanningExceptionInput,
  type PlanningWeekdaySchedule,
  type PlanningLunchBreak,
  type BookingPricingBreakdown,
  type BookingParticipant,
} from '@bs/api-client';

export type PlanningView = 'day' | 'week';

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(date: Date): Date {
  const next = startOfDay(date);
  const dayOfWeek = next.getDay();
  const diff = (dayOfWeek + 6) % 7;
  return addDays(next, -diff);
}

export function planningRange(date: Date, view: PlanningView): { start: Date; end: Date } {
  if (view === 'week') {
    const start = startOfWeek(date);
    return { start, end: addDays(start, 7) };
  }
  const start = startOfDay(date);
  return { start, end: addDays(start, 1) };
}

export function toDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function groupItemsByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = toDateKey(item.startAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(item);
  }
  return map;
}

export function groupExceptionsByDay(exceptions: PlanningException[]): Map<string, PlanningException> {
  return new Map(exceptions.map((exception) => [toDateKey(exception.date), exception]));
}

export function parseTimeToMinutes(time: string | null | undefined): number | null {
  const [hours, minutes] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function buildInterval(startMin: number | null, endMin: number | null) {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin === null || endMin === null || startMin >= endMin) {
    return null;
  }
  return { startMin, endMin };
}

function normalizeIntervals(rawIntervals: Array<{ startMin: number; endMin: number } | null | undefined>) {
  const sorted = rawIntervals
    .filter(Boolean)
    .map((interval) => buildInterval(interval?.startMin ?? null, interval?.endMin ?? null))
    .filter((interval): interval is { startMin: number; endMin: number } => Boolean(interval))
    .sort((left, right) => left.startMin - right.startMin || left.endMin - right.endMin);

  if (!sorted.length) return [];

  const merged = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.startMin <= previous.endMin) {
      previous.endMin = Math.max(previous.endMin, current.endMin);
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function subtractIntervals(baseIntervals: Array<{ startMin: number; endMin: number }>, blockedIntervals: Array<{ startMin: number; endMin: number }>) {
  if (!baseIntervals.length || !blockedIntervals.length) return baseIntervals;

  let current = baseIntervals;
  for (const blocker of blockedIntervals) {
    const next: Array<{ startMin: number; endMin: number }> = [];
    for (const interval of current) {
      if (blocker.endMin <= interval.startMin || blocker.startMin >= interval.endMin) {
        next.push(interval);
        continue;
      }
      if (blocker.startMin > interval.startMin) {
        next.push({ startMin: interval.startMin, endMin: Math.min(blocker.startMin, interval.endMin) });
      }
      if (blocker.endMin < interval.endMin) {
        next.push({ startMin: Math.max(blocker.endMin, interval.startMin), endMin: interval.endMin });
      }
    }
    current = next.filter((interval) => interval.endMin > interval.startMin);
    if (!current.length) break;
  }
  return current;
}

function applyLunchBreak(intervals: Array<{ startMin: number; endMin: number }>, lunchBreak?: PlanningLunchBreak | null) {
  if (!lunchBreak?.isActive) return intervals;
  const lunchInterval = buildInterval(parseTimeToMinutes(lunchBreak.startTime), parseTimeToMinutes(lunchBreak.endTime));
  if (!lunchInterval) return intervals;
  return subtractIntervals(intervals, [lunchInterval]);
}

function scheduleIntervalsForDay(schedule: PlanningSchedule | null, date: Date) {
  const daySchedule = schedule?.weeklySchedule?.find((entry) => Number(entry.dayOfWeek) === date.getDay()) ?? null;
  if (!daySchedule?.isWorking) return [];
  return normalizeIntervals(
    (daySchedule.slots ?? []).map((slot) => buildInterval(parseTimeToMinutes(slot.startTime), parseTimeToMinutes(slot.endTime))),
  );
}

function exceptionIntervals(exception: PlanningException | null | undefined) {
  if (!exception) return [];
  const slots = (exception.slots ?? [])
    .map((slot) => buildInterval(parseTimeToMinutes(slot.startTime), parseTimeToMinutes(slot.endTime)))
    .filter((slot): slot is { startMin: number; endMin: number } => Boolean(slot));
  if (slots.length) return normalizeIntervals(slots);
  const fallback = buildInterval(parseTimeToMinutes(exception.startTime), parseTimeToMinutes(exception.endTime));
  return normalizeIntervals(fallback ? [fallback] : []);
}

export function buildAvailabilityWindows(
  schedule: PlanningSchedule | null,
  date: Date,
  exception?: PlanningException | null,
) {
  const weeklyIntervals = scheduleIntervalsForDay(schedule, date);
  if (exception?.type === 'block' && exception.isFullDay) {
    return { available: [], blocked: [{ startMin: 0, endMin: 24 * 60 }] };
  }

  const exceptionSlots = exceptionIntervals(exception);
  let available = weeklyIntervals;
  let blocked = [] as Array<{ startMin: number; endMin: number }>;

  if (exception?.type === 'modify') {
    available = exceptionSlots;
  } else if (exception?.type === 'add') {
    available = normalizeIntervals([...weeklyIntervals, ...exceptionSlots]);
  } else if (exception?.type === 'block') {
    blocked = exceptionSlots;
    available = subtractIntervals(weeklyIntervals, exceptionSlots);
  }

  return {
    available: applyLunchBreak(available, schedule?.lunchBreak),
    blocked,
  };
}

export function inferHourRange({
  items,
  schedule,
  exceptions,
}: {
  items: CalendarItem[];
  schedule: PlanningSchedule | null;
  exceptions: PlanningException[];
}) {
  const values: number[] = [8 * 60, 20 * 60];
  for (const item of items) {
    const start = new Date(item.startAt);
    const end = new Date(item.endAt);
    values.push(start.getHours() * 60 + start.getMinutes());
    values.push(end.getHours() * 60 + end.getMinutes());
  }
  for (const day of schedule?.weeklySchedule ?? []) {
    for (const slot of day.slots ?? []) {
      const start = parseTimeToMinutes(slot.startTime);
      const end = parseTimeToMinutes(slot.endTime);
      if (start !== null) values.push(start);
      if (end !== null) values.push(end);
    }
  }
  for (const exception of exceptions) {
    if (exception.isFullDay) {
      values.push(0, 24 * 60);
      continue;
    }
    for (const slot of exception.slots ?? []) {
      const start = parseTimeToMinutes(slot.startTime);
      const end = parseTimeToMinutes(slot.endTime);
      if (start !== null) values.push(start);
      if (end !== null) values.push(end);
    }
    const fallbackStart = parseTimeToMinutes(exception.startTime);
    const fallbackEnd = parseTimeToMinutes(exception.endTime);
    if (fallbackStart !== null) values.push(fallbackStart);
    if (fallbackEnd !== null) values.push(fallbackEnd);
  }

  const min = Math.max(0, Math.floor(Math.min(...values) / 60) - 1);
  const max = Math.min(24, Math.ceil(Math.max(...values) / 60) + 1);
  return { startHour: min, endHour: Math.max(min + 8, max) };
}

export interface UsePlanningResult {
  items: CalendarItem[];
  isLoading: boolean;
  isError: boolean;
  cancel: (bookingId: string, reason?: string) => Promise<unknown>;
  markPaid: (bookingId: string) => Promise<unknown>;
  reschedule: (bookingId: string, payload: RescheduleBookingPayload) => Promise<unknown>;
  refetch: () => void;
}

export function usePlanning(params: {
  date: Date;
  view: PlanningView;
  type?: CalendarItemType | null;
}): UsePlanningResult {
  const qc = useQueryClient();
  const { start, end } = planningRange(params.date, params.view);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const type = params.type ?? null;

  const query = useQuery({
    queryKey: ['planning', startIso, endIso, type],
    queryFn: () => listCalendarItems({ startDate: startIso, endDate: endIso, type }),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['planning'] });
  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => cancelBooking(id, reason),
    onSuccess: invalidate,
  });
  const paidMut = useMutation({
    mutationFn: (id: string) => markBalancePaid(id),
    onSuccess: invalidate,
  });
  const rescheduleMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RescheduleBookingPayload }) => rescheduleBooking(id, payload),
    onSuccess: invalidate,
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    cancel: (id, reason) => cancelMut.mutateAsync({ id, reason }),
    markPaid: (id) => paidMut.mutateAsync(id),
    reschedule: (id, payload) => rescheduleMut.mutateAsync({ id, payload }),
    refetch: () => void query.refetch(),
  };
}

export interface UseBookingDetailResult {
  pricing: BookingPricingBreakdown | null;
  participant: BookingParticipant | null;
  isLoading: boolean;
}

/**
 * Charge le détail enrichi d'une réservation prestation (prix réel vendu + ventilation
 * carte cadeau/en ligne/sur place + participant). N'est actif que pour un service_booking ;
 * les autres types (formation/bloqué) restent servis par les champs de l'item du calendrier.
 */
export function useBookingDetail(item: CalendarItem | null): UseBookingDetailResult {
  const enabled = Boolean(item && item.type === 'service_booking');
  const query = useQuery({
    queryKey: ['booking-detail', item?.id ?? null],
    enabled,
    queryFn: () => getBookingDetail(item!.id),
    staleTime: 30_000,
    retry: false,
  });

  return {
    pricing: query.data?.pricing ?? null,
    participant: query.data?.participant ?? null,
    isLoading: enabled && query.isLoading,
  };
}

export function usePlanningAvailability(params: { date: Date; view: PlanningView }) {
  const qc = useQueryClient();
  const { start, end } = planningRange(params.date, params.view);
  const exceptionsStart = addDays(start, -7).toISOString();
  const exceptionsEnd = addDays(end, 21).toISOString();

  const scheduleQuery = useQuery({
    queryKey: ['planning-availability', 'me'],
    queryFn: getMyPlanningAvailability,
    staleTime: 30_000,
    retry: false,
  });

  const practitionerId = scheduleQuery.data?.practitionerId ?? null;
  const exceptionsQuery = useQuery({
    queryKey: ['planning-exceptions', practitionerId, exceptionsStart, exceptionsEnd],
    enabled: Boolean(practitionerId),
    queryFn: () => listPlanningExceptions(practitionerId!, { from: exceptionsStart, to: exceptionsEnd }),
    staleTime: 30_000,
    retry: false,
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['planning-availability'] }),
      qc.invalidateQueries({ queryKey: ['planning-exceptions'] }),
      qc.invalidateQueries({ queryKey: ['planning'] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: (input: { weeklySchedule: PlanningWeekdaySchedule[]; lunchBreak?: PlanningLunchBreak | null }) => {
      if (!practitionerId) throw new Error('Calendrier institut introuvable.');
      return savePlanningSchedule(practitionerId, input);
    },
    onSuccess: invalidate,
  });
  const createMutation = useMutation({
    mutationFn: (input: PlanningExceptionInput) => createPlanningException(input),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PlanningExceptionInput> }) => updatePlanningException(id, input),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePlanningException(id),
    onSuccess: invalidate,
  });

  return {
    practitionerId,
    schedule: scheduleQuery.data?.schedule ?? null,
    exceptions: exceptionsQuery.data ?? [],
    isLoading: scheduleQuery.isLoading || (Boolean(practitionerId) && exceptionsQuery.isLoading),
    isError: scheduleQuery.isError || exceptionsQuery.isError,
    saveSchedule: saveMutation.mutateAsync,
    createException: createMutation.mutateAsync,
    updateException: (id: string, input: Partial<PlanningExceptionInput>) => updateMutation.mutateAsync({ id, input }),
    deleteException: (id: string) => deleteMutation.mutateAsync(id),
    isSaving:
      saveMutation.isPending
      || createMutation.isPending
      || updateMutation.isPending
      || deleteMutation.isPending,
  };
}
