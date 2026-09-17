import { useQuery } from '@tanstack/react-query';
import { getServiceAvailableDays, getServiceAvailableSlots } from '@bs/api-client';

export function useServiceAvailableDays(serviceId: string | undefined, year: number, month: number) {
  return useQuery({
    queryKey: ['availability', 'days', serviceId, year, month],
    queryFn: ({ signal }) => getServiceAvailableDays({ serviceId: serviceId as string, year, month }, signal),
    enabled: Boolean(serviceId),
  });
}

export function useServiceAvailableSlots(
  serviceId: string | undefined,
  date: string | null,
  practitionerId?: string | null,
) {
  return useQuery({
    queryKey: ['availability', 'slots', serviceId, date, practitionerId ?? null],
    queryFn: ({ signal }) =>
      getServiceAvailableSlots({ serviceId: serviceId as string, date: date as string, practitionerId }, signal),
    enabled: Boolean(serviceId && date),
  });
}
