// RX2 — Hooks Finance (TanStack Query). Le backend agrège/exécute et fait autorité ;
// aucune logique de calcul de montant côté front.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFinanceDashboard, getFinanceTimeline, getFinanceMovementDetail,
  processRefundStatus, markBookingBalancePaid,
  type FinanceDashboard, type FinanceRange,
  type FinanceTimeline, type FinanceTimelineFilters,
  type FinanceMovementDetail, type FinanceMovementRef, type BalancePaymentMethod,
} from '@bs/api-client';

export function useFinanceDashboard(range: FinanceRange) {
  return useQuery<FinanceDashboard>({
    queryKey: ['finance', 'dashboard', range],
    queryFn: () => getFinanceDashboard(range),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// RX2.2 — Financial Timeline.
export function useFinanceTimeline(filters: FinanceTimelineFilters) {
  return useQuery<FinanceTimeline>({
    queryKey: ['finance', 'timeline', filters.period ?? 'all', filters.type ?? 'all', filters.status ?? '', filters.limit ?? 50],
    queryFn: () => getFinanceTimeline(filters),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// RX2.3 — Détail d'un mouvement (breakdown paiement + profit net).
export function useFinanceMovementDetail(ref: FinanceMovementRef | null) {
  return useQuery<FinanceMovementDetail>({
    queryKey: ['finance', 'movement-detail', ref?.sourceModel, ref?.sourceId, ref?.type],
    queryFn: () => getFinanceMovementDetail(ref as FinanceMovementRef),
    enabled: Boolean(ref?.sourceModel && ref?.sourceId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

// RX2.3 — Remboursement 1-clic (réutilise la route B1 via refundService côté backend).
export function useProcessRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ refundId, decision, reason }: { refundId: string; decision: 'accept' | 'refuse'; reason?: string }) =>
      processRefundStatus(refundId, decision, reason),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
}

// RX2.3 — Encaissement du solde sur place (M11 balance-paid + moyen de paiement).
export function useMarkBalancePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, paymentMethod }: { bookingId: string; paymentMethod?: BalancePaymentMethod }) =>
      markBookingBalancePaid(bookingId, paymentMethod),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
}
