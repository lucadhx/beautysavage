import { useQuery } from '@tanstack/react-query';
import { getPublicShop, type PublicShopResponse } from '@bs/api-client';

// Clé partagée : formations et produits proviennent du même endpoint /shop (un seul fetch en cache).
export const SHOP_QUERY_KEY = ['catalog', 'shop'] as const;

export function usePublicShop() {
  return useQuery<PublicShopResponse>({
    queryKey: SHOP_QUERY_KEY,
    queryFn: ({ signal }) => getPublicShop(signal),
  });
}
