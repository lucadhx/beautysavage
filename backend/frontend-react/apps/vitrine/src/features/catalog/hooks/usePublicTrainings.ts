import { useQuery } from '@tanstack/react-query';
import { getPublicShop, getPublicTrainingById, type PublicShopResponse } from '@bs/api-client';
import { SHOP_QUERY_KEY } from './usePublicShop';

// Dérive les formations du /shop partagé (même clé → un seul fetch pour formations + produits).
export function usePublicTrainings() {
  return useQuery<PublicShopResponse, Error, PublicShopResponse['formations']>({
    queryKey: SHOP_QUERY_KEY,
    queryFn: ({ signal }) => getPublicShop(signal),
    select: (data) => data.formations,
  });
}

export function usePublicTraining(id: string | undefined) {
  return useQuery({
    queryKey: ['catalog', 'training', id],
    queryFn: ({ signal }) => getPublicTrainingById(id as string, signal),
    enabled: Boolean(id),
  });
}
