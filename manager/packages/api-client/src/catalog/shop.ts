// Boutique publique : formations + produits ensemble. GET /api/vitrine/shop.
import { apiFetch } from '../apiFetch';
import { rawArr } from './raw';
import { mapTraining, mapProduct } from './mappers';
import type { PublicShopResponse } from './types';

export async function getPublicShop(signal?: AbortSignal): Promise<PublicShopResponse> {
  const res = await apiFetch<{ ok: boolean; formations?: unknown; products?: unknown }>(
    '/api/vitrine/shop',
    { signal },
  );
  return {
    formations: rawArr(res.formations).map(mapTraining),
    products: rawArr(res.products).map(mapProduct),
  };
}
