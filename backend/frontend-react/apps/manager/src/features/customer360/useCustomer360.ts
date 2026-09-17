// M12 — Hooks Customer 360 (TanStack Query). Lecture seule ; le backend agrège et fait autorité.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getCustomer360, searchCustomers, type Customer360, type CustomerSearchCard } from '@bs/api-client';

export function useCustomer360(customerId: string | undefined) {
  return useQuery<Customer360>({
    queryKey: ['customer360', customerId],
    queryFn: () => getCustomer360(customerId as string),
    enabled: Boolean(customerId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useCustomerSearch(search: string) {
  return useQuery<CustomerSearchCard[]>({
    queryKey: ['customers', 'search', search.trim()],
    queryFn: ({ signal }) => searchCustomers(search.trim() || undefined, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
