import { useQuery } from '@tanstack/react-query';
import { getPublicShop, getPublicProductById, type PublicShopResponse } from '@bs/api-client';
import { SHOP_QUERY_KEY } from './usePublicShop';

export function usePublicProducts() {
  return useQuery<PublicShopResponse, Error, PublicShopResponse['products']>({
    queryKey: SHOP_QUERY_KEY,
    queryFn: ({ signal }) => getPublicShop(signal),
    select: (data) => data.products,
  });
}

export function usePublicProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['catalog', 'product', id],
    queryFn: ({ signal }) => getPublicProductById(id as string, signal),
    enabled: Boolean(id),
  });
}
