// RX2.6 — Hooks Gift Card Finance (TanStack Query). Lecture seule ; le backend agrège/masque.
import { useQuery } from '@tanstack/react-query';
import {
  listFinanceGiftCards, getFinanceGiftCardDetail,
  type FinanceGiftCardsResult, type FinanceGiftCardDetail, type FinanceGiftCardFilters,
} from '@bs/api-client';

export function useFinanceGiftCards(filters: FinanceGiftCardFilters) {
  return useQuery<FinanceGiftCardsResult>({
    queryKey: ['finance', 'gift-cards', filters.creationMode ?? '', filters.status ?? '', filters.search ?? ''],
    queryFn: () => listFinanceGiftCards(filters),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useFinanceGiftCardDetail(giftCardId: string | undefined) {
  return useQuery<FinanceGiftCardDetail>({
    queryKey: ['finance', 'gift-card-detail', giftCardId],
    queryFn: () => getFinanceGiftCardDetail(giftCardId as string),
    enabled: Boolean(giftCardId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}
