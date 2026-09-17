// Produits publics. Liste dérivée de /api/vitrine/shop ; détail /api/vitrine/products/:id.
import { apiFetch } from '../apiFetch';
import { getPublicShop } from './shop';
import { mapProduct } from './mappers';
import type { PublicProduct } from './types';

export async function getPublicProducts(signal?: AbortSignal): Promise<PublicProduct[]> {
  const { products } = await getPublicShop(signal);
  return products;
}

export async function getPublicProductById(productId: string, signal?: AbortSignal): Promise<PublicProduct> {
  const res = await apiFetch<{ ok: boolean; product?: unknown }>(
    `/api/vitrine/products/${encodeURIComponent(productId)}`,
    { signal },
  );
  return mapProduct(res.product);
}
