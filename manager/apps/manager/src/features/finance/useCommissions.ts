// RX2.5 — Hooks Commissions premium (TanStack Query). Lecture + paiement Stripe Dev hébergé (U3).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCommissionOverview, getCommissionHistory, getCommissionDetail, createCommissionPaymentIntent,
  type CommissionOverview, type CommissionHistory, type CommissionDetail,
} from '@bs/api-client';

export function useCommissionOverview() {
  return useQuery<CommissionOverview>({
    queryKey: ['finance', 'commissions', 'current'],
    queryFn: () => getCommissionOverview(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useCommissionHistory() {
  return useQuery<CommissionHistory>({
    queryKey: ['finance', 'commissions', 'history'],
    queryFn: () => getCommissionHistory(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useCommissionDetail(year: number | undefined, month: number | undefined) {
  return useQuery<CommissionDetail>({
    queryKey: ['finance', 'commissions', 'detail', year, month],
    queryFn: () => getCommissionDetail(year as number, month as number),
    enabled: Number.isInteger(year) && Number.isInteger(month),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// Paiement : crée l'intent hébergé (U3). Le composant gère la redirection / le settledZero.
export function usePayCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => createCommissionPaymentIntent(paymentId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
}
